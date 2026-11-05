/* ═══════════════════════════════════════════════════════════
   MoonVault FC - Push & In-Web Notifications Client
   - Phone Notification Bar (Push API + Service Worker)
   - In-Web Floating Toast with Melodic Audio Chime
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // Helper: Convert VAPID base64 string to Uint8Array for PushManager
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // Helper: Get CSRF token
    function getCsrfToken() {
        const match = document.cookie.match(/csrftoken=([^;]+)/);
        return match ? match[1] : '';
    }

    // ─── Synthesized Web Audio Chime (Zero External Files) ────
    function playNotificationChime() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            // Two-tone bell melody (587.33Hz D5 -> 880Hz A5)
            osc.frequency.setValueAtTime(587.33, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.25, now + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.46);
        } catch (e) {
            // Audio context restricted until user interacts, safely ignored
        }
    }

    // ─── Floating In-Web Toast Notification ───────────────────
    window.showWebToast = function (options) {
        const title = options.title || 'MoonVault FC';
        const body = options.body || '';
        const url = options.url || '#';
        const image = options.image || null;

        if (options.sound !== false) {
            playNotificationChime();
        }

        let container = document.getElementById('mv-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'mv-toast-container';
            container.className = 'mv-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'mv-toast-card';
        toast.innerHTML = `
            <div class="mv-toast-icon">
                <i data-lucide="bell"></i>
            </div>
            <div class="mv-toast-body" onclick="window.location.href='${url}'">
                <div class="mv-toast-title">${title}</div>
                <div class="mv-toast-desc">${body}</div>
            </div>
            ${image ? `<img src="${image}" class="mv-toast-thumb" alt="Preview">` : ''}
            <button class="mv-toast-close" title="Dismiss" aria-label="Dismiss">&times;</button>
        `;

        const closeBtn = toast.querySelector('.mv-toast-close');
        closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            removeToast(toast);
        });

        container.appendChild(toast);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Slide in
        setTimeout(() => toast.classList.add('mv-toast-visible'), 20);

        // Auto dismiss after 6 seconds
        const timeout = setTimeout(() => removeToast(toast), 6000);

        function removeToast(el) {
            clearTimeout(timeout);
            el.classList.remove('mv-toast-visible');
            el.classList.add('mv-toast-hiding');
            setTimeout(() => {
                if (el.parentElement) el.remove();
            }, 300);
        }
    };

    // ─── Push Subscription Manager ────────────────────────────
    window.MoonVaultPush = {
        swRegistration: null,

        init: function (vapidPublicKey) {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                return;
            }

            navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .then(function (reg) {
                    window.MoonVaultPush.swRegistration = reg;
                    window.MoonVaultPush.checkSubscription(vapidPublicKey);
                })
                .catch(function (err) {
                    console.debug('Service Worker registration skipped:', err);
                });
        },

        checkSubscription: function (vapidPublicKey) {
            if (!this.swRegistration) return;

            this.swRegistration.pushManager.getSubscription().then(function (sub) {
                if (sub) {
                    // Already subscribed, ensure server is updated
                    window.MoonVaultPush.saveSubscriptionToServer(sub);
                    window.MoonVaultPush.updateNotificationIcon(true);
                } else {
                    window.MoonVaultPush.updateNotificationIcon(false);
                    // If permission is not denied and user hasn't dismissed before, show prompt
                    if (Notification.permission === 'default' && !sessionStorage.getItem('mv_push_prompt_dismissed')) {
                        setTimeout(() => window.MoonVaultPush.showPermissionBanner(vapidPublicKey), 2500);
                    }
                }
            });
        },

        subscribe: function (vapidPublicKey) {
            if (!this.swRegistration || !vapidPublicKey) return Promise.reject('Missing registration or key');

            return Notification.requestPermission().then(function (permission) {
                if (permission !== 'granted') {
                    throw new Error('Notification permission denied');
                }

                const subscribeOptions = {
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
                };

                return window.MoonVaultPush.swRegistration.pushManager.subscribe(subscribeOptions);
            }).then(function (newSub) {
                window.MoonVaultPush.saveSubscriptionToServer(newSub);
                window.MoonVaultPush.updateNotificationIcon(true);
                window.showWebToast({
                    title: '🔔 Notifications Enabled',
                    body: 'You will now receive match announcements and chat alerts on your device.',
                    sound: true
                });
                return newSub;
            });
        },

        saveSubscriptionToServer: function (subscription) {
            fetch('/api/save-subscription/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ subscription: subscription.toJSON() })
            }).catch(() => {});
        },

        showPermissionBanner: function (vapidPublicKey) {
            if (document.getElementById('mv-push-banner')) return;

            const banner = document.createElement('div');
            banner.id = 'mv-push-banner';
            banner.className = 'mv-push-banner';
            banner.innerHTML = `
                <div class="mv-push-banner-content">
                    <div class="mv-push-banner-icon">
                        <i data-lucide="bell-ring"></i>
                    </div>
                    <div class="mv-push-banner-text">
                        <strong>Turn on Phone Notifications</strong>
                        <span>Receive instant announcements and direct chat alerts on your device.</span>
                    </div>
                    <div class="mv-push-banner-actions">
                        <button type="button" class="btn btn-sm btn-primary" id="mv-enable-push-btn">
                            <i data-lucide="bell"></i> Turn On
                        </button>
                        <button type="button" class="btn btn-sm btn-ghost" id="mv-dismiss-push-btn">
                            Later
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(banner);
            if (typeof lucide !== 'undefined') lucide.createIcons();

            setTimeout(() => banner.classList.add('mv-push-banner-visible'), 30);

            document.getElementById('mv-enable-push-btn').addEventListener('click', function () {
                banner.remove();
                window.MoonVaultPush.subscribe(vapidPublicKey);
            });

            document.getElementById('mv-dismiss-push-btn').addEventListener('click', function () {
                banner.remove();
                sessionStorage.setItem('mv_push_prompt_dismissed', 'true');
            });
        },

        updateNotificationIcon: function (isEnabled) {
            const bell = document.getElementById('topbar-notification-toggle');
            if (!bell) return;
            bell.classList.toggle('notifications-active', isEnabled);
            bell.setAttribute('title', isEnabled ? 'Notifications are active on this device' : 'Click to enable device notifications');
        }
    };

    // Auto-initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function () {
        const vapidKey = document.body.dataset.vapidKey;
        if (vapidKey) {
            window.MoonVaultPush.init(vapidKey);
        }

        const bellToggle = document.getElementById('topbar-notification-toggle');
        if (bellToggle) {
            bellToggle.addEventListener('click', function () {
                const key = document.body.dataset.vapidKey;
                if (!key) return;
                window.MoonVaultPush.subscribe(key).catch(err => {
                    alert('Please allow notification permissions in your browser address bar settings.');
                });
            });
        }
    });
})();

