import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type Ref,
} from 'vue'
import { keysAPI } from '@/api/keys'
import type { ApiKey } from '@/types'
import * as mediaApi from './api'
import * as historyStore from './history'
import { MediaApiError } from './types'
import type {
  MediaHistoryInput,
  MediaHistoryRecord,
  MediaMode,
  MediaModel,
  VideoTaskResponse,
} from './types'

const KEY_PAGE_SIZE = 100
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const POLL_INTERVAL_MS = 3_000
const VIDEO_TIMEOUT_MS = 5 * 60 * 1_000
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_LIKE_MODEL_PATTERN = /(?:video|image-to-video|i2v)/i
const GROK_VIDEO_MODEL_PATTERN = /^grok-(?:imagine-video|image-video|video-1\.5)(?:$|[-.])/i
const GROK_MODEL_PREFIX_PATTERN = /^(?:xai|x-ai|grok)\//i
const IMAGE_MODEL_PATTERN = /(?:image|imagine|dall[-_ ]?e|flux|stable[-_ ]?diffusion|sdxl|recraft|midjourney|ideogram|imagen|nano[-_ ]?banana)/i
const IMAGE_PLATFORMS = new Set(['openai', 'grok', 'composite'])
const VIDEO_PLATFORMS = new Set(['grok', 'composite'])

class VideoTimeoutError extends Error {
  constructor() {
    super('Video generation exceeded its deadline')
    this.name = 'VideoTimeoutError'
  }
}

export interface MediaKeyOption {
  id: string
  name: string
  groupName: string
}

export interface MediaCanvasResult extends MediaHistoryRecord {
  previewUrl: string
}

export type MediaCanvasError =
  | 'loadKeys'
  | 'loadModels'
  | 'invalidFile'
  | 'fileTooLarge'
  | 'promptRequired'
  | 'keyRequired'
  | 'modelRequired'
  | 'generation'
  | 'videoFailed'
  | 'videoTimeout'
  | 'history'

function normalizeOwner(owner: string | number | null | undefined): string {
  return owner === null || owner === undefined ? '' : String(owner).trim()
}

function isKeyAvailable(key: ApiKey, now: number): boolean {
  if (key.status !== 'active') return false
  if (!key.expires_at) return true
  const expiresAt = Date.parse(key.expires_at)
  return Number.isFinite(expiresAt) && expiresAt > now
}

function normalizedGrokModelId(modelId: string): string {
  return modelId.trim().replace(GROK_MODEL_PREFIX_PATTERN, '').toLowerCase()
}

function isVideoLikeModel(model: MediaModel): boolean {
  return VIDEO_LIKE_MODEL_PATTERN.test(model.id) || /video/i.test(model.object || '')
}

function isSupportedGrokVideoModel(model: MediaModel): boolean {
  return GROK_VIDEO_MODEL_PATTERN.test(normalizedGrokModelId(model.id))
}

function filterModels(models: MediaModel[], key: ApiKey | undefined, mode: MediaMode): MediaModel[] {
  const platform = key?.group?.platform?.toLowerCase()
  if (!platform) return []
  if (mode === 'video') {
    return VIDEO_PLATFORMS.has(platform) ? models.filter(isSupportedGrokVideoModel) : []
  }
  return IMAGE_PLATFORMS.has(platform)
    ? models.filter(model => !isVideoLikeModel(model) && IMAGE_MODEL_PATTERN.test(model.id))
    : []
}

function nestedRecord(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined
  const record = value as Record<string, unknown>
  for (const key of ['data', 'task', 'result']) {
    const nested = nestedRecord(record[key], depth + 1)
    if (nested && ('status' in nested || 'request_id' in nested || 'task_id' in nested || 'id' in nested || 'video' in nested)) {
      return nested
    }
  }
  return record
}

