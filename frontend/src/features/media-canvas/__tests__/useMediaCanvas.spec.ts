import { defineComponent, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaCanvas } from '../useMediaCanvas'
import { keysAPI } from '@/api/keys'
import * as api from '../api'
import * as history from '../history'
import { MediaApiError } from '../types'

vi.mock('@/api/keys', () => ({ keysAPI: { list: vi.fn() } }))
vi.mock('../api', () => ({ listModels: vi.fn(), generateImage: vi.fn(), editImage: vi.fn(), generateVideo: vi.fn(), getVideoStatus: vi.fn(), getVideoContent: vi.fn(), imageToBlob: vi.fn() }))
vi.mock('../history', () => ({ listHistory: vi.fn(), saveHistory: vi.fn(), deleteHistory: vi.fn(), clearHistory: vi.fn() }))

let canvas: ReturnType<typeof useMediaCanvas>
const wrappers: ReturnType<typeof mount>[] = []
const secret = 'secret-test-key'
const active = { id: 1, key: secret, name: 'My media key', status: 'active', group: { name: 'Media group', platform: 'grok' }, expires_at: null }
function start(owner = ref('user-1')) {
  const wrapper = mount(defineComponent({ setup() { canvas = useMediaCanvas(owner); return () => null } }))
  wrappers.push(wrapper)
  return { wrapper, owner }
}
async function ready() {
  start()
  await flushPromises()
  canvas.selectedKeyId.value = '1'
  await flushPromises()
  canvas.prompt.value = 'A lighthouse'
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(keysAPI.list).mockResolvedValue({ items: [active, { ...active, id: 2, status: 'inactive' }], total: 2, pages: 1 } as never)
  vi.mocked(api.listModels).mockResolvedValue({ data: [{ id: 'grok-imagine-image' }, { id: 'grok-imagine-video-1.5' }, { id: 'gpt-chat' }] } as never)
  vi.mocked(history.listHistory).mockResolvedValue([])
  vi.mocked(history.saveHistory).mockImplementation(async (ownerId, item) => ({ ...item, ownerId, id: 4 }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers() })

describe('media canvas workflow', () => {
  it('exposes active key names/groups without secrets and requires explicit key selection', async () => {
    start()
    await flushPromises()
    expect(canvas.keyOptions.value).toEqual([{ id: '1', name: 'My media key', groupName: 'Media group' }])
    expect(JSON.stringify(canvas.keyOptions.value)).not.toContain(secret)
    expect(canvas.selectedKeyId.value).toBe('')
    expect(api.listModels).not.toHaveBeenCalled()
  })

  it('loads every key page and excludes expired keys and ambiguous video model IDs', async () => {
    const oldExpiry = new Date(Date.now() - 60_000).toISOString()
    vi.mocked(keysAPI.list)
      .mockResolvedValueOnce({ items: [active], total: 2, pages: 2 } as never)
      .mockResolvedValueOnce({ items: [
        { ...active, id: 3, name: 'Expired', expires_at: oldExpiry },
        { ...active, id: 4, name: 'Second page', expires_at: null },
      ], total: 2, pages: 2 } as never)
    start()
    await flushPromises()
    expect(keysAPI.list).toHaveBeenCalledTimes(2)
    expect(canvas.keyOptions.value.map(option => option.name)).toEqual(['My media key', 'Second page'])
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    vi.mocked(api.listModels).mockResolvedValueOnce({ data: [
      { id: 'grok-imagine' },
      { id: 'grok-imagine-video-1.5' },
      { id: 'image-to-video-preview' },
      { id: 'seedance-video' },
    ] } as never)
    await canvas.loadModels()
    expect(canvas.models.value.map(model => model.id)).toEqual(['grok-imagine'])
    canvas.mode.value = 'video'
    await nextTick()
    expect(canvas.models.value.map(model => model.id)).toEqual(['grok-imagine-video-1.5'])
  })

  it('does not save an in-flight result into another signed-in user’s history', async () => {
    const { owner } = start()
    await flushPromises()
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    canvas.prompt.value = 'A lighthouse'
    let resolveImage!: (value: { data: Array<{ b64_json: string }> }) => void
    vi.mocked(api.generateImage).mockImplementation(() => new Promise(resolve => { resolveImage = resolve }))
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    const generation = canvas.generate()
    await flushPromises()
    owner.value = 'user-2'
    await flushPromises()
    resolveImage({ data: [{ b64_json: 'aW1hZ2U=' }] })
    await generation
    expect(history.saveHistory).not.toHaveBeenCalled()
    expect(canvas.results.value).toEqual([])
  })

  it('reloads model options on key change and filters for the chosen media mode', async () => {
    await ready()
    expect(canvas.models.value.map(m => m.id)).toEqual(['grok-imagine-image'])
    canvas.mode.value = 'video'
    await nextTick()
    expect(canvas.models.value.map(m => m.id)).toEqual(['grok-imagine-video-1.5'])
    canvas.selectedKeyId.value = ''
    await nextTick()
    expect(canvas.models.value).toEqual([])
  })

  it('only offers the Grok video protocol family, including supported provider aliases', async () => {
    const supported = ['grok-imagine-video', 'grok-imagine-video-1.5-preview', 'grok-image-video', 'xai/grok-video-1.5', 'X-AI/grok-imagine-video-1.5', 'grok/grok-imagine-video']
    vi.mocked(api.listModels).mockResolvedValue({ data: [
      ...supported.map(id => ({ id })),
      { id: 'seedance-2.0' }, { id: 'sora-2' }, { id: 'veo-3' },
      { id: 'image-to-video-preview' }, { id: 'custom-video', object: 'video' },
      { id: 'grok-chat-video' }, { id: 'grok-imagine-image' },
    ] } as never)
    await ready()
    expect(canvas.models.value.map(model => model.id)).toEqual(['grok-imagine-image'])
    canvas.mode.value = 'video'
    await nextTick()
    expect(canvas.models.value.map(model => model.id)).toEqual(supported)
  })

  it.each([
    { platform: 'openai', images: ['grok-imagine-image'], videos: [] },
    { platform: 'anthropic', images: [], videos: [] },
    { platform: 'composite', images: ['grok-imagine-image'], videos: ['grok-imagine-video-1.5'] },
  ])('respects the $platform group gateway protocol', async ({ platform, images, videos }) => {
    vi.mocked(keysAPI.list).mockResolvedValue({ items: [{ ...active, group: { ...active.group, platform } }], total: 1, pages: 1 } as never)
    await ready()
    expect(canvas.models.value.map(model => model.id)).toEqual(images)
    canvas.mode.value = 'video'
    await nextTick()
    expect(canvas.models.value.map(model => model.id)).toEqual(videos)
  })

  it('redacts a model API error and clears its detail on the next model load', async () => {
    await ready()
    vi.mocked(api.listModels).mockRejectedValueOnce(new MediaApiError(`Model refused ${secret}`, { status: 403 }))
    await canvas.loadModels()
    expect(canvas.error.value).toBe('loadModels')
    expect(canvas.errorDetail.value).toBe('Model refused [redacted]')
    await canvas.loadModels()
    expect(canvas.error.value).toBe('')
    expect(canvas.errorDetail.value).toBe('')
  })

  it('preserves a generation API error detail while removing the selected key', async () => {
    await ready()
    vi.mocked(api.generateImage).mockRejectedValue(new MediaApiError(`Quota for ${secret} exhausted: ${secret}`, { status: 429 }))
    await canvas.generate()
    expect(canvas.error.value).toBe('generation')
    expect(canvas.errorDetail.value).toBe('Quota for [redacted] exhausted: [redacted]')
    expect(canvas.status.value).toBe('failed')
  })

  it('saves image blobs with display metadata and no key material', async () => {
    await ready()
    vi.mocked(api.generateImage).mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    await canvas.generate()
    expect(api.generateImage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: secret, model: 'grok-imagine-image', prompt: 'A lighthouse' }))
    expect(history.saveHistory).toHaveBeenCalledWith('user-1', expect.objectContaining({ keyName: 'My media key', mode: 'image', blob: expect.any(Blob) }))
    expect(JSON.stringify(vi.mocked(history.saveHistory).mock.calls)).not.toContain(secret)
    expect(canvas.results.value).toHaveLength(1)
  })

  it('keeps the submitted prompt and options even if form values change while generating', async () => {
    await ready()
    let resolveImage!: (value: { data: Array<{ b64_json: string }> }) => void
    vi.mocked(api.generateImage).mockImplementation(() => new Promise(resolve => { resolveImage = resolve }))
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    canvas.imageSize.value = '1536x1024'
    const generation = canvas.generate()
    canvas.prompt.value = 'Changed prompt'
    canvas.imageSize.value = '1024x1536'
    resolveImage({ data: [{ b64_json: 'aW1hZ2U=' }] })
    await generation
    expect(history.saveHistory).toHaveBeenCalledWith('user-1', expect.objectContaining({
      prompt: 'A lighthouse', settings: expect.objectContaining({ size: '1536x1024' }),
    }))
  })

  it('keeps generated media available when browser storage fails', async () => {
    await ready()
    vi.mocked(api.generateImage).mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    vi.mocked(history.saveHistory).mockRejectedValue(new Error('Quota exceeded'))
    await canvas.generate()
    expect(canvas.error.value).toBe('history')
    expect(canvas.results.value).toHaveLength(1)
    expect(canvas.results.value[0].previewUrl).toBe('blob:preview')
    expect(canvas.status.value).toBe('completed')
    expect(canvas.localHistory.value).toEqual([])
    await canvas.reloadHistory()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('prevents duplicate submissions while a generation is pending', async () => {
    await ready()
    let resolveImage!: (value: { data: Array<{ b64_json: string }> }) => void
    vi.mocked(api.generateImage).mockImplementation(() => new Promise(resolve => { resolveImage = resolve }))
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    const first = canvas.generate()
    await canvas.generate()
    expect(api.generateImage).toHaveBeenCalledTimes(1)
    resolveImage({ data: [{ b64_json: 'aW1hZ2U=' }] })
    await first
  })

  it('reports an empty image response as a generation failure', async () => {
    await ready()
    vi.mocked(api.generateImage).mockResolvedValue({ data: [] })
    await canvas.generate()
    expect(canvas.error.value).toBe('generation')
    expect(canvas.status.value).toBe('failed')
    expect(history.saveHistory).not.toHaveBeenCalled()
  })

  it('ignores stale model loads when a different key is selected', async () => {
    start()
    await flushPromises()
    let resolveModels!: (value: { data: Array<{ id: string }> }) => void
    vi.mocked(api.listModels).mockImplementationOnce(() => new Promise(resolve => { resolveModels = resolve }))
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    canvas.selectedKeyId.value = ''
    await nextTick()
    resolveModels({ data: [{ id: 'grok-imagine-image' }] })
    await flushPromises()
    expect(canvas.models.value).toEqual([])
    expect(canvas.modelId.value).toBe('')
  })

  it('submits reference images through image editing', async () => {
    await ready()
    const image = new File(['png'], 'sample.png', { type: 'image/png' })
    canvas.setUpload(image)
    vi.mocked(api.editImage).mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    await canvas.generate()
    expect(api.editImage).toHaveBeenCalledWith(expect.objectContaining({ image, n: 1, response_format: 'b64_json' }))
    expect(api.generateImage).not.toHaveBeenCalled()
  })

  it('polls a video through completion then downloads via the content API', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockResolvedValueOnce({ status: 'processing', progress: 25 }).mockResolvedValueOnce({ status: 'done', video: { url: 'https://external.test/video.mp4' } })
    vi.mocked(api.getVideoContent).mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
    const generation = canvas.generate()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    await generation
    expect(api.getVideoStatus).toHaveBeenCalledTimes(2)
    expect(api.getVideoContent).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'video-1', apiKey: secret }))
    expect(canvas.results.value[0].mode).toBe('video')
  })

  it('stops after a failed video status without downloading', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockResolvedValue({ status: 'failed' })
    await canvas.generate()
    expect(canvas.error.value).toBe('videoFailed')
    expect(api.getVideoContent).not.toHaveBeenCalled()
    expect(canvas.busy.value).toBe(false)
  })

  it('accepts a nested video result without status and only retrieves content from the gateway', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.mocked(api.generateVideo).mockResolvedValue({ data: { task_id: 'nested-task' } } as never)
    vi.mocked(api.getVideoStatus).mockResolvedValue({ data: { video: { url: 'https://external.test/file.mp4' } } } as never)
    vi.mocked(api.getVideoContent).mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
    await canvas.generate()
    expect(api.getVideoContent).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'nested-task' }))
    expect(canvas.results.value[0].mode).toBe('video')
  })

  it('times out after five minutes and clears polling', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockResolvedValue({ status: 'processing' })
    const generation = canvas.generate()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await generation
    expect(canvas.error.value).toBe('videoTimeout')
    expect(canvas.busy.value).toBe(false)
    const callsAtTimeout = vi.mocked(api.getVideoStatus).mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.getVideoStatus).toHaveBeenCalledTimes(callsAtTimeout)
    expect(api.getVideoContent).not.toHaveBeenCalled()
  })

  it('aborts a video status request that hangs beyond the deadline', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const generation = canvas.generate()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await generation
    expect(canvas.error.value).toBe('videoTimeout')
    expect(canvas.status.value).toBe('failed')
    expect(canvas.busy.value).toBe(false)
    expect(vi.mocked(api.getVideoStatus).mock.calls[0][0].signal?.aborted).toBe(true)
  })

  it('stops polling and aborts when the user stops or leaves', async () => {
    await ready()
    canvas.mode.value = 'video'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockResolvedValue({ status: 'processing' })
    const generation = canvas.generate()
    await flushPromises()
    const signal = vi.mocked(api.getVideoStatus).mock.calls[0][0].signal
    canvas.stop()
    await generation
    await vi.advanceTimersByTimeAsync(6000)
    expect(signal?.aborted).toBe(true)
    expect(api.getVideoStatus).toHaveBeenCalledTimes(1)
    expect(canvas.status.value).toBe('stopped')
  })

  it.each(['stop', 'owner change'])('ignores a late video submission after %s', async (action) => {
    const { owner } = start()
    await flushPromises()
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    canvas.mode.value = 'video'
    canvas.prompt.value = 'A lighthouse'
    await nextTick()
    let resolveSubmission!: (value: { request_id: string }) => void
    vi.mocked(api.generateVideo).mockImplementation(() => new Promise(resolve => { resolveSubmission = resolve }))
    const generation = canvas.generate()
    await flushPromises()
    if (action === 'stop') canvas.stop()
    else owner.value = 'user-2'
    await flushPromises()
    resolveSubmission({ request_id: 'late-task' })
    await generation
    expect(canvas.status.value).toBe(action === 'stop' ? 'stopped' : 'idle')
    expect(canvas.progress.value).toBe(action === 'stop' ? 0 : null)
    expect(canvas.busy.value).toBe(false)
    expect(api.getVideoStatus).not.toHaveBeenCalled()
    expect(api.getVideoContent).not.toHaveBeenCalled()
  })

  it.each(['stop', 'owner change'])('ignores a late video status after %s and clears its deadline', async (action) => {
    const { owner } = start()
    await flushPromises()
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    canvas.mode.value = 'video'
    canvas.prompt.value = 'A lighthouse'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    let resolveStatus!: (value: { status: string; progress: number }) => void
    vi.mocked(api.getVideoStatus).mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }))
    const generation = canvas.generate()
    await flushPromises()
    if (action === 'stop') canvas.stop()
    else owner.value = 'user-2'
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
    resolveStatus({ status: 'done', progress: 98 })
    await generation
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(canvas.status.value).toBe(action === 'stop' ? 'stopped' : 'idle')
    expect(canvas.progress.value).toBe(action === 'stop' ? 0 : null)
    expect(canvas.error.value).toBe('')
    expect(canvas.busy.value).toBe(false)
    expect(api.getVideoStatus).toHaveBeenCalledTimes(1)
    expect(api.getVideoContent).not.toHaveBeenCalled()
  })

  it('aborts a pending polling request and revokes previews on unmount', async () => {
    const { wrapper } = start()
    await flushPromises()
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    canvas.prompt.value = 'A lighthouse'
    vi.mocked(api.generateImage).mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    vi.mocked(api.imageToBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    await canvas.generate()
    canvas.mode.value = 'video'
    await nextTick()
    vi.useFakeTimers()
    vi.mocked(api.generateVideo).mockResolvedValue({ request_id: 'video-1' })
    vi.mocked(api.getVideoStatus).mockResolvedValue({ status: 'processing' })
    const generation = canvas.generate()
    await flushPromises()
    const signal = vi.mocked(api.getVideoStatus).mock.calls[0][0].signal
    wrapper.unmount()
    await generation
    await vi.advanceTimersByTimeAsync(6000)
    expect(signal?.aborted).toBe(true)
    expect(api.getVideoStatus).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('does not apply an old account deletion to the next account view', async () => {
    const { owner } = start()
    await flushPromises()
    let resolveDelete!: () => void
    vi.mocked(history.deleteHistory).mockImplementation(() => new Promise(resolve => { resolveDelete = resolve }))
    const record = { id: 7, ownerId: 'user-1', mode: 'image' as const, blob: new Blob(['old']), prompt: '', model: '', settings: {}, keyName: '', createdAt: 0 }
    const deleting = canvas.deleteLocalRecord(record)
    owner.value = 'user-2'
    vi.mocked(history.listHistory).mockResolvedValue([{ ...record, ownerId: 'user-2', blob: new Blob(['new']) }])
    await canvas.reloadHistory()
    resolveDelete()
    await deleting
    expect(canvas.localHistory.value).toHaveLength(1)
  })

  it('rejects unsafe uploads and clears all page state when owner changes', async () => {
    const { owner } = start()
    await flushPromises()
    expect(canvas.setUpload(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).toBe(false)
    expect(canvas.error.value).toBe('invalidFile')
    expect(canvas.setUpload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' }))).toBe(false)
    expect(canvas.error.value).toBe('fileTooLarge')
    canvas.selectedKeyId.value = '1'
    await flushPromises()
    owner.value = 'user-2'
    await flushPromises()
    expect(canvas.selectedKeyId.value).toBe('')
    expect(canvas.results.value).toEqual([])
    expect(history.listHistory).toHaveBeenLastCalledWith('user-2')
  })
})
