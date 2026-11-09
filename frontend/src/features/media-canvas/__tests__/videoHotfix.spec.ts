import { describe, expect, it, vi } from 'vitest'
import { editImage, generateVideo } from '../api'

function requestBody(init: RequestInit): Record<string, unknown> {
  expect(typeof init.body).toBe('string')
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('media canvas video hotfix', () => {
  it('sends a first-frame data URL without image.type', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ request_id: 'task-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const firstFrame = new File([Uint8Array.from([1, 2, 3, 4])], 'frame.png', { type: 'image/png' })

    await generateVideo({
      apiKey: 'test-api-key',
      model: 'grok-imagine-video-1.5',
      prompt: 'a lighthouse at dusk',
      duration: 6,
      aspect_ratio: '16:9',
      resolution: '720p',
      firstFrame,
    }, fetcher as unknown as typeof fetch)

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/v1/videos/generations')
    const image = requestBody(init).image as Record<string, unknown>
    expect(image.url).toEqual(expect.stringMatching(/^data:image\/png;base64,/))
    expect(image).not.toHaveProperty('type')
  })

  it('keeps image.type on grok image edits', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const image = new File([Uint8Array.from([1, 2, 3, 4])], 'ref.png', { type: 'image/png' })

    await editImage({
      apiKey: 'test-api-key',
      model: 'grok-imagine-image',
      prompt: 'make it brighter',
      image,
    }, fetcher as unknown as typeof fetch)

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit]
    const body = requestBody(init)
    expect((body.image as Record<string, unknown>).type).toBe('image_url')
  })
})
