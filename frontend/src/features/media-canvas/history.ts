import type { MediaHistoryInput, MediaHistoryRecord, MediaHistorySettings } from './types'

const DATABASE_NAME = 'sub2api-media-canvas-history'
const DATABASE_VERSION = 1
const STORE_NAME = 'media'
const OWNER_INDEX = 'ownerId'
const SAFE_SETTINGS = new Set([
  'size',
  'quality',
  'count',
  'n',
  'aspectRatio',
  'aspect_ratio',
  'duration',
  'resolution',
])

let databasePromise: Promise<IDBDatabase> | null = null

function requireOwner(ownerId: string): string {
  const normalized = ownerId.trim()
  if (!normalized) throw new Error('A signed-in user is required')
  return normalized
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser history storage is unavailable'))
  }
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex(OWNER_INDEX, OWNER_INDEX, { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(new Error('Could not open browser history storage'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('Browser history storage is blocked by another tab'))
    }
  })
  return databasePromise
}

function transactionResult<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T
    let request: IDBRequest<T>
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, mode)
      request = run(transaction.objectStore(STORE_NAME))
    } catch {
      reject(new Error('Could not access browser history storage'))
      return
    }
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(new Error('Could not access browser history storage'))
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(new Error('Could not update browser history storage'))
    transaction.onerror = () => reject(new Error('Could not update browser history storage'))
  })
}

function sanitizeSettings(settings: MediaHistorySettings): MediaHistorySettings {
  const safe: MediaHistorySettings = {}
  for (const [key, value] of Object.entries(settings)) {
    if (!SAFE_SETTINGS.has(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
  }
  return safe
}

function sanitizeInput(input: MediaHistoryInput): Omit<MediaHistoryRecord, 'id'> {
  if (!(input.blob instanceof Blob)) throw new Error('A media Blob is required')
  if (input.mode !== 'image' && input.mode !== 'video') throw new Error('Unsupported media type')
  return {
    ownerId: '',
    mode: input.mode,
    prompt: input.prompt,
    model: input.model,
    settings: sanitizeSettings(input.settings),
    keyName: input.keyName,
    blob: input.blob,
    createdAt: input.createdAt,
  }
}

export async function listHistory(ownerId: string): Promise<MediaHistoryRecord[]> {
  const owner = requireOwner(ownerId)
  const database = await openDatabase()
  const records = await transactionResult<MediaHistoryRecord[]>(database, 'readonly', store =>
    store.index(OWNER_INDEX).getAll(owner),
  )
  return records.sort((left, right) => right.createdAt - left.createdAt)
}

export async function saveHistory(
  ownerId: string,
  input: MediaHistoryInput,
): Promise<MediaHistoryRecord> {
  const owner = requireOwner(ownerId)
  const sanitized = sanitizeInput(input)
  sanitized.ownerId = owner
  const database = await openDatabase()
  const id = await transactionResult<IDBValidKey>(database, 'readwrite', store => store.add(sanitized))
  return { ...sanitized, id: Number(id) }
}

export async function deleteHistory(ownerId: string, recordId: number): Promise<void> {
  const owner = requireOwner(ownerId)
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(recordId)
    request.onsuccess = () => {
      if (request.result?.ownerId === owner) store.delete(recordId)
    }
    request.onerror = () => reject(new Error('Could not access browser history storage'))
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new Error('Could not update browser history storage'))
    transaction.onerror = () => reject(new Error('Could not update browser history storage'))
  })
}

export async function clearHistory(ownerId: string): Promise<void> {
  const owner = requireOwner(ownerId)
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const cursorRequest = transaction.objectStore(STORE_NAME).index(OWNER_INDEX).openCursor(owner)
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(new Error('Could not access browser history storage'))
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new Error('Could not update browser history storage'))
    transaction.onerror = () => reject(new Error('Could not update browser history storage'))
  })
}
