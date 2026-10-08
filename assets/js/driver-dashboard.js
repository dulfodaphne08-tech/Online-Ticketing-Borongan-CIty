// ============================================================
// BORONGAN TRANSPORT — DRIVER DASHBOARD JS
// Data: api/drivers.php?me=1 · api/wallet.php · api/driver_notifications.php
// Login/session: assets/js/guard.js (data-role="driver") must load first.
// Live balance: polls every 5 s while the page is visible.
// ============================================================

const LOW_BALANCE_THRESHOLD = 50;
const POLL_MS = 5000;

let currentDriver = null;
let driverTransactions = [];
let driverNotifications = [];
let loadHistory = [];
let currentBalance = 0;
let currentFee = 0;
let lastTransactionRef = null;
let driverPaymentPollingTimer = null;
let driverPaymentRefreshInProgress = false;
let dashboardResumeRefreshInProgress = false;
let lastSyncTime = null;
let notificationFilter = 'all';

// ------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-triangle-exclamation' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></span><span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close" aria-label="Close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function formatCurrency(amount) {
    const num = Number(amount || 0);
    return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function localDateKey(d = new Date()) {
    return d.toLocaleDateString('en-CA');
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function getFee() {
    return currentFee;
}

async function apiGet(endpoint, query = {}) {
    const res = await window.api(endpoint, { query });
    if (!res.success) throw new Error(res.message || `HTTP ${res.status}`);
    return res.data || {};
}

function safeStorage(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}

// ------------------------------------------------------------
// Data loaders
// ------------------------------------------------------------
async function loadDriverProfile() {
    try {
        const data = await apiGet('drivers.php', { me: 1 });
        if (data.driver) {
            currentFee = Number(data.driver.fee || 0);
            return normalizeDriver(data.driver);
        }
    } catch (e) { console.error('drivers.php failed:', e); }
    return null;
}

function normalizeDriver(d) {
    return {
        driverId: d.driverId || '',
        fullName: d.fullName || '',
        address: d.address || '',
        contact: d.contact || '',
        birthdate: d.birthdate || '',
        gender: d.gender || '',
        vehicleType: d.vehicleType || '',
        plateNumber: d.plateNumber || '',
        bodyNumber: d.bodyNumber || '',
        licenseNo: d.licenseNo || '',
        photo: d.photo || '',
        status: d.status || 'Active',
        registrationDate: d.registrationDate || d.createdAt || '',
        licenseExpiration: d.licenseExpiration || '',
        username: d.username || '',
        qrPayload: d.qrPayload || ''
    };
}

async function loadDriverBalance() {
    if (!currentDriver) return null;
    try {
        const data = await apiGet('wallet.php', { action: 'balance' });
        currentBalance = Number(data.balance ?? 0);
        currentFee = Number(data.fee ?? currentFee);
        if (data.status) currentDriver.status = data.status;
        setSyncIndicator('ok');
        return data;
    } catch (e) {
        console.warn('wallet.php balance failed:', e);
        setSyncIndicator('error');
        return null;
    }
}

async function loadWalletHistory() {
    if (!currentDriver) return;
    const data = await apiGet('wallet.php', { action: 'history', limit: 300 });
    const rows = Array.isArray(data.transactions) ? data.transactions : [];
    const mapRow = t => ({
        id: t.referenceNumber || t.id,
        type: t.type,
        date: t.date || '',
        time: t.time || '',
        createdAt: t.createdAt,
        amount: Number(t.amount ?? 0),
        previousBalance: Number(t.previousBalance ?? 0),
        balanceAfter: Number(t.balanceAfter ?? 0),
        newBalance: Number(t.balanceAfter ?? 0),
        status: t.status === 'SUCCESSFUL' ? 'Successful' : (t.status || 'Successful'),
        vehicleType: t.vehicleType || currentDriver.vehicleType,
        plateNumber: t.plateNumber || currentDriver.plateNumber,
        bodyNumber: currentDriver.bodyNumber,
        processedBy: t.processedBy || 'Authorized Terminal Staff',
        loadedBy: t.processedBy || 'Cashier',
        paymentMethod: t.paymentMethod || ''
    });
    driverTransactions = rows.filter(t => t.type === 'FEE').map(mapRow);
    loadHistory = rows.filter(t => t.type === 'LOAD').map(mapRow);
    lastTransactionRef = rows.length ? rows[0].referenceNumber : null;
}

async function loadDriverNotifications() {
    try {
        const data = await apiGet('driver_notifications.php');
        return (data.notifications || []).map(n => ({
            id: n.id,
            type: notificationKind(n.type),
            title: n.title || '',
            message: n.message || '',
            timestamp: n.createdAt || new Date().toISOString(),
            read: !!n.read
        }));
    } catch (e) {
        console.warn('driver_notifications.php failed:', e);
        return null;
    }
}

function notificationKind(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'WALLET_LOAD') return 'load';
    if (t === 'TRANSPORT_FEE') return 'payment';
    if (t.includes('LOW') || t.includes('INSUFFICIENT')) return 'low';
    return 'payment';
}

