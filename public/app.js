// State
let appState = {
    authToken: localStorage.getItem('wa_admin_token') || null,
    status: 'disconnected',
    userInfo: null,
    pairingCode: null,
    syncStatus: 'idle',
    config: {},
    birthdays: [],
    groups: [],
    todayDate: '',
};

// Auth Elements
const authGate = document.getElementById('auth-gate');
const appWrapper = document.getElementById('app-wrapper');
const authForm = document.getElementById('auth-form');
const adminPasswordInput = document.getElementById('admin-password-input');
const btnTogglePwd = document.getElementById('btn-toggle-pwd');
const authErrorMsg = document.getElementById('auth-error-msg');
const btnLoginSubmit = document.getElementById('btn-login-submit');
const btnAdminLogout = document.getElementById('btn-admin-logout');

// Dashboard Elements
const connectionBadge = document.getElementById('connection-badge');
const filebaseBadge = document.getElementById('filebase-badge');
const statPhone = document.getElementById('stat-phone');
const statGroup = document.getElementById('stat-group');
const statTime = document.getElementById('stat-time');
const statCount = document.getElementById('stat-count');

const pairingView = document.getElementById('pairing-view');
const connectedView = document.getElementById('connected-view');
const connectedUserText = document.getElementById('connected-user-text');
const btnLogout = document.getElementById('btn-logout');

const phoneInput = document.getElementById('phone-input');
const btnGetCode = document.getElementById('btn-get-code');
const codeResultContainer = document.getElementById('code-result-container');
const pairingCodeDisplay = document.getElementById('pairing-code-display');
const btnCopyCode = document.getElementById('btn-copy-code');

const groupSelect = document.getElementById('group-select');
const manualGroupId = document.getElementById('manual-group-id');
const btnRefreshGroups = document.getElementById('btn-refresh-groups');
const btnSaveGroup = document.getElementById('btn-save-group');
const btnTestGroup = document.getElementById('btn-test-group');
const currentGroupName = document.getElementById('current-group-name');
const currentGroupId = document.getElementById('current-group-id');

const birthdaysTbody = document.getElementById('birthdays-tbody');
const btnOpenAddModal = document.getElementById('btn-open-add-modal');
const btnCheckToday = document.getElementById('btn-check-today');
const birthdayModal = document.getElementById('birthday-modal');
const birthdayForm = document.getElementById('birthday-form');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const modalTitle = document.getElementById('modal-title');
const editBdayId = document.getElementById('edit-bday-id');
const bdayName = document.getElementById('bday-name');
const bdayDob = document.getElementById('bday-dob');
const bdayPhone = document.getElementById('bday-phone');
const bdayCustomWish = document.getElementById('bday-custom-wish');
const bdayImageData = document.getElementById('bday-image-data');
const bdayImageFile = document.getElementById('bday-image-file');
const imageDropzone = document.getElementById('image-dropzone');
const dropzoneEmpty = document.getElementById('dropzone-empty');
const dropzonePreview = document.getElementById('dropzone-preview');
const imagePreviewImg = document.getElementById('image-preview-img');
const btnRemovePhoto = document.getElementById('btn-remove-photo');

const photoLightboxModal = document.getElementById('photo-lightbox-modal');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxImg = document.getElementById('lightbox-img');
const btnCloseLightbox = document.getElementById('btn-close-lightbox');

const schedHour = document.getElementById('sched-hour');
const schedMinute = document.getElementById('sched-minute');
const schedTz = document.getElementById('sched-tz');
const schedEnabled = document.getElementById('sched-enabled');
const btnSaveSettings = document.getElementById('btn-save-settings');
const filebaseSyncText = document.getElementById('filebase-sync-text');

// ----------------------------------------------------
// Authenticated Fetch Wrapper
// ----------------------------------------------------
async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (appState.authToken) {
        options.headers['x-admin-token'] = appState.authToken;
    }

    const response = await fetch(url, options);

    if (response.status === 401 && !url.includes('/api/auth/login')) {
        // Token invalid or expired - lock dashboard
        lockDashboard();
        throw new Error('Unauthorized');
    }

    return response;
}

