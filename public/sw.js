const CACHE_NAME = 'continue-tablet-v1'
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
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

  const url = new URL(event.request.url)
  const isStaticAsset =
    url.origin === self.location.origin &&
    ['script', 'style', 'font', 'image', 'video', 'manifest'].includes(
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