function setSyncIndicator(state) {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    el.className = 'sync-indicator';
    if (state === 'ok') {
        lastSyncTime = new Date();
        el.innerHTML = '<span class="dot"></span> Live · synced ' + lastSyncTime.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } else if (state === 'warning') {
        el.className = 'sync-indicator warning';
        el.innerHTML = '<span class="dot"></span> Syncing...';
    } else if (state === 'error') {
        el.className = 'sync-indicator error';
        el.innerHTML = '<span class="dot"></span> Offline — retrying…';
    }
}

// ------------------------------------------------------------
// Dashboard population
// ------------------------------------------------------------
function populateDashboard() {
    const d = currentDriver;
    if (!d) return;

    setText('driverName', d.fullName || 'Driver');

    const photo = document.getElementById('profilePhoto');
    if (photo) {
        if (d.photo) photo.innerHTML = `<img src="${d.photo}" alt="Driver">`;
        else photo.textContent = (d.fullName || 'D').charAt(0).toUpperCase();
    }

    setText('heroBalance', formatCurrency(currentBalance));
    setText('heroStatus', d.status || 'Active');
    setText('heroVehicle', d.vehicleType || '--');
    setText('heroFee', formatCurrency(currentFee || getFee(d.vehicleType)));

    setText('statBalance', formatCurrency(currentBalance));

    const today = localDateKey();
    const todayTrans = driverTransactions.filter(t => (t.date || '').startsWith(today));
    const todayTotal = todayTrans.reduce((s, t) => s + t.amount, 0);

    setText('todayTrips', todayTrans.length);
    setText('todayFees', formatCurrency(todayTotal));
    setText('statVehicleStatus', (d.status || 'Active').toUpperCase());
    setText('statPlate', d.plateNumber || '--');

    setText('feePerTripValue', formatCurrency(currentFee || getFee(d.vehicleType)));

    setText('qrDriverName', d.fullName || '--');
    setText('qrPageVehicle', d.vehicleType || '--');
    setText('qrPagePlate', d.plateNumber || '--');
    setText('qrFee', formatCurrency(currentFee || getFee(d.vehicleType)));

    const statusEl = document.getElementById('paymentStatusBadge');
    if (statusEl) {
        if (todayTrans.length > 0) {
            statusEl.textContent = `${todayTrans.length} trip${todayTrans.length === 1 ? '' : 's'} today`;
            statusEl.className = 'status-badge paid';
        } else {
            statusEl.textContent = 'No activity today';
            statusEl.className = 'status-badge neutral';
        }
    }

    checkBalanceNotifications();
    renderMiniChart();
}

function checkBalanceNotifications() {
    const banner = document.getElementById('notificationBanner');
    if (!banner) return;
    const fee = currentFee;

    if (currentBalance < fee && currentBalance >= 0) {
        banner.innerHTML = `
            <div class="notification-banner insufficient">
                <i class="fas fa-exclamation-triangle nb-icon" style="color:var(--red);"></i>
                <div>
                    <div class="nb-title">Insufficient Balance</div>
                    <div class="nb-message">Current Balance: ${formatCurrency(currentBalance)} · Required Fee: ${formatCurrency(fee)}<br>Please load your account through the authorized cashier.</div>
                </div>
            </div>`;
    } else if (currentBalance > 0 && currentBalance <= LOW_BALANCE_THRESHOLD) {
        banner.innerHTML = `
            <div class="notification-banner low-balance">
                <i class="fas fa-exclamation-circle nb-icon" style="color:var(--yellow);"></i>
                <div>
                    <div class="nb-title">Low Balance</div>
                    <div class="nb-message">Your current balance is ${formatCurrency(currentBalance)}. Please visit the authorized cashier to load money into your account.</div>
                </div>
            </div>`;
    } else {
        banner.innerHTML = '';
    }
}

// ------------------------------------------------------------
// Last-7-days mini chart
// ------------------------------------------------------------
function renderMiniChart() {
    const wrap = document.getElementById('miniChart');
    if (!wrap) return;

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = new Date();
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = localDateKey(d);
        const total = driverTransactions
            .filter(t => (t.date || '').startsWith(key))
            .reduce((s, t) => s + t.amount, 0);
        last7.push({ key, day: days[(d.getDay() + 6) % 7], total, date: d });
    }

    const max = Math.max(...last7.map(l => l.total), 1);
    const hasData = last7.some(l => l.total > 0);

    if (!hasData) {
    wrap.innerHTML = `
        <div class="mini-chart-empty">
            <i class="fas fa-chart-simple"></i>
            <span>No fees paid in the last 7 days</span>
        </div>`;
    return;
}

    wrap.innerHTML = last7.map(l => {
        const heightPx = l.total > 0 ? Math.max((l.total / max) * 110, 14) : 6;
        const isToday = localDateKey(new Date()) === l.key;
        return `
            <div class="bar-wrapper" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;gap:4px;height:100%;">
                <div style="font-size:.65rem;font-weight:700;color:${l.total > 0 ? '#b22234' : '#cbd5e1'};">
                    ${l.total > 0 ? '₱' + l.total.toFixed(0) : ''}
                </div>
                <div class="bar"
                     style="height:${heightPx}px;width:100%;background:${l.total > 0 ? 'linear-gradient(180deg,#b22234,#8f1a2a)' : '#e2e8f0'};border-radius:6px 6px 2px 2px;transition:all .3s ease;"
                     title="${l.day} ${l.date.toLocaleDateString('en-US',{month:'short',day:'numeric'})}: ${formatCurrency(l.total)}">
                </div>
                <div style="font-size:.65rem;font-weight:${isToday ? '800' : '600'};color:${isToday ? '#b22234' : '#64748b'};">
                    ${l.day.charAt(0)}
                </div>
            </div>`;
    }).join('');
}