function lockDashboard() {
    appState.authToken = null;
    localStorage.removeItem('wa_admin_token');
    appWrapper.classList.add('hidden');
    authGate.classList.remove('hidden');
    adminPasswordInput.value = '';
    adminPasswordInput.focus();
}

function unlockDashboard(token) {
    appState.authToken = token;
    localStorage.setItem('wa_admin_token', token);
    authGate.classList.add('hidden');
    appWrapper.classList.remove('hidden');
    initDashboard();
}

// ----------------------------------------------------
// Toast Notification Helper
// ----------------------------------------------------
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ----------------------------------------------------
// Authentication Form & Password Toggle
// ----------------------------------------------------
btnTogglePwd.addEventListener('click', () => {
    if (adminPasswordInput.type === 'password') {
        adminPasswordInput.type = 'text';
        btnTogglePwd.innerText = '🙈';
    } else {
        adminPasswordInput.type = 'password';
        btnTogglePwd.innerText = '👁️';
    }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = adminPasswordInput.value.trim();
    if (!password) return;

    btnLoginSubmit.disabled = true;
    btnLoginSubmit.querySelector('.btn-text').innerText = 'Verifying...';
    authErrorMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Invalid password');
        }

        showToast('Authenticated successfully! 🚀', 'success');
        unlockDashboard(data.token);
    } catch (err) {
        authErrorMsg.innerText = err.message || 'Incorrect password.';
        authErrorMsg.classList.remove('hidden');
    } finally {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.querySelector('.btn-text').innerText = 'Unlock Dashboard 🚀';
    }
});

btnAdminLogout.addEventListener('click', async () => {
    try {
        await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    lockDashboard();
    showToast('Dashboard locked.', 'info');
});

// ----------------------------------------------------
// Tabs Navigation
// ----------------------------------------------------
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');
    });
});

// ----------------------------------------------------
// Status Polling & Updates
// ----------------------------------------------------
async function fetchStatus() {
    if (!appState.authToken) return;
    try {
        const res = await authFetch('/api/status');
        const data = await res.json();
        
        appState.status = data.status;
        appState.userInfo = data.userInfo;
        appState.pairingCode = data.pairingCode;
        appState.syncStatus = data.syncStatus;
        appState.config = data.config || {};
        appState.todayDate = data.todayDate;

        renderStatusUI();
    } catch (err) {
        // Handled by authFetch
    }
}

function renderStatusUI() {
    const { status, userInfo, syncStatus, config, pairingCode } = appState;

    // Badges
    connectionBadge.className = 'badge';
    if (status === 'connected') {
        connectionBadge.classList.add('badge-connected');
        connectionBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Connected (+${userInfo?.phone || ''})</span>`;
    } else if (status === 'connecting') {
        connectionBadge.classList.add('badge-connecting');
        connectionBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Connecting...</span>`;
    } else if (status === 'awaiting_pairing') {
        connectionBadge.classList.add('badge-pairing');
        connectionBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Awaiting Code Entry</span>`;
    } else {
        connectionBadge.classList.add('badge-disconnected');
        connectionBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Disconnected</span>`;
    }

    // Filebase badge
    filebaseBadge.className = 'badge badge-filebase';
    if (syncStatus === 'synced') {
        filebaseBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Filebase: Synced ☁️</span>`;
        if (filebaseSyncText) filebaseSyncText.innerText = 'Synchronized to Filebase S3';
    } else if (syncStatus === 'syncing') {
        filebaseBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Filebase: Syncing...</span>`;
        if (filebaseSyncText) filebaseSyncText.innerText = 'Syncing...';
    } else {
        filebaseBadge.innerHTML = `<span class="badge-dot"></span><span class="badge-text">Filebase: Ready ☁️</span>`;
        if (filebaseSyncText) filebaseSyncText.innerText = 'Ready';
    }

    // Stats Bar
    statPhone.innerText = userInfo?.phone ? `+${userInfo.phone}` : 'Not Connected';
    statGroup.innerText = config?.targetGroupName || (config?.targetGroupId ? config.targetGroupId.slice(0, 15) + '...' : 'Not Selected');
    
    const h = String(config?.scheduleHour ?? 0).padStart(2, '0');
    const m = String(config?.scheduleMinute ?? 0).padStart(2, '0');
    statTime.innerText = `${h}:${m} (${config?.timezone || 'IST'})`;

    // Pairing Views
    if (status === 'connected') {
        pairingView.classList.add('hidden');
        connectedView.classList.remove('hidden');
        connectedUserText.innerText = `Logged in as: +${userInfo?.phone || ''} (${userInfo?.name || 'User'})`;
    } else {
        connectedView.classList.add('hidden');
        pairingView.classList.remove('hidden');

        if (pairingCode) {
            pairingCodeDisplay.innerText = pairingCode;
            codeResultContainer.classList.remove('hidden');
        }
    }

    // Current Target Info
    currentGroupName.innerText = config?.targetGroupName || 'Not Selected';
    currentGroupId.innerText = config?.targetGroupId || 'None';
    if (config?.targetGroupId) {
        manualGroupId.value = config.targetGroupId;
    }
}

