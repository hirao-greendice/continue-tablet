const CACHE_NAME = 'continue-tablet-v3'
const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './app-icon.svg',
  './favicon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
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

  if (response.ok) {
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
          caches.open(CACHE_NAME).then((cache) => cache.put('./', copy))
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
  const isRemoteImage = event.request.destination === 'image'

  if (!isStaticAsset && !isRemoteImage) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchAndCache = fetch(event.request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }

        return response
      })

      return cachedResponse || fetchAndCache
    }),
  )
})
