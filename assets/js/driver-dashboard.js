const LOW_BALANCE_THRESHOLD = 50;
const POLL_MS = 5000;

let currentDriver = null;
let driverTransactions = [];
let driverNotifications = [];
let driverInquiries = [];
let loadHistory = [];
let currentBalance = 0;
let currentFee = 0;
let lastLoadInfo = null;
let lastTransactionRef = null;
let driverPaymentPollingTimer = null;
let driverPaymentRefreshInProgress = false;
let dashboardResumeRefreshInProgress = false;
let lastSyncTime = null;
let notificationFilter = 'all';
let feesChart = null;
let walletDonut = null;

let __myReqState = { list: [], filter: '', search: '', loading: false };

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-triangle-exclamation' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></span><span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close" aria-label="Close"><i class="fas fa-times"></i></button>`;
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
}

function formatCurrency(amount) {
    const num = Number(amount || 0);
    return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatCurrencyShort(amount) {
    const n = Number(amount || 0);
    if (n >= 1000) return '₱' + (n / 1000).toFixed(1) + 'k';
    return '₱' + n.toFixed(0);
}
function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function formatDateShort(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function localDateKey(d = new Date()) { return d.toLocaleDateString('en-CA'); }
function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
}
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
function getFee() { return currentFee; }

async function apiGet(endpoint, query = {}) {
    const res = await window.api(endpoint, { query });
    if (!res.success) throw new Error(res.message || `HTTP ${res.status}`);
    return res.data || {};
}
function safeStorage(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

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
        plateType: d.plateType || '',
        bodyNumber: d.bodyNumber || '',
        licenseNo: d.licenseNo || '',
        licenseType: d.licenseType || '',
        licenseExpiration: d.licenseExpiration || '',
        driverClassification: d.driverClassification || d.driver_classification || 'Regular',
        emergencyName: d.emergencyContactName || d.emergency_contact_name || '',
        emergencyRelation: d.emergencyContactRelation || d.emergency_contact_relation || '',
        emergencyNumber: d.emergencyContactNumber || d.emergency_contact_number || '',
        photo: d.photo || '',
        status: d.status || 'Active',
        registrationDate: d.registrationDate || d.createdAt || '',
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
        if (data.lastLoad) lastLoadInfo = data.lastLoad;
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
        processedBy: t.processedBy || 'Authorized Terminal Staff'
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
            rawType: n.type,
            title: n.title || '',
            message: n.message || '',
            timestamp: n.createdAt || new Date().toISOString(),
            referenceId: n.referenceId || n.reference_id || null,
            read: !!n.read
        }));
    } catch (e) {
        console.warn('driver_notifications.php failed:', e);
        return null;
    }
}

async function loadDriverInquiries() {
    try {
        const data = await apiGet('inquiries.php');
        return Array.isArray(data.inquiries) ? data.inquiries : [];
    } catch (e) {
        console.error('inquiries.php (driver) failed:', e);
        return null;
    }
}

function notificationKind(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'WALLET_LOAD') return 'load';
    if (t === 'TRANSPORT_FEE' || t === 'FEE') return 'payment';
    if (t === 'ACCOUNT_UPDATE') return 'account';
    if (t === 'FAILED_TRANSACTION' || t === 'INSUFFICIENT_BALANCE') return 'failed';
    if (t.includes('LOW')) return 'low';
    return 'payment';
}

function setSyncIndicator(state) {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    el.className = 'sync-indicator';
    if (state === 'ok') {
        lastSyncTime = new Date();
        el.innerHTML = '<span class="dot"></span> Live';
    } else if (state === 'warning') {
        el.className = 'sync-indicator warning';
        el.innerHTML = '<span class="dot"></span> Syncing…';
    } else if (state === 'error') {
        el.className = 'sync-indicator error';
        el.innerHTML = '<span class="dot"></span> Offline';
    }
}

function updateTopbarDateTime() {
    const el = document.getElementById('topbarDateTime');
    if (!el) return;
    const now = new Date();
    const datePart = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    el.textContent = `${datePart}, ${timePart}`;
}

function populateDashboard() {
    const d = currentDriver;
    if (!d) return;

    setText('welcomeHeading', `Welcome, ${d.fullName || 'Driver'}`);
    setText('userNameChip', d.fullName ? d.fullName.split(' ')[0] : 'Driver');

    const avatarChip = document.getElementById('userAvatarChip');
    if (avatarChip) {
        if (d.photo) avatarChip.innerHTML = `<img src="${d.photo}" alt="Driver">`;
        else avatarChip.textContent = (d.fullName || 'D').charAt(0).toUpperCase();
    }

    setText('kpiBalance', formatCurrency(currentBalance));
    setText('kpiVehicleStatus', (d.status || 'Active').toUpperCase());
    setText('kpiVehiclePlate', d.plateNumber || '—');
    setText('kpiAccountStatus', d.status || '—');

    const today = localDateKey();
    const todayTrans = driverTransactions.filter(t => (t.date || '').startsWith(today));
    const todayTotal = todayTrans.reduce((s, t) => s + t.amount, 0);

    setText('kpiTodayTrips', todayTrans.length);
    setText('kpiTodayFees', formatCurrency(todayTotal));

    setText('kpiBalanceDelta', currentBalance > 0 ? 'Prepaid wallet balance' : 'No balance yet');
    const tripsDelta = document.getElementById('kpiTodayTripsDelta');
    if (tripsDelta) {
        if (todayTrans.length > 0) {
            tripsDelta.textContent = `↑ ${todayTrans.length} today`;
            tripsDelta.className = 'kpi-delta positive';
        } else {
            tripsDelta.textContent = 'No activity today';
            tripsDelta.className = 'kpi-delta';
        }
    }
    const feesDelta = document.getElementById('kpiTodayFeesDelta');
    if (feesDelta) {
        if (todayTotal > 0) {
            feesDelta.textContent = `↑ ${formatCurrency(todayTotal)}`;
            feesDelta.className = 'kpi-delta negative';
        } else {
            feesDelta.textContent = 'No fees today';
            feesDelta.className = 'kpi-delta';
        }
    }

    setText('qrDriverName', d.fullName || '--');
    setText('qrPageVehicle', d.vehicleType || '--');
    setText('qrPagePlate', d.plateNumber || '--');
    setText('qrFee', formatCurrency(currentFee || getFee(d.vehicleType)));
    setText('qrPageDriverId', d.driverId || '--');
    setText('qrPageBodyNumber', d.bodyNumber || '--');

    checkBalanceNotifications();
    renderFeesChart();
    renderWalletDonut();
}

function checkBalanceNotifications() {
    const banner = document.getElementById('notificationBanner');
    if (!banner) return;
    const fee = currentFee;

    if (currentBalance < fee && currentBalance >= 0) {
        banner.innerHTML = `
            <div class="inline-note inline-note-warn">
                <i class="fas fa-exclamation-triangle" style="color:var(--red);"></i>
                <div>
                    <strong>Insufficient Balance.</strong> Current Balance: ${formatCurrency(currentBalance)} · Required Fee: ${formatCurrency(fee)}.
                    Please load your account through the authorized cashier.
                </div>
            </div>`;
    } else if (currentBalance > 0 && currentBalance <= LOW_BALANCE_THRESHOLD) {
        banner.innerHTML = `
            <div class="inline-note inline-note-warn">
                <i class="fas fa-exclamation-circle"></i>
                <div>
                    <strong>Low Balance.</strong> Your current balance is ${formatCurrency(currentBalance)}.
                    Please visit the authorized cashier to load money into your account.
                </div>
            </div>`;
    } else {
        banner.innerHTML = '';
    }
}

