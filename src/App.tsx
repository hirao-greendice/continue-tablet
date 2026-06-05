import {
  type CSSProperties,
  type ImgHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import './App.css'
import { createCroppedPhotoFile } from './cropImage'
import {
  deletePhotoFiles,
  fetchCurrentPhotos,
  saveCurrentPhotos,
  subscribeCurrentPhotos,
  uploadCurrentPhoto,
  type StoredPhoto,
} from './photoStore'
import {
  PHOTO_ASPECT_HEIGHT,
  PHOTO_ASPECT_RATIO,
  PHOTO_ASPECT_WIDTH,
} from './photoAspect'
import {
  clearTeamAnswer,
  connectTeamPresence,
  resetAllTeamAnswers,
  sendHomeCommand,
  setGameEndedStatus,
  subscribeGameControl,
  subscribeHomeCommand,
  subscribeRealtimeConnection,
  submitTeamAnswer,
  subscribeTeamStates,
  type TeamState,
} from './teamStore'
import { realtimeDatabaseUrl } from './firebase'

type Screen = 'home' | 'scene0' | 'scene1' | 'scene3' | 'photos' | 'master'
type DeviceRole = 'unknown' | 'master' | 'player'
type PhotoSlot = {
  history?: PhotoHistoryItem[]
  id: number
  label: string
  src: string
  updatedAt?: number
}
type PhotoHistoryItem = {
  isKept?: boolean
  src: string
  updatedAt?: number
}
type BackupPhoto = {
  id: string
  isKept?: boolean
  label: string
  src: string
  updatedAt?: number
}
type BackupPhotosBySlot = Record<number, BackupPhoto[]>
type CropDraft = {
  slotId: number
  label: string
  src: string
}
type AssetLoadProgress = {
  loaded: number
  total: number
}
type AssetLoadProgressHandler = (progress: AssetLoadProgress) => void

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

function versionedAsset(path: string, version: string) {
  const separator = path.includes('?') ? '&' : '?'

  return publicAsset(`${path}${separator}v=${version}`)
}

const SCENE_ONE_VIDEO_VERSION = 'scene-1-20260605-3'
const APP_CACHE_NAME = 'continue-tablet-v33'
const STATIC_IMAGE_VERSION = 'images-20260605-4'
const BACKUP_PHOTO_VERSION = 'backup-photos-20260604-1'
const BACKUP_PHOTO_FOLDER = 'images/backup-photos'
const BACKUP_PHOTO_MANIFEST_PATH = `${BACKUP_PHOTO_FOLDER}/backup-photos.json`
const DEFAULT_PHOTO_IDS = [1, 2, 3, 4] as const
const DEFAULT_BACKUP_PHOTO_FILES: Record<number, string> = {
  1: 'slot-1-1.png',
  2: 'slot-2-1.png',
  3: 'slot-3-1.png',
  4: 'slot-4-1.png',
}
const DEFAULT_BACKUP_PHOTO_ASSETS = DEFAULT_PHOTO_IDS.map(
  (slotId) => `${BACKUP_PHOTO_FOLDER}/${DEFAULT_BACKUP_PHOTO_FILES[slotId]}`,
)
const CLICK_SOUND = 'sounds/click.mp3'
const SUBMIT_SOUND = 'sounds/omaeda.mp3'
const CLICK_SOUND_VOLUME = 0.8
const SUBMIT_SOUND_VOLUME = 0.6
const SCENE_ONE_VIDEO_VOLUME = 1
const PRELOAD_IMAGE_ASSETS = [
  'QR.png',
  'select.png',
  'images/back.webp',
  'images/dayo.webp',
  'images/erabinaosu_button.png',
  'images/goutou.jpeg',
  'images/hannnin.jpg',
  'images/konohito.png',
  'images/0.webp',
  'images/0-1.webp',
  'images/1.0x.webp',
  'images/1.5x.webp',
  'images/5maebutton.webp',
  'images/5nextbutton.webp',
  'images/play.png',
  'images/playbutton.webp',
  'images/stopbutton.webp',
  'images/teisyutu_botton.webp',
  'images/tenkei.png',
  'images/tukitome.png',
]
const PRELOAD_SOUND_ASSETS = [
  { path: CLICK_SOUND, volume: CLICK_SOUND_VOLUME, poolSize: 4 },
  { path: SUBMIT_SOUND, volume: SUBMIT_SOUND_VOLUME, poolSize: 2 },
]
const PHOTO_HISTORY_LIMIT = 10
const soundPools = new Map<string, HTMLAudioElement[]>()

function getSceneOneVideoSrc() {
  return publicAsset(`videos/scene-1.mp4?v=${SCENE_ONE_VIDEO_VERSION}`)
}

function clampVolume(volume: number) {
  return Math.min(Math.max(volume, 0), 1)
}

function createSound(path: string, volume: number) {
  const sound = new Audio(publicAsset(path))
  sound.preload = 'auto'
  sound.volume = clampVolume(volume)
  sound.load()

  return sound
}

function preloadSoundPool(path: string, volume: number, poolSize: number) {
  if (soundPools.has(path)) {
    return
  }

  soundPools.set(
    path,
    Array.from({ length: poolSize }, () => createSound(path, volume)),
  )
}

function unlockPreloadedSounds() {
  soundPools.forEach((pool) => {
    pool.forEach((sound) => {
      const previousMuted = sound.muted

      sound.muted = true
      void sound
        .play()
        .then(() => {
          sound.pause()
          sound.currentTime = 0
          sound.muted = previousMuted
        })
        .catch(() => {
          sound.muted = previousMuted
        })
    })
  })
}

function playSound(path: string, volume = 1) {
  let pool = soundPools.get(path)

  if (!pool) {
    preloadSoundPool(path, volume, 2)
    pool = soundPools.get(path)
  }

  const sound = pool?.find((candidate) => candidate.paused || candidate.ended) ?? createSound(path, volume)

  sound.volume = clampVolume(volume)
  sound.currentTime = 0
  void sound.play().catch(() => undefined)
}

const SUSPECT_LABELS: Record<number, string> = {
  1: '雑用係\nウーラー・カーター役',
  2: '学芸員\nキャン・バス役',
  3: '警備員\nカンシーガ・シーメイ役',
  4: '刑事\nケージー・ノカン役',
}

const SUSPECT_ROLE_LABELS: Record<number, string> = {
  1: '雑用係',
  2: '学芸員',
  3: '警備員',
  4: '刑事',
}

const defaultPhotos: PhotoSlot[] = DEFAULT_PHOTO_IDS.map((id) => ({
  id,
  label: SUSPECT_LABELS[id],
  src: getDefaultPhotoSrc(id),
}))

function getBackupPhotoManifestSrc() {
  return versionedAsset(BACKUP_PHOTO_MANIFEST_PATH, BACKUP_PHOTO_VERSION)
}

async function loadBackupPhotos() {
  const manifest = await fetchJsonWithCache(getBackupPhotoManifestSrc())

  return withDefaultBackupPhotos(normalizeBackupPhotoManifest(manifest))
}

async function fetchJsonWithCache(src: string) {
  const request = new Request(src)

  try {
    const response = await fetch(request)

    if (response.ok) {
      await cacheResponse(request, response.clone())
      return response.json() as Promise<unknown>
    }
  } catch {
    // Fall through to Cache Storage for offline tablets.
  }

  if (!('caches' in window)) {
    return null
  }

  const cachedResponse = await window.caches.match(request)

  return cachedResponse ? (cachedResponse.json() as Promise<unknown>) : null
}

async function warmBackupPhotoCache(backupPhotosBySlot: BackupPhotosBySlot) {
  const urls = [
    getBackupPhotoManifestSrc(),
    ...Object.values(backupPhotosBySlot).flatMap((backupPhotos) =>
      backupPhotos.map((backupPhoto) => backupPhoto.src),
    ),
  ]

  await Promise.allSettled(urls.map((src) => cacheStaticAsset(src)))
}

async function cacheStaticAsset(src: string) {
  if (!('caches' in window)) {
    return
  }

  const request = new Request(src)
  const cache = await window.caches.open(APP_CACHE_NAME)

  if (await cache.match(request)) {
    return
  }

  const response = await fetch(request)

  if (response.ok) {
    await cache.put(request, response)
  }
}

async function getCachedAssetObjectUrl(src: string) {
  if (!('caches' in window)) {
    return null
  }

  const cachedResponse = await window.caches.match(new Request(src))

  if (!cachedResponse) {
    return null
  }

  const blob = await cachedResponse.blob()

  return URL.createObjectURL(blob)
}

async function cacheResponse(request: Request, response: Response) {
  if (!('caches' in window)) {
    return
  }

  const cache = await window.caches.open(APP_CACHE_NAME)
  await cache.put(request, response)
}

function normalizeBackupPhotoManifest(manifest: unknown) {
  const backupPhotosBySlot: BackupPhotosBySlot = {}

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return backupPhotosBySlot
  }

  Object.entries(manifest as Record<string, unknown>).forEach(([slotKey, rawItems]) => {
    const slotId = Number(slotKey)

    if (!Number.isInteger(slotId) || !Array.isArray(rawItems)) {
      return
    }

    const backupPhotos = rawItems
      .map((rawItem, index) => normalizeBackupPhoto(rawItem, index))
      .filter((backupPhoto): backupPhoto is BackupPhoto => Boolean(backupPhoto))

    if (backupPhotos.length > 0) {
      backupPhotosBySlot[slotId] = backupPhotos
    }
  })

  return backupPhotosBySlot
}

function normalizeBackupPhoto(rawItem: unknown, index: number) {
  const src = typeof rawItem === 'string'
    ? rawItem
    : rawItem && typeof rawItem === 'object' && 'src' in rawItem
      ? (rawItem as { src?: unknown }).src
      : undefined
  const label = rawItem && typeof rawItem === 'object' && 'label' in rawItem
    ? (rawItem as { label?: unknown }).label
    : undefined

  if (typeof src !== 'string' || !src.trim()) {
    return null
  }

  return {
    id: `${src}-${index}`,
    label: typeof label === 'string' && label.trim() ? label.trim() : `予備${index + 1}`,
    src: resolveBackupPhotoSrc(src),
  }
}

function withDefaultBackupPhotos(backupPhotosBySlot: BackupPhotosBySlot) {
  const nextBackupPhotosBySlot = { ...backupPhotosBySlot }

  DEFAULT_PHOTO_IDS.forEach((slotId) => {
    if (!nextBackupPhotosBySlot[slotId]?.length) {
      nextBackupPhotosBySlot[slotId] = [createDefaultBackupPhoto(slotId)]
    }
  })

  return nextBackupPhotosBySlot
}

function createDefaultBackupPhoto(slotId: number): BackupPhoto {
  return {
    id: `default-${slotId}`,
    label: '予備1',
    src: getDefaultPhotoSrc(slotId),
  }
}

function getDefaultPhotoSrc(slotId: number) {
  return resolveBackupPhotoSrc(DEFAULT_BACKUP_PHOTO_FILES[slotId] ?? DEFAULT_BACKUP_PHOTO_FILES[1])
}

function resolveBackupPhotoSrc(src: string) {
  const trimmedSrc = src.trim()

  if (/^[a-z][a-z\d+\-.]*:/i.test(trimmedSrc)) {
    return trimmedSrc
  }

  const publicPath = trimmedSrc.replace(/^\.?\//, '').replace(/^\/+/, '')
  const backupPhotoPath =
    publicPath.startsWith(`${BACKUP_PHOTO_FOLDER}/`) || publicPath.startsWith('images/')
      ? publicPath
      : `${BACKUP_PHOTO_FOLDER}/${publicPath}`

  return versionedAsset(backupPhotoPath, BACKUP_PHOTO_VERSION)
}

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 1920
const SLIDE_EXPORT_CROP = {
  x: 0,
  y: 265,
  width: STAGE_WIDTH,
  height: 1420,
}
const SLIDE_EXPORT_QUALITY = 0.92
const SCENE_FOLLOWUP_SCROLL_DURATION_MS = 1200
const SCENE_FOLLOWUP_SCROLL_OFFSET = -80
const SCENE_VIDEO_SCROLL_DURATION_MS = 1000
const SCENE_VIDEO_SCROLL_OFFSET = 200
const VIDEO_DOUBLE_TAP_MS = 320
const VIDEO_SKIP_INDICATOR_MS = 650
const VIDEO_SKIP_SECONDS = 5
const DEVICE_ROLE_STORAGE_KEY = 'continue-tablet-device-role'

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

type BatteryManager = EventTarget & {
  charging: boolean
  level: number
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>
}

type BatteryStatus = {
  charging: boolean
  level: number | null
  supported: boolean
}

function scrollToElement(container: HTMLElement, target: HTMLElement, duration: number) {
  const startTop = container.scrollTop
  const targetTop = Math.max(target.offsetTop + SCENE_FOLLOWUP_SCROLL_OFFSET, 0)
  const distance = targetTop - startTop
  const startTime = performance.now()
  let frameId = 0

  const easeInOutCubic = (progress: number) =>
    progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2

  const animate = (time: number) => {
    const progress = Math.min((time - startTime) / duration, 1)

    container.scrollTop = startTop + distance * easeInOutCubic(progress)

    if (progress < 1) {
      frameId = window.requestAnimationFrame(animate)
    }
  }

  frameId = window.requestAnimationFrame(animate)

  return () => window.cancelAnimationFrame(frameId)
}

function scrollToCenteredElement(container: HTMLElement, target: HTMLElement, duration: number) {
  return new Promise<void>((resolve) => {
    const startTop = container.scrollTop
    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    const targetTop =
      target.offsetTop - (container.clientHeight - target.offsetHeight) / 2 + SCENE_VIDEO_SCROLL_OFFSET
    const distance = Math.min(Math.max(targetTop, 0), maxScrollTop) - startTop

    if (Math.abs(distance) < 1) {
      resolve()
      return
    }

    const startTime = performance.now()

    const easeInOutCubic = (progress: number) =>
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1)

      container.scrollTop = startTop + distance * easeInOutCubic(progress)

      if (progress < 1) {
        window.requestAnimationFrame(animate)
        return
      }

      resolve()
    }

    window.requestAnimationFrame(animate)
  })
}

