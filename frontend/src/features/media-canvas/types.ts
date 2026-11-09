export type MediaMode = 'image' | 'video'

export type MediaHistorySettings = Record<string, string | number | boolean>

export interface MediaHistoryInput {
  mode: MediaMode
  prompt: string
  model: string
  settings: MediaHistorySettings
  keyName: string
  blob: Blob
  createdAt: number
}

export interface MediaHistoryRecord extends MediaHistoryInput {
  id: number
  ownerId: string
}

export interface MediaApiOptions {
  apiKey: string
  signal?: AbortSignal
}

export interface MediaModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
  [key: string]: unknown
}

export interface MediaModelsResponse {
  object?: string
  data: MediaModel[]
}

export interface MediaImageResultItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
  mime_type?: string
}

export interface MediaImageResponse {
  created?: number
  data: MediaImageResultItem[]
  [key: string]: unknown
}

export interface ImageGenerationOptions extends MediaApiOptions {
  model: string
  prompt: string
  size?: string
  quality?: string
  n?: number
  aspect_ratio?: string
  response_format?: 'url' | 'b64_json' | string
}

export interface ImageEditOptions extends MediaApiOptions {
  model: string
  prompt: string
  image: File
  size?: string
  quality?: string
  n?: number
  aspect_ratio?: string
  response_format?: 'url' | 'b64_json' | string
}

export interface VideoGenerationOptions extends MediaApiOptions {
  model: string
  prompt: string
  duration?: number
  aspect_ratio?: string
  resolution?: string
  firstFrame?: File
}

export interface VideoTaskResponse {
  request_id?: string
  id?: string
  task_id?: string
  status?: string
  model?: string
  progress?: number | string
  video?: {
    url?: string
    duration?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface VideoTaskOptions extends MediaApiOptions {
  requestId: string
}

export interface ImageToBlobOptions extends MediaApiOptions {}

export class MediaApiError extends Error {
  readonly status?: number
  readonly code?: string | number

  constructor(message: string, details: { status?: number; code?: string | number } = {}) {
    super(message)
    this.name = 'MediaApiError'
    this.status = details.status
    this.code = details.code
  }
}