// ------------------------------------------------------------
// QR code generation
// ------------------------------------------------------------
function generateQR() {
    const d = currentDriver;
    if (!d) return;
    const qrText = d.qrPayload || JSON.stringify({
        version: 1,
        driverId: String(d.driverId || ''),
        plateNumber: String(d.plateNumber || ''),
        vehicleType: String(d.vehicleType || '')
    });

    ['qrCode', 'qrCodeFull'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        try {
            new QRCode(el, {
                text: qrText, width: 180, height: 180,
                colorDark: '#b22234', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch {
            el.innerHTML = '<div class="qr-placeholder"><i class="fas fa-qrcode"></i>QR</div>';
        }
    });

    const qrPageEl = document.getElementById('qrCodePage');
    if (qrPageEl) {
        qrPageEl.innerHTML = '';
        try {
            new QRCode(qrPageEl, {
                text: qrText, width: 200, height: 200,
                colorDark: '#b22234', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch {
            qrPageEl.innerHTML = '<div class="qr-placeholder"><i class="fas fa-qrcode"></i>QR</div>';
        }
    }
}

function downloadQR() {
    const canvas = document.querySelector('#qrCode canvas');
    if (!canvas) return showToast('Generate QR first', 'warning');
    const link = document.createElement('a');
    link.download = `QR_${currentDriver.driverId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('QR downloaded!', 'success');
}

function downloadQRPage() {
    const canvas = document.querySelector('#qrCodePage canvas');
    if (!canvas) return showToast('Generate QR first', 'warning');
    const link = document.createElement('a');
    link.download = `QR_${currentDriver.driverId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('QR downloaded!', 'success');
}

function shareQR() { shareQRSel('#qrCode canvas'); }
function shareQRPage() { shareQRSel('#qrCodePage canvas'); }

function shareQRSel(sel) {
    const canvas = document.querySelector(sel);
    if (!canvas) return showToast('Generate QR first', 'warning');
    canvas.toBlob(blob => {
        if (navigator.share) {
            navigator.share({
                title: 'My QR Code',
                files: [new File([blob], 'qr.png', { type: 'image/png' })]
            }).catch(() => {});
        } else showToast('Share not supported', 'warning');
    });
}

function downloadQRFull() {
    const card = document.querySelector('.digital-id-card');
    if (!card) return showToast('Generate ID first', 'warning');
    showToast('Generating download...', 'success');
    html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
        .then(canvas => {
            const link = document.createElement('a');
            link.download = `DriverID_${currentDriver.driverId}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('ID downloaded!', 'success');
        })
        .catch(() => showToast('Download failed, use Print', 'warning'));
}

function printQRCard() {
    document.getElementById('receiptPrintArea')?.classList.remove('show-receipt-print');
    window.print();
}

// ------------------------------------------------------------
// Page-specific populate functions
// ------------------------------------------------------------
function populateQRPage() {
    const d = currentDriver;
    if (!d) return;
    setText('displayRegNumber', d.driverId || '--');
    setText('displayIdBadge', d.driverId || '--');
    setText('displayName', d.fullName || '--');
    setText('displayBirthdate', formatDate(d.birthdate));
    setText('displayGender', d.gender || '--');
    setText('displayContact', d.contact || '--');
    setText('displayVehicle', d.vehicleType || '--');
    setText('displayPlate', d.plateNumber || '--');
    setText('displayBodyNumber', d.bodyNumber || '--');

    setText('qrPageDriverId', d.driverId || '--');
    setText('qrPageVehicle', d.vehicleType || '--');
    setText('qrPageBodyNumber', d.bodyNumber || '--');
    setText('qrPagePlate', d.plateNumber || '--');

    const photoLarge = document.getElementById('photoDisplayLarge');
    if (photoLarge) {
        if (d.photo) photoLarge.innerHTML = `<img src="${d.photo}" alt="Driver Photo">`;
        else {
            const initials = (d.fullName || 'Driver').split(' ')
                .filter(n => n.length > 0).map(n => n[0])
                .join('').toUpperCase().slice(0, 2);
            photoLarge.innerHTML = `<span class="photo-initials">${initials || 'DR'}</span>`;
        }
    }
}

function populateProfile() {
    const d = currentDriver;
    if (!d) return;
    setText('profileName', d.fullName || '--');
    setText('profileId', d.driverId || '--');
    setText('profileFullName', d.fullName || '--');
    setText('profileAddress', d.address || '--');
    setText('profileContact', d.contact || '--');
    setText('profileBirthdate', formatDate(d.birthdate));
    setText('profileGender', d.gender || '--');
    setText('profileDriverId', d.driverId || '--');
    setText('profileStatus', d.status || 'Active');
    setText('profileVehicleType', d.vehicleType || '--');
    setText('profileBodyNumber', d.bodyNumber || '--');
    setText('profilePlateNumber', d.plateNumber || '--');
    setText('profileVehicleStatus', d.status || 'Active');
}

function populateVehicle() {
    const d = currentDriver;
    if (!d) return;
    setText('vehicleType', d.vehicleType || '--');
    setText('vehicleBodyNumber', d.bodyNumber || '--');
    setText('vehiclePlateNumber', d.plateNumber || '--');
    setText('vehicleStatus', (d.status || 'ACTIVE').toUpperCase());
    setText('vehicleFee', formatCurrency(currentFee || getFee(d.vehicleType)));
}

function populateBalance() {
    setText('balanceAmount', formatCurrency(currentBalance));
    setText('balanceAccountStatus', currentDriver?.status || 'ACTIVE');
    setText('balanceFeePerTrip', formatCurrency(currentFee || getFee(currentDriver?.vehicleType)));

    const lastLoad = loadHistory[0];
    if (lastLoad) {
        setText('balanceLastLoad', formatCurrency(lastLoad.amount));
        setText('balanceLastUpdated', formatDate(lastLoad.date));
    } else {
        setText('balanceLastLoad', '--');
        setText('balanceLastUpdated', '--');
    }
}

function renderLoadHistory() {
    const table = document.getElementById('loadHistoryTable');
    if (!table) return;
    if (!loadHistory.length) {
        table.innerHTML = '<tr><td colspan="5"><div class="empty-state py-4"><i class="fas fa-history"></i><h3>No load history</h3></div></td></tr>';
        return;
    }
    table.innerHTML = loadHistory.map(l => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="py-2">${formatDate(l.date)}</td>
            <td class="py-2"><span class="status-badge paid">Load</span></td>
            <td class="py-2 font-bold text-green">+${formatCurrency(l.amount)}</td>
            <td class="py-2">${formatCurrency(l.previousBalance)}</td>
            <td class="py-2 font-semibold">${formatCurrency(l.newBalance)}</td>
        </tr>
    `).join('');
}

function renderPaymentHistory() {
    const search = document.getElementById('paymentSearch')?.value.toLowerCase() || '';
    const filter = document.getElementById('paymentFilter')?.value || 'all';
    const table = document.getElementById('paymentHistoryTable');
    const count = document.getElementById('paymentCount');
    if (!table) return;

    let data = driverTransactions;
    if (filter !== 'all') data = data.filter(t => (t.status || 'Successful') === filter);
    if (search) data = data.filter(t =>
        (t.id || '').toLowerCase().includes(search) ||
        (t.date || '').toLowerCase().includes(search)
    );

    const totalPaid = driverTransactions.reduce((sum, t) => sum + t.amount, 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthPaid = driverTransactions.filter(t => new Date(t.date) >= monthStart)
        .reduce((sum, t) => sum + t.amount, 0);

    setText('totalPaidAmount', formatCurrency(totalPaid));
    setText('monthPaidAmount', formatCurrency(monthPaid));
    if (count) count.textContent = data.length;

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="7"><div class="empty-state py-4"><i class="fas fa-receipt"></i><h3>No transactions found</h3></div></td></tr>';
        return;
    }

    table.innerHTML = data.map(t => `
        <tr class="transaction-row border-b border-gray-100" onclick="viewTransactionDetail('${t.id}')">
            <td class="py-2">${formatDate(t.date)}</td>
            <td class="py-2">${escapeHtml(t.vehicleType || currentDriver.vehicleType)}</td>
            <td class="py-2 font-bold text-primary">${formatCurrency(t.amount)}</td>
            <td class="py-2">${formatCurrency(t.previousBalance)}</td>
            <td class="py-2 font-semibold">${formatCurrency(t.balanceAfter)}</td>
            <td class="py-2"><span class="status-badge ${(t.status || 'successful').toLowerCase() === 'successful' ? 'paid' : 'inactive'}">${escapeHtml(t.status || 'Successful')}</span></td>
            <td class="py-2">
                <button class="btn-primary btn-sm" onclick="event.stopPropagation(); viewTransactionDetail('${t.id}')"><i class="fas fa-eye"></i></button>
                <button class="btn-outline btn-sm" onclick="event.stopPropagation(); printTransaction('${t.id}')"><i class="fas fa-print"></i></button>
            </td>
        </tr>
    `).join('');
}

function viewTransactionDetail(id) {
    const t = driverTransactions.find(x => x.id === id);
    if (!t) return showToast('Transaction not found', 'error');
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-box">
            <h2>Transaction Details</h2>
            <div class="detail-row"><span class="detail-label">Transaction ID</span><span class="detail-value">${escapeHtml(t.id)}</span></div>
            <div class="detail-row"><span class="detail-label">Driver</span><span class="detail-value">${escapeHtml(currentDriver.fullName)}</span></div>
            <div class="detail-row"><span class="detail-label">Vehicle</span><span class="detail-value">${escapeHtml(t.vehicleType || currentDriver.vehicleType)}</span></div>
            <div class="detail-row"><span class="detail-label">Body Number</span><span class="detail-value">${escapeHtml(t.bodyNumber || currentDriver.bodyNumber || '--')}</span></div>
            <div class="detail-row"><span class="detail-label">Plate Number</span><span class="detail-value">${escapeHtml(t.plateNumber || currentDriver.plateNumber)}</span></div>
            <div class="detail-row"><span class="detail-label">Fee</span><span class="detail-value" style="color:var(--primary);">${formatCurrency(t.amount)}</span></div>
            <div class="detail-row"><span class="detail-label">Previous Balance</span><span class="detail-value">${formatCurrency(t.previousBalance)}</span></div>
            <div class="detail-row"><span class="detail-label">Balance After</span><span class="detail-value">${formatCurrency(t.balanceAfter)}</span></div>
            <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" style="color:var(--green);">${escapeHtml(t.status || 'SUCCESSFUL')}</span></div>
            <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${formatDate(t.date)}</span></div>
            <div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${escapeHtml(t.time || '--')}</span></div>
            <div class="detail-row"><span class="detail-label">Processed By</span><span class="detail-value">${escapeHtml(t.processedBy || 'Authorized Terminal Staff')}</span></div>
            <div class="flex gap-3 mt-4">
                <button class="btn-primary flex-1" onclick="this.closest('.modal-overlay').remove()">Close</button>
                <button class="btn-outline flex-1" onclick="printTransaction('${t.id}')"><i class="fas fa-print"></i> Print</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function printTransaction(id) {
    const t = driverTransactions.find(x => x.id === id);
    if (!t) return showToast('Transaction not found', 'error');
    setText('rReceiptNo', t.id);
    setText('rDate', formatDate(t.date));
    setText('rTime', t.time || '--');
    setText('rDriver', currentDriver.fullName);
    setText('rPlate', currentDriver.plateNumber);
    setText('rVehicle', currentDriver.vehicleType);
    setText('rAmount', formatCurrency(t.amount));
    setText('rStatus', (t.status || 'Successful').toUpperCase());
    const printArea = document.getElementById('receiptPrintArea');
    if (!printArea) return;
    printArea.classList.add('show-receipt-print');
    printArea.style.display = 'block';
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            printArea.style.display = 'none';
            printArea.classList.remove('show-receipt-print');
        }, 500);
    }, 100);
}

// ------------------------------------------------------------
// Notifications
// ------------------------------------------------------------
function formatDriverNotificationTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}

function renderDriverNotifications() {
    const list = document.getElementById('driverNotificationList');
    const badge = document.getElementById('driverNotificationBadge');
    if (!list || !badge) return;

    const unreadCount = driverNotifications.filter(n => !n.read).length;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.hidden = unreadCount === 0;

    const badgeBell = document.getElementById('driverNotificationBadgeBell');
    if (badgeBell) {
        badgeBell.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badgeBell.hidden = unreadCount === 0;
    }

    if (!driverNotifications.length) {
        list.innerHTML = '<div class="driver-notification__empty">No notifications yet.</div>';
        renderFullNotifications();
        return;
    }

    list.innerHTML = driverNotifications.slice(0, 30).map(n => `
        <div role="listitem">
            <button type="button" class="driver-notification__item ${n.read ? '' : 'is-unread'}"
                data-driver-notification-id="${escapeHtml(n.id)}">
                <span class="driver-notification__icon"><i class="fas ${notificationIcon(n.type)}" aria-hidden="true"></i></span>
                <span>
                    <span class="driver-notification__title">${escapeHtml(n.title)}</span>
                    <span class="driver-notification__message">${escapeHtml(n.message)}</span>
                    <span class="driver-notification__time">${escapeHtml(formatDriverNotificationTime(n.timestamp))}</span>
                </span>
            </button>
        </div>
    `).join('');
    renderFullNotifications();
}

function notificationIcon(type) {
    if (type === 'load') return 'fa-plus-circle';
    if (type === 'low') return 'fa-exclamation-triangle';
    if (type === 'insufficient') return 'fa-exclamation-circle';
    return 'fa-receipt';
}

function renderFullNotifications() {
    const container = document.getElementById('notificationsFullList');
    if (!container) return;

    let data = driverNotifications;
    if (notificationFilter !== 'all') data = data.filter(n => n.type === notificationFilter);

    if (!data.length) {
        container.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm">No notifications</div>';
        return;
    }

    container.innerHTML = data.map(n => `
        <div class="driver-notification__item ${n.read ? '' : 'is-unread'}" style="cursor:default;">
            <span class="driver-notification__icon"><i class="fas ${notificationIcon(n.type)}"></i></span>
            <span>
                <span class="driver-notification__title">${escapeHtml(n.title)}</span>
                <span class="driver-notification__message">${escapeHtml(n.message)}</span>
                <span class="driver-notification__time">${escapeHtml(formatDriverNotificationTime(n.timestamp))}</span>
            </span>
        </div>
    `).join('');
}

async function refreshNotifications() {
    const remote = await loadDriverNotifications();
    if (remote) {
        driverNotifications = remote;
        renderDriverNotifications();
    }
}

async function markNotificationsRead(id) {
    driverNotifications = driverNotifications.map(n => (!id || n.id === id) ? { ...n, read: true } : n);
    renderDriverNotifications();
    await window.api('driver_notifications.php', { method: 'POST', body: id ? { id } : { markAllRead: true } });
}

async function initDriverNotifications() {
    await refreshNotifications();

    const bell = document.getElementById('driverNotificationBell');
    const panel = document.getElementById('driverNotificationPanel');
    const wrapper = document.getElementById('driverNotification');
    const list = document.getElementById('driverNotificationList');
    const markRead = document.getElementById('markDriverNotificationsRead');
    if (!bell || !panel || !wrapper || !list || !markRead) return;

    bell.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = panel.hidden;
        panel.hidden = !isOpen;
        bell.setAttribute('aria-expanded', String(isOpen));
    });
    markRead.addEventListener('click', e => {
        e.stopPropagation();
        markNotificationsRead(null);
    });
    list.addEventListener('click', e => {
        const item = e.target.closest('[data-driver-notification-id]');
        if (!item) return;
        markNotificationsRead(item.getAttribute('data-driver-notification-id'));
    });
    document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) {
            panel.hidden = true;
            bell.setAttribute('aria-expanded', 'false');
        }
    });
}

