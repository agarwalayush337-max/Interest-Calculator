// File: sw.js
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Check if this is a share request.
  if (event.request.method === 'POST' && url.pathname.endsWith('index.html')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const imageFile = formData.get('image');

        if (imageFile) {
          // Find the app's client window to send the file to.
          const clients = await self.clients.matchAll({ type: 'window' });
          if (clients.length > 0) {
            // Send the file to the first available client (your open app).
            clients[0].postMessage({ file: imageFile, action: 'scan-image' });
          }
        }
      } catch (e) {
        console.error('Service Worker failed to handle share:', e);
      }
      
      // After processing, redirect back to the main page.
      return Response.redirect('index.html', 303);
    })());
  }
});