function getIsFullscreen() {
  return Boolean(document.fullscreenElement)
}

function getStageScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
}

function getStoredDeviceRole(): DeviceRole {
  const storedRole = window.localStorage.getItem(DEVICE_ROLE_STORAGE_KEY)

  return storedRole === 'master' || storedRole === 'player' ? storedRole : 'unknown'
}

function isCrossOriginUrl(src: string) {
  const url = new URL(src, window.location.href)

  return url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== window.location.origin
}

function hasCrossOriginPhotos(photos: PhotoSlot[]) {
  return photos.some((photo) => isCrossOriginUrl(photo.src))
}

function preloadDecodedImage(src: string, cache: Map<string, Promise<HTMLImageElement>>) {
  const cachedImage = cache.get(src)

  if (cachedImage) {
    return cachedImage
  }

  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()

    image.decoding = 'async'
    image.addEventListener(
      'load',
      () => {
        void decodeImage(image).then(() => resolve(image))
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => reject(new Error(`Failed to preload image: ${src}`)),
      { once: true },
    )
    image.src = src
  })

  const trackedImagePromise = imagePromise.catch((error) => {
    cache.delete(src)
    throw error
  })

  cache.set(src, trackedImagePromise)

  return trackedImagePromise
}

async function preloadCachedImage(
  src: string,
  cache: Map<string, Promise<HTMLImageElement>>,
) {
  const image = await preloadDecodedImage(src, cache)

  await cacheStaticAsset(src).catch((error) => {
    console.warn('Failed to cache image asset', error)
  })

  return image
}

async function decodeImage(image: HTMLImageElement) {
  try {
    await image.decode?.()
  } catch {
    // Some browsers can report decode failures for already usable images.
  }
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()

    if (isCrossOriginUrl(src)) {
      image.crossOrigin = 'anonymous'
    }

    image.addEventListener(
      'load',
      () => {
        void decodeImage(image).then(() => resolve(image))
      },
      { once: true },
    )
    image.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), {
      once: true,
    })
    image.src = src
  })
}

async function loadCanvasPhotoImage(photo: PhotoSlot) {
  const fallbackSrc = getDefaultPhotoSrc(photo.id)

  try {
    return await loadCanvasImage(photo.src || fallbackSrc)
  } catch (error) {
    if (!photo.src || photo.src === fallbackSrc) {
      throw error
    }

    return loadCanvasImage(fallbackSrc)
  }
}

function getPreloadImageSrcs() {
  return PRELOAD_IMAGE_ASSETS.map((path) => versionedAsset(path, STATIC_IMAGE_VERSION))
}

function getBackupPhotoImageSrcs(backupPhotosBySlot: BackupPhotosBySlot) {
  return Object.values(backupPhotosBySlot).flatMap((backupPhotos) =>
    backupPhotos.map((backupPhoto) => backupPhoto.src),
  )
}

function getResidentImageSrcs(photos: PhotoSlot[]) {
  return Array.from(
    new Set([
      ...getPreloadImageSrcs(),
      ...DEFAULT_BACKUP_PHOTO_ASSETS.map((path) => versionedAsset(path, BACKUP_PHOTO_VERSION)),
      ...photos.map((photo) => photo.src),
      ...photos.map((photo) => getDefaultPhotoSrc(photo.id)),
    ]),
  )
}

function getPhotoManagerImageSrcs(
  photos: PhotoSlot[],
  backupPhotosBySlot: BackupPhotosBySlot,
) {
  return Array.from(
    new Set([
      ...Array.from(getPhotoSrcs(photos)),
      ...photos.map((photo) => getDefaultPhotoSrc(photo.id)),
      ...getBackupPhotoImageSrcs(backupPhotosBySlot),
    ]),
  )
}

async function preparePhotoForDisplay(
  photo: PhotoSlot,
  decodedImageCache: Map<string, Promise<HTMLImageElement>>,
) {
  const fallbackSrc = getDefaultPhotoSrc(photo.id)
  const primarySrc = photo.src || fallbackSrc

  try {
    await preloadCachedImage(primarySrc, decodedImageCache)
    return { ...photo, src: primarySrc }
  } catch {
    await preloadCachedImage(fallbackSrc, decodedImageCache).catch((error) => {
      console.error('Failed to preload fallback photo', error)
    })
    return { ...photo, src: fallbackSrc }
  }
}

function preparePhotoSlots(
  photos: PhotoSlot[],
  decodedImageCache: Map<string, Promise<HTMLImageElement>>,
) {
  return Promise.all(
    photos.map((photo) => preparePhotoForDisplay(photo, decodedImageCache)),
  )
}

async function prepareInitialAppAssets(
  photos: PhotoSlot[],
  decodedImageCache: Map<string, Promise<HTMLImageElement>>,
  onProgress?: AssetLoadProgressHandler,
) {
  const imageSrcs = getResidentImageSrcs(photos)
  const mediaSrcs = [
    getSceneOneVideoSrc(),
    ...PRELOAD_SOUND_ASSETS.map(({ path }) => publicAsset(path)),
  ]
  const total = imageSrcs.length + mediaSrcs.length
  let loaded = 0
  const reportProgress = () => onProgress?.({ loaded, total })
  const trackAsset = <T,>(promise: Promise<T>) =>
    promise.finally(() => {
      loaded += 1
      reportProgress()
    })

  reportProgress()

  const [preparedPhotos] = await Promise.all([
    preparePhotoSlots(photos, decodedImageCache),
    Promise.allSettled(
      imageSrcs.map((src) => trackAsset(preloadCachedImage(src, decodedImageCache))),
    ),
    Promise.allSettled(mediaSrcs.map((src) => trackAsset(cacheStaticAsset(src)))),
  ])

  return preparedPhotos
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
            return
          }

          reject(new Error('Failed to create image blob'))
        },
        type,
        quality,
      )
    } catch (error) {
      reject(error)
    }
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (image.naturalWidth - sourceWidth) / 2
  const sourceY = (image.naturalHeight - sourceHeight) / 2

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

function drawImageContain(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  const drawX = x + (width - drawWidth) / 2
  const drawY = y + (height - drawHeight) / 2

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
}

function drawPhotoPlaceholder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save()
  context.fillStyle = '#d8d8d8'
  context.fillRect(x, y, width, height)
  context.strokeStyle = '#777'
  context.lineWidth = 8
  context.beginPath()
  context.moveTo(x + width * 0.18, y + height * 0.18)
  context.lineTo(x + width * 0.82, y + height * 0.82)
  context.moveTo(x + width * 0.82, y + height * 0.18)
  context.lineTo(x + width * 0.18, y + height * 0.82)
  context.stroke()
  context.fillStyle = '#555'
  context.font = '900 34px "Yu Gothic", "YuGothic", "Hiragino Sans", Meiryo, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('NO PHOTO', x + width / 2, y + height / 2)
  context.restore()
}

function drawSceneThreeLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const [roleLabel, castLabel] = label.split('\n')
  const lines = castLabel ? [roleLabel, castLabel] : [roleLabel]
  const lineHeight = 35
  const totalHeight = lines.length * lineHeight + Math.max(lines.length - 1, 0) * 3
  let lineY = y + (height - totalHeight) / 2

  context.save()
  context.font = '900 34px "Yu Gothic", "YuGothic", "Hiragino Sans", Meiryo, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.shadowColor = 'rgba(255, 235, 170, 0.52)'
  context.shadowBlur = 5

  lines.forEach((line, index) => {
    context.fillStyle = index === 0 ? '#d54397' : '#8a1b12'
    context.fillText(line, x + width / 2, lineY, width)
    lineY += lineHeight + 3
  })

  context.restore()
}