// ------------------------------------------------------------
// Rendering & refresh orchestration
// ------------------------------------------------------------
function renderAll() {
    populateDashboard();
    populateBalance();
    populateVehicle();
    renderPaymentHistory();
    renderLoadHistory();
}

function flashBalance(direction) {
    ['heroBalance', 'statBalance', 'balanceAmount'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('balance-flash-up', 'balance-flash-down');
        void el.offsetWidth;
        el.classList.add(direction > 0 ? 'balance-flash-up' : 'balance-flash-down');
    });
}

async function refreshDriverPayments(force = false) {
    if (driverPaymentRefreshInProgress || !currentDriver) return;
    driverPaymentRefreshInProgress = true;
    try {
        const before = currentBalance;
        const beforeRef = lastTransactionRef;
        const data = await loadDriverBalance();
        if (!data) return;
        const latestRef = data.lastTransaction ? data.lastTransaction.referenceNumber : null;
        const changed = force || latestRef !== beforeRef || Math.abs(currentBalance - before) > 0.001;
        if (!changed) return;

        await Promise.all([loadWalletHistory(), refreshNotifications()]);
        renderAll();

        if (!force && data.lastTransaction && latestRef !== beforeRef) {
            const t = data.lastTransaction;
            if (t.type === 'LOAD') {
                showToast(`${formatCurrency(t.amount)} was loaded to your wallet. New balance: ${formatCurrency(t.balanceAfter)}`, 'success');
                logDriverActivity('Wallet loaded ' + formatCurrency(t.amount), 'fa-wallet', 'log-payment');
            } else {
                showToast(`Terminal fee ${formatCurrency(t.amount)} deducted. Remaining: ${formatCurrency(t.balanceAfter)}`, 'warning');
                logDriverActivity('Fee paid ' + formatCurrency(t.amount), 'fa-receipt', 'log-payment');
            }
            flashBalance(currentBalance - before);
        }
    } catch (e) {
        console.error('Live refresh failed:', e);
        setSyncIndicator('error');
    } finally {
        driverPaymentRefreshInProgress = false;
    }
}

