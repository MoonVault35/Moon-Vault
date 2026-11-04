/* ═══════════════════════════════════════════════════════════
   MoonVault FC - Main JavaScript
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
    // ─── Sidebar Toggle ──────────────────────────────────
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarClose = document.getElementById('sidebar-close');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', function () {
            sidebar.classList.add('open');
        });
    }

    if (sidebarClose && sidebar) {
        sidebarClose.addEventListener('click', function () {
            sidebar.classList.remove('open');
        });
    }

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', function (e) {
        if (sidebar && sidebar.classList.contains('open')) {
            if (!sidebar.contains(e.target) && e.target !== menuToggle && !menuToggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });

    // ─── Auto-dismiss alerts ─────────────────────────────
    const alerts = document.querySelectorAll('[data-alert]');
    alerts.forEach(function (alert) {
        setTimeout(function () {
            alert.style.opacity = '0';
            alert.style.transform = 'translateY(-10px)';
            setTimeout(function () {
                alert.remove();
            }, 300);
        }, 5000);
    });

    // ─── Player search filter (chat sidebar) ─────────────
    const playerSearch = document.getElementById('player-search');
    if (playerSearch) {
        playerSearch.addEventListener('input', function () {
            const query = this.value.toLowerCase();
            const items = document.querySelectorAll('.chat-player-item');
            items.forEach(function (item) {
                const name = item.getAttribute('data-name') || '';
                item.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    // ─── Universal File Dropzone & Live Preview ───────────
    function initDropzones() {
        document.querySelectorAll('.dropzone-box').forEach(function (zone) {
            if (zone.dataset.dzInit) return;
            zone.dataset.dzInit = 'true';

            const input = zone.querySelector('input[type="file"]');
            const preview = zone.querySelector('.dropzone-preview');
            const previewImg = zone.querySelector('.dropzone-preview-img');
            const fileNameSpan = zone.querySelector('.dropzone-file-name');
            const promptWrap = zone.querySelector('.dropzone-prompt');
            const clearBtn = zone.querySelector('.dropzone-clear-btn');

            if (!input) return;

            function showFile(file) {
                if (file && file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = function (e) {
                        if (previewImg) previewImg.src = e.target.result;
                        if (fileNameSpan) {
                            const sizeKb = (file.size / 1024).toFixed(1);
                            fileNameSpan.textContent = file.name + ' (' + sizeKb + ' KB)';
                        }
                        if (preview) preview.style.display = 'flex';
                        if (promptWrap) promptWrap.style.display = 'none';
                        zone.classList.add('has-file');
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                    };
                    reader.readAsDataURL(file);
                }
            }

            input.addEventListener('change', function () {
                if (this.files && this.files[0]) {
                    showFile(this.files[0]);
                }
            });

            // Drag & drop support
            ['dragenter', 'dragover'].forEach(function (ev) {
                zone.addEventListener(ev, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    zone.classList.add('drag-over');
                });
            });

            ['dragleave', 'drop'].forEach(function (ev) {
                zone.addEventListener(ev, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    zone.classList.remove('drag-over');
                });
            });

            zone.addEventListener('drop', function (e) {
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    input.files = e.dataTransfer.files;
                    showFile(e.dataTransfer.files[0]);
                }
            });

            if (clearBtn) {
                clearBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    input.value = '';
                    if (preview) preview.style.display = 'none';
                    if (promptWrap) promptWrap.style.display = 'flex';
                    zone.classList.remove('has-file');
                });
            }
        });
    }

    initDropzones();
    window.initDropzones = initDropzones;
});