// ----------------------------------------------------
// Pairing Code Action
// ----------------------------------------------------
btnGetCode.addEventListener('click', async () => {
    const rawPhone = phoneInput.value.trim();
    if (!rawPhone) {
        showToast('Please enter your WhatsApp phone number with country code.', 'error');
        return;
    }

    btnGetCode.disabled = true;
    btnGetCode.querySelector('.btn-text').innerText = 'Generating...';

    try {
        const res = await authFetch('/api/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: rawPhone }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to get pairing code');
        }

        pairingCodeDisplay.innerText = data.pairingCode;
        codeResultContainer.classList.remove('hidden');
        showToast(`Pairing code generated: ${data.pairingCode}`, 'success');
        fetchStatus();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btnGetCode.disabled = false;
        btnGetCode.querySelector('.btn-text').innerText = 'Get Pairing Code';
    }
});

btnCopyCode.addEventListener('click', () => {
    const code = pairingCodeDisplay.innerText.replace(/-/g, '');
    navigator.clipboard.writeText(code).then(() => {
        showToast('Pairing code copied to clipboard!', 'success');
    });
});

btnLogout.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to log out? This will clear session keys from Filebase S3.')) return;

    try {
        const res = await authFetch('/api/logout', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Logged out successfully', 'info');
        codeResultContainer.classList.add('hidden');
        phoneInput.value = '';
        fetchStatus();
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// ----------------------------------------------------
// Groups Management
// ----------------------------------------------------
async function loadGroups() {
    if (!appState.authToken) return;
    try {
        const res = await authFetch('/api/groups');
        const data = await res.json();
        appState.groups = data.groups || [];

        groupSelect.innerHTML = '<option value="">-- Select from your WhatsApp Groups --</option>';
        if (appState.groups.length === 0) {
            groupSelect.innerHTML = '<option value="">No groups found. Connect WhatsApp first.</option>';
            return;
        }

        appState.groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.innerText = `${g.subject} (${g.participantsCount} members)`;
            if (appState.config?.targetGroupId === g.id) {
                opt.selected = true;
            }
            groupSelect.appendChild(opt);
        });
    } catch (err) {
        console.error('Error loading groups:', err);
    }
}

groupSelect.addEventListener('change', () => {
    if (groupSelect.value) {
        manualGroupId.value = groupSelect.value;
    }
});

btnRefreshGroups.addEventListener('click', async () => {
    btnRefreshGroups.innerText = 'Refreshing...';
    await loadGroups();
    btnRefreshGroups.innerText = '🔄 Refresh Groups';
    showToast('Groups list refreshed!', 'success');
});