function startDriverPaymentPolling() {
    stopDriverPaymentPolling();
    driverPaymentPollingTimer = setInterval(() => refreshDriverPayments(false), POLL_MS);
}

function stopDriverPaymentPolling() {
    if (driverPaymentPollingTimer) clearInterval(driverPaymentPollingTimer);
    driverPaymentPollingTimer = null;
}

async function refreshDriverDashboardOnResume() {
    if (!currentDriver || dashboardResumeRefreshInProgress || document.hidden) return;
    dashboardResumeRefreshInProgress = true;
    stopDriverPaymentPolling();
    setSyncIndicator('warning');

    try {
        const session = await window.api('session.php', { allow401: true });
        if (!session.success) {
            if (session.status === 401) window.location.replace('login.html?expired=1');
            else setSyncIndicator('error');
            return;
        }

        const user = session.data?.user;
        if (!user) {
            window.location.replace('login.html?expired=1');
            return;
        }
        if (user.role !== 'driver') {
            window.location.replace(window.landingPageFor(user.role));
            return;
        }

        window.CURRENT_USER = user;
        const driver = await loadDriverProfile();
        if (!driver) {
            setSyncIndicator('error');
            showToast('Could not refresh your driver profile. Check your connection and try again.', 'error');
            return;
        }

        currentDriver = driver;
        await Promise.all([
            loadDriverBalance(),
            loadWalletHistory().catch(e => console.warn('history refresh failed:', e)),
            refreshNotifications()
        ]);

        renderAll();
        generateQR();
        populateQRPage();
        populateProfile();
        renderActivities();
        updateLastUpdated();
    } catch (e) {
        console.error('Dashboard resume refresh failed:', e);
        setSyncIndicator('error');
    } finally {
        dashboardResumeRefreshInProgress = false;
        if (currentDriver && !document.hidden) startDriverPaymentPolling();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopDriverPaymentPolling();
    } else {
        refreshDriverDashboardOnResume();
    }
});
window.addEventListener('focus', refreshDriverDashboardOnResume);
window.addEventListener('pageshow', refreshDriverDashboardOnResume);