async function createSceneThreeSlideBlob(photos: PhotoSlot[]) {
  await document.fonts?.ready

  const [backgroundImage, submitButtonImage, ...photoImages] = await Promise.all([
    loadCanvasImage(versionedAsset('images/hannnin.jpg', STATIC_IMAGE_VERSION)),
    loadCanvasImage(versionedAsset('images/teisyutu_botton.webp', STATIC_IMAGE_VERSION)),
    ...photos.map((photo) => loadCanvasPhotoImage(photo)),
  ])
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = SLIDE_EXPORT_CROP.width
  canvas.height = SLIDE_EXPORT_CROP.height

  if (!context) {
    throw new Error('Canvas is not supported')
  }

  context.save()
  context.translate(-SLIDE_EXPORT_CROP.x, -SLIDE_EXPORT_CROP.y)
  context.fillStyle = '#020817'
  context.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
  drawImageCover(context, backgroundImage, 0, 0, STAGE_WIDTH, STAGE_HEIGHT)

  photos.forEach((photo, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const cardX = 120 + column * (442 + 88)
    const cardY = 470 + row * (378 / PHOTO_ASPECT_RATIO + 14 + 86 + 36)
    const frameX = cardX + 32
    const frameY = cardY
    const frameWidth = 378
    const frameHeight = frameWidth / PHOTO_ASPECT_RATIO
    const labelY = frameY + frameHeight + 14
    const photoImage = photoImages[index]

    context.save()
    context.shadowColor = 'rgba(96, 54, 28, 0.24)'
    context.shadowBlur = 18
    context.shadowOffsetX = 9
    context.shadowOffsetY = 12
    context.fillStyle = 'rgba(255, 255, 255, 0.01)'
    context.fillRect(frameX, frameY, frameWidth, frameHeight)
    context.restore()

    if (photoImage) {
      drawImageCover(context, photoImage, frameX, frameY, frameWidth, frameHeight)
    } else {
      drawPhotoPlaceholder(context, frameX, frameY, frameWidth, frameHeight)
    }

    context.save()
    context.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    context.lineWidth = 2
    context.strokeRect(frameX + 1, frameY + 1, frameWidth - 2, frameHeight - 2)
    context.restore()

    drawSceneThreeLabel(context, photo.label, cardX, labelY, 442, 86)
  })

  context.save()
  context.globalAlpha = 0.52
  drawImageContain(context, submitButtonImage, 310, 1682, 581, 129)
  context.restore()
  context.restore()

  return canvasToBlob(canvas, 'image/jpeg', SLIDE_EXPORT_QUALITY)
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(getStoredDeviceRole)
  const [teamNumber, setTeamNumber] = useState<number | null>(null)
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null)
  const [submittedPhotoId, setSubmittedPhotoId] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(getIsFullscreen)
  const [stageScale, setStageScale] = useState(getStageScale)
  const [photos, setPhotos] = useState<PhotoSlot[]>(defaultPhotos)
  const [backupPhotosBySlot, setBackupPhotosBySlot] = useState<BackupPhotosBySlot>({})
  const [teamStates, setTeamStates] = useState<TeamState[]>(createEmptyTeamStates)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [realtimeError, setRealtimeError] = useState('')
  const [gameEnded, setGameEnded] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [isSlideExporting, setIsSlideExporting] = useState(false)
  const [slideExportStatus, setSlideExportStatus] = useState('')
  const [hasRevealedSceneOneVideo, setHasRevealedSceneOneVideo] = useState(false)
  const [hasCompletedSceneOneVideo, setHasCompletedSceneOneVideo] = useState(false)
  const [isAppReady, setIsAppReady] = useState(false)
  const [assetLoadStatus, setAssetLoadStatus] = useState('LOADING...')
  const [assetLoadProgress, setAssetLoadProgress] = useState<AssetLoadProgress>({
    loaded: 0,
    total: 0,
  })
  const isPreparingSceneThree = false
  const [secretMenuOpen, setSecretMenuOpen] = useState(false)
  const decodedImageCache = useRef<Map<string, Promise<HTMLImageElement>>>(new Map())
  const photosRef = useRef(photos)
  const photoPreparationSequenceRef = useRef(0)
  const hasLoadedPhotoManagerAssetsRef = useRef(false)
  const sceneSequenceRef = useRef<HTMLDivElement>(null)
  const sceneTwoPanelRef = useRef<HTMLDivElement>(null)
  const shouldScrollToSceneTwoRef = useRef(false)
  const hasSeenHomeCommandRef = useRef(false)
  const lastHomeCommandIdRef = useRef<string | null>(null)
  const sceneTouchScrollRef = useRef({
    animationFrame: 0,
    didDrag: false,
    lastTime: 0,
    lastY: 0,
    suppressClick: false,
    startScrollTop: 0,
    startY: 0,
    velocity: 0,
  })
  const secretTapCount = useRef(0)
  const secretTapResetTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    PRELOAD_SOUND_ASSETS.forEach(({ path, volume, poolSize }) => {
      preloadSoundPool(path, volume, poolSize)
    })

    const unlockAudio = () => {
      unlockPreloadedSounds()
    }

    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true })

    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    let isMounted = true

    const initializeAppAssets = async () => {
      let storedPhotos: StoredPhoto[] = []

      try {
        storedPhotos = await fetchCurrentPhotos()
      } catch (error) {
        console.warn('Failed to fetch current photos on startup', error)
      }

      const initialPhotos = mergeStoredPhotos(defaultPhotos, storedPhotos)

      setAssetLoadStatus('LOADING ASSETS...')
      const preparedPhotos = await prepareInitialAppAssets(
        initialPhotos,
        decodedImageCache.current,
        (progress) => {
          if (isMounted) {
            setAssetLoadProgress(progress)
          }
        },
      )

      if (!isMounted) {
        return
      }

      photosRef.current = preparedPhotos
      setPhotos(preparedPhotos)
      setIsAppReady(true)
    }

    void initializeAppAssets().catch((error) => {
      console.error('Failed to initialize app assets', error)

      if (!isMounted) {
        return
      }

      setIsAppReady(true)
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const fullscreenQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: fullscreen)',
    )
    const standaloneQuery: LegacyMediaQueryList = window.matchMedia(
      '(display-mode: standalone)',
    )

    const updateFullscreenState = () => {
      setIsFullscreen(getIsFullscreen())
    }

    document.addEventListener('fullscreenchange', updateFullscreenState)
    fullscreenQuery.addEventListener?.('change', updateFullscreenState)
    fullscreenQuery.addListener?.(updateFullscreenState)
    standaloneQuery.addEventListener?.('change', updateFullscreenState)
    standaloneQuery.addListener?.(updateFullscreenState)

    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState)
      fullscreenQuery.removeEventListener?.('change', updateFullscreenState)
      fullscreenQuery.removeListener?.(updateFullscreenState)
      standaloneQuery.removeEventListener?.('change', updateFullscreenState)
      standaloneQuery.removeListener?.(updateFullscreenState)
    }
  }, [])

  useEffect(() => {
    const updateStageScale = () => {
      setStageScale(getStageScale())
    }

    updateStageScale()
    window.addEventListener('resize', updateStageScale)
    window.addEventListener('orientationchange', updateStageScale)

    return () => {
      window.removeEventListener('resize', updateStageScale)
      window.removeEventListener('orientationchange', updateStageScale)
    }
  }, [])

  useEffect(() => {
    if (!isAppReady) {
      return
    }

    return subscribeCurrentPhotos((storedPhotos) => {
      const sequence = photoPreparationSequenceRef.current + 1
      photoPreparationSequenceRef.current = sequence
      const nextPhotos = mergeStoredPhotos(photosRef.current, storedPhotos)

      void preparePhotoSlots(nextPhotos, decodedImageCache.current)
        .then((preparedPhotos) => {
          if (photoPreparationSequenceRef.current !== sequence) {
            return
          }

          photosRef.current = preparedPhotos
          setPhotos(preparedPhotos)
        })
        .catch((error) => {
          console.error('Failed to prepare updated photos', error)
        })
    })
  }, [isAppReady])

  useEffect(() => {
    return subscribeGameControl((state) => setGameEnded(state.gameEnded), setRealtimeError)
  }, [])

  useEffect(() => {
    if (screen !== 'master' && screen !== 'home') {
      return
    }

    return subscribeTeamStates(setTeamStates, setRealtimeError)
  }, [screen])

  useEffect(() => {
    if (screen !== 'master') {
      return
    }

    return subscribeRealtimeConnection(setRealtimeConnected)
  }, [screen])

  useEffect(() => {
    if (!teamNumber) {
      return
    }

    return connectTeamPresence(teamNumber, setRealtimeError)
  }, [teamNumber])

  useEffect(() => {
    photos.forEach((photo) => {
      void preloadCachedImage(photo.src, decodedImageCache.current).catch(() => undefined)
      void preloadCachedImage(getDefaultPhotoSrc(photo.id), decodedImageCache.current).catch(() => undefined)
    })
  }, [photos])

  useEffect(() => {
    if (screen !== 'photos') {
      return
    }

    let isMounted = true

    const loadPhotoManagerAssets = async () => {
      let loadedBackupPhotosBySlot = backupPhotosBySlot

      if (!hasLoadedPhotoManagerAssetsRef.current) {
        try {
          loadedBackupPhotosBySlot = await loadBackupPhotos()
        } catch (error) {
          console.warn('Failed to load backup photos for photo manager', error)
          loadedBackupPhotosBySlot = withDefaultBackupPhotos({})
        }

        if (!isMounted) {
          return
        }

        hasLoadedPhotoManagerAssetsRef.current = true
        setBackupPhotosBySlot(loadedBackupPhotosBySlot)
      }

      const imageSrcs = getPhotoManagerImageSrcs(
        photosRef.current,
        loadedBackupPhotosBySlot,
      )

      await Promise.allSettled([
        warmBackupPhotoCache(loadedBackupPhotosBySlot),
        ...imageSrcs.map((src) => preloadCachedImage(src, decodedImageCache.current)),
      ])
    }

    void loadPhotoManagerAssets()

    return () => {
      isMounted = false
    }
  }, [backupPhotosBySlot, photos, screen])

  useEffect(() => {
    if (screen !== 'scene1') {
      return
    }

    if (!hasCompletedSceneOneVideo) {
      sceneSequenceRef.current?.scrollTo({ top: 0 })
      return
    }

    if (!shouldScrollToSceneTwoRef.current) {
      sceneSequenceRef.current?.scrollTo({ top: 0 })
      return
    }

    shouldScrollToSceneTwoRef.current = false

    let cancelScroll: (() => void) | undefined
    const frameId = window.requestAnimationFrame(() => {
      if (sceneSequenceRef.current && sceneTwoPanelRef.current) {
        cancelScroll = scrollToElement(
          sceneSequenceRef.current,
          sceneTwoPanelRef.current,
          SCENE_FOLLOWUP_SCROLL_DURATION_MS,
        )
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      cancelScroll?.()
    }
  }, [hasCompletedSceneOneVideo, screen])

  useEffect(() => {
    if (screen !== 'scene1') {
      return
    }

    const scrollContainer = sceneSequenceRef.current

    if (!scrollContainer) {
      return
    }

    const shouldIgnoreTouch = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.video-seek'))

    const getMaxScrollTop = () =>
      Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0)

    const scrollToTop = (top: number) => {
      scrollContainer.scrollTop = Math.min(Math.max(top, 0), getMaxScrollTop())
    }

    const stopMomentum = () => {
      if (sceneTouchScrollRef.current.animationFrame) {
        window.cancelAnimationFrame(sceneTouchScrollRef.current.animationFrame)
        sceneTouchScrollRef.current.animationFrame = 0
      }
    }

    const runMomentum = () => {
      const state = sceneTouchScrollRef.current

      if (Math.abs(state.velocity) < 0.02) {
        state.animationFrame = 0
        return
      }

      const beforeTop = scrollContainer.scrollTop
      scrollToTop(beforeTop + state.velocity * 16)

      if (scrollContainer.scrollTop === beforeTop) {
        state.animationFrame = 0
        state.velocity = 0
        return
      }

      state.velocity *= 0.92
      state.animationFrame = window.requestAnimationFrame(runMomentum)
    }

    const startTouchScroll = (event: TouchEvent) => {
      if (shouldIgnoreTouch(event.target) || event.touches.length !== 1) {
        return
      }

      stopMomentum()

      const touchY = event.touches[0].clientY
      const now = performance.now()

      sceneTouchScrollRef.current = {
        animationFrame: 0,
        didDrag: false,
        lastTime: now,
        lastY: touchY,
        suppressClick: false,
        startScrollTop: scrollContainer.scrollTop,
        startY: touchY,
        velocity: 0,
      }
    }

    const moveTouchScroll = (event: TouchEvent) => {
      if (shouldIgnoreTouch(event.target) || event.touches.length !== 1) {
        return
      }

      const state = sceneTouchScrollRef.current
      const touchY = event.touches[0].clientY
      const deltaFromStart = touchY - state.startY

      if (Math.abs(deltaFromStart) < 5 && !state.didDrag) {
        return
      }

      const now = performance.now()
      const deltaY = touchY - state.lastY
      const deltaTime = Math.max(now - state.lastTime, 1)
      const scrollDelta = -deltaY / Math.max(stageScale, 0.1)

      state.didDrag = true
      state.suppressClick = true
      state.velocity = Math.min(Math.max(scrollDelta / deltaTime, -4), 4)
      state.lastY = touchY
      state.lastTime = now

      scrollToTop(scrollContainer.scrollTop + scrollDelta)
      event.preventDefault()
    }

    const endTouchScroll = () => {
      const state = sceneTouchScrollRef.current

      if (!state.didDrag) {
        return
      }

      stopMomentum()
      state.animationFrame = window.requestAnimationFrame(runMomentum)
    }

    const suppressDraggedClick = (event: MouseEvent) => {
      const state = sceneTouchScrollRef.current

      if (!state.suppressClick) {
        return
      }

      state.suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    const wheelScroll = (event: WheelEvent) => {
      if (shouldIgnoreTouch(event.target)) {
        return
      }

      scrollToTop(scrollContainer.scrollTop + event.deltaY / Math.max(stageScale, 0.1))
      event.preventDefault()
    }

    scrollContainer.addEventListener('touchstart', startTouchScroll, { passive: true })
    scrollContainer.addEventListener('touchmove', moveTouchScroll, { passive: false })
    scrollContainer.addEventListener('touchend', endTouchScroll)
    scrollContainer.addEventListener('touchcancel', endTouchScroll)
    scrollContainer.addEventListener('click', suppressDraggedClick, true)
    scrollContainer.addEventListener('wheel', wheelScroll, { passive: false })

    return () => {
      stopMomentum()
      scrollContainer.removeEventListener('touchstart', startTouchScroll)
      scrollContainer.removeEventListener('touchmove', moveTouchScroll)
      scrollContainer.removeEventListener('touchend', endTouchScroll)
      scrollContainer.removeEventListener('touchcancel', endTouchScroll)
      scrollContainer.removeEventListener('click', suppressDraggedClick, true)
      scrollContainer.removeEventListener('wheel', wheelScroll)
    }
  }, [screen, stageScale])

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhotoId),
    [photos, selectedPhotoId],
  )
  const submittedPhoto = useMemo(
    () => photos.find((photo) => photo.id === submittedPhotoId),
    [photos, submittedPhotoId],
  )
  const residentImageSrcs = useMemo(
    () => getResidentImageSrcs(photos),
    [photos],
  )

  const enterFullscreen = async () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => undefined)
    }
  }

  const exitFullscreenFromSecretMenu = async () => {
    await exitFullscreen()
    setSecretMenuOpen(false)
  }

  const startTeam = (team: number) => {
    void enterFullscreen()
    setDeviceRole('player')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'player')
    setTeamNumber(team)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    shouldScrollToSceneTwoRef.current = false
    setHasRevealedSceneOneVideo(false)
    setHasCompletedSceneOneVideo(false)
    setScreen('scene0')
  }

  const goHome = () => {
    setTeamNumber(null)
    setSelectedPhotoId(null)
    setSubmittedPhotoId(null)
    shouldScrollToSceneTwoRef.current = false
    setHasRevealedSceneOneVideo(false)
    setHasCompletedSceneOneVideo(false)
    setSecretMenuOpen(false)
    setScreen('home')
  }

  const reloadApp = () => {
    window.location.reload()
  }

  useEffect(() => {
    return subscribeHomeCommand((command) => {
      if (!command?.id) {
        hasSeenHomeCommandRef.current = true
        return
      }

      if (!hasSeenHomeCommandRef.current) {
        hasSeenHomeCommandRef.current = true
        lastHomeCommandIdRef.current = command.id
        return
      }

      if (lastHomeCommandIdRef.current === command.id) {
        return
      }

      lastHomeCommandIdRef.current = command.id

      if (deviceRole !== 'master') {
        goHome()
      }
    }, setRealtimeError)
  }, [deviceRole])

  const tapSecretHotspot = () => {
    window.clearTimeout(secretTapResetTimer.current)
    secretTapCount.current += 1

    if (secretTapCount.current >= 5) {
      secretTapCount.current = 0
      setSecretMenuOpen(true)
      return
    }

    secretTapResetTimer.current = window.setTimeout(() => {
      secretTapCount.current = 0
    }, 1200)
  }

  const preparePhotosForDisplay = (nextPhotos: PhotoSlot[]) =>
    preparePhotoSlots(nextPhotos, decodedImageCache.current)

  const updatePhoto = async (slotId: number, file: File | null) => {
    if (!file) {
      return
    }

    setUploadStatus('アップロード中...')

    try {
      const src = await uploadCurrentPhoto(slotId, file)
      const updatedAt = Date.now()
      const previousPhotos = photos
      const nextPhotos = photos.map((photo) =>
        photo.id === slotId
          ? {
              ...photo,
              history: getPhotoHistory({ ...photo, src, updatedAt }),
              src,
              updatedAt,
            }
          : photo,
      )
      const preparedPhotos = await preparePhotosForDisplay(nextPhotos)

      photosRef.current = preparedPhotos
      setPhotos(preparedPhotos)
      await saveCurrentPhotos(toStoredPhotos(preparedPhotos))
      await deletePhotoFiles(getUnreferencedPhotoSrcs(previousPhotos, preparedPhotos))
      setUploadStatus('更新しました')
    } catch (error) {
      console.error('Failed to update photo', error)
      setUploadStatus('アップロードに失敗しました')
    }
  }

  const selectPhotoHistory = async (slotId: number, historyItem: PhotoHistoryItem) => {
    const previousPhotos = photos
    const nextPhotos = photos.map((photo) =>
      photo.id === slotId
        ? {
            ...photo,
            history: getPhotoHistory({ ...photo, src: historyItem.src, updatedAt: historyItem.updatedAt }),
            src: historyItem.src,
            updatedAt: historyItem.updatedAt,
          }
        : photo,
    )
    const preparedPhotos = await preparePhotosForDisplay(nextPhotos)

    photosRef.current = preparedPhotos
    setPhotos(preparedPhotos)
    await saveCurrentPhotos(toStoredPhotos(preparedPhotos))
    await deletePhotoFiles(getUnreferencedPhotoSrcs(previousPhotos, preparedPhotos))
  }

  const togglePhotoKeep = async (slotId: number, src: string) => {
    const previousPhotos = photos
    let isKeptAfterToggle = false
    const nextPhotos = photos.map((photo) => {
      if (photo.id !== slotId) {
        return photo
      }

      const history = getPhotoHistory(photo)
      const selectedItem = history.find((historyItem) => historyItem.src === src)

      if (!selectedItem) {
        return photo
      }

      isKeptAfterToggle = !selectedItem.isKept

      const toggledItem = setPhotoHistoryItemKeep(selectedItem, isKeptAfterToggle)
      const nextHistory = isKeptAfterToggle
        ? history.map((historyItem) =>
            historyItem.src === src ? toggledItem : historyItem,
          )
        : [
            toggledItem,
            ...history.filter((historyItem) => historyItem.src !== src),
          ]

      return {
        ...photo,
        history: getPhotoHistory({ ...photo, history: nextHistory }),
      }
    })

    const preparedPhotos = await preparePhotosForDisplay(nextPhotos)
    photosRef.current = preparedPhotos
    setPhotos(preparedPhotos)

    try {
      await saveCurrentPhotos(toStoredPhotos(preparedPhotos))
      await deletePhotoFiles(getUnreferencedPhotoSrcs(previousPhotos, preparedPhotos))
      setUploadStatus(isKeptAfterToggle ? '写真を保管しました' : '写真の保管を解除しました')
    } catch (error) {
      console.error('Failed to update kept photo', error)
      photosRef.current = previousPhotos
      setPhotos(previousPhotos)
      setUploadStatus('写真の保管設定に失敗しました')
    }
  }

  const selectBackupPhoto = async (slotId: number, backupPhoto: BackupPhoto) => {
    const updatedAt = Date.now()
    const previousPhotos = photos
    const nextPhotos = photos.map((photo) =>
      photo.id === slotId
        ? {
            ...photo,
            history: getPhotoHistory({ ...photo, src: backupPhoto.src, updatedAt }),
            src: backupPhoto.src,
            updatedAt,
          }
        : photo,
    )

    const preparedPhotos = await preparePhotosForDisplay(nextPhotos)
    photosRef.current = preparedPhotos
    setPhotos(preparedPhotos)

    try {
      await saveCurrentPhotos(toStoredPhotos(preparedPhotos))
      await deletePhotoFiles(getUnreferencedPhotoSrcs(previousPhotos, preparedPhotos))
      setUploadStatus('予備写真に切り替えました')
    } catch (error) {
      console.error('Failed to save backup photo selection', error)
      setUploadStatus('端末内で予備写真を表示しています')
    }
  }

  const submitAnswer = async () => {
    if (!teamNumber || !selectedPhoto) {
      return
    }

    const photoId = selectedPhoto.id

    setSubmittedPhotoId(photoId)

    try {
      await submitTeamAnswer(teamNumber, {
        label: getAnswerLabel(photoId),
        photoId,
      })
    } catch (error) {
      console.error('Failed to submit answer', error)
    }
  }

  const retryAnswer = async () => {
    setSubmittedPhotoId(null)
    setSelectedPhotoId(null)

    if (teamNumber) {
      try {
        await clearTeamAnswer(teamNumber)
      } catch (error) {
        console.error('Failed to clear answer', error)
      }
    }
  }

  const resetMasterAnswers = async () => {
    await resetAllTeamAnswers()
  }

  const returnToSceneTwo = () => {
    shouldScrollToSceneTwoRef.current = false
    setHasRevealedSceneOneVideo(true)
    setHasCompletedSceneOneVideo(true)
    setScreen('scene1')
  }

  const completeSceneOneVideo = () => {
    shouldScrollToSceneTwoRef.current = true
    setHasRevealedSceneOneVideo(true)
    setHasCompletedSceneOneVideo(true)
  }

  const startSceneOne = () => {
    setScreen('scene1')
  }

  const openSceneThree = () => {
    setScreen('scene3')
  }

  const openMaster = () => {
    void enterFullscreen()
    setDeviceRole('master')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'master')
    setScreen('master')
  }

  const openPhotos = () => {
    setDeviceRole('master')
    window.localStorage.setItem(DEVICE_ROLE_STORAGE_KEY, 'master')
    setScreen('photos')
  }

  const exportSlideImage = async () => {
    if (isSlideExporting) {
      return
    }

    setIsSlideExporting(true)
    setSlideExportStatus('出力中...')

    try {
      const blob = await createSceneThreeSlideBlob(photos)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

      downloadBlob(blob, `scene3-slide-${timestamp}.jpg`)
      setSlideExportStatus('出力しました')
    } catch (error) {
      console.error('Failed to export scene 3 slide image', error)
      setSlideExportStatus(
        hasCrossOriginPhotos(photos)
          ? 'Firebase StorageのCORS設定を確認してください'
          : '出力に失敗しました',
      )
    } finally {
      setIsSlideExporting(false)
    }
  }

  const isPlayerGameEnded =
    gameEnded &&
    deviceRole === 'player' &&
    (screen === 'scene0' || screen === 'scene1' || screen === 'scene3')

  return (
    <main className="app-frame">
      <div
        className="stage"
        data-screen={screen}
        style={
          {
            '--stage-scale': stageScale,
            '--stage-width': `${STAGE_WIDTH * stageScale}px`,
            '--stage-height': `${STAGE_HEIGHT * stageScale}px`,
            '--photo-aspect-width': `${PHOTO_ASPECT_WIDTH}`,
            '--photo-aspect-height': `${PHOTO_ASPECT_HEIGHT}`,
            '--photo-aspect-ratio': `${PHOTO_ASPECT_RATIO}`,
          } as CSSProperties
        }
      >
        <div className="stage-content">
          {!isAppReady ? (
            <AssetLoadingScreen progress={assetLoadProgress} status={assetLoadStatus} />
          ) : (
            <>
              <div
                className="persistent-scene-three"
                data-active={screen === 'scene3'}
                aria-hidden={screen !== 'scene3'}
              >
                <SceneThree
                  photos={photos}
                  selectedPhoto={selectedPhoto}
                  selectedPhotoId={selectedPhotoId}
                  submittedPhoto={submittedPhoto}
                  onBack={returnToSceneTwo}
                  onRetry={retryAnswer}
                  onSelect={setSelectedPhotoId}
                  onSubmit={submitAnswer}
                />
              </div>

              {screen !== 'scene3' && (
                <div className="active-screen-layer">
                  {screen === 'home' && (
                    <HomeScreen
                      photos={photos}
                      isSlideExporting={isSlideExporting}
                      slideExportStatus={slideExportStatus}
                      teams={teamStates}
                      onExportSlideImage={exportSlideImage}
                      onStartTeam={startTeam}
                      onOpenMaster={openMaster}
                      onOpenPhotos={openPhotos}
                    />
                  )}

                  {screen === 'scene0' && (
                    <SceneZero onNext={startSceneOne} />
                  )}

                  {screen === 'scene1' && (
                    <div
                      className="scene-sequence"
                      data-followup-visible={hasCompletedSceneOneVideo}
                      ref={sceneSequenceRef}
                    >
                      <SceneOne
                        isPreparingNext={isPreparingSceneThree}
                        isVideoComplete={hasCompletedSceneOneVideo}
                        isVideoRevealed={hasRevealedSceneOneVideo}
                        sceneFollowupRef={sceneTwoPanelRef}
                        onVideoReveal={() => setHasRevealedSceneOneVideo(true)}
                        onVideoComplete={completeSceneOneVideo}
                        onNext={openSceneThree}
                      />
                    </div>
                  )}

                  {screen === 'master' && (
                    <MasterScreen
                      gameEnded={gameEnded}
                      realtimeConnected={realtimeConnected}
                      realtimeError={realtimeError}
                      teams={teamStates}
                      onBack={() => setScreen('home')}
                      onResetAnswers={resetMasterAnswers}
                      onSendHomeCommand={sendHomeCommand}
                      onSetGameEnded={setGameEndedStatus}
                    />
                  )}

                  {screen === 'photos' && (
                    <PhotoManager
                      backupPhotosBySlot={backupPhotosBySlot}
                      photos={photos}
                      uploadStatus={uploadStatus}
                      onBack={() => setScreen('home')}
                      onSelectBackupPhoto={selectBackupPhoto}
                      onSelectHistory={selectPhotoHistory}
                      onToggleKeep={togglePhotoKeep}
                      onUpdatePhoto={updatePhoto}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isAppReady && <AssetPreloadLayer srcs={residentImageSrcs} />}

      {isPlayerGameEnded && <GameEndedOverlay />}

      {!isFullscreen && screen !== 'photos' && (
        <button className="fullscreen-control" type="button" onClick={enterFullscreen}>
          全画面
        </button>
      )}

      <button
        className="secret-hotspot"
        type="button"
        aria-label="管理メニュー"
        onClick={tapSecretHotspot}
      />

      {secretMenuOpen && (
        <SecretMenu
          teamNumber={teamNumber}
          onClose={() => setSecretMenuOpen(false)}
          onExitFullscreen={exitFullscreenFromSecretMenu}
          onGoHome={goHome}
          onReload={reloadApp}
        />
      )}
    </main>
  )
}

function GameEndedOverlay() {
  return (
    <div className="game-ended-overlay" role="status" aria-live="polite">
      <div className="game-ended-message">ゲームが終了いたしました</div>
    </div>
  )
}

function AssetLoadingScreen({
  progress,
  status,
}: {
  progress: AssetLoadProgress
  status: string
}) {
  const percent = progress.total > 0
    ? Math.round((progress.loaded / progress.total) * 100)
    : 0

  return (
    <section className="asset-loading-screen" aria-label="loading">
      <div className="asset-loading-panel">
        <p>{status}</p>
        <div className="asset-loading-count" aria-live="polite">
          <span>{progress.loaded}</span>
          <span>/</span>
          <span>{progress.total}</span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="asset-loading-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ '--asset-load-progress': `${percent}%` } as CSSProperties}
        >
          <span />
        </div>
      </div>
    </section>
  )
}

function AssetPreloadLayer({ srcs }: { srcs: string[] }) {
  return (
    <div className="asset-preload-layer" aria-hidden="true">
      {srcs.map((src) => (
        <img
          alt=""
          decoding="async"
          key={src}
          loading="eager"
          src={src}
        />
      ))}
    </div>
  )
}

function mergeStoredPhotos(currentPhotos: PhotoSlot[], storedPhotos: StoredPhoto[]) {
  const hasFourthPhoto = storedPhotos.some((item) => item.id === 4)
  const legacyCageyPhoto = hasFourthPhoto
    ? undefined
    : storedPhotos.find((item) => item.id === 3)

  return currentPhotos.map((photo) => {
    const storedPhoto = photo.id === 4 && legacyCageyPhoto
      ? legacyCageyPhoto
      : storedPhotos.find((item) => item.id === photo.id)

    if (photo.id === 3 && legacyCageyPhoto) {
      return photo
    }

    return storedPhoto
      ? {
          ...photo,
          history: getPhotoHistory(storedPhoto),
          src: storedPhoto.src,
          updatedAt: storedPhoto.updatedAt ?? getPhotoVersionTimestamp(storedPhoto.src),
        }
      : photo
  })
}

function toStoredPhotos(photos: PhotoSlot[]): StoredPhoto[] {
  return photos.map((photo) => ({
    ...(photo.history && photo.history.length > 0
      ? {
          history: photo.history.map((historyItem) => ({
            ...(historyItem.isKept ? { isKept: true } : {}),
            ...(historyItem.updatedAt ? { updatedAt: historyItem.updatedAt } : {}),
            src: historyItem.src,
          })),
        }
      : {}),
    id: photo.id,
    src: photo.src,
    ...(photo.updatedAt ? { updatedAt: photo.updatedAt } : {}),
  }))
}

function getUnreferencedPhotoSrcs(previousPhotos: PhotoSlot[], nextPhotos: PhotoSlot[]) {
  const nextSrcs = getPhotoSrcs(nextPhotos)

  return Array.from(getPhotoSrcs(previousPhotos)).filter((src) => !nextSrcs.has(src))
}

function getPhotoSrcs(photos: PhotoSlot[]) {
  const srcs = new Set<string>()

  photos.forEach((photo) => {
    srcs.add(photo.src)
    photo.history?.forEach((historyItem) => {
      srcs.add(historyItem.src)
    })
  })

  return srcs
}

function setPhotoHistoryItemKeep(historyItem: PhotoHistoryItem, isKept: boolean): PhotoHistoryItem {
  return {
    ...(isKept ? { isKept: true } : {}),
    ...(historyItem.updatedAt ? { updatedAt: historyItem.updatedAt } : {}),
    src: historyItem.src,
  }
}

function getPhotoHistory(photo: Pick<PhotoSlot, 'history' | 'src' | 'updatedAt'>) {
  const history = photo.history ?? []
  const currentUpdatedAt = photo.updatedAt ?? getPhotoVersionTimestamp(photo.src)
  const items = [
    { src: photo.src, updatedAt: currentUpdatedAt },
    ...history,
  ]
  const seen = new Map<string, PhotoHistoryItem>()
  const uniqueItems: PhotoHistoryItem[] = []
  let unkeptCount = 0

  items.forEach((item) => {
    if (!item.src) {
      return
    }

    const existingItem = seen.get(item.src)

    if (existingItem) {
      if (item.isKept) {
        existingItem.isKept = true
      }

      if (!existingItem.updatedAt && item.updatedAt) {
        existingItem.updatedAt = item.updatedAt
      }

      return
    }

    const nextItem: PhotoHistoryItem = {
      ...(item.isKept ? { isKept: true } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
      src: item.src,
    }

    seen.set(item.src, nextItem)
    uniqueItems.push(nextItem)
  })

  return uniqueItems.filter((item) => {
    if (item.isKept) {
      return true
    }

    if (unkeptCount >= PHOTO_HISTORY_LIMIT) {
      return false
    }

    unkeptCount += 1
    return true
  })
}

function getPhotoVersionTimestamp(src: string) {
  const version = new URL(src, window.location.href).searchParams.get('v')
  const timestamp = Number(version)

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined
}

const photoUpdatedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatPhotoUpdatedAt(updatedAt: number | undefined) {
  if (!updatedAt) {
    return '更新日時: 未更新'
  }

  return `更新日時: ${photoUpdatedAtFormatter.format(new Date(updatedAt))}`
}

function formatHomePhotoUpdatedAt(updatedAt: number | undefined) {
  if (!updatedAt) {
    return '未更新'
  }

  return photoUpdatedAtFormatter.format(new Date(updatedAt))
}

type FallbackPhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError' | 'src'> & {
  fallbackSrc: string
  retryKey?: boolean | number | string
  src: string
}
type CachedObjectUrl = {
  objectUrl: string
  src: string
}
type FailedPrimarySrc = {
  retryKey?: boolean | number | string
  src: string
}

function FallbackPhotoImage({
  fallbackSrc,
  retryKey,
  src,
  ...props
}: FallbackPhotoImageProps) {
  const primarySrc = src || fallbackSrc
  const [failedPrimarySrc, setFailedPrimarySrc] = useState<FailedPrimarySrc | null>(null)
  const [cachedObjectUrl, setCachedObjectUrl] = useState<CachedObjectUrl | null>(null)
  const currentPrimarySrcRef = useRef(primarySrc)
  const isFailedForCurrentRetry =
    failedPrimarySrc?.src === primarySrc && failedPrimarySrc.retryKey === retryKey
  const displaySrc = cachedObjectUrl?.src === primarySrc
    ? cachedObjectUrl.objectUrl
    : isFailedForCurrentRetry
      ? fallbackSrc
      : primarySrc

  useEffect(() => {
    currentPrimarySrcRef.current = primarySrc
  }, [primarySrc])

  useEffect(() => {
    return () => {
      if (cachedObjectUrl) {
        URL.revokeObjectURL(cachedObjectUrl.objectUrl)
      }
    }
  }, [cachedObjectUrl])

  return (
    <img
      {...props}
      key={primarySrc}
      src={displaySrc}
      onError={() => {
        if (displaySrc !== primarySrc || primarySrc === fallbackSrc) {
          return
        }

        void getCachedAssetObjectUrl(primarySrc)
          .then((objectUrl) => {
            if (!objectUrl) {
              setFailedPrimarySrc({ retryKey, src: primarySrc })
              return
            }

            if (currentPrimarySrcRef.current !== primarySrc) {
              URL.revokeObjectURL(objectUrl)
              return
            }

            setFailedPrimarySrc(null)
            setCachedObjectUrl({ objectUrl, src: primarySrc })
          })
          .catch(() => setFailedPrimarySrc({ retryKey, src: primarySrc }))
      }}
    />
  )
}

function createEmptyTeamStates() {
  return Array.from({ length: 8 }, (_, index) => ({ team: index + 1 }))
}

function getAnswerLabel(photoId: number) {
  return SUSPECT_LABELS[photoId] ?? ''
}

function isTeamAlive(team: TeamState) {
  return Boolean(team.online)
}

function getTeamConnectionCount(team: TeamState) {
  return Object.keys(team.connections ?? {}).length
}

function useBatteryStatus() {
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus>(() => ({
    charging: false,
    level: null,
    supported:
      typeof navigator !== 'undefined'
        && Boolean((navigator as NavigatorWithBattery).getBattery),
  }))

  useEffect(() => {
    const getBattery = (navigator as NavigatorWithBattery).getBattery

    if (!getBattery) {
      return
    }

    let battery: BatteryManager | null = null
    let isDisposed = false

    const updateBatteryStatus = () => {
      if (!battery) {
        return
      }

      setBatteryStatus({
        charging: battery.charging,
        level: battery.level,
        supported: true,
      })
    }

    void getBattery.call(navigator)
      .then((nextBattery) => {
        if (isDisposed) {
          return
        }

        battery = nextBattery
        updateBatteryStatus()
        battery.addEventListener('chargingchange', updateBatteryStatus)
        battery.addEventListener('levelchange', updateBatteryStatus)
      })
      .catch(() => {
        if (!isDisposed) {
          setBatteryStatus((currentStatus) => ({
            ...currentStatus,
            supported: false,
          }))
        }
      })

    return () => {
      isDisposed = true

      if (battery) {
        battery.removeEventListener('chargingchange', updateBatteryStatus)
        battery.removeEventListener('levelchange', updateBatteryStatus)
      }
    }
  }, [])

  return batteryStatus
}

type SecretMenuProps = {
  teamNumber: number | null
  onClose: () => void
  onExitFullscreen: () => Promise<void>
  onGoHome: () => void
  onReload: () => void
}

function SecretMenu({ teamNumber, onClose, onExitFullscreen, onGoHome, onReload }: SecretMenuProps) {
  return (
    <div className="secret-menu-backdrop" role="dialog" aria-modal="true" aria-label="管理メニュー">
      <div className="secret-menu-panel">
        <div className="secret-team-number">チーム：{teamNumber ?? '-'}</div>
        <button className="secret-close" type="button" onClick={onClose}>
          閉じる
        </button>
        <button
          className="secret-action secret-action-blue"
          type="button"
          onClick={() => void onExitFullscreen()}
        >
          フルスクリーン
          <br />
          を解除する
        </button>
        <button className="secret-action secret-action-green" type="button" onClick={onReload}>
          リロード
        </button>
        <button className="secret-action secret-action-pink" type="button" onClick={onGoHome}>
          ホーム
          <br />
          に戻る
        </button>
      </div>
    </div>
  )
}

type HomeScreenProps = {
  isSlideExporting: boolean
  photos: PhotoSlot[]
  slideExportStatus: string
  teams: TeamState[]
  onExportSlideImage: () => void
  onOpenMaster: () => void
  onStartTeam: (team: number) => void
  onOpenPhotos: () => void
}

function HomeScreen({
  isSlideExporting,
  photos,
  slideExportStatus,
  teams,
  onExportSlideImage,
  onOpenMaster,
  onStartTeam,
  onOpenPhotos,
}: HomeScreenProps) {
  const batteryStatus = useBatteryStatus()
  const teamsByNumber = useMemo(
    () => new Map(teams.map((team) => [team.team, team])),
    [teams],
  )

  return (
    <section className="home-screen" aria-label="チーム選択">
      <BatteryIndicator status={batteryStatus} />
      <h1 className="home-title">ゲームは続く</h1>
      <div className="home-photo-strip" aria-label="現在の写真">
        {photos.map((photo) => (
          <article className="home-photo-card" key={photo.id}>
            <FallbackPhotoImage
              src={photo.src}
              fallbackSrc={getDefaultPhotoSrc(photo.id)}
              alt={`${photo.label}の現在の写真`}
            />
            <span>{photo.label}</span>
            <p className="home-photo-updated-at">{formatHomePhotoUpdatedAt(photo.updatedAt)}</p>
          </article>
        ))}
      </div>

      <div className="team-grid" aria-label="チーム番号">
        {Array.from({ length: 8 }, (_, index) => {
          const teamNumber = index + 1
          const teamState = teamsByNumber.get(teamNumber)
          const connectionCount = teamState ? getTeamConnectionCount(teamState) : 0
          const hasDuplicateConnections = connectionCount >= 2

          return (
            <button
              className="team-button"
              data-duplicate={hasDuplicateConnections}
              data-online={teamState ? isTeamAlive(teamState) : false}
              key={teamNumber}
              type="button"
              onClick={() => onStartTeam(teamNumber)}
            >
              <span>{teamNumber}</span>
              {hasDuplicateConnections && <small>{connectionCount}台接続済</small>}
              {!hasDuplicateConnections && teamState && isTeamAlive(teamState) && <small>接続済み</small>}
            </button>
          )
        })}
      </div>

      <div className="home-actions">
        <button className="home-action-button" type="button" onClick={onOpenMaster}>
          MASTER
        </button>
        <button
          className="home-action-button home-action-slide"
          disabled={isSlideExporting}
          type="button"
          onClick={onExportSlideImage}
        >
          スライド用画像
        </button>
        <button className="home-action-button" type="button" onClick={onOpenPhotos}>
          写真撮影
        </button>
        {slideExportStatus && <p className="home-action-status">{slideExportStatus}</p>}
      </div>
    </section>
  )
}

type BatteryIndicatorProps = {
  status: BatteryStatus
}

function BatteryIndicator({ status }: BatteryIndicatorProps) {
  const batteryLevel = status.level === null ? 0 : Math.round(status.level * 100)
  const batteryPercent = status.level === null ? '--' : `${batteryLevel}%`
  const batteryLabel = status.supported
    ? status.charging
      ? '充電中'
      : '使用中'
    : '取得不可'
  const isLowBattery = status.supported && !status.charging && status.level !== null && status.level <= 0.2

  return (
    <div
      className="battery-indicator"
      data-charging={status.charging}
      data-low={isLowBattery}
      data-supported={status.supported}
      aria-label={
        status.supported && status.level !== null
          ? `バッテリー残量 ${batteryPercent}、${status.charging ? '充電中' : '充電していません'}`
          : 'バッテリー情報を取得できません'
      }
    >
      <span
        className="battery-icon"
        style={{ '--battery-level': `${batteryLevel}%` } as CSSProperties}
        aria-hidden="true"
      >
        <span className="battery-fill" />
      </span>
      <span className="battery-percent">{batteryPercent}</span>
      <span className="battery-state">{batteryLabel}</span>
    </div>
  )
}

type SceneOneProps = {
  isPreparingNext: boolean
  isVideoComplete: boolean
  isVideoRevealed: boolean
  sceneFollowupRef: RefObject<HTMLDivElement | null>
  onVideoReveal: () => void
  onVideoComplete: () => void
  onNext: () => void
}

type SceneZeroProps = {
  onNext: () => void
}

function SceneZero({ onNext }: SceneZeroProps) {
  return (
    <section className="story-screen scene-zero" aria-label="天使からの手紙">
      <div
        className="story-background"
        style={{ backgroundImage: `url("${versionedAsset('images/0.webp', STATIC_IMAGE_VERSION)}")` }}
        aria-hidden="true"
      />
      <div className="scene-zero-content">
        <p className="scene-zero-message">
          席に戻ってまずは、
          <br />
          タブレットを確認しよう！
        </p>
        <span className="scene-zero-letter-float" aria-hidden="true">
          <img
            className="scene-zero-letter"
            src={versionedAsset('images/0-1.webp', STATIC_IMAGE_VERSION)}
            alt=""
          />
        </span>
        <button
          className="scene-zero-next"
          type="button"
          onClick={() => {
            playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
            onNext()
          }}
        >
          進む
        </button>
      </div>
    </section>
  )
}

function SceneOne({
  isPreparingNext,
  isVideoComplete,
  isVideoRevealed,
  sceneFollowupRef,
  onVideoReveal,
  onVideoComplete,
  onNext,
}: SceneOneProps) {
  const videoBoxRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoClickTimerRef = useRef(0)
  const videoSkipIndicatorTimerRef = useRef(0)
  const lastVideoTapRef = useRef<{ side: 'left' | 'right'; time: number } | null>(null)
  const [hasStartedVideo, setHasStartedVideo] = useState(isVideoRevealed)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoSkipIndicator, setVideoSkipIndicator] = useState<'left' | 'right' | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoPlaybackRate, setVideoPlaybackRate] = useState<1 | 1.5>(1)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = clampVolume(SCENE_ONE_VIDEO_VOLUME)
    }

    return () => {
      window.clearTimeout(videoClickTimerRef.current)
      window.clearTimeout(videoSkipIndicatorTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = videoPlaybackRate
    }
  }, [videoPlaybackRate])

  const playVideo = async (restart = false) => {
    try {
      if (videoRef.current) {
        videoRef.current.volume = clampVolume(SCENE_ONE_VIDEO_VOLUME)
        videoRef.current.playbackRate = videoPlaybackRate

        if (restart) {
          videoRef.current.currentTime = 0
          setVideoProgress(0)
        }
      }

      await videoRef.current?.play()
      setIsVideoPlaying(true)
    } catch {
      setIsVideoPlaying(false)
    }
  }

  const scrollVideoToCenter = async () => {
    const videoBox = videoBoxRef.current
    const scrollContainer = videoBox?.closest('.scene-sequence') as HTMLElement | null

    if (!videoBox || !scrollContainer) {
      return
    }

    await scrollToCenteredElement(scrollContainer, videoBox, SCENE_VIDEO_SCROLL_DURATION_MS)
  }

  const startReenactment = async () => {
    playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)

    flushSync(() => {
      onVideoReveal()
    })

    await scrollVideoToCenter()
    await playVideo(true)
  }

  const toggleVideo = async () => {
    playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)

    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      setIsVideoPlaying(false)
      return
    }

    await playVideo()
  }

  const toggleVideoPlaybackRate = () => {
    playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
    setVideoPlaybackRate((currentRate) => {
      const nextRate = currentRate === 1 ? 1.5 : 1

      if (videoRef.current) {
        videoRef.current.playbackRate = nextRate
      }

      return nextRate
    })
  }

  const syncVideoProgress = () => {
    const video = videoRef.current

    if (!video) {
      return
    }

    setVideoProgress(video.currentTime)
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0)
  }

  const seekVideo = (time: number) => {
    const video = videoRef.current

    setVideoProgress(time)

    if (video) {
      video.currentTime = time
    }
  }

  const skipVideo = (seconds: number) => {
    const video = videoRef.current

    if (!video) {
      return
    }

    const duration = Number.isFinite(video.duration) ? video.duration : videoDuration
    const nextTime = Math.min(Math.max(video.currentTime + seconds, 0), duration || video.currentTime)

    seekVideo(nextTime)
  }

  const clickSkipControl = (seconds: number, side: 'left' | 'right') => {
    playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
    skipVideo(seconds)
    showSkipIndicator(side)
  }

  const showSkipIndicator = (side: 'left' | 'right') => {
    window.clearTimeout(videoSkipIndicatorTimerRef.current)
    setVideoSkipIndicator(side)
    videoSkipIndicatorTimerRef.current = window.setTimeout(() => {
      setVideoSkipIndicator(null)
    }, VIDEO_SKIP_INDICATOR_MS)
  }

  const clickVideo = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const side = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
    const now = performance.now()
    const lastTap = lastVideoTapRef.current

    if (lastTap && lastTap.side === side && now - lastTap.time <= VIDEO_DOUBLE_TAP_MS) {
      window.clearTimeout(videoClickTimerRef.current)
      lastVideoTapRef.current = null
      skipVideo(side === 'right' ? VIDEO_SKIP_SECONDS : -VIDEO_SKIP_SECONDS)
      showSkipIndicator(side)
      return
    }

    lastVideoTapRef.current = { side, time: now }
    window.clearTimeout(videoClickTimerRef.current)
    videoClickTimerRef.current = window.setTimeout(() => {
      lastVideoTapRef.current = null
      void toggleVideo()
    }, VIDEO_DOUBLE_TAP_MS)
  }

  const seekVideoFromClientX = (track: HTMLElement, clientX: number) => {
    if (!videoDuration) {
      return
    }

    const rect = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)

    seekVideo(ratio * videoDuration)
  }

  const videoProgressRatio = videoDuration
    ? Math.min(Math.max(videoProgress / videoDuration, 0), 1)
    : 0

  return (
    <section className="story-screen scene-one">
      <div
        className="story-background"
        style={{ backgroundImage: `url("${versionedAsset('images/tenkei.png', STATIC_IMAGE_VERSION)}")` }}
        aria-hidden="true"
      />
      <div
        className="scene-one-content"
        data-video-complete={isVideoComplete}
        data-video-revealed={isVideoRevealed}
      >
        <div className="ribbon-title">
          <img
            className="ribbon-title-art"
            src={versionedAsset('images/dayo.webp', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          <h1>天啓だよ！</h1>
        </div>
        <div className="scene-one-text-panel">
          <p>
            あのスタッフは急におかしくなったのではなく、
            <br />
            <strong>ボクが少し取り憑かせてもらっただけなので、</strong>
            <br />
            安心してボクの天啓を読んでほしい。
          </p>
          <p>
            ボクは<strong className="scene-alert-emphasis">天使</strong>。
            <br />
            運命が狂ってしまった人間を助ける使者だよ。
          </p>
          <p>
            君たちが遊んでいる<br /><strong>「幻の秘宝コバルト・ハートの消失」</strong><br />というナゾトキイベントでは、<br />いつもとは違う、<br /><strong>大変なこと</strong>が起こっているんだ。
          </p>
          <p>
            文字で説明するより見せたほうがいいか。
            <br />
            君たちがこの会場に入る前にボクが聞いた会話を、
            <br />
            なるべく<strong>忠実に再現</strong>するね。
            
           
          </p>
        </div>
        {!isVideoRevealed && (
          <button className="scene-reenact-button" type="button" onClick={startReenactment}>
            再現する
          </button>
        )}
        {isVideoRevealed && (
          <>
            <button
          className="video-box"
          data-playing={isVideoPlaying}
          data-started={hasStartedVideo}
          ref={videoBoxRef}
          type="button"
          aria-label={isVideoPlaying ? '動画を停止' : '動画を再生'}
          onClick={clickVideo}
        >
          <video
            ref={videoRef}
            src={getSceneOneVideoSrc()}
            preload="metadata"
            playsInline
            onLoadedMetadata={syncVideoProgress}
            onTimeUpdate={syncVideoProgress}
            onPlay={() => {
              setHasStartedVideo(true)
              setIsVideoPlaying(true)
            }}
            onPause={() => setIsVideoPlaying(false)}
            onEnded={() => {
              syncVideoProgress()
              onVideoComplete()
            }}
          />
          <img
            className="play-mark"
            src={versionedAsset('images/play.png', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          {videoSkipIndicator && (
            <span className="video-skip-indicator" data-side={videoSkipIndicator} aria-hidden="true">
              <span />
              <span />
            </span>
          )}
        </button>
        <div
          className="video-seek"
          role="slider"
          tabIndex={videoDuration ? 0 : -1}
          aria-label="動画の再生位置"
          aria-disabled={!videoDuration}
          aria-valuemin={0}
          aria-valuemax={Math.round(videoDuration)}
          aria-valuenow={Math.round(videoProgress)}
          style={{ '--video-progress': `${videoProgressRatio * 100}%` } as CSSProperties}
          onPointerDown={(event) => {
            if (!videoDuration) {
              return
            }

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            seekVideoFromClientX(event.currentTarget, event.clientX)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return
            }

            event.preventDefault()
            seekVideoFromClientX(event.currentTarget, event.clientX)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onKeyDown={(event) => {
            if (!videoDuration) {
              return
            }

            const step = videoDuration / 100

            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              seekVideo(Math.max(videoProgress - step, 0))
            }

            if (event.key === 'ArrowRight') {
              event.preventDefault()
              seekVideo(Math.min(videoProgress + step, videoDuration))
            }
          }}
        >
          <span className="video-seek-track" aria-hidden="true">
            <span className="video-seek-fill" />
            <span className="video-seek-thumb" />
          </span>
        </div>
        {isVideoComplete && (
        <div className="video-controls" aria-label="動画操作">
          <button
            className="video-control-button video-skip-button"
            disabled={!videoDuration}
            type="button"
            aria-label="5秒戻る"
            onClick={() => clickSkipControl(-VIDEO_SKIP_SECONDS, 'left')}
          >
            <img
              className="video-control-art"
              src={versionedAsset('images/5maebutton.webp', STATIC_IMAGE_VERSION)}
              alt=""
              aria-hidden="true"
            />
          </button>
          <button
            className="video-control-button video-toggle-button"
            type="button"
            aria-label={isVideoPlaying ? '動画を停止' : '動画を再生'}
            onClick={() => void toggleVideo()}
          >
            <img
              className="video-control-art"
              src={versionedAsset(
                isVideoPlaying ? 'images/stopbutton.webp' : 'images/playbutton.webp',
                STATIC_IMAGE_VERSION,
              )}
              alt=""
              aria-hidden="true"
            />
          </button>
          <button
            className="video-control-button video-skip-button"
            disabled={!videoDuration}
            type="button"
            aria-label="5秒進む"
            onClick={() => clickSkipControl(VIDEO_SKIP_SECONDS, 'right')}
          >
            <img
              className="video-control-art"
              src={versionedAsset('images/5nextbutton.webp', STATIC_IMAGE_VERSION)}
              alt=""
              aria-hidden="true"
            />
          </button>
          <button
            className="video-control-button video-speed-button"
            type="button"
            aria-label={`再生速度 ${videoPlaybackRate}倍`}
            aria-pressed={videoPlaybackRate === 1.5}
            onClick={toggleVideoPlaybackRate}
          >
            <img
              className="video-control-art"
              src={versionedAsset(
                videoPlaybackRate === 1 ? 'images/1.0x.webp' : 'images/1.5x.webp',
                STATIC_IMAGE_VERSION,
              )}
              alt=""
              aria-hidden="true"
            />
          </button>
        </div>
        )}
          </>
        )}
        {isVideoComplete && (
          <div className="scene-one-followup" ref={sceneFollowupRef}>
            <SceneTwoContent isPreparingNext={isPreparingNext} onNext={onNext} />
          </div>
        )}
      </div>
    </section>
  )
}

type SceneTwoProps = {
  isPreparingNext: boolean
  onNext: () => void
}

function SceneTwoContent({ isPreparingNext, onNext }: SceneTwoProps) {
  return (
    <>
      <div className="scene-two-content">
        <div className="scene-two-text-block">
          <p>
            この映像は<strong>あくまでイメージ</strong>だから、
            <br />
            実際の見た目や性別は分からないけど、
            <br />
            大変な状況だということが伝わったかな？
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            先ほどの警備員の<strong>意気込んだ発言</strong>も
            <br />
            何かの<strong>アピール</strong>だったのかもね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            とにかく今この<strong>会場にいる泥棒</strong>によって
            <br />
            君たちは<strong className="scene-alert-emphasis scene-fate-emphasis">死ぬ運命</strong>にある。
            <br />
            ゲームが終わったあとの解説で、
            <br />
            スタッフが変な細工をしたことに
            <br />
            気づいてしまうんだよね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            誰が泥棒なのか教えてあげたいけど、
            <br />
            天使の掟で<strong>「人の運命を直接変える」</strong>ことは
            <br />
            <strong className="scene-alert-emphasis">禁止</strong>されているんだ。
          </p>
          <p>
            ただ、安心して。
            <br />
            あくまで禁止されているのは<strong>「直接変えること」</strong>。
          </p>
          <p>
            さっき神様と交渉して、君たちが助かる方法を見つけてきたよ。
            <br />
            それは、ボクが泥棒に<strong>「改心の一撃」</strong>を放つこと！
            <br />
            そのためには、
            <br />
            <strong className="scene-two-insight scene-breakthrough-emphasis">君たちのひらめきで泥棒を突き止める</strong>
            <br />
            必要がある。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            さっきの注意事項を聞いて
            <br />
            「謎を独り占めしたら、
            <br />
            退席できて死の運命を回避できるじゃん！」
            <br />
            って思った人、いるでしょ？
            <br />
            <strong>そんな方法では無理！</strong>
            <br />
            チームメイトと仲良く協力して、
            <br />
            エレガントに死の運命を回避してね。
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            「改心の一撃」が打てるのは
            <br />
            ちょうど<strong>ゲームが終わる瞬間</strong>。
            <br />
            <strong>チャンスは1回</strong>だけだよ！
          </p>
        </div>
        <div className="scene-two-text-block">
          <p>
            <strong>この内容は一緒に渡した紙にまとめたから、</strong>
            <br />
            <strong>開いて確認してね！</strong>
          </p>
        </div>
      </div>
      <button
        className="primary-next scene-two-next"
        disabled={isPreparingNext}
        type="button"
        onClick={() => {
          if (isPreparingNext) {
            return
          }

          playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
          onNext()
        }}
      >
        <img
          className="scene-two-next-art"
          src={versionedAsset('images/tukitome.png', STATIC_IMAGE_VERSION)}
          alt=""
          aria-hidden="true"
        />
        犯人が誰か突き止める
      </button>
    </>
  )
}

type SceneThreeProps = {
  photos: PhotoSlot[]
  selectedPhoto: PhotoSlot | undefined
  selectedPhotoId: number | null
  submittedPhoto: PhotoSlot | undefined
  onBack: () => void
  onRetry: () => Promise<void>
  onSelect: (photoId: number) => void
  onSubmit: () => Promise<void>
}

function SceneThree({
  photos,
  selectedPhoto,
  selectedPhotoId,
  submittedPhoto,
  onBack,
  onRetry,
  onSelect,
  onSubmit,
}: SceneThreeProps) {
  const isSubmitted = Boolean(submittedPhoto)
  const submittedPreviewPhoto = submittedPhoto ?? selectedPhoto ?? photos[0] ?? defaultPhotos[0]

  return (
    <div className="scene-three-stack">
      <div
        className="scene-three-panel"
        data-active={!isSubmitted}
        aria-hidden={isSubmitted}
      >
        <section className="story-screen scene-three">
      <div
        className="story-background"
        style={{ backgroundImage: `url("${versionedAsset('images/hannnin.jpg', STATIC_IMAGE_VERSION)}")` }}
        aria-hidden="true"
      />
      <header className="answer-header">
        <button className="back-button answer-back" type="button" onClick={onBack}>
          <img
            className="answer-back-art"
            src={versionedAsset('images/back.webp', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          戻る
        </button>
        <h1>ホントの最終解答</h1>
      </header>

      <div className="answer-content">
        <h2>本物の強盗は：</h2>
        <div className="suspect-list">
          {photos.map((photo) => {
            const isSelected = selectedPhotoId === photo.id
            const [roleLabel, castLabel] = photo.label.split('\n')

            return (
              <button
                className="suspect-card"
                data-selected={isSelected}
                key={photo.id}
                type="button"
                onClick={() => {
                  playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
                  onSelect(photo.id)
                }}
              >
                <span className="suspect-frame">
                  <FallbackPhotoImage
                    src={photo.src}
                    fallbackSrc={getDefaultPhotoSrc(photo.id)}
                    alt={photo.label}
                    decoding="sync"
                    loading="eager"
                  />
                </span>
                <span className="selection-pointer-slot" aria-hidden="true">
                  {isSelected && (
                    <img
                      className="selection-pointer"
                      src={versionedAsset('select.png', STATIC_IMAGE_VERSION)}
                      alt=""
                    />
                  )}
                </span>
                <span className="suspect-label">
                  <span className="suspect-role-label">{roleLabel}</span>
                  {castLabel && <span className="suspect-cast-label">{castLabel}</span>}
                </span>
              </button>
            )
          })}
        </div>

        <div className="selection-area" aria-live="polite">
          {selectedPhoto ? (
            <strong>お前だ！</strong>
          ) : (
            <span className="empty-selection">選択してください</span>
          )}
        </div>

        <button
          className="submit-answer"
          type="button"
          aria-label="提出する"
          disabled={!selectedPhoto}
          onClick={() => {
            playSound(SUBMIT_SOUND, SUBMIT_SOUND_VOLUME)
            void onSubmit()
          }}
        >
          <img
            className="image-button-art"
            src={versionedAsset('images/teisyutu_botton.webp', STATIC_IMAGE_VERSION)}
            alt=""
            aria-hidden="true"
          />
          天使に提出する
        </button>
        <p className="submit-answer-note">※提出後でも選びなおすことができます</p>
      </div>
        </section>
      </div>
      <div
        className="scene-three-panel"
        data-active={isSubmitted}
        aria-hidden={!isSubmitted}
      >
        <SubmittedAnswerScreen
          key={`${submittedPreviewPhoto.id}:${submittedPreviewPhoto.src}`}
          isActive={isSubmitted}
          photo={submittedPreviewPhoto}
          onRetry={onRetry}
        />
      </div>
    </div>
  )
}

type SubmittedAnswerScreenProps = {
  isActive: boolean
  photo: PhotoSlot
  onRetry: () => Promise<void>
}

function SubmittedAnswerScreen({ isActive, photo, onRetry }: SubmittedAnswerScreenProps) {
  const [roleLabel, castLabel] = photo.label.split('\n')

  return (
    <section className="submitted-answer-screen" aria-label="提出した回答">
      <img
        className="submitted-answer-art"
        src={versionedAsset('images/goutou.jpeg', STATIC_IMAGE_VERSION)}
        alt=""
        aria-hidden="true"
      />
      <span className="submitted-file-photo-frame">
        <FallbackPhotoImage
          className="submitted-file-photo"
          src={photo.src}
          fallbackSrc={getDefaultPhotoSrc(photo.id)}
          retryKey={isActive ? 'active' : 'inactive'}
          alt={photo.label}
          decoding="sync"
          loading="eager"
        />
      </span>
      <span className="submitted-file-name">
        <span className="submitted-file-role-label">{roleLabel}</span>
        {castLabel && <span className="submitted-file-cast-label">{castLabel}</span>}
      </span>
      <button
        className="retry-answer"
        type="button"
        aria-label="選び直す"
        onClick={() => {
          playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
          void onRetry()
        }}
      >
        <img
          className="image-button-art"
          src={versionedAsset('images/erabinaosu_button.png', STATIC_IMAGE_VERSION)}
          alt=""
          aria-hidden="true"
        />
        選び直す
      </button>
    </section>
  )
}

type MasterScreenProps = {
  gameEnded: boolean
  realtimeConnected: boolean
  realtimeError: string
  teams: TeamState[]
  onBack: () => void
  onResetAnswers: () => Promise<void>
  onSendHomeCommand: () => Promise<void>
  onSetGameEnded: (gameEnded: boolean) => Promise<void>
}

function MasterScreen({
  gameEnded,
  realtimeConnected,
  realtimeError,
  teams,
  onBack,
  onResetAnswers,
  onSendHomeCommand,
  onSetGameEnded,
}: MasterScreenProps) {
  const [isHomeConfirmOpen, setIsHomeConfirmOpen] = useState(false)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  const confirmReset = async () => {
    await onResetAnswers()
    setIsResetConfirmOpen(false)
  }

  const confirmSendHome = async () => {
    await onSendHomeCommand()
    setIsHomeConfirmOpen(false)
  }
  return (
    <section className="master-screen" aria-label="MASTER">
      <button className="master-back" type="button" onClick={onBack}>
        戻る
      </button>
      <button
        className="master-reset-answers"
        type="button"
        onClick={() => setIsResetConfirmOpen(true)}
      >
        リセット機能
      </button>
      <button
        className="master-send-home"
        type="button"
        onClick={() => setIsHomeConfirmOpen(true)}
      >
        全端末ホーム
      </button>
      <div className="master-game-controls">
        <div className="master-game-buttons">
          <button
            className="master-game-end"
            data-active={gameEnded}
            type="button"
            onClick={() => void onSetGameEnded(true)}
          >
            ゲーム終了
          </button>
          <button
            className="master-game-resume"
            data-active={!gameEnded}
            type="button"
            onClick={() => void onSetGameEnded(false)}
          >
            ゲーム中
          </button>
        </div>
        <div className="master-game-current-status" data-ended={gameEnded}>
          現在：{gameEnded ? 'ゲーム終了' : 'ゲーム中'}
        </div>
      </div>
      <h1>MASTER</h1>
      <div className="master-connection" data-connected={realtimeConnected}>
        RTDB {realtimeConnected ? '接続中' : '未接続'}
      </div>
      {realtimeError && <div className="master-error">{realtimeError}</div>}
      <div className="master-url">{realtimeDatabaseUrl}</div>

      <div className="master-team-grid">
        {teams.map((team) => {
          const answer = team.answer
          const previousAnswer = answer ? undefined : team.previousAnswer
          const connectionCount = getTeamConnectionCount(team)
          const hasDuplicateConnections = connectionCount >= 2
          const answerLabel = answer ? SUSPECT_ROLE_LABELS[answer.photoId] ?? answer.label : ''
          const previousAnswerLabel = previousAnswer
            ? SUSPECT_ROLE_LABELS[previousAnswer.photoId] ?? previousAnswer.label
            : ''
          const isCorrect = answer?.photoId === 2 || answer?.label === '学芸員'

          return (
            <article className="master-team" key={team.team}>
              <div
                className="master-team-number"
                data-alive={isTeamAlive(team)}
                data-duplicate={hasDuplicateConnections}
              >
                <span>{team.team}</span>
                {hasDuplicateConnections && <small>{connectionCount}台接続済</small>}
              </div>
              <div
                className="master-team-answer"
                data-correct={isCorrect}
                data-previous={Boolean(previousAnswerLabel)}
              >
                {answerLabel}
                {previousAnswerLabel && (
                  <span className="master-team-previous-answer">
                    前回: {previousAnswerLabel}
                  </span>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {isHomeConfirmOpen && (
        <div
          className="master-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="全端末ホーム確認"
        >
          <div className="master-confirm-panel">
            <p>MASTER以外の全端末をホームに戻しますか？</p>
            <div className="master-confirm-actions">
              <button type="button" onClick={confirmSendHome}>
                はい
              </button>
              <button type="button" onClick={() => setIsHomeConfirmOpen(false)}>
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}

      {isResetConfirmOpen && (
        <div
          className="master-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="リセット確認"
        >
          <div className="master-confirm-panel">
            <p>全プレイヤーの選択した結果をリセットしますか？</p>
            <p>回答表示をリセットしますか</p>
            <div className="master-confirm-actions">
              <button type="button" onClick={confirmReset}>
                はい
              </button>
              <button type="button" onClick={() => setIsResetConfirmOpen(false)}>
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type PhotoManagerProps = {
  backupPhotosBySlot: BackupPhotosBySlot
  photos: PhotoSlot[]
  uploadStatus: string
  onBack: () => void
  onSelectBackupPhoto: (slotId: number, backupPhoto: BackupPhoto) => Promise<void>
  onSelectHistory: (slotId: number, historyItem: PhotoHistoryItem) => Promise<void>
  onToggleKeep: (slotId: number, src: string) => Promise<void>
  onUpdatePhoto: (slotId: number, file: File | null) => Promise<void>
}

function PhotoManager({
  backupPhotosBySlot,
  photos,
  uploadStatus,
  onBack,
  onSelectBackupPhoto,
  onSelectHistory,
  onToggleKeep,
  onUpdatePhoto,
}: PhotoManagerProps) {
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)
  const [activePhotoId, setActivePhotoId] = useState(() => photos[0]?.id ?? 0)
  const [selectedHistorySrcBySlot, setSelectedHistorySrcBySlot] = useState<Record<number, string>>({})
  const [selectedBackupSrcBySlot, setSelectedBackupSrcBySlot] = useState<Record<number, string>>({})
  const objectUrls = useRef<string[]>([])

  useEffect(() => {
    const createdObjectUrls = objectUrls.current

    return () => {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const openCropper = (photo: PhotoSlot, file: File | null) => {
    if (!file) {
      return
    }

    const src = URL.createObjectURL(file)
    objectUrls.current.push(src)
    setCropDraft({
      slotId: photo.id,
      label: photo.label,
      src,
    })
  }

  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? photos[0]
  const activeHistory = activePhoto?.history ?? []
  const activeRegularHistory = activeHistory.filter((historyItem) => !historyItem.isKept)
  const activeBackupPhotos = activePhoto ? backupPhotosBySlot[activePhoto.id] ?? [] : []
  const activeKeptBackupPhotos: BackupPhoto[] = activeHistory
    .filter((historyItem) => historyItem.isKept)
    .map((historyItem, index) => ({
      id: `kept-${activePhoto?.id ?? 0}-${index}-${historyItem.src}`,
      isKept: true,
      label: formatHomePhotoUpdatedAt(historyItem.updatedAt),
      src: historyItem.src,
      updatedAt: historyItem.updatedAt,
    }))
  const activeBackupChoices = [...activeKeptBackupPhotos, ...activeBackupPhotos]
  const activeCurrentBackupPhoto = activePhoto
    ? activeBackupChoices.find((backupPhoto) => backupPhoto.src === activePhoto.src)
    : undefined
  const activeCurrentHistoryItem = activePhoto
    ? activeHistory.find((historyItem) => historyItem.src === activePhoto.src)
    : null
  const activePhotoIsKept = Boolean(activeCurrentHistoryItem?.isKept)
  const selectedHistorySrc = activePhoto
    ? selectedHistorySrcBySlot[activePhoto.id] ?? activePhoto.src
    : ''
  const selectedHistoryItem =
    activeRegularHistory.find((historyItem) => historyItem.src === selectedHistorySrc) ?? null
  const canRestoreHistory =
    Boolean(activePhoto && selectedHistoryItem) && selectedHistoryItem?.src !== activePhoto?.src
  const canToggleKeep = Boolean(selectedHistoryItem)
  const selectedHistoryIsKept = Boolean(selectedHistoryItem?.isKept)
  const selectedBackupSrc = activePhoto
    ? selectedBackupSrcBySlot[activePhoto.id] ?? activeCurrentBackupPhoto?.src ?? ''
    : ''
  const selectedBackupPhoto =
    activeBackupChoices.find((backupPhoto) => backupPhoto.src === selectedBackupSrc) ?? null
  const canApplyBackup =
    Boolean(activePhoto && selectedBackupPhoto) && selectedBackupPhoto?.src !== activePhoto?.src

  return (
    <section className="photo-manager" data-scrollable="true" aria-label="写真撮影">
      <button className="back-button photo-back" type="button" onClick={onBack}>
        戻る
      </button>
      <img
        className="photo-qr"
        src={versionedAsset('QR.png', STATIC_IMAGE_VERSION)}
        alt="QRコード"
      />
      <div className="photo-manager-inner">
        <header className="photo-manager-header">
          <h1>写真撮影</h1>
          <p>人物を選んで、写真を大きく確認しながら撮影・差し替えできます。</p>
          {uploadStatus && <div className="upload-status" role="status">{uploadStatus}</div>}
        </header>

        <div className="photo-workspace">
          <nav className="photo-slot-panel" aria-label="写真を選択">
            {photos.map((photo) => {
              const isActive = activePhoto?.id === photo.id

              return (
                <button
                  className="photo-slot-card"
                  aria-pressed={isActive}
                  data-active={isActive}
                  key={photo.id}
                  type="button"
                  onClick={() => setActivePhotoId(photo.id)}
                >
                  <span className="photo-slot-number">{photo.id}</span>
                  <FallbackPhotoImage
                    src={photo.src}
                    fallbackSrc={getDefaultPhotoSrc(photo.id)}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="photo-slot-name">{photo.label}</span>
                  <span className="photo-slot-updated">{formatHomePhotoUpdatedAt(photo.updatedAt)}</span>
                </button>
              )
            })}
          </nav>

          {activePhoto && (
            <main className="photo-main-panel">
              <section className="photo-preview-panel" aria-label="現在の写真">
                <div className="photo-preview-heading">
                  <span>現在の写真</span>
                  <h2>{activePhoto.id}. {activePhoto.label}</h2>
                  <p className="photo-updated-at">{formatPhotoUpdatedAt(activePhoto.updatedAt)}</p>
                  {activePhotoIsKept && <strong className="photo-preview-kept-badge">保管中</strong>}
                </div>
                <div className="photo-preview-frame">
                  <FallbackPhotoImage
                    src={activePhoto.src}
                    fallbackSrc={getDefaultPhotoSrc(activePhoto.id)}
                    alt={`${activePhoto.label}の現在の写真`}
                  />
                </div>
              </section>

              <section className="photo-action-panel" aria-label="写真操作">
                <label className="photo-capture-button">
                  撮影・撮り直し
                  <input
                    accept="image/*"
                    capture="environment"
                    type="file"
                    onChange={(event) => {
                      openCropper(activePhoto, event.target.files?.[0] ?? null)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <div className="photo-current-meta">
                  <span>選択中</span>
                  <strong>{activePhoto.label}</strong>
                </div>
              </section>

              <section className="photo-history-panel" aria-label="過去の写真">
                <div className="photo-history-heading">
                  <h3>過去の写真</h3>
                  <span>{activeRegularHistory.length}枚</span>
                </div>
                {activeRegularHistory.length > 0 ? (
                  <>
                    <div className="photo-history-actions">
                    <button
                      className="photo-restore-button"
                      disabled={!canRestoreHistory}
                      type="button"
                      onClick={() => {
                        if (!selectedHistoryItem) {
                          return
                        }

                        void onSelectHistory(activePhoto.id, selectedHistoryItem)
                      }}
                    >
                      この写真に戻す
                    </button>
                      <button
                        className="photo-keep-button"
                        data-kept={selectedHistoryIsKept}
                        disabled={!canToggleKeep}
                        type="button"
                        onClick={() => {
                          if (!selectedHistoryItem) {
                            return
                          }

                          void onToggleKeep(activePhoto.id, selectedHistoryItem.src).then(() => {
                            setSelectedHistorySrcBySlot((currentSelections) => {
                              const nextSelections = { ...currentSelections }
                              delete nextSelections[activePhoto.id]

                              return nextSelections
                            })
                            setSelectedBackupSrcBySlot((currentSelections) => ({
                              ...currentSelections,
                              [activePhoto.id]: selectedHistoryItem.src,
                            }))
                          })
                        }}
                      >
                        {selectedHistoryIsKept ? '保管を解除' : 'この写真を保管'}
                      </button>
                    </div>
                    <div className="photo-history-options">
                      {activeRegularHistory.map((historyItem) => {
                        const isCurrent = historyItem.src === activePhoto.src
                        const isSelected = historyItem.src === selectedHistorySrc

                        return (
                          <button
                            className="photo-history-option"
                            aria-pressed={isSelected}
                            data-current={isCurrent}
                            data-selected={isSelected}
                            key={historyItem.src}
                            type="button"
                            onClick={() =>
                              setSelectedHistorySrcBySlot((currentSelections) => ({
                                ...currentSelections,
                                [activePhoto.id]: historyItem.src,
                              }))
                            }
                          >
                            <FallbackPhotoImage
                              src={historyItem.src}
                              fallbackSrc={getDefaultPhotoSrc(activePhoto.id)}
                              alt=""
                              aria-hidden="true"
                            />
                            <span>{isCurrent ? '現在の写真' : formatHomePhotoUpdatedAt(historyItem.updatedAt)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p className="photo-history-empty">過去の写真はまだありません。</p>
                )}
              </section>

              <section className="photo-backup-panel" aria-label="予備写真">
                <div className="photo-backup-heading">
                  <h3>予備写真</h3>
                  <span>{activeBackupChoices.length}枚</span>
                </div>
                {activeBackupChoices.length > 0 ? (
                  <>
                    <div className="photo-backup-actions">
                    <button
                      className="photo-restore-button photo-backup-apply"
                      disabled={!canApplyBackup}
                      type="button"
                      onClick={() => {
                        if (!selectedBackupPhoto) {
                          return
                        }

                        if (selectedBackupPhoto.isKept) {
                          void onSelectHistory(activePhoto.id, selectedBackupPhoto)
                          return
                        }

                        void onSelectBackupPhoto(activePhoto.id, selectedBackupPhoto)
                      }}
                    >
                      この予備写真を使う
                    </button>
                      <button
                        className="photo-keep-button photo-kept-release-button"
                        aria-hidden={!selectedBackupPhoto?.isKept}
                        data-visible={selectedBackupPhoto?.isKept}
                        disabled={!selectedBackupPhoto?.isKept}
                        type="button"
                        onClick={() => {
                          if (!selectedBackupPhoto?.isKept) {
                            return
                          }

                          void onToggleKeep(activePhoto.id, selectedBackupPhoto.src).then(() => {
                            setSelectedBackupSrcBySlot((currentSelections) => {
                              const nextSelections = { ...currentSelections }
                              delete nextSelections[activePhoto.id]

                              return nextSelections
                            })
                          })
                        }}
                      >
                        保管を解除
                      </button>
                    </div>
                    <div className="photo-backup-options">
                      {activeBackupChoices.map((backupPhoto) => {
                        const isCurrent = backupPhoto.src === activePhoto.src
                        const isSelected = backupPhoto.src === selectedBackupSrc

                        return (
                          <button
                            className="photo-backup-option"
                            aria-pressed={isSelected}
                            data-current={isCurrent}
                            data-kept={backupPhoto.isKept}
                            data-selected={isSelected}
                            key={backupPhoto.id}
                            type="button"
                            onClick={() => {
                              playSound(CLICK_SOUND, CLICK_SOUND_VOLUME)
                              setSelectedBackupSrcBySlot((currentSelections) => ({
                                ...currentSelections,
                                [activePhoto.id]: backupPhoto.src,
                              }))
                            }}
                          >
                            <FallbackPhotoImage
                              src={backupPhoto.src}
                              fallbackSrc={getDefaultPhotoSrc(activePhoto.id)}
                              alt=""
                              aria-hidden="true"
                            />
                            <span>{backupPhoto.label}</span>
                            <strong>{backupPhoto.isKept ? '保管中' : isCurrent ? '使用中' : '選択する'}</strong>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p className="photo-history-empty">予備写真は設定されていません。</p>
                )}
              </section>
            </main>
          )}
        </div>
      </div>
      {cropDraft &&
        createPortal(
          <PhotoCropDialog
            draft={cropDraft}
            onCancel={() => setCropDraft(null)}
            onUpdate={async (file) => {
              await onUpdatePhoto(cropDraft.slotId, file)
              setSelectedHistorySrcBySlot((currentSelections) => {
                const nextSelections = { ...currentSelections }
                delete nextSelections[cropDraft.slotId]

                return nextSelections
              })
              setSelectedBackupSrcBySlot((currentSelections) => {
                const nextSelections = { ...currentSelections }
                delete nextSelections[cropDraft.slotId]

                return nextSelections
              })
              setCropDraft(null)
            }}
          />,
          document.body,
        )}
    </section>
  )
}

type PhotoCropDialogProps = {
  draft: CropDraft
  onCancel: () => void
  onUpdate: (file: File) => Promise<void>
}

function PhotoCropDialog({ draft, onCancel, onUpdate }: PhotoCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  const updatePhoto = async () => {
    if (!croppedAreaPixels) {
      return
    }

    setIsUpdating(true)

    try {
      const file = await createCroppedPhotoFile(draft.src, croppedAreaPixels, draft.slotId)
      await onUpdate(file)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div
      className="crop-dialog"
      data-scrollable="true"
      role="dialog"
      aria-modal="true"
      aria-label="写真の切り取り"
    >
      <div className="crop-panel">
        <header className="crop-header">
          <h2>{draft.slotId}. {draft.label}</h2>
          <button className="crop-cancel" type="button" onClick={onCancel}>
            キャンセル
          </button>
        </header>

        <div className="crop-area">
          <Cropper
            image={draft.src}
            crop={crop}
            zoom={zoom}
            aspect={PHOTO_ASPECT_RATIO}
            objectFit="contain"
            onCropChange={setCrop}
            onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
            onZoomChange={setZoom}
          />
        </div>

        <div className="crop-controls">
          <label>
            拡大
            <input
              max="3"
              min="1"
              step="0.01"
              type="range"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <button
            className="crop-update"
            type="button"
            disabled={isUpdating}
            onClick={() => void updatePhoto()}
          >
            {isUpdating ? '更新中...' : '更新する'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
