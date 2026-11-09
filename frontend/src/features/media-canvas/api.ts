import {
  MediaApiError,
  type ImageToBlobOptions,
  type MediaImageResultItem,
  type ImageEditOptions,
  type ImageGenerationOptions,
  type MediaApiOptions,
  type MediaImageResponse,
  type MediaModelsResponse,
  type VideoGenerationOptions,
  type VideoTaskOptions,
  type VideoTaskResponse,
} from './types'

type Fetcher = typeof fetch

function authHeaders(apiKey: string, accept = 'application/json'): Headers {
  const headers = new Headers({ Accept: accept })
  headers.set('Authorization', `Bearer ${apiKey}`)
  return headers
}

function redact(message: string, apiKey: string): string {
  if (!apiKey) return message
  return message.split(apiKey).join('[redacted]')
}

async function errorFromResponse(response: Response, apiKey: string): Promise<MediaApiError> {
  let message = response.statusText || `HTTP ${response.status}`
  let code: string | number | undefined = response.status

  try {
    const body: unknown = await response.clone().json()
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      const nested = record.error && typeof record.error === 'object'
        ? record.error as Record<string, unknown>
        : undefined
      const candidate = nested?.message ?? record.message ?? record.error
      if (typeof candidate === 'string' && candidate.trim()) message = candidate
      const candidateCode = nested?.code ?? nested?.type ?? record.code
      if (typeof candidateCode === 'string') code = redact(candidateCode, apiKey)
      else if (typeof candidateCode === 'number') code = candidateCode
    }
  } catch {
    try {
      const text = (await response.clone().text()).trim()
      if (text) message = text.slice(0, 500)
    } catch {
      // Fall back to the status text when the body is empty or unreadable.
    }
  }

  return new MediaApiError(redact(message, apiKey), { status: response.status, code })
}

async function safeFetch(fetcher: Fetcher, path: string, init: RequestInit, apiKey: string): Promise<Response> {
  try {
    return await fetcher(path, init)
  } catch (error) {
    if (error instanceof Error && apiKey) {
      const safeMessage = redact(error.message, apiKey)
      const safeCode = typeof (error as Error & { code?: unknown }).code === 'string'
        ? redact((error as Error & { code: string }).code, apiKey)
        : undefined
      if (safeMessage !== error.message || safeCode) {
        throw new MediaApiError(safeMessage, { code: safeCode })
      }
    }
    throw error
  }
}

async function requestJson<T>(
  path: string,
  options: MediaApiOptions,
  init: Omit<RequestInit, 'headers' | 'signal'> & { headers?: HeadersInit } = {},
  fetcher: Fetcher = fetch,
): Promise<T> {
  const headers = authHeaders(options.apiKey)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await safeFetch(fetcher, path, {
    ...init,
    headers,
    signal: options.signal,
  }, options.apiKey)
  if (!response.ok) throw await errorFromResponse(response, options.apiKey)
  return response.json() as Promise<T>
}

async function requestBlob(
  path: string,
  options: MediaApiOptions,
  fetcher: Fetcher = fetch,
): Promise<Blob> {
  const response = await safeFetch(fetcher, path, {
    headers: authHeaders(options.apiKey, 'video/*, application/octet-stream, */*'),
    signal: options.signal,
  }, options.apiKey)
  if (!response.ok) throw await errorFromResponse(response, options.apiKey)
  return response.blob()
}

export function listModels(
  options: MediaApiOptions,
  fetcher: Fetcher = fetch,
): Promise<MediaModelsResponse> {
  return requestJson('/v1/models', options, { method: 'GET' }, fetcher)
}

export function generateImage(
  options: ImageGenerationOptions,
  fetcher: Fetcher = fetch,
): Promise<MediaImageResponse> {
  const { apiKey, signal, ...payload } = options
  return requestJson('/v1/images/generations', { apiKey, signal }, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, fetcher)
}

export async function editImage(
  options: ImageEditOptions,
  fetcher: Fetcher = fetch,
): Promise<MediaImageResponse> {
  const { apiKey, signal, image, ...fields } = options
  // Grok's multipart gateway conversion omits response_format; JSON preserves it.
  if (/^(?:(?:xai|x-ai|grok)\/)?grok[-_]/i.test(fields.model)) {
    return requestJson('/v1/images/edits', { apiKey, signal }, {
      method: 'POST',
      body: JSON.stringify({
        ...fields,
        image: { url: await fileToDataUrl(image), type: 'image_url' },
      }),
    }, fetcher)
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, String(value))
  }
  form.append('image', image)

  return requestJson('/v1/images/edits', { apiKey, signal }, {
    method: 'POST',
    body: form,
  }, fetcher)
}

async function fileToDataUrl(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    const mimeType = file.type || 'application/octet-stream'
    return `data:${mimeType};base64,${btoa(binary)}`
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read first-frame image'))
    reader.onerror = () => reject(new Error('Could not read first-frame image'))
    reader.readAsDataURL(file)
  })
}

export async function imageToBlob(
  image: MediaImageResultItem,
  options: ImageToBlobOptions,
  fetcher: Fetcher = fetch,
): Promise<Blob> {
  if (image.b64_json) {
    const binary = atob(image.b64_json)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new Blob([bytes], { type: image.mime_type || 'image/png' })
  }
  if (!image.url) throw new MediaApiError('Image response did not include image data')

  const origin = typeof window === 'undefined' ? undefined : window.location.origin
  let url: URL
  try {
    url = new URL(image.url, origin)
  } catch {
    throw new MediaApiError('Image response URL is invalid')
  }
  if (!origin || url.origin !== origin || url.username || url.password) {
    throw new MediaApiError('Image response must use a same-origin URL')
  }

  const response = await safeFetch(fetcher, `${url.pathname}${url.search}`, {
    headers: authHeaders(options.apiKey, 'image/*, application/octet-stream, */*'),
    signal: options.signal,
  }, options.apiKey)
  if (!response.ok) throw await errorFromResponse(response, options.apiKey)
  return response.blob()
}

export async function generateVideo(
  options: VideoGenerationOptions,
  fetcher: Fetcher = fetch,
): Promise<VideoTaskResponse> {
  const { apiKey, signal, firstFrame, ...payload } = options
  const requestPayload: Record<string, unknown> = payload
  if (firstFrame) {
    // The served production bundle omits image.type. Video generation rejects
    // type:"image_url"; grok image edits below still send it.
    requestPayload.image = {
      url: await fileToDataUrl(firstFrame),
    }
  }

  return requestJson('/v1/videos/generations', { apiKey, signal }, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  }, fetcher)
}

export function getVideoStatus(
  options: VideoTaskOptions,
  fetcher: Fetcher = fetch,
): Promise<VideoTaskResponse> {
  const requestId = encodeURIComponent(options.requestId)
  return requestJson(`/v1/videos/generations/${requestId}`, options, {}, fetcher)
}

export function getVideoContent(
  options: VideoTaskOptions,
  fetcher: Fetcher = fetch,
): Promise<Blob> {
  const requestId = encodeURIComponent(options.requestId)
  return requestBlob(`/v1/videos/generations/${requestId}/content`, options, fetcher)
}