// ------------------------------------------------------------
// Local activity log
// ------------------------------------------------------------
function getActivityLog(driverId) {
    return safeStorage(() => JSON.parse(localStorage.getItem('borongan_driver_activity_' + driverId) || '[]'), []);
}
function saveActivityLog(driverId, log) {
    safeStorage(() => localStorage.setItem('borongan_driver_activity_' + driverId, JSON.stringify(log)));
}
function logDriverActivity(action, icon = 'fa-info-circle', logClass = 'log-login') {
    if (!currentDriver) return;
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let log = getActivityLog(currentDriver.driverId);
    log.unshift({ action, time: timeStr, timestamp: now.toISOString(), icon, logClass });
    if (log.length > 200) log = log.slice(0, 200);
    saveActivityLog(currentDriver.driverId, log);
    renderActivities();
}
function renderActivities() {
    const container = document.getElementById('recentActivities');
    if (!container) return;
    if (!currentDriver) { container.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm">No recent activities</div>'; return; }
    const log = getActivityLog(currentDriver.driverId);
    if (!log || !log.length) {
        container.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm">No recent activities</div>';
        return;
    }
    container.innerHTML = log.slice(0, 10).map(l => `
        <div class="activity-log-item ${l.logClass || 'log-login'}">
            <div class="log-left">
                <span class="log-icon"></span>
                <span class="log-action">${escapeHtml(l.action)}</span>
            </div>
            <span class="log-time">${escapeHtml(l.time)}</span>
        </div>
    `).join('');
}

// ------------------------------------------------------------
// Stations map
// ------------------------------------------------------------
let driverStationsMapInstance = null;
let driverStationMarkers = {};

async function initDriverStationsMap(forceRefresh = false) {
    const mapEl = document.getElementById('driverStationsMap');
    if (!mapEl || typeof L === 'undefined') return;

    if (!driverStationsMapInstance) {
        driverStationsMapInstance = L.map('driverStationsMap', {
            center: [11.6080, 125.4316],
            zoom: 11,
            zoomControl: true,
            scrollWheelZoom: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Borongan BCTT'
        }).addTo(driverStationsMapInstance);
    }

    try {
        const res = await window.api('terminals.php');
        const list = (res && res.success && res.data && res.data.terminals) ? res.data.terminals : [];
        if (!list.length) return;

        Object.values(driverStationMarkers).forEach(m => driverStationsMapInstance.removeLayer(m));
        driverStationMarkers = {};

        const markersGroup = [];
        const gridEl = document.getElementById('driverStationsList');
        let html = '';

        list.forEach(t => {
            const isReceiving = (t.code || '').startsWith('RS');
            const badgeBg = isReceiving ? '#ecfdf5' : '#fef2f2';
            const badgeColor = isReceiving ? '#059669' : '#b22234';
            const pinBg = isReceiving ? '#059669' : '#b22234';
            const typeLabel = isReceiving ? 'Checkpoint' : 'Ticketing Station';

            const iconHtml = `<div style="width:36px;height:36px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.25);border:2px solid #fff;"><i class="fas ${isReceiving ? 'fa-clipboard-check' : 'fa-ticket'}" style="font-size:13px;"></i></div>`;
            const icon = L.divIcon({ html: iconHtml, className: 'driver-map-pin', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] });
            const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(driverStationsMapInstance);

            const popup = `
                <div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:200px;">
                    <span style="font-size:10px;font-weight:800;color:${badgeColor};background:${badgeBg};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span>
                    <h4 style="font-size:13px;font-weight:700;margin:4px 0 4px 0;color:#0f172a;">${escapeHtml(t.name)}</h4>
                    <p style="font-size:11.5px;color:#64748b;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p>
                    <div style="background:#f8fafc;padding:5px 7px;border-radius:6px;font-size:11px;color:#334155;border:1px solid #e2e8f0;">
                        <div><strong>Hours:</strong> ${escapeHtml(t.operating_hours || '5:00 AM - 8:00 PM')}</div>
                        <div style="margin-top:2px;"><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'Borongan City')}</div>
                    </div>
                </div>
            `;
            marker.bindPopup(popup);
            driverStationMarkers[t.code] = marker;
            markersGroup.push(marker);

            html += `
                <div class="driver-station-card p-3 rounded-xl border border-gray-200 bg-white hover:border-primary transition cursor-pointer flex flex-col justify-between"
                     data-code="${escapeHtml(t.code)}"
                     onclick="focusDriverStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})">
                    <div>
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded" style="background:${badgeBg};color:${badgeColor}">${escapeHtml(t.code)}</span>
                            <span class="text-[10px] font-bold text-gray-500 uppercase">${typeLabel}</span>
                        </div>
                        <h5 class="font-bold text-xs text-gray-900 leading-snug mb-1">${escapeHtml(t.name)}</h5>
                        <p class="text-[11px] text-gray-500 mb-1.5"><i class="fas fa-location-dot text-primary mr-1"></i>${escapeHtml(t.address || 'Borongan City')}</p>
                        <div class="text-[11px] text-gray-600 bg-gray-50 p-1.5 rounded border border-gray-100 mb-2">
                            <i class="fas fa-route text-primary mr-1"></i><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'City Proper')}
                        </div>
                    </div>
                    <div class="flex justify-between items-center text-[11px] text-primary font-bold pt-1.5 border-t border-gray-100">
                        <span><i class="fas fa-location-crosshairs mr-1"></i> View on Map</span>
                        <i class="fas fa-arrow-right text-[10px]"></i>
                    </div>
                </div>
            `;
        });

        if (gridEl) gridEl.innerHTML = html;

        if (markersGroup.length > 0) {
            const group = new L.featureGroup(markersGroup);
            driverStationsMapInstance.fitBounds(group.getBounds().pad(0.12));
        }

        if (forceRefresh && typeof showToast === 'function') {
            showToast('Stations & checkpoints updated', 'success');
        }
    } catch (e) {
        console.warn('Could not load stations:', e);
    }
}
window.initDriverStationsMap = initDriverStationsMap;