btnSaveGroup.addEventListener('click', async () => {
    const groupId = manualGroupId.value.trim() || groupSelect.value;
    if (!groupId) {
        showToast('Please select or enter a WhatsApp Group JID.', 'error');
        return;
    }

    let groupName = 'Custom Group';
    const matched = appState.groups.find(g => g.id === groupId);
    if (matched) groupName = matched.subject;

    try {
        const res = await authFetch('/api/groups/target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, groupName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        appState.config = data.config;
        renderStatusUI();
        showToast(`Target group saved: ${groupName}`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
});

btnTestGroup.addEventListener('click', async () => {
    if (!appState.config?.targetGroupId && !manualGroupId.value.trim()) {
        showToast('Save a target group first before testing!', 'error');
        return;
    }

    btnTestGroup.disabled = true;
    btnTestGroup.innerText = 'Sending...';

    try {
        const res = await authFetch('/api/test-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('🚀 Test message sent into the WhatsApp group!', 'success');
    } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
    } finally {
        btnTestGroup.disabled = false;
        btnTestGroup.innerText = '🚀 Send Test Wish to Group';
    }
});

// ----------------------------------------------------
// Birthdays Database & Table
// ----------------------------------------------------
async function loadBirthdays() {
    if (!appState.authToken) return;
    try {
        const res = await authFetch('/api/birthdays');
        const data = await res.json();
        appState.birthdays = data.birthdays || [];
        statCount.innerText = appState.birthdays.length;
        renderBirthdaysTable();
    } catch (err) {
        console.error('Error loading birthdays:', err);
    }
}

function calculateDaysUntil(dobStr) {
    if (!dobStr) return { days: 999, isToday: false };
    const clean = dobStr.length > 5 ? dobStr.slice(-5) : dobStr; // MM-DD
    const [month, day] = clean.split('-').map(Number);
    if (!month || !day) return { days: 999, isToday: false };

    const now = new Date();
    const currentYear = now.getFullYear();
    let target = new Date(currentYear, month - 1, day);

    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);

    if (target < now) {
        target = new Date(currentYear + 1, month - 1, day);
    }

    const diffTime = target - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return { days: diffDays, isToday: diffDays === 0 };
}

function getInitials(name) {
    if (!name) return '🎂';
    const clean = name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Sir)\s+/i, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (clean.slice(0, 2) || '🎂').toUpperCase();
}

function renderBirthdaysTable() {
    if (appState.birthdays.length === 0) {
        birthdaysTbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4" style="color: var(--text-dim);">
                    No birthdays added yet. Click <strong>+ Add Birthday</strong> to get started!
                </td>
            </tr>
        `;
        return;
    }

    const sorted = [...appState.birthdays].sort((a, b) => {
        return calculateDaysUntil(a.dob).days - calculateDaysUntil(b.dob).days;
    });

    birthdaysTbody.innerHTML = sorted.map(b => {
        const { days, isToday } = calculateDaysUntil(b.dob);
        const tagText = b.phone ? `<code>${b.phone}</code>` : '<span style="color: var(--text-dim);">-</span>';
        
        let statusBadge = `<span class="countdown-badge bday-upcoming">In ${days} day${days === 1 ? '' : 's'}</span>`;
        if (isToday) {
            statusBadge = `<span class="countdown-badge bday-today">🎂 TODAY! 🎉</span>`;
        }

        const photoHtml = b.image ? `
            <div class="avatar-thumbnail" onclick="openPhotoLightbox('${escapeHtml(b.name)}', '${escapeHtml(b.image)}')" title="Click to view photo">
                <img src="${escapeHtml(b.image)}" alt="${escapeHtml(b.name)}" class="avatar-img">
                <span class="avatar-zoom-icon">🔍</span>
            </div>
        ` : `
            <div class="avatar-placeholder" title="No photo attached">${getInitials(b.name)}</div>
        `;

        return `
            <tr>
                <td class="bday-photo-cell">${photoHtml}</td>
                <td class="bday-name-cell">${escapeHtml(b.name)}</td>
                <td><strong>${escapeHtml(b.dob)}</strong></td>
                <td>${tagText}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-sm btn-ghost" onclick="triggerSingleTest('${b.id}')" title="Send Wish with Photo">🚀</button>
                        <button class="btn btn-sm btn-ghost" onclick="openEditModal('${b.id}')" title="Edit">✏️</button>
                        <button class="btn btn-sm btn-ghost" onclick="deleteBirthday('${b.id}')" title="Delete" style="color: var(--danger);">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ----------------------------------------------------
// Image Upload & Clipboard Paste Handlers
// ----------------------------------------------------
function setPhotoPreview(urlOrData) {
    if (urlOrData && urlOrData.trim()) {
        bdayImageData.value = urlOrData;
        imagePreviewImg.src = urlOrData;
        dropzoneEmpty.classList.add('hidden');
        dropzonePreview.classList.remove('hidden');
    } else {
        clearPhoto();
    }
}

function clearPhoto() {
    bdayImageData.value = '';
    bdayImageFile.value = '';
    imagePreviewImg.src = '';
    dropzoneEmpty.classList.remove('hidden');
    dropzonePreview.classList.add('hidden');
}

function compressImage(srcDataUrl, maxDim, quality, callback) {
    const img = new Image();
    img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
            if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
            } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const output = canvas.toDataURL('image/jpeg', quality);
        callback(output);
    };
    img.onerror = () => callback(srcDataUrl);
    img.src = srcDataUrl;
}

function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please select or paste a valid image file (JPG, PNG, WEBP).', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const rawDataUrl = e.target.result;
        compressImage(rawDataUrl, 1200, 0.85, (compressedDataUrl) => {
            setPhotoPreview(compressedDataUrl);
            showToast('Photo attached! 📸', 'success');
        });
    };
    reader.readAsDataURL(file);
}