function renderFeesChart() {
    const canvas = document.getElementById('feesChart');
    if (!canvas || typeof Chart === 'undefined') return;

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

    const rangeLabel = document.getElementById('chartRangeLabel');
    if (rangeLabel) {
        const first = last7[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const last = last7[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        rangeLabel.textContent = `${first} – ${last}`;
    }

    const ctx = canvas.getContext('2d');
    if (feesChart) feesChart.destroy();

    feesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: last7.map(l => l.day),
            datasets: [{
                label: 'Fees Paid',
                data: last7.map(l => l.total),
                backgroundColor: '#8B1D2C',
                hoverBackgroundColor: '#6B1520',
                borderRadius: 6,
                borderSkipped: false,
                maxBarThickness: 42
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1F2937',
                    padding: 10,
                    titleFont: { size: 12, weight: '700' },
                    bodyFont: { size: 12 },
                    callbacks: { label: (ctx) => formatCurrency(ctx.parsed.y) }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { font: { size: 11 }, color: '#9CA3AF', callback: (v) => formatCurrencyShort(v) },
                    grid: { color: '#F1F5F9', drawBorder: false }
                },
                x: {
                    ticks: { font: { size: 11, weight: '600' }, color: '#6B7280' },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderWalletDonut() {
    const canvas = document.getElementById('walletDonut');
    if (!canvas || typeof Chart === 'undefined') return;

    const byVehicle = {};
    driverTransactions.forEach(t => {
        const key = t.vehicleType || 'Other';
        byVehicle[key] = (byVehicle[key] || 0) + t.amount;
    });
    const entries = Object.entries(byVehicle);
    const palette = ['#8B1D2C', '#2563EB', '#EA580C', '#16A34A', '#7C3AED', '#0D9488'];

    let labels, data, colors;
    if (entries.length === 0) {
        labels = ['Current Balance', 'No fees yet'];
        data = [Math.max(currentBalance, 0.01), 0.01];
        colors = ['#16A34A', '#E5E7EB'];
    } else {
        labels = entries.map(([k]) => k);
        data = entries.map(([, v]) => v);
        colors = palette.slice(0, labels.length);
    }

    const ctx = canvas.getContext('2d');
    if (walletDonut) walletDonut.destroy();

    walletDonut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1F2937',
                    padding: 10,
                    callbacks: {
                        label: (ctx) => {
                            const v = Number(ctx.parsed) || 0;
                            const total = (ctx.dataset.data || []).reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                            return `${ctx.label}: ${formatCurrency(v)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    const legend = document.getElementById('donutLegend');
    if (legend) {
        const total = data.reduce((a, b) => a + b, 0);
        legend.innerHTML = labels.map((lbl, i) => {
            const v = data[i];
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
            return `
                <div class="lg-row">
                    <span class="lg-dot" style="background:${colors[i]}"></span>
                    <span class="lg-label">${escapeHtml(lbl)}</span>
                    <span class="lg-value">${pct}%</span>
                </div>`;
        }).join('');
    }
}

function getActivityLog(driverId) {
    return safeStorage(() => JSON.parse(localStorage.getItem('borongan_driver_activity_' + driverId) || '[]'), []);
}
function saveActivityLog(driverId, log) {
    safeStorage(() => localStorage.setItem('borongan_driver_activity_' + driverId, JSON.stringify(log)));
}
function logDriverActivity(action, icon = 'fa-info-circle') {
    if (!currentDriver) return;
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let log = getActivityLog(currentDriver.driverId);
    log.unshift({ action, time: timeStr, icon });
    if (log.length > 200) log = log.slice(0, 200);
    saveActivityLog(currentDriver.driverId, log);
    renderActivities();
}
function renderActivities() {
    const container = document.getElementById('recentActivities');
    if (!container) return;
    if (!currentDriver) { container.innerHTML = '<div class="empty-inline">No recent activity</div>'; return; }
    const log = getActivityLog(currentDriver.driverId);
    if (!log || !log.length) {
        container.innerHTML = '<div class="empty-inline">No recent activity</div>';
        return;
    }
    container.innerHTML = log.slice(0, 8).map(l => `
        <div class="activity-item">
            <div class="act-left">
                <i class="fas ${escapeHtml(l.icon || 'fa-info-circle')} act-icon"></i>
                <span class="act-text">${escapeHtml(l.action)}</span>
            </div>
            <span class="act-time">${escapeHtml(l.time)}</span>
        </div>
    `).join('');
}

function inquiryReadKey(id) { return 'bctt_driver_inquiry_read_' + id; }
function isInquiryReadLocally(id) {
    return safeStorage(() => localStorage.getItem(inquiryReadKey(id)) === '1', false);
}
function markInquiryReadLocally(id) {
    safeStorage(() => localStorage.setItem(inquiryReadKey(id), '1'));
}

function cleanSubject(subject) {
    if (!subject) return 'Request';
    return String(subject)
        .replace(/^\[(PERSONAL UPDATE|VEHICLE UPDATE)\]\s*/i, '')
        .trim() || 'Request';
}

function stripInternalFooter(message) {
    if (!message) return '';
    const idx = message.search(/\n?─────\n/);
    return idx >= 0 ? message.slice(0, idx).trim() : message.trim();
}

function inferKind(inq) {
    const s = (inq.subject || '').toLowerCase();
    if (s.includes('vehicle')) return 'vehicle';
    if (s.includes('personal') || s.includes('emergency') || s.includes('contact')) return 'personal';
    return 'general';
}

function deriveStatus(inq) {
    const raw = String(inq.status || 'new').toLowerCase();
    const hasReply = !!inq.reply;
    if (raw === 'resolved') return 'resolved';
    if (raw === 'replied' || hasReply) return 'replied';
    return 'pending';
}

function statusMeta(status) {
    return {
        pending:  { pill: 'pending',  label: 'Awaiting Response', icon: 'fa-hourglass-half' },
        replied:  { pill: 'replied',  label: 'Replied',           icon: 'fa-reply' },
        resolved: { pill: 'resolved', label: 'Resolved',          icon: 'fa-circle-check' }
    }[status] || { pill: 'pending', label: 'Pending', icon: 'fa-clock' };
}

function kindMeta(kind) {
    return {
        personal: { icon: 'fa-user-pen',        label: 'Personal Info',  cls: '' },
        vehicle:  { icon: 'fa-car-side',        label: 'Vehicle Info',   cls: 'vehicle' },
        general:  { icon: 'fa-circle-question', label: 'General',        cls: 'general' }
    }[kind] || { icon: 'fa-circle-info', label: 'Request', cls: '' };
}

function buildTimeline(inq) {
    const steps = [
        { key: 'submitted', label: 'Submitted',    time: inq.receivedAt, icon: 'fa-paper-plane' },
        { key: 'review',    label: 'Under Review', time: inq.readAt,     icon: 'fa-magnifying-glass' },
        { key: 'replied',   label: 'Replied',      time: inq.repliedAt,  icon: 'fa-reply' },
        { key: 'resolved',  label: 'Resolved',     time: inq.resolvedAt, icon: 'fa-circle-check' }
    ];
    return steps.map((s, i) => {
        const isDone = !!s.time;
        return `
            <div class="inq-step ${isDone ? 'done' : ''}">
                <div class="inq-step__dot"><i class="fas ${s.icon}"></i></div>
                <div>
                    <div class="inq-step__label">${escapeHtml(s.label)}</div>
                    ${s.time ? `<div class="inq-step__time">${escapeHtml(formatNotifTimeShort(s.time))}</div>` : ''}
                </div>
            </div>
            ${i < steps.length - 1 ? `<div class="inq-step__bar ${isDone ? 'done' : ''}"></div>` : ''}
        `;
    }).join('');
}

function renderDriverInquiries(list) {
    const container = document.getElementById('driverInquiryList');
    const badge = document.getElementById('driverInquiryBadge');
    if (!container) return;

    if (list === null) {
        container.innerHTML = `
            <div class="inq-error">
                <i class="fas fa-triangle-exclamation"></i>
                <strong>Could not load your requests</strong>
                <div style="margin-top:.35rem;font-size:.8rem;">Please check your connection and try again.</div>
                <button class="btn-outline btn-sm" onclick="refreshDriverInquiries()">
                    <i class="fas fa-sync"></i> Retry
                </button>
            </div>`;
        if (badge) badge.hidden = true;
        return;
    }

    __myReqState.list = list;
    driverInquiries = list;

    const unread = list.filter(i => deriveStatus(i) === 'replied' && !isInquiryReadLocally(i.id)).length;
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.hidden = unread === 0;
    }

    const total    = list.length;
    const pending  = list.filter(i => deriveStatus(i) === 'pending').length;
    const replied  = list.filter(i => deriveStatus(i) === 'replied').length;
    const resolved = list.filter(i => deriveStatus(i) === 'resolved').length;
    setText('inqCountTotal', total);
    setText('inqCountPending', pending);
    setText('inqCountReplied', replied);
    setText('inqCountResolved', resolved);

    document.querySelectorAll('.inq-summary-tile').forEach(t => {
        t.classList.toggle('is-active', (t.dataset.filter || '') === (__myReqState.filter || ''));
    });

    let filtered = list.slice();
    filtered.sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));

    if (__myReqState.filter) {
        filtered = filtered.filter(i => deriveStatus(i) === __myReqState.filter);
    }
    if (__myReqState.search) {
        const q = __myReqState.search.toLowerCase();
        filtered = filtered.filter(i =>
            (i.subject || '').toLowerCase().includes(q) ||
            (i.message || '').toLowerCase().includes(q) ||
            (i.reply || '').toLowerCase().includes(q));
    }

    if (!filtered.length) {
        const isFiltered = __myReqState.filter || __myReqState.search;
        container.innerHTML = `
            <div class="inq-empty">
                <div class="inq-empty__icon"><i class="fas fa-inbox"></i></div>
                <div class="inq-empty__title">${isFiltered ? 'No matching requests' : 'No requests yet'}</div>
                <div class="inq-empty__text">
                    ${isFiltered
                        ? 'Try clearing the filters or search terms.'
                        : 'You haven\'t submitted any requests. Use the button below to send one to the office.'}
                </div>
                ${isFiltered
                    ? `<button class="btn-outline btn-sm" onclick="clearInquiryFilters()"><i class="fas fa-times"></i> Clear Filters</button>`
                    : `<button class="btn-primary btn-sm" onclick="openNewInquiryModal()"><i class="fas fa-plus"></i> New Request</button>`}
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(inq => {
        const derived = deriveStatus(inq);
        const meta = statusMeta(derived);
        const kind = inferKind(inq);
        const kindInfo = kindMeta(kind);
        const subject = cleanSubject(inq.subject);
        const body = stripInternalFooter(inq.message || '');
        const isUnread = derived === 'replied' && !isInquiryReadLocally(inq.id);
        const hasReply = !!inq.reply;

        return `
            <article class="inq-driver-card ${isUnread ? 'is-unread' : ''}" data-inq-id="${escapeHtml(inq.id)}">
                <div class="inq-driver-card__head">
                    <div class="inq-driver-card__title-block">
                        <span class="inq-driver-card__kind ${kindInfo.cls}">
                            <i class="fas ${kindInfo.icon}"></i> ${escapeHtml(kindInfo.label)}
                        </span>
                        <div class="inq-driver-card__subject">${escapeHtml(subject)}</div>
                        <div class="inq-driver-card__meta">
                            <span><i class="far fa-clock"></i> Submitted ${escapeHtml(formatNotifTimeShort(inq.receivedAt))}</span>
                            ${inq.repliedAt ? `<span><i class="fas fa-reply"></i> Replied ${escapeHtml(formatNotifTimeShort(inq.repliedAt))}</span>` : ''}
                        </div>
                    </div>
                    <span class="inq-pill ${meta.pill}">
                        <i class="fas ${meta.icon}"></i> ${escapeHtml(meta.label)}
                    </span>
                </div>

                <div class="inq-timeline">${buildTimeline(inq)}</div>

                <div class="inq-driver-card__msg">${escapeHtml(body)}</div>

                ${hasReply ? `
                    <div class="inq-driver-card__reply">
                        <div class="inq-driver-card__reply-label">
                            <i class="fas fa-reply"></i> Response from the Office
                        </div>
                        <div class="inq-driver-card__reply-text">${escapeHtml(inq.reply)}</div>
                        ${inq.repliedAt ? `
                            <div class="inq-driver-card__reply-time">
                                <i class="far fa-clock"></i> ${escapeHtml(formatNotifTime(inq.repliedAt))}
                            </div>` : ''}
                    </div>
                ` : `
                    <div class="inq-driver-card__waiting">
                        <i class="fas fa-hourglass-half"></i>
                        <div class="inq-driver-card__waiting-body">
                            <div class="inq-driver-card__waiting-title">Awaiting response</div>
                            <div class="inq-driver-card__waiting-text">
                                The office has received your request. You will see their reply here once it's ready.
                            </div>
                        </div>
                    </div>
                `}
            </article>`;
    }).join('');

    filtered.forEach(i => {
        if (deriveStatus(i) === 'replied') markInquiryReadLocally(i.id);
    });
    if (badge) {
        const stillUnread = __myReqState.list.filter(i =>
            deriveStatus(i) === 'replied' && !isInquiryReadLocally(i.id)).length;
        badge.textContent = stillUnread > 99 ? '99+' : String(stillUnread);
        badge.hidden = stillUnread === 0;
    }
}

async function refreshDriverInquiries(showSuccess = false) {
    const container = document.getElementById('driverInquiryList');
    if (container) {
        container.innerHTML = `
            <div class="inq-skeleton-list">
                <div class="inq-skeleton"></div>
                <div class="inq-skeleton"></div>
            </div>`;
    }
    const list = await loadDriverInquiries();
    renderDriverInquiries(list);
    if (showSuccess && list) showToast('Requests refreshed.', 'success');
}
window.refreshDriverInquiries = refreshDriverInquiries;

function clearInquiryFilters() {
    __myReqState.filter = '';
    __myReqState.search = '';
    const searchInput = document.getElementById('inquirySearchInput');
    const statusFilter = document.getElementById('inquiryStatusFilter');
    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = '';
    renderDriverInquiries(__myReqState.list);
}
window.clearInquiryFilters = clearInquiryFilters;

function openNewInquiryModal(preselectKind) {
    const modal = document.getElementById('newInquiryModal');
    if (!modal) return;

    const form = document.getElementById('newInquiryForm');
    if (form) form.reset();
    document.getElementById('inqKind').value = '';
    document.querySelectorAll('.inq-kind-btn').forEach(b => b.classList.remove('is-selected'));
    document.getElementById('inqCharCount').textContent = '0 / 1000';
    const msg = document.getElementById('newInquiryMsg');
    if (msg) { msg.textContent = ''; msg.className = 'account-msg'; }

    const submitBtn = document.getElementById('submitInquiryBtn');
    if (submitBtn) submitBtn.disabled = true;

    modal.hidden = false;

    if (preselectKind) {
        setTimeout(() => {
            const btn = document.querySelector(`.inq-kind-btn[data-kind="${preselectKind}"]`);
            if (btn) btn.click();
        }, 100);
    } else {
        setTimeout(() => document.querySelector('.inq-kind-btn')?.focus(), 120);
    }
}
window.openNewInquiryModal = openNewInquiryModal;

function closeNewInquiryModal() {
    const modal = document.getElementById('newInquiryModal');
    if (modal) modal.hidden = true;
}
window.closeNewInquiryModal = closeNewInquiryModal;

function __validateComposeForm() {
    const kind = document.getElementById('inqKind').value;
    const subject = document.getElementById('inqSubject').value.trim();
    const message = document.getElementById('inqMessage').value.trim();
    const btn = document.getElementById('submitInquiryBtn');
    const valid = !!kind && subject.length >= 3 && message.length >= 10;
    if (btn) btn.disabled = !valid;
}

async function submitNewInquiry() {
    const kind = document.getElementById('inqKind').value;
    const subject = document.getElementById('inqSubject').value.trim();
    const message = document.getElementById('inqMessage').value.trim();
    const msgEl = document.getElementById('newInquiryMsg');
    const btn = document.getElementById('submitInquiryBtn');

    if (!kind) { msgEl.textContent = 'Please choose a request type.'; msgEl.className = 'account-msg error'; return; }
    if (subject.length < 3) { msgEl.textContent = 'Subject must be at least 3 characters.'; msgEl.className = 'account-msg error'; return; }
    if (message.length < 10) { msgEl.textContent = 'Please describe your request (at least 10 characters).'; msgEl.className = 'account-msg error'; return; }

    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

    try {
        const res = await window.api('inquiries.php', {
            method: 'POST',
            body: { kind, subject, message }
        });

        if (!res.success) {
            msgEl.textContent = res.message || 'Request could not be submitted.';
            msgEl.className = 'account-msg error';
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            return;
        }

        showToast('Your request was submitted. The office will review it.', 'success');
        logDriverActivity('Submitted request: ' + subject, 'fa-pen-to-square');

        closeNewInquiryModal();
        await refreshDriverInquiries();

        if (!document.getElementById('page-myinquiries')?.classList.contains('active')) {
            navigateTo('myinquiries');
        }
    } catch (err) {
        console.error(err);
        msgEl.textContent = 'Server error. Please try again.';
        msgEl.className = 'account-msg error';
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}
window.submitNewInquiry = submitNewInquiry;

function initMyRequestsModule() {
    document.querySelectorAll('.inq-kind-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.inq-kind-btn').forEach(b => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            document.getElementById('inqKind').value = btn.dataset.kind || '';
            __validateComposeForm();
        });
    });

    document.getElementById('inqSubject')?.addEventListener('input', __validateComposeForm);
    document.getElementById('inqMessage')?.addEventListener('input', () => {
        const len = (document.getElementById('inqMessage').value || '').length;
        document.getElementById('inqCharCount').textContent = `${len} / 1000`;
        __validateComposeForm();
    });

    document.getElementById('submitInquiryBtn')?.addEventListener('click', submitNewInquiry);

    document.querySelectorAll('#newInquiryModal [data-inquiry-close]').forEach(el => {
        el.addEventListener('click', closeNewInquiryModal);
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeNewInquiryModal();
    });

    document.getElementById('inquirySearchInput')?.addEventListener('input', (e) => {
        __myReqState.search = (e.target.value || '').trim();
        renderDriverInquiries(__myReqState.list);
    });

    document.getElementById('inquiryStatusFilter')?.addEventListener('change', (e) => {
        __myReqState.filter = (e.target.value || '').trim();
        renderDriverInquiries(__myReqState.list);
    });

    document.querySelectorAll('.inq-summary-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            const filter = tile.dataset.filter || '';
            __myReqState.filter = filter;
            const sel = document.getElementById('inquiryStatusFilter');
            if (sel) sel.value = filter;
            renderDriverInquiries(__myReqState.list);
        });
    });

    document.getElementById('refreshInquiriesBtn')?.addEventListener('click', () => {
        refreshDriverInquiries(true);
    });
}

async function requestInfoUpdate(kind) {
    openNewInquiryModal(kind === 'vehicle' ? 'vehicle' : 'personal');
}
window.requestInfoUpdate = requestInfoUpdate;

function generateQR() {
    const d = currentDriver;
    if (!d) return;
    const qrText = d.qrPayload || JSON.stringify({
        version: 1,
        driverId: String(d.driverId || ''),
        plateNumber: String(d.plateNumber || ''),
        vehicleType: String(d.vehicleType || '')
    });

    const qrFull = document.getElementById('qrCodeFull');
    if (qrFull) {
        qrFull.innerHTML = '';
        try {
            new QRCode(qrFull, {
                text: qrText, width: 160, height: 160,
                colorDark: '#8B1D2C', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch { qrFull.innerHTML = '<div>QR</div>'; }
    }

    const qrPage = document.getElementById('qrCodePage');
    if (qrPage) {
        qrPage.innerHTML = '';
        try {
            new QRCode(qrPage, {
                text: qrText, width: 200, height: 200,
                colorDark: '#8B1D2C', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch { qrPage.innerHTML = '<div>QR</div>'; }
    }
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
function shareQRPage() { shareQRSel('#qrCodePage canvas'); }
function shareQRSel(sel) {
    const canvas = document.querySelector(sel);
    if (!canvas) return showToast('Generate QR first', 'warning');
    canvas.toBlob(blob => {
        if (navigator.share) {
            navigator.share({ title: 'My QR Code', files: [new File([blob], 'qr.png', { type: 'image/png' })] }).catch(() => {});
        } else showToast('Share not supported', 'warning');
    });
}
function downloadQRFull() {
    const card = document.querySelector('.digital-id-card');
    if (!card) return showToast('Generate ID first', 'warning');
    showToast('Generating download…', 'success');
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
    const card = document.querySelector('.digital-id-card');
    if (!card) return showToast('Generate ID first', 'warning');

    const printWin = window.open('', '_blank', 'width=520,height=760');
    if (!printWin) { showToast('Please allow pop-ups to print', 'warning'); return; }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => `<link rel="stylesheet" href="${l.href}">`).join('');

    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Driver ID — ${escapeHtml(currentDriver.driverId || '')}</title>
            ${styles}
            <style>
                body { margin: 0; padding: 24px; background: #fff; font-family: 'Inter', sans-serif; }
                .digital-id-card { margin: 0 auto; box-shadow: none !important; }
                @media print {
                    body { padding: 0; }
                    .digital-id-card { border: 1px solid #000 !important; border-radius: 0 !important; }
                }
            </style>
        </head>
        <body>
            ${card.outerHTML}
            <script>
                window.onload = function () {
                    setTimeout(function () {
                        window.focus();
                        window.print();
                        setTimeout(function(){ window.close(); }, 400);
                    }, 300);
                };
            <\/script>
        </body>
        </html>
    `);
    printWin.document.close();
}

function printQRPage() {
    const canvas = document.querySelector('#qrCodePage canvas');
    if (!canvas) return showToast('Generate QR first', 'warning');

    const qrImgSrc = canvas.toDataURL('image/png');
    const d = currentDriver;

    const printWin = window.open('', '_blank', 'width=520,height=680');
    if (!printWin) { showToast('Please allow pop-ups to print', 'warning'); return; }

    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Driver QR — ${escapeHtml(d.driverId || '')}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: 'Inter', system-ui, sans-serif;
                    background: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    padding: 24px;
                }
                .qr-print-card {
                    width: 400px;
                    padding: 28px 24px;
                    border: 2px solid #8B1D2C;
                    border-radius: 12px;
                    text-align: center;
                    background: #fff;
                }
                .qr-print-org {
                    font-weight: 800;
                    font-size: 11px;
                    letter-spacing: .16em;
                    color: #8B1D2C;
                    text-transform: uppercase;
                    margin-bottom: 6px;
                }
                .qr-print-title {
                    font-weight: 700;
                    font-size: 15px;
                    color: #1F2937;
                    margin-bottom: 14px;
                }
                .qr-print-img {
                    display: inline-block;
                    padding: 8px;
                    background: #fff;
                    border: 1px solid #E5E7EB;
                    border-radius: 8px;
                }
                .qr-print-img img { display: block; width: 200px; height: 200px; }
                .qr-print-name {
                    font-weight: 800;
                    font-size: 14px;
                    color: #1F2937;
                    margin-top: 14px;
                }
                .qr-print-id {
                    font-family: 'Courier New', monospace;
                    color: #6B7280;
                    font-size: 12px;
                    margin-top: 2px;
                }
                .qr-print-vehicle {
                    color: #6B7280;
                    font-size: 11px;
                    margin-top: 3px;
                }
                .qr-print-footer {
                    margin-top: 18px;
                    padding-top: 14px;
                    border-top: 1px dashed #CBD5E1;
                    font-size: 10px;
                    color: #6B7280;
                }
                @media print {
                    body { padding: 0; }
                    .qr-print-card { border: 1px solid #000; border-radius: 0; page-break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="qr-print-card">
                <div class="qr-print-org">Borongan City Transport Terminal</div>
                <div class="qr-print-title">DRIVER QR CODE</div>
                <div class="qr-print-img"><img src="${qrImgSrc}" alt="QR Code"></div>
                <div class="qr-print-name">${escapeHtml(d.fullName || '—')}</div>
                <div class="qr-print-id">${escapeHtml(d.driverId || '—')}</div>
                <div class="qr-print-vehicle">${escapeHtml(d.vehicleType || '—')} · ${escapeHtml(d.bodyNumber || '—')} · ${escapeHtml(d.plateNumber || '—')}</div>
                <div class="qr-print-footer">Present this QR code to the terminal Staff.</div>
            </div>
            <script>
                window.onload = function () {
                    setTimeout(function () {
                        window.focus();
                        window.print();
                        setTimeout(function(){ window.close(); }, 400);
                    }, 300);
                };
            <\/script>
        </body>
        </html>
    `);
    printWin.document.close();
}

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
    setText('displayClassification', d.driverClassification || 'Regular');
    setText('displayAccountStatus', d.status || 'Active');

    const photoLarge = document.getElementById('photoDisplayLarge');
    if (photoLarge) {
        if (d.photo) photoLarge.innerHTML = `<img src="${d.photo}" alt="Driver Photo">`;
        else {
            const initials = (d.fullName || 'Driver').split(' ')
                .filter(n => n.length > 0).map(n => n[0])
                .join('').toUpperCase().slice(0, 2);
            photoLarge.textContent = initials || 'DR';
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
    setText('profileLicenseNo', d.licenseNo || '--');
    setText('profileLicenseType', d.licenseType || '--');
    setText('profileClassification', d.driverClassification || 'Regular');
    setText('profileStatus', d.status || 'Active');
    setText('profileVehicleType', d.vehicleType || '--');
    setText('profileBodyNumber', d.bodyNumber || '--');
    setText('profilePlateNumber', d.plateNumber || '--');
    setText('profileVehicleStatus', d.status || 'Active');

    const badge = document.getElementById('profileClassBadge');
    if (badge) {
        const cls = (d.driverClassification || 'Regular');
        if (cls === 'Regular') { badge.hidden = true; }
        else {
            badge.hidden = false;
            badge.textContent = cls.toUpperCase();
            badge.className = 'tag tag-class' + (cls === 'Senior Citizen' ? ' senior' : cls === 'PWD' ? ' pwd' : '');
        }
    }
}

function populateEmergencyContact() {
    const d = currentDriver;
    if (!d) return;
    setText('emergencyName', d.emergencyName || '—');
    setText('emergencyRelation', d.emergencyRelation || '—');
    setText('emergencyNumber', d.emergencyNumber || '—');
}

function populateAccount() {
    const d = currentDriver;
    if (!d) return;
    setText('acctUsername', d.username || '—');
    setText('acctStatus', d.status || '—');
}

function populateVehicle() {
    const d = currentDriver;
    if (!d) return;
    setText('vehicleType', d.vehicleType || '--');
    setText('vehicleBodyNumber', d.bodyNumber || '--');
    setText('vehiclePlateNumber', d.plateNumber || '--');
    setText('vehiclePlateType', d.plateType || '--');
    setText('vehicleStatus', (d.status || 'ACTIVE').toUpperCase());
    setText('vehicleFee', formatCurrency(currentFee || getFee(d.vehicleType)));
}

function populateBalance() {
    setText('balanceAmount', formatCurrency(currentBalance));
    setText('balanceAccountStatus', currentDriver?.status || 'ACTIVE');
    setText('balanceFeePerTrip', formatCurrency(currentFee || getFee(currentDriver?.vehicleType)));

    if (lastLoadInfo) {
        setText('balanceLastLoad', formatCurrency(lastLoadInfo.amount));
        setText('balanceLastUpdated', formatDate(lastLoadInfo.createdAt));
    } else if (loadHistory[0]) {
        setText('balanceLastLoad', formatCurrency(loadHistory[0].amount));
        setText('balanceLastUpdated', formatDate(loadHistory[0].date));
    } else {
        setText('balanceLastLoad', '--');
        setText('balanceLastUpdated', '--');
    }

    setText('balanceDetailCurrent', formatCurrency(currentBalance));
    const lastFee = driverTransactions[0];
    if (lastFee) {
        setText('balanceDetailLastFee', formatCurrency(lastFee.amount) + ' · ' + formatDate(lastFee.date));
        setText('balanceDetailPrevious', formatCurrency(lastFee.previousBalance));
    } else {
        setText('balanceDetailLastFee', '—');
        setText('balanceDetailPrevious', '—');
    }
    setText('balanceDetailUpdated', new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }));
}

function renderLoadHistory() {
    const table = document.getElementById('loadHistoryTable');
    if (!table) return;
    if (!loadHistory.length) {
        table.innerHTML = '<tr><td colspan="6"><div class="empty-inline">No load history yet</div></td></tr>';
        return;
    }
    table.innerHTML = loadHistory.map(l => `
        <tr>
            <td>${formatDateShort(l.date)}</td>
            <td><span style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(l.id || '')}</span></td>
            <td style="color:var(--green);font-weight:800;">+${formatCurrency(l.amount)}</td>
            <td>${formatCurrency(l.previousBalance)}</td>
            <td style="font-weight:700;">${formatCurrency(l.newBalance)}</td>
            <td><span class="status-badge successful">${escapeHtml(l.status || 'Successful')}</span></td>
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
        table.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No transactions found</div></td></tr>';
        return;
    }

    table.innerHTML = data.map(t => `
        <tr>
            <td>${formatDateShort(t.date)}</td>
            <td>${escapeHtml(t.vehicleType || currentDriver.vehicleType)}</td>
            <td style="color:var(--maroon);font-weight:800;">${formatCurrency(t.amount)}</td>
            <td>${formatCurrency(t.previousBalance)}</td>
            <td style="font-weight:700;">${formatCurrency(t.balanceAfter)}</td>
            <td><span class="status-badge ${(t.status || 'successful').toLowerCase() === 'successful' ? 'successful' : 'failed'}">${escapeHtml(t.status || 'Successful')}</span></td>
            <td>
                <button class="btn-primary btn-sm" onclick="viewTransactionDetail('${t.id}')"><i class="fas fa-eye"></i></button>
                <button class="btn-outline btn-sm" onclick="printTransaction('${t.id}')"><i class="fas fa-print"></i></button>
            </td>
        </tr>
    `).join('');
}

function viewTransactionDetail(id) {
    const t = driverTransactions.find(x => x.id === id);
    if (!t) return showToast('Transaction not found', 'error');
    const modal = document.createElement('div');
    modal.className = 'notif-modal';
    modal.innerHTML = `
        <div class="notif-modal-backdrop" data-close="1"></div>
        <div class="notif-modal-box" role="dialog">
            <div class="notif-modal-header">
                <div class="notif-modal-icon payment"><i class="fas fa-receipt"></i></div>
                <div>
                    <h2>Transaction Details</h2>
                    <p class="notif-modal-time">${escapeHtml(t.id)}</p>
                </div>
                <button class="notif-modal-close" data-close="1"><i class="fas fa-times"></i></button>
            </div>
            <div class="notif-modal-body">
                <div class="notif-detail-row"><span class="notif-detail-label">Driver</span><span class="notif-detail-value">${escapeHtml(currentDriver.fullName)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Driver ID</span><span class="notif-detail-value mono">${escapeHtml(currentDriver.driverId)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Vehicle</span><span class="notif-detail-value">${escapeHtml(t.vehicleType || currentDriver.vehicleType)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Body Number</span><span class="notif-detail-value mono">${escapeHtml(t.bodyNumber || currentDriver.bodyNumber || '--')}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Plate Number</span><span class="notif-detail-value mono">${escapeHtml(t.plateNumber || currentDriver.plateNumber)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Fee</span><span class="notif-detail-value" style="color:var(--maroon);">${formatCurrency(t.amount)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Previous Balance</span><span class="notif-detail-value">${formatCurrency(t.previousBalance)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Balance After</span><span class="notif-detail-value">${formatCurrency(t.balanceAfter)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Status</span><span class="notif-detail-value" style="color:var(--green);">${escapeHtml(t.status || 'SUCCESSFUL')}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Date</span><span class="notif-detail-value">${formatDate(t.date)}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Time</span><span class="notif-detail-value">${escapeHtml(t.time || '--')}</span></div>
                <div class="notif-detail-row"><span class="notif-detail-label">Processed By</span><span class="notif-detail-value">${escapeHtml(t.processedBy || 'Authorized Terminal Staff')}</span></div>
            </div>
            <div class="notif-modal-footer">
                <button class="btn-outline btn-sm" onclick="printTransaction('${t.id}')"><i class="fas fa-print"></i> Print</button>
                <button class="btn-primary btn-sm" data-close="1">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', () => modal.remove());
    });
}

function printTransaction(id) {
    const t = driverTransactions.find(x => x.id === id);
    if (!t) return showToast('Transaction not found', 'error');

    const printWin = window.open('', '_blank', 'width=480,height=720');
    if (!printWin) { showToast('Please allow pop-ups to print', 'warning'); return; }

    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Transaction — ${escapeHtml(t.id)}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: 'Courier New', monospace;
                    background: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    padding: 20px;
                }
                .receipt {
                    width: 340px;
                    padding: 16px;
                    border: 2px dashed #333;
                    border-radius: 8px;
                    font-size: 12px;
                }
                .receipt .r-head {
                    text-align: center;
                    border-bottom: 2px solid #333;
                    padding-bottom: 8px;
                    margin-bottom: 12px;
                }
                .receipt .r-head .org { font-weight: 800; font-size: 12px; }
                .receipt .r-head .kind { font-size: 11px; font-weight: 700; color: #8B1D2C; }
                .receipt .r-row { display: flex; justify-content: space-between; padding: 3px 0; }
                .receipt .r-row.total {
                    border-top: 1px dashed #333;
                    margin-top: 6px;
                    padding-top: 8px;
                    font-weight: 800;
                }
                .receipt .r-foot {
                    text-align: center;
                    font-size: 10px;
                    color: #555;
                    margin-top: 12px;
                    padding-top: 8px;
                    border-top: 1px dashed #ccc;
                }
                @media print {
                    body { padding: 0; }
                    .receipt { border: 1px solid #000; border-radius: 0; }
                }
            </style>
        </head>
        <body>
            <div class="receipt">
                <div class="r-head">
                    <div class="org">BORONGAN CITY TRANSPORT TERMINAL</div>
                    <div class="kind">TRANSACTION RECORD</div>
                </div>
                <div class="r-row"><span>Ref:</span><strong>${escapeHtml(t.id || '—')}</strong></div>
                <div class="r-row"><span>Date:</span><strong>${escapeHtml(formatDate(t.date))}</strong></div>
                <div class="r-row"><span>Time:</span><strong>${escapeHtml(t.time || '--')}</strong></div>
                <div class="r-row"><span>Driver:</span><strong>${escapeHtml(currentDriver.fullName)}</strong></div>
                <div class="r-row"><span>Driver ID:</span><strong>${escapeHtml(currentDriver.driverId)}</strong></div>
                <div class="r-row"><span>Vehicle:</span><strong>${escapeHtml(currentDriver.vehicleType)}</strong></div>
                <div class="r-row"><span>Plate:</span><strong>${escapeHtml(currentDriver.plateNumber)}</strong></div>
                <div class="r-row"><span>Body No:</span><strong>${escapeHtml(currentDriver.bodyNumber || '—')}</strong></div>
                <div class="r-row total"><span>Amount:</span><strong>${formatCurrency(t.amount)}</strong></div>
                <div class="r-row"><span>Previous Balance:</span><strong>${formatCurrency(t.previousBalance)}</strong></div>
                <div class="r-row"><span>Balance After:</span><strong>${formatCurrency(t.balanceAfter)}</strong></div>
                <div class="r-row"><span>Status:</span><strong>${escapeHtml((t.status || 'Successful').toUpperCase())}</strong></div>
                <div class="r-footer r-foot">Keep this transaction record. Thank you!</div>
            </div>
            <script>
                window.onload = function () {
                    setTimeout(function () {
                        window.focus();
                        window.print();
                        setTimeout(function(){ window.close(); }, 400);
                    }, 300);
                };
            <\/script>
        </body>
        </html>
    `);
    printWin.document.close();
}

const NOTIF_ICONS = {
    load:    { icon: 'fa-wallet',               label: 'Wallet Load' },
    payment: { icon: 'fa-receipt',              label: 'Transaction' },
    low:     { icon: 'fa-triangle-exclamation', label: 'Balance Alert' },
    failed:  { icon: 'fa-circle-xmark',         label: 'Failed Transaction' },
    account: { icon: 'fa-circle-info',          label: 'Account Update' }
};

function formatNotifTime(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return String(timestamp);
    const datePart = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${datePart} · ${timePart}`;
}
function formatNotifTimeShort(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return String(timestamp);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function notifDetailRows(n) {
    const rows = [];
    const msg = n.message || '';
    let m;
    m = msg.match(/(?:loaded|added)[^\d]*(₱[\d,]+\.\d{2})/i);
    if (m) rows.push({ label: 'Amount Loaded', value: m[1] });
    m = msg.match(/(?:deducted|Fee)[^\d]*(₱[\d,]+\.\d{2})/i);
    if (m) rows.push({ label: 'Fee Deducted', value: m[1] });
    m = msg.match(/New balance[^\d]*(₱[\d,]+\.\d{2})/i) || msg.match(/(?:remaining|balance after)[^\d]*(₱[\d,]+\.\d{2})/i);
    if (m) rows.push({ label: 'New Balance', value: m[1] });
    m = msg.match(/Current Balance[^\d]*(₱[\d,]+\.\d{2})/i);
    if (m) rows.push({ label: 'Current Balance', value: m[1] });
    m = msg.match(/Required Fee[^\d]*(₱[\d,]+\.\d{2})/i);
    if (m) rows.push({ label: 'Required Fee', value: m[1] });
    m = msg.match(/Ref[:\s]*([A-Z0-9-]{6,})/i) || msg.match(/(?:Transaction ID|Ref\.?|Reference)[:\s]*([A-Z0-9-]{6,})/i);
    if (m) {
        const label = /^TX/.test(m[1]) ? 'Transaction ID' : 'Reference Number';
        rows.push({ label, value: m[1], mono: true });
    }
    if (n.referenceId && !rows.some(r => r.mono)) {
        rows.push({ label: 'Reference Number', value: n.referenceId, mono: true });
    }
    rows.push({ label: 'Date & Time', value: formatNotifTime(n.timestamp) });
    rows.push({ label: 'Status', value: n.read ? 'Read' : 'Unread' });
    return rows;
}

function computeNotifCounts() {
    return {
        all:    driverNotifications.length,
        unread: driverNotifications.filter(n => !n.read).length,
        loads:  driverNotifications.filter(n => n.type === 'load').length,
        alerts: driverNotifications.filter(n => n.type === 'low' || n.type === 'failed').length
    };
}
function renderNotifSummary() {
    const c = computeNotifCounts();
    setText('notifCountAll', c.all);
    setText('notifCountUnread', c.unread);
    setText('notifCountLoads', c.loads);
    setText('notifCountAlerts', c.alerts);
}

function renderFullNotifications() {
    const container = document.getElementById('notificationsFullList');
    if (!container) return;
    let data = driverNotifications;
    if (notificationFilter !== 'all') {
        if (notificationFilter === 'low') {
            data = data.filter(n => n.type === 'low' || n.type === 'failed');
        } else {
            data = data.filter(n => n.type === notificationFilter);
        }
    }
    renderNotifSummary();
    if (!data.length) {
        container.innerHTML = `
            <div class="notif-empty">
                <i class="fas fa-bell-slash"></i>
                <h3>No Notifications Yet</h3>
                <p>When your account receives wallet updates, transaction records, or important alerts, they will appear here.</p>
            </div>`;
        return;
    }
    container.innerHTML = data.map(n => {
        const kind = n.type || 'payment';
        const ic = NOTIF_ICONS[kind] || NOTIF_ICONS.payment;
        const cls = n.read ? '' : 'unread';
        const unreadPill = n.read ? '' : '<span class="notif-unread-pill">UNREAD</span>';
        return `
            <article class="notif-card ${cls}" data-notif-id="${escapeHtml(n.id)}">
                <div class="notif-card-icon ${kind}"><i class="fas ${ic.icon}"></i></div>
                <div class="notif-card-body">
                    <h3 class="notif-card-title">${escapeHtml(n.title || 'Notification')}${unreadPill}</h3>
                    <p class="notif-card-msg">${escapeHtml(n.message || '')}</p>
                    <div class="notif-card-meta">
                        <span><i class="fas fa-clock"></i> ${escapeHtml(formatNotifTimeShort(n.timestamp))}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(ic.label)}</span>
                    </div>
                    <div class="notif-card-actions">
                        <button class="notif-action-btn primary" data-action="view" data-id="${escapeHtml(n.id)}">
                            <i class="fas fa-eye"></i> View Details
                        </button>
                        ${!n.read ? `
                            <button class="notif-action-btn" data-action="read" data-id="${escapeHtml(n.id)}">
                                <i class="fas fa-check"></i> Mark as read
                            </button>
                        ` : `<button class="notif-action-btn" disabled><i class="fas fa-check-double"></i> Read</button>`}
                    </div>
                </div>
            </article>`;
    }).join('');
    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const action = btn.getAttribute('data-action');
            if (action === 'view') openNotifModal(id);
            if (action === 'read') markNotificationsRead(id);
        });
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
        list.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
        renderFullNotifications();
        return;
    }
    list.innerHTML = driverNotifications.slice(0, 30).map(n => {
        const kind = n.type || 'payment';
        const ic = NOTIF_ICONS[kind] || NOTIF_ICONS.payment;
        return `
            <div role="listitem">
                <button type="button" class="driver-notification__item ${n.read ? '' : 'is-unread'}"
                    data-driver-notification-id="${escapeHtml(n.id)}"
                    style="width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--border-soft);padding:.65rem .85rem;cursor:pointer;display:flex;gap:.6rem;align-items:flex-start;">
                    <span style="color:var(--maroon);font-size:.9rem;margin-top:.15rem;"><i class="fas ${ic.icon}"></i></span>
                    <span style="flex:1;min-width:0;">
                        <span style="display:block;font-size:.78rem;font-weight:700;color:var(--text-dark);">${escapeHtml(n.title)}</span>
                        <span style="display:block;font-size:.7rem;color:var(--text-mid);margin-top:.15rem;line-height:1.4;">${escapeHtml(n.message)}</span>
                        <span style="display:block;font-size:.62rem;color:var(--text-soft);margin-top:.25rem;">${escapeHtml(formatNotifTimeShort(n.timestamp))}</span>
                    </span>
                </button>
            </div>`;
    }).join('');
    renderFullNotifications();
}

function openNotifModal(id) {
    const n = driverNotifications.find(x => String(x.id) === String(id));
    if (!n) return;
    const kind = n.type || 'payment';
    const ic = NOTIF_ICONS[kind] || NOTIF_ICONS.payment;
    const iconEl = document.getElementById('notifModalIcon');
    if (iconEl) {
        iconEl.className = 'notif-modal-icon ' + kind;
        iconEl.innerHTML = `<i class="fas ${ic.icon}"></i>`;
    }
    setText('notifModalTitle', n.title || 'Notification');
    setText('notifModalTime', formatNotifTime(n.timestamp));
    const body = document.getElementById('notifModalBody');
    if (body) {
        const rows = notifDetailRows(n);
        body.innerHTML = `
            <p style="margin:0 0 .75rem 0;color:var(--text-mid);">${escapeHtml(n.message || '')}</p>
            ${rows.map(r => `
                <div class="notif-detail-row">
                    <span class="notif-detail-label">${escapeHtml(r.label)}</span>
                    <span class="notif-detail-value ${r.mono ? 'mono' : ''}">${escapeHtml(r.value)}</span>
                </div>
            `).join('')}`;
    }
    const markBtn = document.getElementById('notifModalMarkRead');
    if (markBtn) {
        markBtn.style.display = n.read ? 'none' : '';
        markBtn.onclick = () => { markNotificationsRead(n.id); closeNotifModal(); };
    }
    const modal = document.getElementById('notifModal');
    if (modal) modal.hidden = false;
}
function closeNotifModal() {
    const modal = document.getElementById('notifModal');
    if (modal) modal.hidden = true;
}

async function refreshNotifications() {
    const remote = await loadDriverNotifications();
    if (remote) {
        driverNotifications = remote;
        renderDriverNotifications();
    }
}

async function markNotificationsRead(id) {
    driverNotifications = driverNotifications.map(n =>
        (!id || String(n.id) === String(id)) ? { ...n, read: true } : n
    );
    renderDriverNotifications();
    try {
        await window.api('driver_notifications.php', {
            method: 'POST',
            body: id ? { id } : { markAllRead: true }
        });
        if (!id) showToast('All notifications marked as read.', 'success');
    } catch (err) {
        console.error('Mark read failed:', err);
        showToast('Could not mark as read.', 'error');
    }
}

async function initDriverNotifications() {
    await refreshNotifications();

    const bell = document.getElementById('driverNotificationBell');
    const panel = document.getElementById('driverNotificationPanel');
    const wrapper = document.getElementById('driverNotification');
    const list = document.getElementById('driverNotificationList');
    const markRead = document.getElementById('markDriverNotificationsRead');

    if (bell && panel && wrapper && list && markRead) {
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
            openNotifModal(item.getAttribute('data-driver-notification-id'));
            panel.hidden = true;
        });
        document.addEventListener('click', e => {
            if (!wrapper.contains(e.target)) {
                panel.hidden = true;
                bell.setAttribute('aria-expanded', 'false');
            }
        });
    }

    document.getElementById('markAllReadBtn')?.addEventListener('click', () => {
        if (!driverNotifications.some(n => !n.read)) {
            showToast('No unread notifications.', 'warning');
            return;
        }
        markNotificationsRead(null);
    });

    document.querySelectorAll('.notif-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            window.setNotifFilter(tab.dataset.filter);
        });
    });

    document.querySelectorAll('#notifModal [data-close]').forEach(el => {
        el.addEventListener('click', closeNotifModal);
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeNotifModal();
    });
}

window.setNotifFilter = function(type) {
    notificationFilter = type || 'all';
    document.querySelectorAll('.notif-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.filter === notificationFilter);
    });
    renderFullNotifications();
};

async function handleChangePassword(e) {
    e.preventDefault();
    const msg = document.getElementById('changePwMsg');
    const cur = document.getElementById('currentPassword').value;
    const nw = document.getElementById('newPassword').value;
    const cf = document.getElementById('confirmNewPassword').value;

    msg.className = 'account-msg';
    msg.textContent = '';
    if (!cur || !nw || !cf) { msg.textContent = 'Please fill in all fields.'; msg.classList.add('error'); return; }
    if (nw.length < 8) { msg.textContent = 'New password must be at least 8 characters.'; msg.classList.add('error'); return; }
    if (nw !== cf) { msg.textContent = 'New password and confirmation do not match.'; msg.classList.add('error'); return; }

    try {
        const res = await window.api('change_password.php', {
            method: 'POST',
            body: { currentPassword: cur, newPassword: nw }
        });
        if (!res.success) {
            msg.textContent = res.message || 'Could not update password.';
            msg.classList.add('error');
            return;
        }
        msg.textContent = 'Password updated successfully!';
        msg.classList.add('success');
        document.getElementById('changePasswordForm').reset();
        showToast('Password updated successfully.', 'success');
    } catch (err) {
        console.error(err);
        msg.textContent = 'Server error. Please try again.';
        msg.classList.add('error');
    }
}

function initDriverUserChip() {
    console.log('[Driver Chip] Initializing…');

    let chip = document.querySelector('.user-chip');
    if (!chip) chip = document.querySelector('header.topbar .user-chip');
    if (!chip) {
        const nameEl = document.getElementById('userNameChip');
        if (nameEl) chip = nameEl.closest('.user-chip') || nameEl.parentElement?.parentElement;
    }

    if (!chip) {
        console.warn('[Driver Chip] .user-chip not found in DOM');
        return;
    }

    console.log('[Driver Chip] Found chip element:', chip);

    if (chip.dataset.chipBound === '1') {
        console.log('[Driver Chip] Already bound, skipping');
        return;
    }
    chip.dataset.chipBound = '1';

    if (!document.getElementById('driverChipMenu')) {
        const menu = document.createElement('div');
        menu.id = 'driverChipMenu';
        menu.style.cssText = `
            position: absolute;
            display: none;
            min-width: 220px;
            padding: .4rem 0;
            border: 1px solid #E5E7EB;
            border-radius: .65rem;
            background: #fff;
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16);
            z-index: 2500;
            font-family: 'Inter', system-ui, sans-serif;
        `;

        menu.innerHTML = `
            <div style="padding:.7rem 1rem .6rem;border-bottom:1px solid #F1F5F9;">
                <div id="dchipName" style="font-weight:700;font-size:.85rem;color:#1F2937;">Driver</div>
                <div id="dchipRole" style="font-size:.7rem;color:#6B7280;margin-top:.1rem;">Driver Account</div>
            </div>
            <button type="button" class="driver-chip-item" data-action="profile"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#1F2937;cursor:pointer;font-family:inherit;">
                <i class="fas fa-user-circle" style="color:#8B1D2C;width:16px;"></i> My Profile
            </button>
            <button type="button" class="driver-chip-item" data-action="driver-id"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#1F2937;cursor:pointer;font-family:inherit;">
                <i class="fas fa-id-card" style="color:#8B1D2C;width:16px;"></i> My Driver ID
            </button>
            <button type="button" class="driver-chip-item" data-action="qr"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#1F2937;cursor:pointer;font-family:inherit;">
                <i class="fas fa-qrcode" style="color:#8B1D2C;width:16px;"></i> My QR Code
            </button>
            <button type="button" class="driver-chip-item" data-action="account"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#1F2937;cursor:pointer;font-family:inherit;">
                <i class="fas fa-key" style="color:#8B1D2C;width:16px;"></i> Change Password
            </button>
            <button type="button" class="driver-chip-item" data-action="requests"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#1F2937;cursor:pointer;font-family:inherit;">
                <i class="fas fa-envelope-open-text" style="color:#8B1D2C;width:16px;"></i> My Requests
            </button>
            <div style="height:1px;background:#F1F5F9;margin:.35rem 0;"></div>
            <button type="button" class="driver-chip-item" data-action="logout"
                    style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:#DC2626;cursor:pointer;font-family:inherit;">
                <i class="fas fa-right-from-bracket" style="width:16px;"></i> Logout
            </button>
        `;
        document.body.appendChild(menu);
        console.log('[Driver Chip] Menu element created and appended to body');

        menu.querySelectorAll('.driver-chip-item').forEach(item => {
            item.addEventListener('mouseenter', () => { item.style.background = '#FDF2F4'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'none'; });

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                console.log('[Driver Chip] Item clicked:', action);
                closeDriverChipMenu();
                switch (action) {
                    case 'profile':   navigateTo('profile');     break;
                    case 'driver-id': navigateTo('qr');          break;
                    case 'qr':        navigateTo('myqr');        break;
                    case 'account':   navigateTo('account');     break;
                    case 'requests':  navigateTo('myinquiries'); break;
                    case 'logout':    if (typeof window.logout === 'function') window.logout(); break;
                }
            });
        });
    }

    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('[Driver Chip] Chip clicked');
        const menu = document.getElementById('driverChipMenu');
        if (!menu) return;

        if (currentDriver) {
            setText('dchipName', currentDriver.fullName || currentDriver.driverId || 'Driver');
            setText('dchipRole', 'Driver · ' + (currentDriver.driverId || '—'));
        } else {
            setText('dchipName', 'Driver');
            setText('dchipRole', 'Driver Account');
        }

        const rect = chip.getBoundingClientRect();
        menu.style.top  = (rect.bottom + window.scrollY + 8) + 'px';
        menu.style.left = (rect.right + window.scrollX - 220) + 'px';

        const isOpen = menu.style.display === 'block';
        menu.style.display = isOpen ? 'none' : 'block';
        console.log('[Driver Chip] Menu display:', menu.style.display);
    });

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('driverChipMenu');
        if (!menu || menu.style.display !== 'block') return;
        if (!chip.contains(e.target) && !menu.contains(e.target)) {
            closeDriverChipMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDriverChipMenu();
    });

    console.log('[Driver Chip] Binding complete');
}

function closeDriverChipMenu() {
    const menu = document.getElementById('driverChipMenu');
    if (menu) menu.style.display = 'none';
}
window.closeDriverChipMenu = closeDriverChipMenu;
window.initDriverUserChip = initDriverUserChip;

function renderAll() {
    populateDashboard();
    populateBalance();
    populateVehicle();
    populateProfile();
    populateEmergencyContact();
    populateAccount();
    renderPaymentHistory();
    renderLoadHistory();
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
                showToast(`${formatCurrency(t.amount)} was loaded to your wallet.`, 'success');
                logDriverActivity('Wallet loaded ' + formatCurrency(t.amount), 'fa-wallet');
            } else {
                showToast(`Terminal fee ${formatCurrency(t.amount)} deducted.`, 'warning');
                logDriverActivity('Fee paid ' + formatCurrency(t.amount), 'fa-receipt');
            }
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
        if (!user) { window.location.replace('login.html?expired=1'); return; }
        if (user.role !== 'driver') { window.location.replace(window.landingPageFor(user.role)); return; }
        window.CURRENT_USER = user;
        const driver = await loadDriverProfile();
        if (!driver) { setSyncIndicator('error'); return; }
        currentDriver = driver;
        await Promise.all([
            loadDriverBalance(),
            loadWalletHistory().catch(e => console.warn('history refresh failed:', e)),
            refreshNotifications()
        ]);
        renderAll();
        generateQR();
        populateQRPage();
        renderActivities();
        updateTopbarDateTime();
    } catch (e) {
        console.error('Dashboard resume refresh failed:', e);
        setSyncIndicator('error');
    } finally {
        dashboardResumeRefreshInProgress = false;
        if (currentDriver && !document.hidden) startDriverPaymentPolling();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopDriverPaymentPolling();
    else refreshDriverDashboardOnResume();
});
window.addEventListener('focus', refreshDriverDashboardOnResume);
window.addEventListener('pageshow', refreshDriverDashboardOnResume);

