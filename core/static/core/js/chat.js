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

    // ─── Lightbox Viewer ─────────────────────────────────────
    window.openLightbox = function (imgSrc) {
        const lightbox = document.getElementById('chat-lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        const lightboxDownload = document.getElementById('lightbox-download');
        if (!lightbox || !lightboxImg) return;

        lightboxImg.src = imgSrc;
        if (lightboxDownload) {
            lightboxDownload.href = imgSrc;
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
            chatSendBtn.disabled = false;
        } else {
            chatSendBtn.classList.remove('chat-send-active');
        }
    }

    if (messageInput) {
        messageInput.addEventListener('input', updateSendButtonState);
    }

    // ─── Render Message Bubble ───────────────────────────────
    function addMessageBubble(message, imageUrl, isMine, timestamp, isRead = false) {
        const emptyState = chatMessages.querySelector('.chat-empty-messages');
        if (emptyState) emptyState.remove();

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + (isMine ? 'chat-bubble-sent' : 'chat-bubble-received');

        let innerHtml = '';

        if (imageUrl) {
            const displayUrl = imageUrl.startsWith('http') || imageUrl.startsWith('data:') ? imageUrl : '/media/' + imageUrl;
            innerHtml +=
                '<div class="chat-bubble-image-wrap">' +
                '<img src="' + displayUrl + '" alt="Attached photo" class="chat-bubble-img" onclick="openLightbox(\'' + displayUrl + '\')" loading="lazy">' +
                '</div>';
        }

        if (message) {
            innerHtml += '<p class="chat-bubble-text">' + escapeHtml(message) + '</p>';
        }

        innerHtml += '<div class="chat-bubble-meta">';
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

    // ─── Send Message via HTTP FormData ───────────────────────
    chatForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (isSubmitting) return;

        const message = messageInput.value.trim();
        const file = stagedFile;

        if (!message && !file) return;

        isSubmitting = true;
        chatSendBtn.disabled = true;

        const formData = new FormData();
        formData.append('receiver_id', receiverId);
        formData.append('message', message);
        if (file) {
            formData.append('image', file);
        }

        // Preview optimistic image URL if file exists
        let optimisticImgUrl = '';
        if (file) {
            optimisticImgUrl = URL.createObjectURL(file);
        }

        // Add bubble optimistically for immediate tactile feedback
        addMessageBubble(message, optimisticImgUrl, true, formatTimeNow(), false);

        // Clear input and staged image right away
        messageInput.value = '';
        clearStagedImage();
        updateSendButtonState();

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
            chatSendBtn.disabled = false;
            updateSendButtonState();
            if (!data.success) {
                console.error('Send error:', data.error);
            }
        })
        .catch(err => {
            isSubmitting = false;
            chatSendBtn.disabled = false;
            updateSendButtonState();
            console.error('Network error sending message:', err);
        });

        messageInput.focus();
    });

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

    // ─── Initialize ──────────────────────────────────────────
    scrollToBottom();
    connectWebSocket();
    setTimeout(() => {
        if (!wsConnected) startPolling();
    }, 3000);
});