// Dropzone Click & Change
imageDropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-photo')) return;
    bdayImageFile.click();
});

bdayImageFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        handleImageFile(e.target.files[0]);
    }
});

btnRemovePhoto.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPhoto();
    showToast('Photo removed', 'info');
});

// Drag & Drop
imageDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageDropzone.classList.add('drag-over');
});

imageDropzone.addEventListener('dragleave', () => {
    imageDropzone.classList.remove('drag-over');
});

imageDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    imageDropzone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
    }
});

// Global & Modal Clipboard Paste Handler (Ctrl+V)
window.addEventListener('paste', (e) => {
    if (!e.clipboardData || !e.clipboardData.items) return;
    
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            if (blob) {
                e.preventDefault();
                // If birthday modal isn't open, open it automatically
                if (birthdayModal.classList.contains('hidden')) {
                    btnOpenAddModal.click();
                }
                handleImageFile(blob);
                break;
            }
        }
    }
});

// Lightbox Preview Handlers
function openPhotoLightbox(name, imgSrc) {
    if (!imgSrc) return;
    lightboxTitle.innerText = `${name} - Photo`;
    lightboxImg.src = imgSrc;
    photoLightboxModal.classList.remove('hidden');
}

function closePhotoLightbox() {
    photoLightboxModal.classList.add('hidden');
    lightboxImg.src = '';
}

btnCloseLightbox.addEventListener('click', closePhotoLightbox);
photoLightboxModal.addEventListener('click', (e) => {
    if (e.target === photoLightboxModal) closePhotoLightbox();
});

// ----------------------------------------------------
// Birthday Modal Actions
// ----------------------------------------------------
btnOpenAddModal.addEventListener('click', () => {
    modalTitle.innerText = 'Add Birthday';
    editBdayId.value = '';
    clearPhoto();
    birthdayForm.reset();
    birthdayModal.classList.remove('hidden');
});

function openEditModal(id) {
    const item = appState.birthdays.find(b => b.id === id);
    if (!item) return;

    modalTitle.innerText = 'Edit Birthday';
    editBdayId.value = item.id;
    bdayName.value = item.name;
    bdayDob.value = item.dob;
    bdayPhone.value = item.phone || '';
    bdayCustomWish.value = item.customWish || '';
    
    if (item.image) {
        setPhotoPreview(item.image);
    } else {
        clearPhoto();
    }

    birthdayModal.classList.remove('hidden');
}

function closeModal() {
    birthdayModal.classList.add('hidden');
}

