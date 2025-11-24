// Define a name for the cache and the files that make up the app shell
const CACHE_NAME = 'interest-calculator-cache-v7';
const APP_SHELL_URLS = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icon-192x192.png',
  'icon-512x512.png'
];

// The 'install' event runs when the service worker is first installed.
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    console.log('Service Worker: Caching app shell');
    await cache.addAll(APP_SHELL_URLS);
  })());
});

// The 'activate' event runs when the service worker is activated.
// It's used to clean up old, unused caches.
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => {
        if (cacheName !== CACHE_NAME) {
          console.log('Service Worker: Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
  })());
});

// The 'fetch' event intercepts all network requests.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- 1. Handle the Share Target POST request ---
  if (event.request.method === 'POST' && url.pathname.endsWith('index.html')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const imageFile = formData.get('image');

        if (imageFile) {
          const clients = await self.clients.matchAll({ type: 'window' });
          if (clients.length > 0) {
            clients[0].postMessage({ file: imageFile, action: 'scan-image' });
          }
        }
      } catch (e) {
        console.error('Service Worker failed to handle share:', e);
      }
      return Response.redirect('index.html', 303);
    })());
    return; // Important to exit here
  }

  // --- 2. Handle all other GET requests with a "Cache First" strategy ---
  event.respondWith((async () => {
    // Try to find the response in the cache.
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      // If it's in the cache, return it immediately.
      return cachedResponse;
    }
    // If it's not in the cache, fetch it from the network.
    return fetch(event.request);
  })());
});