function focusDriverStation(code, lat, lng) {
    if (driverStationsMapInstance && lat && lng) {
        driverStationsMapInstance.flyTo([lat, lng], 16, { duration: 1.2 });
        if (driverStationMarkers[code]) {
            setTimeout(() => driverStationMarkers[code].openPopup(), 400);
        }
    }
}
window.focusDriverStation = focusDriverStation;

// ------------------------------------------------------------
// Navigation
// ------------------------------------------------------------
function navigateTo(page) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');
    document.querySelectorAll('.sidebar-item[data-page]').forEach(i => {
        i.classList.toggle('active', i.dataset.page === page);
    });
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');

    if (page === 'qr') { logDriverActivity('Viewed Driver ID', 'fa-id-card', 'log-qr'); populateQRPage(); generateQR(); }
    if (page === 'myqr') { logDriverActivity('Viewed QR Code', 'fa-qrcode', 'log-qr'); generateQR(); }
    if (page === 'payments') { logDriverActivity('Viewed Transactions', 'fa-receipt', 'log-payment'); renderPaymentHistory(); }
    if (page === 'profile') { logDriverActivity('Viewed Profile', 'fa-user', 'log-profile'); populateProfile(); }
    if (page === 'vehicle') populateVehicle();
    if (page === 'balance') { logDriverActivity('Viewed Balance', 'fa-wallet', 'log-payment'); populateBalance(); }
    if (page === 'loadhistory') renderLoadHistory();
    if (page === 'notifications') renderFullNotifications();
    if (page === 'stations') {
        logDriverActivity('Viewed Station Map', 'fa-map-location-dot', 'log-qr');
        initDriverStationsMap();
        setTimeout(() => {
            if (driverStationsMapInstance) driverStationsMapInstance.invalidateSize();
        }, 150);
    }
}
window.navigateTo = navigateTo;

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
async function initDriverDashboard() {
    const driver = await loadDriverProfile();
    if (!driver) {
        showToast('Your driver profile could not be loaded. Please log in again or contact the BCTT office.', 'error');
        setTimeout(() => window.logoutAndRedirect(), 3000);
        return;
    }
    currentDriver = driver;

    await Promise.all([
        loadDriverBalance(),
        loadWalletHistory().catch(e => console.warn('history failed:', e))
    ]);

    renderAll();
    generateQR();
    populateQRPage();
    populateProfile();
    populateVehicle();
    populateBalance();

    updateLastUpdated();
    setInterval(updateLastUpdated, 60000);

    logDriverActivity('Opened dashboard', 'fa-sign-in-alt', 'log-login');
    renderActivities();

    await initDriverNotifications();
    startDriverPaymentPolling();

    const fromHash = (location.hash || '').replace('#', '');
    if (fromHash && document.getElementById('page-' + fromHash)) navigateTo(fromHash);
}

