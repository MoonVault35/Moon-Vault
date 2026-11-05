/* ═══════════════════════════════════════════════════════════
   MoonVault FC - Service Worker for Web Push Notifications
   Handles background notifications in Mobile Notification Bar & Desktop
   ═══════════════════════════════════════════════════════════ */

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

// ─── Listen for Push Notifications ─────────────────────────
self.addEventListener('push', function (event) {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: 'MoonVault FC', body: event.data.text() };
        }
    }

    const title = data.title || 'MoonVault FC';
    const options = {
        body: data.body || 'You have a new update from MoonVault FC.',
        icon: data.icon || '/static/core/images/logo-192.png',
        badge: data.badge || '/static/core/images/badge-72.png',
        image: data.image || null,
        data: {
            url: data.url || '/'
        },
        tag: data.tag || 'moonvault-notification',
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// ─── Handle Notification Click / Tap ───────────────────────
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
            // Check if there is already an open window/tab with MoonVault
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client && client.url !== targetUrl) {
                        return client.navigate(targetUrl);
                    }
                    return client;
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