function taskId(response: VideoTaskResponse): string | undefined {
  const record = nestedRecord(response)
  const id = response.request_id ?? response.task_id ?? response.id ?? record?.request_id ?? record?.task_id ?? record?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
}

function taskStatus(response: VideoTaskResponse): string {
  const record = nestedRecord(response)
  if (typeof response.status === 'string') return response.status.toLowerCase()
  if (typeof record?.status === 'string') return record.status.toLowerCase()
  const video = record?.video
  if (video && typeof video === 'object' && typeof (video as Record<string, unknown>).url === 'string') return 'done'
  return ''
}

function taskProgress(response: VideoTaskResponse): number | null {
  const record = nestedRecord(response)
  const value = response.progress ?? record?.progress
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null
}

function safeFilename(value: string): string {
  const cleaned = value.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return cleaned || 'media-canvas'
}

export function useMediaCanvas(ownerId: Ref<string | number | null | undefined>) {
  const mode = ref<MediaMode>('image')
  const prompt = ref('')
  const selectedKeyId = ref('')
  const keyOptions = ref<MediaKeyOption[]>([])
  const models = ref<MediaModel[]>([])
  const modelId = ref('')
  const imageSize = ref('1024x1024')
  const imageQuality = ref('auto')
  const imageCount = ref(1)
  const aspectRatio = ref('1:1')
  const videoDuration = ref(6)
  const videoResolution = ref('720p')
  const upload = ref<File | null>(null)
  const busy = ref(false)
  const loadingKeys = ref(false)
  const loadingModels = ref(false)
  const loadingHistory = ref(false)
  const error = ref<MediaCanvasError | ''>('')
  const errorDetail = ref('')
  const status = ref<'idle' | 'submitting' | 'processing' | 'completed' | 'failed' | 'stopped'>('idle')
  const progress = ref<number | null>(null)
  const results = ref<MediaCanvasResult[]>([])
  const localHistory = ref<MediaCanvasResult[]>([])
  const availableModels = ref<MediaModel[]>([])

  const keysById = new Map<string, ApiKey>()
  const previewUrls = new Map<number, string>()
  let activeController: AbortController | null = null
  let keyLoadController: AbortController | null = null
  let modelLoadController: AbortController | null = null
  let keyLoadRevision = 0
  let modelLoadRevision = 0
  let historyLoadRevision = 0
  let runRevision = 0
  let fallbackRecordId = -1

  const currentOwnerId = computed(() => normalizeOwner(ownerId.value))
  const selectedKey = computed(() => keysById.get(selectedKeyId.value))
  const canGenerate = computed(() => Boolean(
    !busy.value && currentOwnerId.value && prompt.value.trim() && selectedKey.value && modelId.value,
  ))

  function revokeUnusedUrls(keepIds: Set<number> = new Set()) {
    for (const [id, url] of previewUrls) {
      if (keepIds.has(id)) continue
      URL.revokeObjectURL(url)
      previewUrls.delete(id)
    }
  }

  function previewFor(record: MediaHistoryRecord): MediaCanvasResult {
    let previewUrl = previewUrls.get(record.id)
    if (!previewUrl) {
      previewUrl = URL.createObjectURL(record.blob)
      previewUrls.set(record.id, previewUrl)
    }
    return { ...record, previewUrl }
  }

  function resetAccountState() {
    stop()
    keyLoadController?.abort()
    modelLoadController?.abort()
    selectedKeyId.value = ''
    keyOptions.value = []
    keysById.clear()
    availableModels.value = []
    models.value = []
    modelId.value = ''
    upload.value = null
    prompt.value = ''
    loadingKeys.value = false
    loadingModels.value = false
    loadingHistory.value = false
    error.value = ''
    errorDetail.value = ''
    progress.value = null
    status.value = 'idle'
    results.value = []
    localHistory.value = []
    revokeUnusedUrls()
  }

  async function loadKeys() {
    const revision = ++keyLoadRevision
    keyLoadController?.abort()
    const controller = new AbortController()
    keyLoadController = controller
    const requestedOwner = currentOwnerId.value
    loadingKeys.value = true
    error.value = ''
    errorDetail.value = ''
    keysById.clear()
    keyOptions.value = []
    selectedKeyId.value = ''
    try {
      if (!requestedOwner) return
      const allKeys: ApiKey[] = []
      let page = 1
      let pages = 1
      do {
        const response = await keysAPI.list(page, KEY_PAGE_SIZE, undefined, { signal: controller.signal })
        if (revision !== keyLoadRevision || requestedOwner !== currentOwnerId.value) return
        allKeys.push(...response.items)
        pages = Math.max(1, response.pages || Math.ceil(response.total / KEY_PAGE_SIZE) || 1)
        page += 1
      } while (page <= pages)

      const now = Date.now()
      const activeKeys = allKeys.filter(key => isKeyAvailable(key, now))
      activeKeys.forEach(key => keysById.set(String(key.id), key))
      keyOptions.value = activeKeys.map(key => ({
        id: String(key.id),
        name: key.name,
        groupName: key.group?.name || '',
      }))
    } catch {
      if (revision === keyLoadRevision && requestedOwner === currentOwnerId.value) error.value = 'loadKeys'
    } finally {
      if (revision === keyLoadRevision) loadingKeys.value = false
    }
  }

  async function loadModels() {
    const revision = ++modelLoadRevision
    modelLoadController?.abort()
    const controller = new AbortController()
    modelLoadController = controller
    const key = selectedKey.value
    const requestedOwner = currentOwnerId.value
    availableModels.value = []
    models.value = []
    modelId.value = ''
    error.value = ''
    errorDetail.value = ''
    if (!key || !requestedOwner) {
      loadingModels.value = false
      return
    }

    loadingModels.value = true
    try {
      const response = await mediaApi.listModels({ apiKey: key.key, signal: controller.signal })
      if (revision !== modelLoadRevision || key.id !== selectedKey.value?.id || requestedOwner !== currentOwnerId.value) return
      availableModels.value = response.data
      models.value = filterModels(availableModels.value, key, mode.value)
      modelId.value = models.value[0]?.id || ''
    } catch (cause) {
      if (revision === modelLoadRevision && key.id === selectedKey.value?.id && requestedOwner === currentOwnerId.value) {
        error.value = 'loadModels'
        if (cause instanceof MediaApiError) errorDetail.value = cause.message.split(key.key).join('[redacted]').slice(0, 500)
      }
    } finally {
      if (revision === modelLoadRevision) loadingModels.value = false
    }
  }

  async function reloadHistory() {
    const revision = ++historyLoadRevision
    const requestedOwner = currentOwnerId.value
    if (!requestedOwner) {
      localHistory.value = []
      return
    }
    loadingHistory.value = true
    try {
      const records = await historyStore.listHistory(requestedOwner)
      if (revision !== historyLoadRevision || requestedOwner !== currentOwnerId.value) return
      localHistory.value = records.map(previewFor)
      revokeUnusedUrls(new Set([...records, ...results.value].map(record => record.id)))
    } catch {
      if (revision === historyLoadRevision && requestedOwner === currentOwnerId.value) error.value = 'history'
    } finally {
      if (revision === historyLoadRevision) loadingHistory.value = false
    }
  }

  function setUpload(file: File | null) {
    error.value = ''
    errorDetail.value = ''
    if (file && !ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      error.value = 'invalidFile'
      return false
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      error.value = 'fileTooLarge'
      return false
    }
    upload.value = file
    return true
  }

  function abortActiveRun(nextStatus: 'idle' | 'stopped' = 'stopped') {
    runRevision += 1
    activeController?.abort()
    activeController = null
    if (busy.value) {
      busy.value = false
      status.value = nextStatus
    }
  }

  function stop() {
    abortActiveRun('stopped')
  }

  async function waitBeforeNextPoll(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, POLL_INTERVAL_MS)
      const onAbort = () => {
        window.clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function historyInput(
    blob: Blob,
    keyName: string,
    savedMode: MediaMode,
    savedModel: string,
    settings: MediaHistoryInput['settings'],
    savedPrompt: string,
  ): MediaHistoryInput {
    return {
      mode: savedMode,
      prompt: savedPrompt,
      model: savedModel,
      settings,
      keyName,
      blob,
      createdAt: Date.now(),
    }
  }

  async function addResult(
    blob: Blob,
    keyName: string,
    savedMode: MediaMode,
    savedModel: string,
    settings: MediaHistoryInput['settings'],
    savedPrompt: string,
    requestedOwner: string,
    revision: number,
  ) {
    if (requestedOwner !== currentOwnerId.value || revision !== runRevision) return
    const input = historyInput(blob, keyName, savedMode, savedModel, settings, savedPrompt)
    let record: MediaHistoryRecord
    try {
      record = await historyStore.saveHistory(requestedOwner, input)
    } catch {
      if (requestedOwner !== currentOwnerId.value || revision !== runRevision) return
      // Keep the generated Blob usable in this session if local browser storage is unavailable.
      record = { ...input, id: fallbackRecordId--, ownerId: requestedOwner }
      error.value = 'history'
    }
    if (requestedOwner !== currentOwnerId.value || revision !== runRevision) return
    const result = previewFor(record)
    results.value = [result, ...results.value]
    if (record.id > 0) localHistory.value = [result, ...localHistory.value.filter(item => item.id !== record.id)]
  }

  async function generateImageResult(
    apiKey: string,
    keyName: string,
    savedModel: string,
    settings: MediaHistoryInput['settings'],
    savedPrompt: string,
    requestedOwner: string,
    revision: number,
    signal: AbortSignal,
  ) {
    const common = {
      apiKey,
      signal,
      model: savedModel,
      prompt: savedPrompt,
      size: String(settings.size),
      quality: String(settings.quality),
      n: Number(settings.count),
      aspect_ratio: String(settings.aspectRatio),
    }
    const response = upload.value
      ? await mediaApi.editImage({ ...common, response_format: 'b64_json', image: upload.value })
      : await mediaApi.generateImage({ ...common, response_format: 'b64_json' })
    if (!response.data?.length) throw new Error('Image response did not include image data')
    for (const item of response.data || []) {
      if (signal.aborted || revision !== runRevision) return
      const blob = await mediaApi.imageToBlob(item, { apiKey, signal })
      await addResult(blob, keyName, 'image', savedModel, settings, savedPrompt, requestedOwner, revision)
    }
    if (revision === runRevision && requestedOwner === currentOwnerId.value) {
      status.value = 'completed'
      progress.value = 100
    }
  }

  async function generateVideoResult(
    apiKey: string,
    keyName: string,
    savedModel: string,
    settings: MediaHistoryInput['settings'],
    savedPrompt: string,
    requestedOwner: string,
    revision: number,
    signal: AbortSignal,
    onTaskSubmitted: () => void,
  ) {
    const submitted = await mediaApi.generateVideo({
      apiKey,
      signal,
      model: savedModel,
      prompt: savedPrompt,
      duration: Number(settings.duration),
      aspect_ratio: String(settings.aspectRatio),
      resolution: String(settings.resolution),
      firstFrame: upload.value || undefined,
    })
    if (signal.aborted || revision !== runRevision || requestedOwner !== currentOwnerId.value) return
    const id = taskId(submitted)
    if (!id) throw new Error('Missing video task id')
    onTaskSubmitted()
    status.value = 'processing'
    const deadline = Date.now() + VIDEO_TIMEOUT_MS
    let terminal = ''

    while (!signal.aborted && revision === runRevision) {
      if (Date.now() >= deadline) {
        error.value = 'videoTimeout'
        status.value = 'failed'
        return
      }
      let timeout: number | undefined
      let abortHandler: (() => void) | undefined
      let task: VideoTaskResponse
      try {
        task = await Promise.race([
          mediaApi.getVideoStatus({ apiKey, requestId: id, signal }),
          new Promise<never>((_resolve, reject) => {
            abortHandler = () => reject(new DOMException('Aborted', 'AbortError'))
            if (signal.aborted) abortHandler()
            else signal.addEventListener('abort', abortHandler, { once: true })
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = window.setTimeout(() => {
              reject(new VideoTimeoutError())
              if (revision === runRevision && requestedOwner === currentOwnerId.value) activeController?.abort()
            }, Math.max(0, deadline - Date.now()))
          }),
        ])
      } catch (cause) {
        if (cause instanceof VideoTimeoutError && revision === runRevision && requestedOwner === currentOwnerId.value) {
          error.value = 'videoTimeout'
          status.value = 'failed'
        }
        throw cause
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout)
        if (abortHandler) signal.removeEventListener('abort', abortHandler)
      }
      if (signal.aborted || revision !== runRevision || requestedOwner !== currentOwnerId.value) return
      const state = taskStatus(task)
      const taskProgressValue = taskProgress(task)
      if (taskProgressValue !== null) progress.value = taskProgressValue
      if (['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(state)) {
        terminal = 'success'
        break
      }
      if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(state)) {
        terminal = 'failed'
        break
      }
      await waitBeforeNextPoll(signal)
    }
    if (signal.aborted || revision !== runRevision) return
    if (terminal !== 'success') {
      error.value = 'videoFailed'
      status.value = 'failed'
      return
    }
    const blob = await mediaApi.getVideoContent({ apiKey, requestId: id, signal })
    await addResult(blob, keyName, 'video', savedModel, settings, savedPrompt, requestedOwner, revision)
    if (revision === runRevision && requestedOwner === currentOwnerId.value) {
      status.value = 'completed'
      progress.value = 100
    }
  }

  async function generate() {
    if (busy.value) return
    error.value = ''
    errorDetail.value = ''
    if (!currentOwnerId.value) return
    if (!prompt.value.trim()) { error.value = 'promptRequired'; return }
    const key = selectedKey.value
    if (!key) { error.value = 'keyRequired'; return }
    if (!modelId.value || !models.value.some(model => model.id === modelId.value)) { error.value = 'modelRequired'; return }

    const requestedOwner = currentOwnerId.value
    const savedMode = mode.value
    const savedModel = modelId.value
    const savedPrompt = prompt.value.trim()
    const settings: MediaHistoryInput['settings'] = savedMode === 'image'
      ? {
          size: imageSize.value,
          quality: imageQuality.value,
          count: Math.max(1, Math.min(4, Math.trunc(imageCount.value) || 1)),
          aspectRatio: aspectRatio.value,
        }
      : { duration: videoDuration.value, resolution: videoResolution.value, aspectRatio: aspectRatio.value }
    const keyName = key.name
    const apiKey = key.key
    const revision = ++runRevision
    let videoTaskSubmitted = false
    const controller = new AbortController()
    activeController = controller
    busy.value = true
    status.value = 'submitting'
    progress.value = 0
    try {
      if (savedMode === 'video') {
        await generateVideoResult(apiKey, keyName, savedModel, settings, savedPrompt, requestedOwner, revision, controller.signal, () => { videoTaskSubmitted = true })
      } else {
        await generateImageResult(apiKey, keyName, savedModel, settings, savedPrompt, requestedOwner, revision, controller.signal)
      }
    } catch (cause) {
      if ((!controller.signal.aborted || cause instanceof VideoTimeoutError) && revision === runRevision && requestedOwner === currentOwnerId.value) {
        if (cause instanceof VideoTimeoutError) error.value = 'videoTimeout'
        else if (videoTaskSubmitted) error.value = 'videoFailed'
        else error.value = 'generation'
        if (cause instanceof MediaApiError) {
          errorDetail.value = cause.message.split(apiKey).join('[redacted]').slice(0, 500)
        }
        status.value = 'failed'
      }
    } finally {
      if (revision === runRevision) {
        busy.value = false
        activeController = null
      }
    }
  }

  async function deleteLocalRecord(record: MediaCanvasResult | MediaHistoryRecord) {
    const requestedOwner = currentOwnerId.value
    if (!requestedOwner || record.ownerId !== requestedOwner) return
    const revision = historyLoadRevision
    try {
      await historyStore.deleteHistory(requestedOwner, record.id)
      if (requestedOwner !== currentOwnerId.value || revision !== historyLoadRevision) return
      localHistory.value = localHistory.value.filter(item => item.id !== record.id)
      results.value = results.value.filter(item => item.id !== record.id)
      revokeUnusedUrls(new Set([...localHistory.value, ...results.value].map(item => item.id)))
    } catch {
      if (requestedOwner === currentOwnerId.value && revision === historyLoadRevision) error.value = 'history'
    }
  }

  async function clearLocalHistory() {
    if (!currentOwnerId.value) return
    const requestedOwner = currentOwnerId.value
    try {
      await historyStore.clearHistory(requestedOwner)
      if (requestedOwner !== currentOwnerId.value) return
      const removedIds = new Set(localHistory.value.map(record => record.id))
      localHistory.value = []
      results.value = results.value.filter(record => !removedIds.has(record.id))
      revokeUnusedUrls(new Set(results.value.map(item => item.id)))
    } catch {
      error.value = 'history'
    }
  }

  function download(record: MediaCanvasResult | MediaHistoryRecord) {
    const url = 'previewUrl' in record ? record.previewUrl : URL.createObjectURL(record.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeFilename(record.prompt)}.${record.mode === 'video' ? 'mp4' : record.blob.type === 'image/jpeg' ? 'jpg' : record.blob.type === 'image/webp' ? 'webp' : 'png'}`
    anchor.rel = 'noopener'
    anchor.click()
    if (!('previewUrl' in record)) URL.revokeObjectURL(url)
  }

  watch(selectedKeyId, () => { void loadModels() }, { flush: 'sync' })
  watch(mode, async () => {
    modelId.value = ''
    if (!selectedKey.value) {
      models.value = []
      return
    }
    // Refilter a cached response immediately when possible; otherwise load it for this key.
    if (availableModels.value.length) {
      models.value = filterModels(availableModels.value, selectedKey.value, mode.value)
      modelId.value = models.value[0]?.id || ''
    } else {
      await loadModels()
    }
  }, { flush: 'post' })
  watch(currentOwnerId, async (nextOwner, previousOwner) => {
    if (nextOwner === previousOwner) return
    keyLoadRevision += 1
    modelLoadRevision += 1
    historyLoadRevision += 1
    resetAccountState()
    error.value = ''
    if (!nextOwner) return
    await Promise.all([loadKeys(), reloadHistory()])
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    keyLoadRevision += 1
    modelLoadRevision += 1
    historyLoadRevision += 1
    abortActiveRun('stopped')
    keyLoadController?.abort()
    modelLoadController?.abort()
    revokeUnusedUrls()
    keysById.clear()
  })

  return {
    mode,
    prompt,
    selectedKeyId,
    keyOptions,
    models,
    modelId,
    imageSize,
    imageQuality,
    imageCount,
    aspectRatio,
    videoDuration,
    videoResolution,
    upload,
    busy,
    loadingKeys,
    loadingModels,
    loadingHistory,
    error,
    errorDetail,
    status,
    progress,
    results,
    localHistory,
    canGenerate,
    loadKeys,
    loadModels,
    reloadHistory,
    setUpload,
    generate,
    stop,
    deleteLocalRecord,
    clearLocalHistory,
    download,
  }
}