function updateLastUpdated() {
    const el = document.getElementById('lastUpdatedTime');
    if (el) el.textContent = new Date().toLocaleTimeString();
}

window.logout = function() {
    const doLogout = () => {
        logDriverActivity('Logged out', 'fa-sign-out-alt', 'log-logout');
        stopDriverPaymentPolling();
        window.logoutAndRedirect();
    };
    ConfirmModal.show({
        title: "Log out?",
        message: "Are you sure you want to log out of the driver dashboard?",
        confirmText: "Yes, log out",
        cancelText: "Cancel",
        onConfirm: doLogout
    });
};

window.setNotifFilter = function(type) {
    notificationFilter = type;
    document.querySelectorAll('.notif-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.filter === type);
    });
    renderFullNotifications();
};

window.authReady.then(() => {
    initDriverDashboard();
    document.querySelectorAll('.sidebar-item[data-page]').forEach(i => {
        i.addEventListener('click', function() { navigateTo(this.dataset.page); });
    });
    document.getElementById('mobileToggle')?.addEventListener('click', function() {
        document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('paymentSearch')?.addEventListener('input', renderPaymentHistory);
    document.getElementById('paymentFilter')?.addEventListener('change', renderPaymentHistory);
    document.getElementById('refreshBalanceBtn')?.addEventListener('click', async () => {
        await refreshDriverPayments(true);
        showToast('Balance updated: ' + formatCurrency(currentBalance), 'success');
    });
});