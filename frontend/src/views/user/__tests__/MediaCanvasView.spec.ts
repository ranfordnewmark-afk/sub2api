import { computed, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MediaCanvasView from '../MediaCanvasView.vue'

const { canvasState } = vi.hoisted(() => ({ canvasState: { current: null as Record<string, any> | null } }))
vi.mock('vue-i18n', async importOriginal => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/layout/AppLayout.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 9 } }) }))
vi.mock('@/features/media-canvas/useMediaCanvas', () => ({ useMediaCanvas: () => canvasState.current }))

function setup() {
  canvasState.current = {
    mode: ref('image'), prompt: ref(''), selectedKeyId: ref(''), keyOptions: ref([{ id: '1', name: 'Private key name', groupName: 'Cinema group' }]),
    models: ref([{ id: 'grok-imagine-image' }]), modelId: ref(''), imageSize: ref('1024x1024'), imageQuality: ref('auto'),
    imageCount: ref(1), aspectRatio: ref('1:1'), videoDuration: ref(6), videoResolution: ref('720p'), upload: ref(null),
    busy: ref(false), loadingKeys: ref(false), loadingModels: ref(false), loadingHistory: ref(false), error: ref(''), errorDetail: ref(''),
    status: ref(''), progress: ref(null), results: ref([]), localHistory: ref([]),
    canGenerate: computed(() => Boolean(canvasState.current?.selectedKeyId.value && canvasState.current?.modelId.value && canvasState.current?.prompt.value.trim())),
    setUpload: vi.fn(), generate: vi.fn(), stop: vi.fn(), deleteLocalRecord: vi.fn(), clearLocalHistory: vi.fn(),
    download: vi.fn(), reloadHistory: vi.fn(), loadKeys: vi.fn(), loadModels: vi.fn(),
  }
  return mount(MediaCanvasView, { global: { stubs: {
    AppLayout: { template: '<div><slot /></div>' },
    RouterLink: { template: '<a><slot /></a>' },
  } } })
}

describe('MediaCanvasView', () => {
  beforeEach(() => { canvasState.current = null })

  it('lets users switch between image and video controls', async () => {
    const wrapper = setup()
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain('mediaCanvas.image')
    await wrapper.get('[role="tab"]:nth-child(2)').trigger('click')
    await nextTick()
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain('mediaCanvas.video')
    expect(wrapper.text()).toContain('mediaCanvas.duration')
    expect(wrapper.text()).toContain('mediaCanvas.resolution')
  })

  it('shows key name and group while never rendering key material or price estimates', () => {
    const wrapper = setup()
    expect(wrapper.text()).toContain('Private key name · Cinema group')
    expect(wrapper.text()).not.toContain('secret-test-key')
    expect(wrapper.text()).not.toMatch(/estimated price|price estimate|预估价格|估价/)
    expect(wrapper.text()).toContain('mediaCanvas.billingNote')
    expect(wrapper.text()).not.toContain('mediaCanvas.description')
    expect(wrapper.text()).not.toContain('mediaCanvas.privacyNote')
  })

  it('links to API key management when the account has no active keys', async () => {
    const wrapper = setup()
    canvasState.current!.keyOptions.value = []
    await nextTick()
    expect(wrapper.text()).toContain('mediaCanvas.noKeys')
    expect(wrapper.get('a').text()).toBe('mediaCanvas.manageKeys')
  })

  it('renders a readable gateway error and retries model loading', async () => {
    const wrapper = setup()
    canvasState.current!.error.value = 'loadModels'
    canvasState.current!.errorDetail.value = 'HTTP 403: this model is unavailable for the selected key'
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain('HTTP 403: this model is unavailable for the selected key')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(canvasState.current!.loadModels).toHaveBeenCalledOnce()
  })

  it('keeps generation disabled until the user selects a key, model, and prompt', async () => {
    const wrapper = setup()
    const button = wrapper.get('button.btn-primary')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    canvasState.current!.selectedKeyId.value = '1'
    canvasState.current!.modelId.value = 'grok-imagine-image'
    canvasState.current!.prompt.value = 'A lighthouse'
    await flushPromises()
    expect((button.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows image and video previews and downloads the selected result record', async () => {
    const wrapper = setup()
    const image = { id: 1, mode: 'image', prompt: 'A lighthouse', blob: new Blob(['png']), previewUrl: 'blob:image', model: 'image-model', keyName: 'Studio' }
    const video = { ...image, id: 2, mode: 'video', previewUrl: 'blob:video' }
    canvasState.current!.results.value = [image, video]
    await nextTick()
    expect(wrapper.get('img').attributes('src')).toBe('blob:image')
    expect(wrapper.get('video').attributes('src')).toBe('blob:video')
    expect(wrapper.get('video').attributes()).toHaveProperty('controls')
    const downloadButtons = wrapper.findAll('button').filter(button => button.text() === 'mediaCanvas.download')
    expect(downloadButtons).toHaveLength(2)
    await downloadButtons[1].trigger('click')
    expect(canvasState.current!.download).toHaveBeenCalledWith(video)
  })

  it('uses existing history previews and passes the full record to history actions', async () => {
    const wrapper = setup()
    const record = { id: 7, mode: 'image', prompt: 'A lighthouse', blob: new Blob(['png']), previewUrl: 'blob:history', model: 'image-model', keyName: 'Studio', createdAt: 100 }
    canvasState.current!.localHistory.value = [record]
    await nextTick()
    expect(wrapper.get('img').attributes('src')).toBe('blob:history')
    const downloadButton = wrapper.findAll('button').find(button => button.text() === 'mediaCanvas.download')!
    const deleteButton = wrapper.findAll('button').find(button => button.text() === 'mediaCanvas.delete')!
    await downloadButton.trigger('click')
    await deleteButton.trigger('click')
    expect(canvasState.current!.download).toHaveBeenCalledWith(record)
    expect(canvasState.current!.deleteLocalRecord).toHaveBeenCalledWith(record)
  })

  it('asks before clearing history and calls the history action only on confirmation', async () => {
    const wrapper = setup()
    canvasState.current!.localHistory.value = [{ id: 1, mode: 'image', blob: new Blob(['png']), previewUrl: 'blob:history', createdAt: 100 }]
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await nextTick()
    const clearButton = wrapper.findAll('button').find(button => button.text() === 'mediaCanvas.clearHistory')!
    await clearButton.trigger('click')
    expect(canvasState.current!.clearLocalHistory).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    await clearButton.trigger('click')
    expect(canvasState.current!.clearLocalHistory).toHaveBeenCalledOnce()
    confirmation.mockRestore()
  })

  it('clears a rejected file so users can choose the same file again', async () => {
    const wrapper = setup()
    const input = wrapper.get('input[type="file"]')
    const invalid = new File(['svg'], 'invalid.svg', { type: 'image/svg+xml' })
    canvasState.current!.setUpload.mockReturnValue(false)
    Object.defineProperty(input.element, 'files', { configurable: true, value: [invalid] })
    Object.defineProperty(input.element, 'value', { configurable: true, writable: true, value: 'invalid.svg' })
    await input.trigger('change')
    expect(canvasState.current!.setUpload).toHaveBeenCalledWith(invalid)
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('accept')).toBe('image/png,image/jpeg,image/webp')
  })
})