btnCloseModal.addEventListener('click', closeModal);
btnCancelModal.addEventListener('click', closeModal);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePhotoLightbox();
        closeModal();
    }
});

birthdayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editBdayId.value;
    
    let finalImageUrl = bdayImageData.value;

    // If image data is a data URI (pasted/uploaded), upload to server
    if (finalImageUrl && finalImageUrl.startsWith('data:image/')) {
        try {
            showToast('Uploading photo...', 'info');
            const upRes = await authFetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: finalImageUrl }),
            });
            const upData = await upRes.json();
            if (!upRes.ok) throw new Error(upData.error || 'Photo upload failed');
            finalImageUrl = upData.imageUrl;
        } catch (upErr) {
            showToast(`Photo upload failed: ${upErr.message}`, 'error');
            return;
        }
    }

    const payload = {
        name: bdayName.value.trim(),
        dob: bdayDob.value.trim(),
        phone: bdayPhone.value.trim(),
        customWish: bdayCustomWish.value.trim(),
        image: finalImageUrl || '',
    };

    try {
        let res;
        if (id) {
            res = await authFetch(`/api/birthdays/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } else {
            res = await authFetch('/api/birthdays', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        closeModal();
        await loadBirthdays();
        showToast(id ? 'Birthday updated with photo! 🎉' : 'Birthday added with photo! 🎉', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
});

async function deleteBirthday(id) {
    if (!confirm('Are you sure you want to delete this birthday?')) return;
    try {
        const res = await authFetch(`/api/birthdays/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        await loadBirthdays();
        showToast('Birthday removed', 'info');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function triggerSingleTest(id) {
    try {
        showToast('Sending wish into target group...', 'info');
        const res = await authFetch('/api/test-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ birthdayId: id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Birthday greeting posted in WhatsApp Group!', 'success');
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    }
}

btnCheckToday.addEventListener('click', async () => {
    try {
        btnCheckToday.disabled = true;
        const res = await authFetch('/api/check-today', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.count > 0) {
            showToast(`🎉 Sent wishes for ${data.count} birthday(s) today!`, 'success');
        } else {
            showToast('No birthdays matching today\'s date.', 'info');
        }
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    } finally {
        btnCheckToday.disabled = false;
    }
});

// ----------------------------------------------------
// Settings Action
// ----------------------------------------------------
btnSaveSettings.addEventListener('click', async () => {
    const payload = {
        scheduleHour: parseInt(schedHour.value, 10),
        scheduleMinute: parseInt(schedMinute.value, 10),
        timezone: schedTz.value,
        enabled: schedEnabled.checked,
    };

    try {
        const res = await authFetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        appState.config = data.config;
        renderStatusUI();
        showToast('Settings saved & scheduler updated!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
});

function populateSettingsUI() {
    const { config } = appState;
    if (!config) return;
    if (config.scheduleHour !== undefined) schedHour.value = config.scheduleHour;
    if (config.scheduleMinute !== undefined) schedMinute.value = config.scheduleMinute;
    if (config.timezone) schedTz.value = config.timezone;
    if (config.enabled !== undefined) schedEnabled.checked = config.enabled;
}

// ----------------------------------------------------
// Bootstrap & Verification
// ----------------------------------------------------
async function initDashboard() {
    await fetchStatus();
    populateSettingsUI();
    await loadBirthdays();
    await loadGroups();
}

async function verifyAuthAndStart() {
    if (!appState.authToken) {
        lockDashboard();
        return;
    }

    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'x-admin-token': appState.authToken }
        });
        if (res.ok) {
            authGate.classList.add('hidden');
            appWrapper.classList.remove('hidden');
            await initDashboard();
            setInterval(fetchStatus, 4000);
        } else {
            lockDashboard();
        }
    } catch {
        lockDashboard();
    }
}

// Expose globals for inline HTML handlers
window.openEditModal = openEditModal;
window.deleteBirthday = deleteBirthday;
window.triggerSingleTest = triggerSingleTest;
window.openPhotoLightbox = openPhotoLightbox;

window.addEventListener('DOMContentLoaded', verifyAuthAndStart);
