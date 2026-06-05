const CACHE_NAME = 'continue-tablet-v32'
const STATIC_IMAGE_VERSION = 'images-20260605-3'
const BACKUP_PHOTO_VERSION = 'backup-photos-20260604-1'

function versionedAsset(path) {
  return `${path}?v=${STATIC_IMAGE_VERSION}`
}

function versionedBackupPhotoAsset(path) {
  return `${path}?v=${BACKUP_PHOTO_VERSION}`
}

const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './app-icon.svg',
  './favicon.svg',
]

const WARM_ASSET_CACHE = [
  versionedAsset('./QR.png'),
  versionedAsset('./select.png'),
  versionedAsset('./images/back.webp'),
  versionedAsset('./images/dayo.webp'),
  versionedAsset('./images/erabinaosu_button.png'),
  versionedAsset('./images/goutou.jpeg'),
  versionedAsset('./images/hannnin.jpg'),
  versionedAsset('./images/konohito.png'),
  versionedAsset('./images/0.webp'),
  versionedAsset('./images/0-1.webp'),
  versionedAsset('./images/1.0x.webp'),
  versionedAsset('./images/1.5x.webp'),
  versionedAsset('./images/5maebutton.webp'),
  versionedAsset('./images/5nextbutton.webp'),
  versionedAsset('./images/play.png'),
  versionedAsset('./images/playbutton.webp'),
  versionedAsset('./images/stopbutton.webp'),
  versionedAsset('./images/teisyutu_botton.webp'),
  versionedAsset('./images/tenkei.png'),
  versionedAsset('./images/tukitome.png'),
  versionedBackupPhotoAsset('./images/backup-photos/slot-1-1.png'),
  versionedBackupPhotoAsset('./images/backup-photos/slot-2-1.png'),
  versionedBackupPhotoAsset('./images/backup-photos/slot-3-1.png'),
  versionedBackupPhotoAsset('./images/backup-photos/slot-4-1.png'),
  './sounds/click.mp3',
  './sounds/omaeda.mp3',
]

async function warmAssetCache() {
  const cache = await caches.open(CACHE_NAME)

  await Promise.allSettled(
    WARM_ASSET_CACHE.map(async (asset) => {
      const request = new Request(asset)
      const response = await fetch(request)

      if (response.status === 200) {
        await cache.put(request, response)
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL.map(async (asset) => {
          const request = new Request(asset)
          const response = await fetch(request)

          if (response.status === 200) {
            await cache.put(request, response)
          }
        }),
      ),
    ),
  )
  warmAssetCache().catch(() => undefined)
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function isVersionedVideo(url) {
  return url.pathname.endsWith('/videos/scene-1.mp4') && url.searchParams.has('v')
}

function getContentType(response) {
  return response.headers.get('content-type') || 'video/mp4'
}

function parseRange(rangeHeader, size) {
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '')

  if (!match) {
    return null
  }

  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : size - 1

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return null
  }

  return { start, end }
}

async function getCachedVideoResponse(url) {
  const cache = await caches.open(CACHE_NAME)
  const cacheRequest = new Request(url.href)
  const cachedResponse = await cache.match(cacheRequest)

  if (cachedResponse) {
    return cachedResponse
  }

  const response = await fetch(cacheRequest)

  if (response.status === 200) {
    await cache.put(cacheRequest, response.clone())
    const cachedRequests = await cache.keys()

    await Promise.all(
      cachedRequests.map((request) => {
        const cachedUrl = new URL(request.url)
        const isOldVideo =
          cachedUrl.pathname === url.pathname &&
          cachedUrl.searchParams.has('v') &&
          cachedUrl.href !== url.href

        return isOldVideo ? cache.delete(request) : undefined
      }),
    )
  }

  return response
}

async function deleteOldVersionedCacheEntries(cache, currentRequest) {
  const currentUrl = new URL(currentRequest.url)

  if (!currentUrl.searchParams.has('v')) {
    return
  }

  const cachedRequests = await cache.keys()

  await Promise.all(
    cachedRequests.map((request) => {
      const cachedUrl = new URL(request.url)
      const isSameVersionedAsset =
        cachedUrl.origin === currentUrl.origin &&
        cachedUrl.pathname === currentUrl.pathname &&
        cachedUrl.searchParams.has('v') &&
        cachedUrl.href !== currentUrl.href

      return isSameVersionedAsset ? cache.delete(request) : undefined
    }),
  )
}

async function createVideoRangeResponse(request, url) {
  const fullResponse = await getCachedVideoResponse(url)

  if (!fullResponse.ok) {
    return fullResponse
  }

  const buffer = await fullResponse.arrayBuffer()
  const range = parseRange(request.headers.get('range'), buffer.byteLength)

  if (!range) {
    return new Response(buffer, {
      status: 200,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(buffer.byteLength),
        'content-type': getContentType(fullResponse),
      },
    })
  }

  const chunk = buffer.slice(range.start, range.end + 1)

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(chunk.byteLength),
      'content-range': `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
      'content-type': getContentType(fullResponse),
    },
  })
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)

  if (isVersionedVideo(url)) {
    event.respondWith(
      event.request.headers.has('range')
        ? createVideoRangeResponse(event.request, url)
        : getCachedVideoResponse(url),
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          if (response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put('./', copy))
          }
          return response
        })
        .catch(() => caches.match('./')),
    )
    return
  }

  const isStaticAsset =
    url.origin === self.location.origin &&
    ['script', 'style', 'font', 'image', 'manifest'].includes(
      event.request.destination,
    )
  const isStaticAudio =
    url.origin === self.location.origin &&
    event.request.destination === 'audio'

  if (!isStaticAsset && !isStaticAudio) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then((response) => {
        if (response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(async (cache) => {
            await cache.put(event.request, copy)
            await deleteOldVersionedCacheEntries(cache, event.request)
          })
        }

        return response
      })
    }),
  )
})
