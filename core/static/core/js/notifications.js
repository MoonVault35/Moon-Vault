/* ═══════════════════════════════════════════════════════════
   MoonVault FC - Push & In-Web Notifications Client
   - Phone Notification Bar (Push API + Service Worker)
   - In-Web Floating Toast with Melodic Audio Chimes
   - Interactive Notification Tray / Dropdown Center
   - PWA Home Screen App Badging
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

    // Helper: Escape HTML string
    function escapeHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ─── PWA App Icon Badging API ────────────────────────────
    window.updateAppBadge = function (count) {
        if ('setAppBadge' in navigator) {
            if (typeof count === 'number' && count > 0) {
                navigator.setAppBadge(count).catch(() => {});
            } else {
                navigator.clearAppBadge().catch(() => {});
            }
        }
    };

    // ─── Synthesized Web Audio Chimes (Match vs Chat) ────────
    function playNotificationChime(type) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const now = ctx.currentTime;

            if (type === 'announcement' || type === 'match') {
                // Upbeat 3-tone stadium fanfare (C5 -> E5 -> G5)
                const notes = [523.25, 659.25, 783.99];
                notes.forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const startTime = now + idx * 0.09;
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, startTime);
                    gain.gain.setValueAtTime(0.001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + 0.2);
                });
            } else {
                // Sleek soft glass 2-tone melodic blip (A5 -> C6)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.1);
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.4);
            }
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
        const type = options.type || 'chat';

        if (options.sound !== false) {
            playNotificationChime(type);
        }

        let container = document.getElementById('mv-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'mv-toast-container';
            container.className = 'mv-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'mv-toast-card ' + (type === 'announcement' ? 'mv-toast-announcement' : 'mv-toast-chat');
        toast.innerHTML = `
            <div class="mv-toast-icon">
                <i data-lucide="${type === 'announcement' ? 'megaphone' : 'message-circle'}"></i>
            </div>
            <div class="mv-toast-body" onclick="window.location.href='${url}'">
                <div class="mv-toast-title">${escapeHtml(title)}</div>
                <div class="mv-toast-desc">${escapeHtml(body)}</div>
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
        isSubscribed: false,

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
                    window.MoonVaultPush.isSubscribed = true;
                    window.MoonVaultPush.saveSubscriptionToServer(sub);
                    window.MoonVaultPush.updateNotificationIcon(true);
                } else {
                    window.MoonVaultPush.isSubscribed = false;
                    window.MoonVaultPush.updateNotificationIcon(false);
                    // If permission is not denied and user hasn't dismissed before, show banner
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
                window.MoonVaultPush.isSubscribed = true;
                window.MoonVaultPush.saveSubscriptionToServer(newSub);
                window.MoonVaultPush.updateNotificationIcon(true);
                window.showWebToast({
                    title: '🔔 Notifications Active',
                    body: 'You will receive match announcements and chat alerts on this device.',
                    type: 'announcement',
                    sound: true
                });
                return newSub;
            });
        },

        unsubscribe: function () {
            if (!this.swRegistration) return Promise.resolve();

            return this.swRegistration.pushManager.getSubscription().then(function (sub) {
                if (sub) {
                    const endpoint = sub.endpoint;
                    return sub.unsubscribe().then(function () {
                        window.MoonVaultPush.isSubscribed = false;
                        window.MoonVaultPush.updateNotificationIcon(false);
                        fetch('/api/unsubscribe-push/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': getCsrfToken()
                            },
                            body: JSON.stringify({ endpoint: endpoint })
                        }).catch(() => {});
                    });
                }
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
            if (bell) {
                bell.classList.toggle('notifications-active', isEnabled);
                bell.setAttribute('title', isEnabled ? 'Notifications are active on this device' : 'Click to view notifications');
            }
            const toggleDot = document.getElementById('notif-toggle-dot');
            const toggleText = document.getElementById('notif-toggle-text');
            if (toggleDot && toggleText) {
                toggleDot.classList.toggle('active', isEnabled);
                toggleText.textContent = isEnabled ? 'Phone Alerts: On' : 'Phone Alerts: Off';
            }
        }
    };

    // ─── Dropdown Tray Loader ─────────────────────────────────
    function loadRecentNotifications() {
        const bodyEl = document.getElementById('notif-dropdown-body');
        if (!bodyEl) return;

        bodyEl.innerHTML = `
            <div class="notif-loading">
                <div class="spinner-sm"></div>
                <span>Checking updates...</span>
            </div>
        `;

        fetch('/api/recent-notifications/')
            .then(r => r.json())
            .then(data => {
                if (!data.success) {
                    bodyEl.innerHTML = '<div class="notif-error">Unable to load notifications</div>';
                    return;
                }

                const announcements = data.announcements || [];
                const chats = data.unread_messages || [];
                const totalUnread = data.unread_total || 0;

                // Update app badge on home screen
                window.updateAppBadge(totalUnread);

                // Update bell dot
                const bellDot = document.getElementById('bell-dot');
                if (bellDot) {
                    bellDot.style.display = (totalUnread > 0 || announcements.length > 0) ? 'block' : 'none';
                }

                if (announcements.length === 0 && chats.length === 0) {
                    bodyEl.innerHTML = `
                        <div class="notif-empty">
                            <div class="notif-empty-icon"><i data-lucide="check-circle-2"></i></div>
                            <strong>All Caught Up!</strong>
                            <p>No new announcements or unread messages.</p>
                        </div>
                    `;
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                    return;
                }

                let html = '';

                // Unread Chats Section
                if (chats.length > 0) {
                    html += '<div class="notif-section-title">New Messages</div>';
                    chats.forEach(c => {
                        html += `
                            <a href="/chat/?player=${c.sender_id || ''}" class="notif-item notif-item-chat">
                                <div class="notif-item-icon chat-icon-bg">
                                    <i data-lucide="message-circle"></i>
                                </div>
                                <div class="notif-item-content">
                                    <div class="notif-item-top">
                                        <span class="notif-item-author">${escapeHtml(c.sender_name)}</span>
                                        <span class="notif-item-time">${escapeHtml(c.time)}</span>
                                    </div>
                                    <div class="notif-item-snippet">${escapeHtml(c.message)}</div>
                                </div>
                            </a>
                        `;
                    });
                }

                // Recent Announcements Section
                if (announcements.length > 0) {
                    html += '<div class="notif-section-title">Latest Announcements</div>';
                    announcements.forEach(a => {
                        html += `
                            <a href="/announcements/" class="notif-item notif-item-announcement">
                                <div class="notif-item-icon announcement-icon-bg">
                                    <i data-lucide="megaphone"></i>
                                </div>
                                <div class="notif-item-content">
                                    <div class="notif-item-top">
                                        <span class="notif-item-author">${escapeHtml(a.title)}</span>
                                        <span class="notif-item-time">${escapeHtml(a.time)}</span>
                                    </div>
                                    <div class="notif-item-snippet">${escapeHtml(a.content)}</div>
                                </div>
                                ${a.image ? `<img src="/media/${a.image}" class="notif-item-thumb" alt="Photo">` : ''}
                            </a>
                        `;
                    });
                }

                bodyEl.innerHTML = html;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            })
            .catch(() => {
                bodyEl.innerHTML = '<div class="notif-error">Failed to load updates. Try again later.</div>';
            });
    }

    // ─── Initialize ───────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const vapidKey = document.body.dataset.vapidKey;
        if (vapidKey) {
            window.MoonVaultPush.init(vapidKey);
        }

        const bellToggle = document.getElementById('topbar-notification-toggle');
        const dropdown = document.getElementById('notification-dropdown');
        const notifWrap = document.getElementById('topbar-notif-wrap');
        const pushToggleBtn = document.getElementById('notif-push-toggle-btn');

        if (bellToggle && dropdown) {
            // Toggle dropdown open / close
            bellToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                const isOpen = dropdown.style.display !== 'none';
                if (isOpen) {
                    dropdown.style.display = 'none';
                    bellToggle.setAttribute('aria-expanded', 'false');
                } else {
                    dropdown.style.display = 'block';
                    bellToggle.setAttribute('aria-expanded', 'true');
                    loadRecentNotifications();
                }
            });

            // Close when clicking outside
            document.addEventListener('click', function (e) {
                if (notifWrap && !notifWrap.contains(e.target)) {
                    dropdown.style.display = 'none';
                    bellToggle.setAttribute('aria-expanded', 'false');
                }
            });

            // Toggle Phone Alerts inside the dropdown
            if (pushToggleBtn) {
                pushToggleBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const key = document.body.dataset.vapidKey;
                    if (!key) return;

                    if (window.MoonVaultPush.isSubscribed) {
                        window.MoonVaultPush.unsubscribe().then(() => {
                            window.showWebToast({
                                title: '🔕 Phone Alerts Disabled',
                                body: 'You will no longer receive lock screen notifications on this device.',
                                sound: false
                            });
                        });
                    } else {
                        window.MoonVaultPush.subscribe(key).catch(() => {
                            alert('Please allow notification permissions in your browser address bar settings.');
                        });
                    }
                });
            }
        }
    });
})();
