/* ═══════════════════════════════════════════════════════════
   MoonVault FC - Professional Real-Time Chat System
   Supports: Real-time WebSockets, Image Attachments,
   Clipboard Paste (Ctrl+V), Drag & Drop, Lightbox Viewer,
   Optimistic UI, Read Receipts & Auto-scroll
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const receiverIdInput = document.getElementById('receiver-id');
    const chatMessages = document.getElementById('chat-messages');
    const chatImageInput = document.getElementById('chat-image-input');
    const chatAttachLabel = document.getElementById('chat-attach-label');
    const stagingTray = document.getElementById('attachment-staging');
    const stagingThumb = document.getElementById('staging-thumb');
    const stagingFilename = document.getElementById('staging-filename');
    const stagingRemoveBtn = document.getElementById('staging-remove-btn');
    const chatSendBtn = document.getElementById('chat-send-btn');

    if (!chatForm || !receiverIdInput) return;

    const receiverId = receiverIdInput.value;
    if (!receiverId) return;

    let stagedFile = null;
    let ws = null;
    let wsConnected = false;
    let isSubmitting = false;

    // ─── CSRF Token ──────────────────────────────────────────
    function getCsrfToken() {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith('csrftoken=')) {
                return cookie.substring('csrftoken='.length);
            }
        }
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input) return input.value;
        return '';
    }

    // ─── Scroll to Bottom ────────────────────────────────────
    function scrollToBottom(smooth = false) {
        if (!chatMessages) return;
        if (smooth) {
            chatMessages.scrollTo({
                top: chatMessages.scrollHeight,
                behavior: 'smooth'
            });
        } else {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // ─── Escape HTML ─────────────────────────────────────────
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── Format Time ─────────────────────────────────────────
    function formatTimeNow() {
        const now = new Date();
        return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // ─── Media URL Helper ────────────────────────────────────
    function getMediaUrl(url) {
        if (!url) return '';
        const trimmed = String(url).trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('blob:') || trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
        }
        if (trimmed.startsWith('/media/')) {
            return trimmed;
        }
        if (trimmed.startsWith('/')) {
            return trimmed;
        }
        return '/media/' + trimmed;
    }

    // ─── Lightbox Viewer ─────────────────────────────────────
    window.openLightbox = function (imgSrc) {
        const cleanUrl = getMediaUrl(imgSrc);
        const lightbox = document.getElementById('chat-lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        const lightboxDownload = document.getElementById('lightbox-download');
        if (!lightbox || !lightboxImg || !cleanUrl) return;

        lightboxImg.src = cleanUrl;
        if (lightboxDownload) {
            lightboxDownload.href = cleanUrl;
        }
        lightbox.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.closeLightbox = function () {
        const lightbox = document.getElementById('chat-lightbox');
        if (lightbox) {
            lightbox.style.display = 'none';
        }
    };

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            window.closeLightbox();
        }
    });

    // Delegated click handler to open image in full lightbox without inline script attributes
    document.addEventListener('click', function (e) {
        const wrap = e.target.closest('.chat-bubble-image-wrap');
        if (wrap) {
            const img = wrap.querySelector('.chat-bubble-img');
            if (img && img.src) {
                window.openLightbox(img.src);
            }
        }
    });

    // ─── Attachment Staging Handler ──────────────────────────
    function stageImage(file) {
        if (!file || !file.type.startsWith('image/')) return;

        stagedFile = file;
        const reader = new FileReader();
        reader.onload = function (e) {
            if (stagingThumb) stagingThumb.src = e.target.result;
            if (stagingFilename) {
                const sizeKb = (file.size / 1024).toFixed(1);
                stagingFilename.textContent = file.name + ' (' + sizeKb + ' KB)';
            }
            if (stagingTray) stagingTray.style.display = 'flex';
            updateSendButtonState();
            if (messageInput) messageInput.focus();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        };
        reader.readAsDataURL(file);
    }

    function clearStagedImage() {
        stagedFile = null;
        if (chatImageInput) chatImageInput.value = '';
        if (stagingTray) stagingTray.style.display = 'none';
        if (stagingThumb) stagingThumb.src = '';
        updateSendButtonState();
    }

    // Click handler failsafe for label
    if (chatAttachLabel && chatImageInput) {
        chatAttachLabel.addEventListener('click', function (e) {
            // Label natively opens input, but if click originated on svg, ensure trigger
            try {
                chatImageInput.click();
            } catch(err) {}
        });

        chatImageInput.addEventListener('change', function () {
            if (this.files && this.files[0]) {
                stageImage(this.files[0]);
            }
        });
    }

    if (stagingRemoveBtn) {
        stagingRemoveBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            clearStagedImage();
        });
    }

    // ─── Clipboard Paste (Ctrl+V) Image Support ──────────────
    document.addEventListener('paste', function (e) {
        if (!chatForm) return;

        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                stageImage(file);
                e.preventDefault();
                break;
            }
        }
    });

    // ─── Drag & Drop on Chat Area ────────────────────────────
    if (chatMessages) {
        ['dragenter', 'dragover'].forEach(eventName => {
            chatMessages.addEventListener(eventName, function (e) {
                e.preventDefault();
                e.stopPropagation();
                chatMessages.classList.add('chat-drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            chatMessages.addEventListener(eventName, function (e) {
                e.preventDefault();
                e.stopPropagation();
                chatMessages.classList.remove('chat-drag-over');
            });
        });

        chatMessages.addEventListener('drop', function (e) {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    stageImage(file);
                }
            }
        });
    }

    // ─── Send Button State ───────────────────────────────────
    function updateSendButtonState() {
        if (!chatSendBtn || !messageInput) return;
        const hasText = messageInput.value.trim().length > 0;
        const hasImg = stagedFile !== null;
        if (hasText || hasImg) {
            chatSendBtn.classList.add('chat-send-active');
            chatSendBtn.style.opacity = '1';
        } else {
            chatSendBtn.classList.remove('chat-send-active');
            chatSendBtn.style.opacity = '0.7';
        }
    }

    if (messageInput) {
        messageInput.addEventListener('input', updateSendButtonState);

        messageInput.addEventListener('focus', function () {
            document.body.classList.add('keyboard-open');
            setTimeout(() => scrollToBottom(true), 150);
            setTimeout(() => scrollToBottom(true), 350);
        });

        messageInput.addEventListener('blur', function () {
            // Slight delay so any pending click/pointerdown on send button executes before resetting position
            setTimeout(() => {
                if (!isSubmitting && document.activeElement !== messageInput) {
                    document.body.classList.remove('keyboard-open');
                    setTimeout(() => scrollToBottom(true), 150);
                }
            }, 120);
        });
    }

    // ─── Render Message Bubble ───────────────────────────────
    function addMessageBubble(message, imageUrl, isMine, timestamp, isRead = false) {
        const emptyState = chatMessages.querySelector('.chat-empty-messages');
        if (emptyState) emptyState.remove();

        const cleanImgUrl = getMediaUrl(imageUrl);
        const hasImage = Boolean(cleanImgUrl);
        const hasText = Boolean(message && message.trim());

        const bubble = document.createElement('div');
        let bubbleClasses = 'chat-bubble ' + (isMine ? 'chat-bubble-sent' : 'chat-bubble-received');
        const isImageOnly = hasImage && !hasText;
        if (isImageOnly) {
            bubbleClasses += ' chat-bubble-image-only';
        } else if (hasImage && hasText) {
            bubbleClasses += ' chat-bubble-has-image';
        }
        bubble.className = bubbleClasses;

        let innerHtml = '';

        if (hasImage) {
            if (!isMine) {
                const otherName = window.CHAT_OTHER_NAME || 'MoonVault Support';
                innerHtml += '<span class="chat-sender-name">' + escapeHtml(otherName) + '</span>';
            }
            innerHtml +=
                '<div class="chat-bubble-image-wrap" style="position:relative;width:290px;max-width:calc(85vw - 12px);aspect-ratio:4/3;min-height:200px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;border-radius:20px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.12);border:1px solid rgba(0,0,0,0.06);cursor:pointer;">' +
                '<img src="' + escapeHtml(cleanImgUrl) + '" alt="Photo" class="chat-bubble-img" style="display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;border-radius:20px;" decoding="async">' +
                '<div class="chat-img-zoom-hint" title="Tap to view full photo"><i data-lucide="maximize-2"></i></div>' +
                '</div>';
        }

        if (hasText) {
            innerHtml += '<p class="chat-bubble-text">' + escapeHtml(message) + '</p>';
        }

        innerHtml += '<div class="chat-bubble-meta ' + (isImageOnly ? 'meta-beside-image' : '') + '">';
        innerHtml += '<span class="chat-time">' + escapeHtml(timestamp) + '</span>';
        if (isMine) {
            innerHtml +=
                '<span class="chat-status-icon ' + (isRead ? 'read' : '') + '">' +
                (isRead ? '<i data-lucide="check-check" style="width:14px;height:14px;"></i>' : '<i data-lucide="check" style="width:14px;height:14px;"></i>') +
                '</span>';
        }
        innerHtml += '</div>';

        bubble.innerHTML = innerHtml;
        chatMessages.appendChild(bubble);
        scrollToBottom(true);

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        return bubble;
    }

    // ─── WebSocket Connection ────────────────────────────────
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/ws/chat/';

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = function () {
                wsConnected = true;
                console.log('Chat WebSocket connected');
            };

            ws.onmessage = function (e) {
                const data = JSON.parse(e.data);
                if (data.type === 'received' && data.sender_id === receiverId) {
                    addMessageBubble(data.message, data.image || '', false, data.timestamp || formatTimeNow());
                    fetch('/chat/mark-read/' + receiverId + '/', {
                        method: 'POST',
                        headers: { 'X-CSRFToken': getCsrfToken() }
                    }).catch(() => {});
                } else if (data.type === 'received' && data.sender_id !== receiverId) {
                    // Message from a different conversation — show toast
                    if (typeof window.showWebToast === 'function') {
                        window.showWebToast({
                            title: '💬 New Message',
                            body: data.message || 'Sent a photo',
                            url: '/chat/?player=' + data.sender_id,
                            type: 'chat',
                            sound: true
                        });
                    }
                } else if (data.type === 'sent') {
                    // Confirmed via WebSocket
                }
            };

            ws.onclose = function () {
                wsConnected = false;
                startPolling();
            };

            ws.onerror = function () {
                wsConnected = false;
                startPolling();
            };
        } catch (e) {
            startPolling();
        }
    }

    // ─── Unified Send Message Function (Instant 1-Click Send) ──
    let lastSendTimestamp = 0;
    function doSendMessage() {
        const now = Date.now();
        if (now - lastSendTimestamp < 350) return; // Prevent duplicate triggers from touch + click

        if (isSubmitting) return;

        const message = messageInput ? messageInput.value.trim() : '';
        const file = stagedFile;

        // Nothing to send
        if (!message && !file) {
            if (messageInput) messageInput.focus();
            return;
        }

        lastSendTimestamp = now;
        isSubmitting = true;

        // Immediately blur input field so mobile virtual keyboard closes and returns input to bottom
        if (messageInput) {
            messageInput.blur();
        }
        document.body.classList.remove('keyboard-open');

        const formData = new FormData();
        formData.append('receiver_id', receiverId);
        formData.append('message', message);
        if (file) {
            formData.append('image', file);
        }

        // Preview optimistic image URL if file exists
        let optimisticImgUrl = '';
        if (file) {
            try {
                optimisticImgUrl = URL.createObjectURL(file);
            } catch (err) {}
        }

        // Add bubble optimistically for immediate tactile feedback
        const pendingBubble = addMessageBubble(message, optimisticImgUrl, true, formatTimeNow(), false);

        // Clear input and staged image right away
        if (messageInput) {
            messageInput.value = '';
        }
        clearStagedImage();
        updateSendButtonState();

        // Smooth scroll to bottom
        scrollToBottom(true);
        setTimeout(() => scrollToBottom(true), 120);

        fetch('/chat/send/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCsrfToken()
            },
            body: formData
        })
        .then(r => r.json())
        .then(data => {
            isSubmitting = false;
            updateSendButtonState();
            if (data.success && data.message) {
                // If the message had an image and an optimistic preview was used, upgrade to permanent server URL
                if (data.message.image && pendingBubble) {
                    const permanentUrl = getMediaUrl(data.message.image);
                    const imgEl = pendingBubble.querySelector('.chat-bubble-img');
                    if (imgEl) {
                        imgEl.src = permanentUrl;
                    }
                }
            } else if (!data.success) {
                console.error('Send error:', data.error);
            }
        })
        .catch(err => {
            isSubmitting = false;
            updateSendButtonState();
            console.error('Network error sending message:', err);
        });
    }

    // ─── Attach Handlers for Guaranteed 1-Click Send ─────────
    if (chatSendBtn) {
        // pointerdown and touchstart fire immediately on touch before any blur layout shift can occur
        ['touchstart', 'pointerdown'].forEach(evtName => {
            chatSendBtn.addEventListener(evtName, function (e) {
                e.preventDefault();
                e.stopPropagation();
                doSendMessage();
            }, { passive: false });
        });

        // Click handler for mouse/pointer fallback
        chatSendBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            doSendMessage();
        });
    }

    if (chatForm) {
        chatForm.addEventListener('submit', function (e) {
            e.preventDefault();
            e.stopPropagation();
            doSendMessage();
        });
    }

    if (messageInput) {
        messageInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSendMessage();
            }
        });
    }

    // ─── Fallback Polling ────────────────────────────────────
    let pollInterval = null;
    let lastMessageCount = chatMessages ? chatMessages.querySelectorAll('.chat-bubble').length : 0;

    function startPolling() {
        if (pollInterval) return;
        pollInterval = setInterval(fetchMessages, 4000);
    }

    function fetchMessages() {
        fetch('/chat/messages/' + receiverId + '/')
            .then(r => r.json())
            .then(data => {
                if (data.messages && data.messages.length > lastMessageCount) {
                    const newMessages = data.messages.slice(lastMessageCount);
                    newMessages.forEach(msg => {
                        if (!msg.is_mine) {
                            addMessageBubble(msg.message, msg.image || '', false, msg.timestamp, msg.is_read);
                        }
                    });
                    lastMessageCount = data.messages.length;
                }
            })
            .catch(() => {});
    }

    // ─── Search Filter for Conversations (Admin) ─────────────
    const playerSearch = document.getElementById('player-search');
    const clearSearch = document.getElementById('clear-search');
    if (playerSearch) {
        playerSearch.addEventListener('input', function () {
            const query = this.value.toLowerCase().trim();
            if (clearSearch) {
                clearSearch.style.display = query.length > 0 ? 'block' : 'none';
            }
            const items = document.querySelectorAll('.chat-player-item');
            items.forEach(item => {
                const name = item.getAttribute('data-name') || '';
                item.style.display = name.includes(query) ? 'flex' : 'none';
            });
        });

        if (clearSearch) {
            clearSearch.addEventListener('click', function () {
                playerSearch.value = '';
                clearSearch.style.display = 'none';
                const items = document.querySelectorAll('.chat-player-item');
                items.forEach(item => {
                    item.style.display = 'flex';
                });
                playerSearch.focus();
            });
        }
    }

    // ─── Chat Back Button (Mobile) ───────────────────────────
    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            window.location.href = '/chat/';
        });
    }

    // ─── Mobile Viewport & Keyboard Adjustment ───────────────
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () {
            if (document.activeElement === messageInput) {
                document.body.classList.add('keyboard-open');
            } else {
                document.body.classList.remove('keyboard-open');
            }
            scrollToBottom(true);
        });
        window.visualViewport.addEventListener('scroll', function () {
            if (document.activeElement === messageInput) {
                window.scrollTo(0, 0);
            }
        });
    }

    // ─── Initialize ──────────────────────────────────────────
    scrollToBottom();
    // Re-scroll after fonts and layout settle
    setTimeout(() => scrollToBottom(), 100);
    setTimeout(() => scrollToBottom(), 350);
    connectWebSocket();
    setTimeout(() => {
        if (!wsConnected) startPolling();
    }, 3000);
});