let driverStationsMapInstance = null;
let driverStationMarkers = {};

async function initDriverStationsMap(forceRefresh = false) {
    const mapEl = document.getElementById('driverStationsMap');
    if (!mapEl || typeof L === 'undefined') return;

    if (!driverStationsMapInstance) {
        driverStationsMapInstance = L.map('driverStationsMap', {
            center: [11.6080, 125.4316], zoom: 11, zoomControl: true, scrollWheelZoom: true
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Borongan BCTT'
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
            const pinBg = isReceiving ? '#16A34A' : '#8B1D2C';
            const codeClass = isReceiving ? 'green' : 'maroon';
            const typeLabel = isReceiving ? 'Checkpoint' : 'Ticketing Station';

            const iconHtml = `<div style="width:34px;height:34px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.25);border:2px solid #fff;"><i class="fas ${isReceiving ? 'fa-clipboard-check' : 'fa-ticket'}" style="font-size:12px;"></i></div>`;
            const icon = L.divIcon({ html: iconHtml, className: 'driver-map-pin', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
            const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(driverStationsMapInstance);

            const popup = `
                <div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:200px;">
                    <span style="font-size:10px;font-weight:800;color:${pinBg};background:${isReceiving ? '#F0FDF4' : '#F5E8EA'};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span>
                    <h4 style="font-size:12px;font-weight:700;margin:5px 0 4px 0;color:#1F2937;">${escapeHtml(t.name)}</h4>
                    <p style="font-size:11px;color:#6B7280;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p>
                    <div style="background:#F8F9FA;padding:5px 7px;border-radius:6px;font-size:11px;color:#374151;">
                        <div><strong>Hours:</strong> ${escapeHtml(t.operating_hours || '5:00 AM - 8:00 PM')}</div>
                        <div style="margin-top:2px;"><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'Borongan City')}</div>
                    </div>
                </div>`;
            marker.bindPopup(popup);
            driverStationMarkers[t.code] = marker;
            markersGroup.push(marker);

            html += `
                <div class="station-card" onclick="focusDriverStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})">
                    <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;">
                            <span class="station-code ${codeClass}">${escapeHtml(t.code)}</span>
                            <span style="font-size:.6rem;font-weight:800;color:var(--text-soft);text-transform:uppercase;letter-spacing:.05em;">${typeLabel}</span>
                        </div>
                        <div class="station-name">${escapeHtml(t.name)}</div>
                        <div class="station-address"><i class="fas fa-location-dot" style="color:var(--maroon);margin-right:.25rem;"></i>${escapeHtml(t.address || 'Borongan City')}</div>
                        <div class="station-route"><i class="fas fa-route" style="color:var(--maroon);margin-right:.25rem;"></i><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'City Proper')}</div>
                    </div>
                    <div class="station-foot">
                        <span><i class="fas fa-location-crosshairs"></i> View on Map</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </div>`;
        });

        if (gridEl) gridEl.innerHTML = html;
        if (markersGroup.length > 0) {
            const group = new L.featureGroup(markersGroup);
            driverStationsMapInstance.fitBounds(group.getBounds().pad(0.12));
        }
        if (forceRefresh) showToast('Stations & checkpoints updated', 'success');
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

const PAGE_LABELS = {
    dashboard: 'Driver Summary',
    qr: 'My Driver ID',
    myqr: 'My QR Code',
    vehicle: 'My Vehicle',
    emergency: 'Emergency Contact',
    balance: 'My Balance',
    loadhistory: 'Load History',
    payments: 'Transactions',
    myinquiries: 'My Requests',
    notifications: 'Notifications',
    profile: 'My Profile',
    account: 'Account',
    stations: 'Stations & Checkpoints'
};

function navigateTo(page) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');

    document.querySelectorAll('.sidebar-item[data-page]').forEach(i => {
        i.classList.toggle('active', i.dataset.page === page);
    });

    setText('topbarCurrentPage', PAGE_LABELS[page] || 'Dashboard');

    if (window.innerWidth <= 1100) document.getElementById('sidebar')?.classList.remove('open');

    if (page === 'qr') { logDriverActivity('Viewed Driver ID', 'fa-id-card'); populateQRPage(); generateQR(); }
    if (page === 'myqr') { logDriverActivity('Viewed QR Code', 'fa-qrcode'); generateQR(); }
    if (page === 'payments') { logDriverActivity('Viewed Transactions', 'fa-receipt'); renderPaymentHistory(); }
    if (page === 'profile') { logDriverActivity('Viewed Profile', 'fa-user'); populateProfile(); }
    if (page === 'vehicle') populateVehicle();
    if (page === 'emergency') { logDriverActivity('Viewed Emergency Contact', 'fa-kit-medical'); populateEmergencyContact(); }
    if (page === 'account') { logDriverActivity('Viewed Account', 'fa-gear'); populateAccount(); }
    if (page === 'balance') { logDriverActivity('Viewed Balance', 'fa-wallet'); populateBalance(); }
    if (page === 'loadhistory') renderLoadHistory();
    if (page === 'myinquiries') {
        logDriverActivity('Viewed My Requests', 'fa-envelope-open-text');
        refreshDriverInquiries();
    }
    if (page === 'notifications') { logDriverActivity('Viewed Notifications', 'fa-bell'); renderFullNotifications(); }
    if (page === 'stations') {
        logDriverActivity('Viewed Station Map', 'fa-map-location-dot');
        initDriverStationsMap();
        setTimeout(() => {
            if (driverStationsMapInstance) driverStationsMapInstance.invalidateSize();
        }, 150);
    }
}
window.navigateTo = navigateTo;

async function initDriverDashboard() {
    const driver = await loadDriverProfile();
    if (!driver) {
        showToast('Your driver profile could not be loaded.', 'error');
        setTimeout(() => window.logoutAndRedirect(), 3000);
        return;
    }
    currentDriver = driver;

    await Promise.all([
        loadDriverBalance(),
        loadWalletHistory().catch(e => console.warn('history failed:', e))
    ]);

    try { renderAll(); }                catch (e) { console.error('renderAll:', e); }
    try { generateQR(); }               catch (e) { console.error('generateQR:', e); }
    try { populateQRPage(); }           catch (e) { console.error('populateQRPage:', e); }
    try { populateProfile(); }          catch (e) { console.error('populateProfile:', e); }
    try { populateEmergencyContact(); } catch (e) { console.error('populateEmergencyContact:', e); }
    try { populateAccount(); }          catch (e) { console.error('populateAccount:', e); }
    try { populateVehicle(); }          catch (e) { console.error('populateVehicle:', e); }
    try { populateBalance(); }          catch (e) { console.error('populateBalance:', e); }

    try {
        await refreshDriverInquiries();
    } catch (e) { console.error('inquiries preload:', e); }

    setText('sidebarDriverName', (driver.fullName || driver.driverId || 'Driver') + ' · Driver');

    updateTopbarDateTime();
    setInterval(updateTopbarDateTime, 30000);

    logDriverActivity('Opened dashboard', 'fa-sign-in-alt');
    renderActivities();

    try { await initDriverNotifications(); } catch (e) { console.error('initNotifications:', e); }
    startDriverPaymentPolling();

    const fromHash = (location.hash || '').replace('#', '');
    if (fromHash && document.getElementById('page-' + fromHash)) navigateTo(fromHash);
}

window.logout = function() {
    const doLogout = () => {
        logDriverActivity('Logged out', 'fa-sign-out-alt');
        stopDriverPaymentPolling();
        window.logoutAndRedirect();
    };
    if (window.ConfirmModal) {
        ConfirmModal.show({
            title: "Log out?",
            message: "Are you sure you want to log out of the driver dashboard?",
            confirmText: "Yes, log out",
            cancelText: "Cancel",
            onConfirm: doLogout
        });
    } else {
        if (confirm("Log out?")) doLogout();
    }
};

window.requestInfoUpdate = requestInfoUpdate;

window.authReady.then(() => {
    console.log('[Boot] authReady resolved, initializing driver dashboard');
    initDriverDashboard();
    initDriverUserChip();
    initMyRequestsModule();

    document.querySelectorAll('.sidebar-item[data-page]').forEach(i => {
        i.addEventListener('click', function() { navigateTo(this.dataset.page); });
    });

    document.getElementById('mobileToggle')?.addEventListener('click', function() {
        document.getElementById('sidebar')?.classList.toggle('open');
    });

    document.getElementById('paymentSearch')?.addEventListener('input', renderPaymentHistory);
    document.getElementById('paymentFilter')?.addEventListener('change', renderPaymentHistory);

    document.getElementById('refreshBalanceBtn')?.addEventListener('click', async () => {
        await refreshDriverPayments(true);
        showToast('Data refreshed · ' + formatCurrency(currentBalance), 'success');
    });

    document.getElementById('changePasswordForm')?.addEventListener('submit', handleChangePassword);
});