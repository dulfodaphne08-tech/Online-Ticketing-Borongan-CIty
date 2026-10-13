const MAX_LOAD = 50000;
const POLL_MS = 5000;

let currentUser = null;
let currentPage = 'dashboard';
let currentDriver = null;
let searchResults = [];
let loading = false;
let receiptOnDone = null;
let historyRows = [];
let cashierStationsMapInstance = null;
let cashierStationMarkers = {};
let dashboardPollTimer = null;
let notifPollTimer = null;
let unreadNotifs = [];
let pendingORNumber = '';

function peso(n) {
    const num = Number(n || 0);
    return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add('active'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('active'); }

function generateORNumber() {
    const now = new Date();
    const ymd = now.getFullYear().toString() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return 'OR-' + ymd + '-' + rand;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-triangle-exclamation' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></span>
        <span class="toast-msg">${escapeHtml(message)}</span>
        <button class="toast-close" aria-label="Close"><i class="fas fa-times"></i></button>`;
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4500);
}
window.showToast = showToast;

function setBusy(btn, busy, text) {
    if (!btn) return;
    if (busy) {
        btn.dataset.label = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + escapeHtml(text || 'Please wait…');
    } else {
        btn.disabled = false;
        if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
}

function setSyncIndicator(state) {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    el.className = 'sync-indicator';
    if (state === 'ok') el.innerHTML = '<span class="dot"></span> Live';
    else if (state === 'warning') { el.className = 'sync-indicator warning'; el.innerHTML = '<span class="dot"></span> Syncing…'; }
    else if (state === 'error') { el.className = 'sync-indicator error'; el.innerHTML = '<span class="dot"></span> Offline'; }
}

function updateTopbarDateTime() {
    const el = document.getElementById('topbarDateTime');
    if (!el) return;
    const now = new Date();
    const datePart = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    el.textContent = `${datePart}, ${timePart}`;
}

document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
        if (e.target === m && m.id !== 'receiptModal') closeModal(m.id);
        if (e.target.closest('[data-close-modal]')) closeModal(m.id);
    });
});

const PAGE_LABELS = {
    dashboard: 'Dashboard', load: 'Load Driver Balance', history: 'Load History',
    references: 'Payment References', verify: 'Driver Verification', today: "Today's Records",
    attendance: 'My Attendance', profile: 'My Profile', 'stations-map': 'Terminal Stations'
};

function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page-section').forEach(s => {
        s.classList.toggle('active', s.id === 'page-' + page);
    });
    document.querySelectorAll('.sidebar-item').forEach(i => {
        i.classList.toggle('active', i.dataset.page === page);
    });
    setText('topbarCurrentPage', PAGE_LABELS[page] || 'Dashboard');
    const sb = document.getElementById('sidebar');
    if (sb && window.innerWidth <= 1100) sb.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const userDropdown = document.getElementById('userDropdown');
    if (userDropdown) userDropdown.classList.remove('active');
    if (page === 'dashboard') refreshDashboard();
    if (page === 'history') loadHistory();
    if (page === 'references') loadReferences();
    if (page === 'today') loadToday();
    if (page === 'attendance') loadAttendance();
    if (page === 'stations-map') {
        initCashierStationsMap();
        setTimeout(() => {
            if (cashierStationsMapInstance) {
                cashierStationsMapInstance.invalidateSize();
                const markers = Object.values(cashierStationMarkers);
                if (markers.length > 0) {
                    const group = new L.featureGroup(markers);
                    cashierStationsMapInstance.fitBounds(group.getBounds().pad(0.15));
                }
            }
        }, 200);
    }
}
window.navigateTo = navigateTo;

document.querySelectorAll('.sidebar-item[data-page]').forEach(b => {
    b.addEventListener('click', () => navigateTo(b.dataset.page));
});
document.querySelectorAll('[data-goto]').forEach(b => {
    b.addEventListener('click', () => navigateTo(b.dataset.goto));
});

document.getElementById('mobileToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    const doLogout = () => { stopDashboardPolling(); window.logoutAndRedirect(); };
    if (window.ConfirmModal) {
        window.ConfirmModal.show({
            title: 'Log out?', message: 'Log out of the cashier dashboard?',
            confirmText: 'Yes, log out', cancelText: 'Cancel', onConfirm: doLogout
        });
    } else if (confirm('Log out?')) doLogout();
});

async function refreshDashboard() {
    if (!currentUser) return;
    setSyncIndicator('warning');
    try {
        const [stats, recent] = await Promise.all([
            window.api('payments.php', { query: { action: 'stats' } }),
            window.api('payments.php', { query: { action: 'list', type: 'LOAD', limit: 20 } })
        ]);
        if (stats && stats.success) {
            const s = stats.data.stats || {};
            setText('statLoads', peso(s.loadsToday));
            setText('statLoadsCount', s.loadsCountToday || 0);
        }
        const list = (recent && recent.success && recent.data.transactions) ? recent.data.transactions : [];
        const today = new Date().toLocaleDateString('en-CA');
        const todayList = list.filter(t => (t.date || '').startsWith(today));
        const ok = todayList.filter(t => String(t.status).toUpperCase() === 'SUCCESSFUL').length;
        setText('statSuccessfulLoads', ok);
        setText('statFailedLoads', Math.max(todayList.length - ok, 0));
        const tb = document.getElementById('recentTable');
        if (tb) {
            const show = todayList.slice(0, 8);
            if (!show.length) tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No loads recorded today.</div></td></tr>';
            else tb.innerHTML = show.map(t => `
                <tr>
                    <td>${escapeHtml(t.time || '')}</td>
                    <td>${escapeHtml(t.driverName || t.driverId || '—')}</td>
                    <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.driverId || '—')}</td>
                    <td style="color:var(--green);font-weight:800;">+${peso(t.amount)}</td>
                    <td style="font-weight:700;">${peso(t.balanceAfter)}</td>
                    <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.referenceNumber || '—')}</td>
                    <td><span class="status-badge successful">SUCCESSFUL</span></td>
                </tr>`).join('');
        }
        setText('lastUpdatedTime', new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }));
        setSyncIndicator('ok');
    } catch (err) { console.error(err); setSyncIndicator('error'); }
}

document.getElementById('refreshStatsBtn')?.addEventListener('click', async () => {
    await refreshDashboard();
    showToast('Dashboard refreshed.', 'success');
});

function startDashboardPolling() {
    stopDashboardPolling();
    dashboardPollTimer = setInterval(() => {
        if (currentPage === 'dashboard' && !document.hidden) refreshDashboard();
    }, POLL_MS);
}
function stopDashboardPolling() {
    if (dashboardPollTimer) clearInterval(dashboardPollTimer);
    dashboardPollTimer = null;
}

function startNotifPolling() {
    stopNotifPolling();
    checkNotifications();
    notifPollTimer = setInterval(checkNotifications, 15000);
}
function stopNotifPolling() {
    if (notifPollTimer) clearInterval(notifPollTimer);
    notifPollTimer = null;
}

async function checkNotifications() {
    try {
        const res = await window.api('payments.php', { query: { action: 'list', type: 'ALL', limit: 10 } });
        if (res && res.success && res.data.transactions) {
            const savedReadIds = JSON.parse(localStorage.getItem('bctt_read_notifs') || '[]');
            unreadNotifs = res.data.transactions.map(t => {
                const notifId = t.id || t.referenceNumber || t.date + t.time;
                return {
                    id: notifId,
                    title: t.type === 'LOAD' ? 'Balance Loaded' : 'Fee Collected',
                    message: `${t.type === 'LOAD' ? 'Loaded' : 'Collected'} ${peso(t.amount)} for ${t.driverName || 'Driver'}`,
                    time: t.date + ' ' + t.time,
                    isRead: savedReadIds.includes(notifId)
                };
            });
            renderNotifications();
        }
    } catch (err) { console.warn('Notif fetch failed', err); }
}

function renderNotifications() {
    const badge = document.getElementById('notifBadge');
    const list = document.getElementById('notifList');
    if (!badge || !list) return;
    const unreadCount = unreadNotifs.filter(n => !n.isRead).length;
    if (unreadCount > 0) { badge.textContent = unreadCount > 9 ? '9+' : unreadCount; badge.hidden = false; }
    else badge.hidden = true;
    if (unreadNotifs.length === 0) { list.innerHTML = '<div class="notif-empty">No new notifications.</div>'; return; }
    list.innerHTML = unreadNotifs.map(n => `
        <div class="notif-item ${n.isRead ? '' : 'unread'}" data-id="${escapeHtml(n.id)}">
            <div class="notif-icon"><i class="fas fa-money-bill-wave"></i></div>
            <div class="notif-content">
                <p>${escapeHtml(n.title)}</p>
                <p style="font-weight:400; font-size:.7rem; color:var(--text-mid);">${escapeHtml(n.message)}</p>
                <small>${escapeHtml(n.time)}</small>
            </div>
        </div>
    `).join('');
}

document.getElementById('notifBellBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notifDropdown')?.classList.toggle('active');
    document.getElementById('userDropdown')?.classList.remove('active');
});

document.addEventListener('click', (e) => {
    const nw = document.querySelector('.notif-wrapper');
    if (nw && !nw.contains(e.target)) document.getElementById('notifDropdown')?.classList.remove('active');
    const uw = document.querySelector('.user-chip-wrapper');
    if (uw && !uw.contains(e.target)) document.getElementById('userDropdown')?.classList.remove('active');
});

document.getElementById('markAllReadBtn')?.addEventListener('click', () => {
    const savedReadIds = JSON.parse(localStorage.getItem('bctt_read_notifs') || '[]');
    const allIds = unreadNotifs.map(n => n.id);
    const newReadIds = [...new Set([...savedReadIds, ...allIds])];
    localStorage.setItem('bctt_read_notifs', JSON.stringify(newReadIds));
    unreadNotifs.forEach(n => n.isRead = true);
    renderNotifications();
    showToast('All notifications marked as read.', 'success');
});

document.getElementById('notifList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.notif-item');
    if (item && item.classList.contains('unread')) {
        const id = item.dataset.id;
        const savedReadIds = JSON.parse(localStorage.getItem('bctt_read_notifs') || '[]');
        if (!savedReadIds.includes(id)) { savedReadIds.push(id); localStorage.setItem('bctt_read_notifs', JSON.stringify(savedReadIds)); }
        const notif = unreadNotifs.find(n => n.id === id);
        if (notif) notif.isRead = true;
        renderNotifications();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const userChipBtn = document.getElementById('userChipBtn');
    const userDropdown = document.getElementById('userDropdown');
    if (userChipBtn && userDropdown) {
        userChipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('active');
            document.getElementById('notifDropdown')?.classList.remove('active');
        });
        userDropdown.querySelectorAll('.dropdown-item[data-goto]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                userDropdown.classList.remove('active');
                const gotoPage = item.getAttribute('data-goto');
                if (gotoPage && typeof navigateTo === 'function') navigateTo(gotoPage);
            });
        });
        const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
        if (dropdownLogoutBtn) {
            dropdownLogoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                userDropdown.classList.remove('active');
                document.getElementById('logoutBtn')?.click();
            });
        }
    }
});

async function searchDrivers(q) {
    const box = document.getElementById('loadSearchResults');
    if (!box) return;
    if (!q) { box.innerHTML = '<p class="form-hint" style="color:var(--red);">Enter a name, Driver ID, body number, or plate.</p>'; return; }
    box.innerHTML = '<p class="form-hint"><i class="fas fa-spinner fa-spin"></i> Searching…</p>';
    try {
        const res = await window.api('wallet.php', { query: { action: 'search', q } });
        if (!res.success) { box.innerHTML = `<p class="form-hint" style="color:var(--red);">${escapeHtml(res.message || 'Search failed.')}</p>`; return; }
        searchResults = res.data.drivers || [];
        if (!searchResults.length) {
            box.innerHTML = `<div class="empty-inline" style="padding:1.5rem;"><i class="fas fa-user-slash" style="font-size:1.5rem;color:var(--border);display:block;margin-bottom:.5rem;"></i>No driver matches "${escapeHtml(q)}".</div>`;
            return;
        }
        box.innerHTML = '<div class="result-list">' + searchResults.map((d, i) => `
            <button type="button" class="result-item" data-pick="${i}">
                <span class="driver-info-avatar">${d.photo ? `<img src="${escapeHtml(d.photo)}" alt="">` : `<span>${escapeHtml((d.fullName || 'D').charAt(0).toUpperCase())}</span>`}</span>
                <span class="result-main">
                    <strong>${escapeHtml(d.fullName || '—')}</strong>
                    <small>${escapeHtml(d.driverId || '—')} · ${escapeHtml(d.vehicleType || '—')} · ${escapeHtml(d.plateNumber || '—')}</small>
                </span>
                <span class="result-balance">${peso(d.balance)}</span>
            </button>`).join('') + '</div>';
        box.querySelectorAll('[data-pick]').forEach(b => {
            b.addEventListener('click', () => selectLoadDriver(searchResults[Number(b.dataset.pick)]));
        });
    } catch (err) { console.error(err); box.innerHTML = '<p class="form-hint" style="color:var(--red);">Server error while searching.</p>'; }
}

function selectLoadDriver(d) {
    currentDriver = d;
    document.getElementById('loadStepSearch').hidden = true;
    document.getElementById('loadStepForm').hidden = false;
    const av = document.getElementById('ldAvatar');
    if (av) av.innerHTML = d.photo ? `<img src="${escapeHtml(d.photo)}" alt="">` : `<span>${escapeHtml((d.fullName || 'D').charAt(0).toUpperCase())}</span>`;
    setText('ldName', d.fullName || '—');
    setText('ldDriverId', d.driverId || '—');
    setText('ldVehicle', d.vehicleType || '—');
    setText('ldPlate', d.plateNumber || '—');
    setText('ldBalance', peso(d.balance));
    setValue('loadAmount', '');

    pendingORNumber = generateORNumber();
    const orField = document.getElementById('orNumber');
    if (orField) {
        orField.value = pendingORNumber;
        orField.readOnly = true;
        orField.style.background = '#F8F9FA';
        orField.style.cursor = 'not-allowed';
    }

    updateLoadPreview();
    document.getElementById('loadAmount')?.focus();
}

function resetLoad() {
    currentDriver = null;
    pendingORNumber = '';
    const lf = document.getElementById('loadStepForm'); if (lf) lf.hidden = true;
    const ls = document.getElementById('loadStepSearch'); if (ls) ls.hidden = false;
    const rs = document.getElementById('loadSearchResults'); if (rs) rs.innerHTML = '';
    setValue('loadSearchInput', '');
    setValue('loadAmount', '');
    setValue('orNumber', '');
    const msg = document.getElementById('loadMsg'); if (msg) msg.textContent = '';
}

function amountValue() {
    const el = document.getElementById('loadAmount');
    if (!el) return 0;
    const n = Number(el.value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function updateLoadPreview() {
    const amt = amountValue();
    const lp = document.getElementById('loadPreview');
    if (lp) lp.hidden = !(currentDriver && amt > 0);
    if (!currentDriver) return;
    setText('pvCurrent', peso(currentDriver.balance));
    setText('pvAmount', peso(amt));
    setText('pvNew', peso((Number(currentDriver.balance) || 0) + amt));
}

document.getElementById('loadSearchForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const el = document.getElementById('loadSearchInput');
    if (el) searchDrivers(el.value.trim());
});
document.getElementById('changeDriverBtn')?.addEventListener('click', resetLoad);
document.getElementById('loadAmount')?.addEventListener('input', updateLoadPreview);
document.querySelectorAll('.quick-btn').forEach(b => {
    b.addEventListener('click', () => { setValue('loadAmount', b.dataset.amount); updateLoadPreview(); });
});

document.getElementById('loadForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const amt = amountValue();
    const msg = document.getElementById('loadMsg');
    if (!currentDriver) return;
    if (!(amt > 0)) { if (msg) msg.textContent = 'Enter an amount greater than ₱0.'; return; }
    if (amt > MAX_LOAD) { if (msg) msg.textContent = 'Maximum load per transaction is ₱50,000.'; return; }
    if (msg) msg.textContent = '';

    if (!pendingORNumber) {
        pendingORNumber = generateORNumber();
        const orField = document.getElementById('orNumber');
        if (orField) orField.value = pendingORNumber;
    }

    console.log('📋 OR number for this load:', pendingORNumber);

    setText('cfDriver', currentDriver.fullName || '—');
    setText('cfDriverId', currentDriver.driverId || '—');
    setText('cfPrev', peso(currentDriver.balance));
    setText('cfAmount', peso(amt));
    setText('cfNew', peso((Number(currentDriver.balance) || 0) + amt));
    const pm = document.getElementById('paymentMethod');
    if (pm) setText('cfMethod', pm.selectedOptions[0].textContent);
    setText('cfOrNumber', pendingORNumber);
    openModal('confirmLoadModal');
});

document.getElementById('confirmLoadBtn')?.addEventListener('click', async () => {
    if (!currentDriver || loading) return;
    loading = true;
    const btn = document.getElementById('confirmLoadBtn');
    setBusy(btn, true, 'Loading…');

    const pm = document.getElementById('paymentMethod');
    const orValue = pendingORNumber || generateORNumber();

    console.log('===== CONFIRM CLICK =====');
    console.log('OR value being sent:', JSON.stringify(orValue));
    console.log('========================');

    const body = {
        action: 'load',
        driverId: currentDriver.driverId,
        amount: amountValue(),
        paymentMethod: pm ? pm.value : 'CASH',
        orNumber: orValue,
        referenceNumber: orValue,
        confirmDuplicate: false
    };
    console.log('📤 Sending to backend:', body);
    try {
        const res = await window.api('wallet.php', { method: 'POST', body });
        console.log('📥 Backend response:', res);
        setBusy(btn, false);
        loading = false;
        closeModal('confirmLoadModal');
        if (res.success) {
            pendingORNumber = '';
            showReceipt(res.data.receipt, () => resetLoad());
            refreshDashboard();
            return;
        }
        if (res.code === 'DUPLICATE_LOAD') {
            if (confirm(res.message + '\n\nLoad again anyway?')) {
                const res2 = await window.api('wallet.php', { method: 'POST', body: Object.assign({}, body, { confirmDuplicate: true }) });
                if (res2.success) { showReceipt(res2.data.receipt, () => resetLoad()); refreshDashboard(); }
                else showToast(res2.message || 'Load failed.', 'error');
            }
            return;
        }
        showToast(res.message || 'Load failed.', 'error');
    } catch (err) {
        console.error(err);
        setBusy(btn, false);
        loading = false;
        showToast('Server error. Please try again.', 'error');
    }
});

async function loadHistory() {
    const tb = document.getElementById('historyTable');
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">Loading…</div></td></tr>';
    const q = (document.getElementById('histSearch')?.value || '').trim();
    try {
        const res = await window.api('payments.php', { query: { action: 'list', type: 'ALL', q, limit: 500 } });
        if (!res.success) { tb.innerHTML = `<tr><td colspan="7"><div class="empty-inline">${escapeHtml(res.message || 'Failed to load.')}</div></td></tr>`; return; }
        historyRows = res.data.transactions || [];
        setText('historyCount', historyRows.length);
        if (!historyRows.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No records.</div></td></tr>'; return; }
        tb.innerHTML = historyRows.map(t => `
            <tr>
                <td>${escapeHtml((t.date || '') + ' ' + (t.time || ''))}</td>
                <td>${t.type === 'LOAD' ? 'Load' : 'Fee'}</td>
                <td>${escapeHtml(t.driverName || t.driverId || '—')}</td>
                <td style="${t.type === 'LOAD' ? 'color:var(--green);font-weight:800;' : 'color:var(--red);font-weight:800;'}">${t.type === 'LOAD' ? '+' : '−'}${peso(t.amount)}</td>
                <td>${peso(t.previousBalance)}</td>
                <td style="font-weight:700;">${peso(t.balanceAfter)}</td>
                <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.referenceNumber || '—')}</td>
            </tr>`).join('');
    } catch (err) { console.error(err); tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">Server error.</div></td></tr>'; }
}

document.getElementById('histSearch')?.addEventListener('input', () => {
    clearTimeout(window.__histT);
    window.__histT = setTimeout(loadHistory, 350);
});
document.getElementById('histClearBtn')?.addEventListener('click', () => { setValue('histSearch', ''); loadHistory(); });

document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    if (!historyRows.length) { showToast('Nothing to export.', 'warning'); return; }
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Date','Time','Type','Ref','Driver ID','Driver','Amount','Prev','Balance After','Processed By','Status'].map(cell).join(',')];
    historyRows.forEach(t => lines.push([t.date, t.time, t.type, t.referenceNumber || '', t.driverId, t.driverName, t.amount, t.previousBalance, t.balanceAfter, t.processedBy, t.status].map(cell).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bctt-load-history-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    showToast('CSV exported.', 'success');
});

async function loadReferences() {
    const tb = document.getElementById('refTable');
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">Loading…</div></td></tr>';
    const q = (document.getElementById('refSearch')?.value || '').trim();
    try {
        const res = await window.api('payments.php', { query: { action: 'list', type: 'LOAD', q, limit: 500 } });
        if (!res.success || !res.data.transactions.length) {
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No reference records.</div></td></tr>';
            return;
        }
        tb.innerHTML = res.data.transactions.map(t => {
            const orDisplay = t.orNumber ? t.orNumber : '—';
            return `
            <tr>
                <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.referenceNumber || '—')}</td>
                <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(orDisplay)}</td>
                <td>${escapeHtml(t.driverName || t.driverId || '—')}</td>
                <td style="color:var(--green);font-weight:800;">+${peso(t.amount)}</td>
                <td>${escapeHtml(t.processedBy || '—')}</td>
                <td>${escapeHtml(t.date || '')}<br><span style="font-size:.65rem;color:var(--text-soft);">${escapeHtml(t.time || '')}</span></td>
                <td><span class="status-badge successful">SUCCESSFUL</span></td>
            </tr>`;
        }).join('');
    } catch (err) { console.error(err); tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">Server error.</div></td></tr>'; }
}
document.getElementById('refSearch')?.addEventListener('input', () => {
    clearTimeout(window.__refT);
    window.__refT = setTimeout(loadReferences, 350);
});

async function loadToday() {
    try {
        const res = await window.api('payments.php', { query: { action: 'list', type: 'LOAD', limit: 500 } });
        if (!res.success) return;
        const today = new Date().toLocaleDateString('en-CA');
        const tx = (res.data.transactions || []).filter(t => (t.date || '').startsWith(today));
        const ok = tx.filter(t => String(t.status).toUpperCase() === 'SUCCESSFUL').length;
        setText('todayTotalCount', tx.length);
        setText('todayTotalAmount', peso(tx.reduce((a, t) => a + Number(t.amount || 0), 0)));
        setText('todaySuccessful', ok);
        setText('todayFailed', Math.max(tx.length - ok, 0));
        setText('todayDate', new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }));
        const tb = document.getElementById('todayTable');
        if (!tb) return;
        if (!tx.length) tb.innerHTML = '<tr><td colspan="6"><div class="empty-inline">No loads today.</div></td></tr>';
        else tb.innerHTML = tx.map(t => `
            <tr>
                <td>${escapeHtml(t.time || '')}</td>
                <td>${escapeHtml(t.driverName || t.driverId || '—')}</td>
                <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.driverId || '—')}</td>
                <td style="color:var(--green);font-weight:800;">+${peso(t.amount)}</td>
                <td style="font-family:'Courier New',monospace;font-size:.72rem;">${escapeHtml(t.referenceNumber || '—')}</td>
                <td><span class="status-badge successful">SUCCESSFUL</span></td>
            </tr>`).join('');
    } catch (err) { console.error(err); }
}

async function loadAttendance() {
    try {
        const res = await window.api('attendance.php', { query: { action: 'list', date: new Date().toLocaleDateString('en-CA') } });
        if (!res || !res.success) return;
        const me = window.CURRENT_USER || {};
        const myName = (me.fullName || me.username || '').toLowerCase();
        const mine = (res.data.records || []).find(r => (r.name || r.user_name || '').toLowerCase() === myName);
        if (!mine) return;
        const timeIn = mine.timeIn || mine.time_in || '—';
        const timeOut = mine.timeOut || mine.time_out || '—';
        const status = mine.status || 'NOT CLOCKED IN';
        setText('attTimeIn', timeIn ? new Date(timeIn).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');
        setText('attTimeOut', timeOut ? new Date(timeOut).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');
        setText('cashierTimeIn', timeIn ? new Date(timeIn).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');
        const s = String(status).toUpperCase();
        const cls = s === 'ON TIME' ? 'active' : s === 'LATE' ? 'pending' : s === 'NOT CLOCKED IN' ? 'neutral' : 'failed';
        const html = `<span class="status-badge ${cls}">${escapeHtml(s.replace(/_/g, ' '))}</span>`;
        const el1 = document.getElementById('attStatus'); if (el1) el1.innerHTML = html;
        const el2 = document.getElementById('cashierAttStatus'); if (el2) el2.innerHTML = html;
    } catch (err) { console.error(err); }
}

document.getElementById('timeInBtn')?.addEventListener('click', async () => {
    try {
        const res = await window.api('attendance.php', { method: 'POST', body: { action: 'time-in' } });
        setText('attMessage', res.success ? 'Time In recorded.' : (res.message || 'Failed.'));
        if (res.success) { loadAttendance(); showToast('Time In recorded.', 'success'); }
    } catch { showToast('Server error.', 'error'); }
});

document.getElementById('timeOutBtn')?.addEventListener('click', () => {
    const doTimeOut = async () => {
        try {
            const res = await window.api('attendance.php', { method: 'POST', body: { action: 'time-out' } });
            setText('attMessage', res.success ? 'Time Out recorded.' : (res.message || 'Failed.'));
            if (res.success) { loadAttendance(); showToast('Time Out recorded.', 'success'); }
        } catch { showToast('Server error.', 'error'); }
    };
    if (window.ConfirmModal) window.ConfirmModal.show({ title: 'Confirm Time Out?', message: 'Record your time out for today?', confirmText: 'Confirm', cancelText: 'Cancel', onConfirm: doTimeOut });
    else if (confirm('Record time out?')) doTimeOut();
});

function showReceipt(t, onDone) {
    receiptOnDone = onDone || null;
    const isLoad = String(t.type).toUpperCase() === 'LOAD';
    setText('receiptHeading', isLoad ? 'PREPAID BALANCE LOAD RECORD' : 'TERMINAL FEE RECEIPT');
    const st = document.getElementById('receiptStamp');
    if (st) { st.textContent = isLoad ? 'LOADED' : 'PAID'; st.className = 'receipt-stamp ' + (isLoad ? 'is-load' : 'is-fee'); }
    setText('rAmount', (isLoad ? '+' : '') + peso(t.amount));
    setText('rRef', t.referenceNumber || '—');
    setText('rOrNumber', t.orNumber || '—');
    setText('rDate', (t.date || '') + ' · ' + (t.time || ''));
    setText('rDriver', t.driverName || '—');
    setText('rDriverId', t.driverId || '—');
    setText('rVehicleType', t.vehicleType || '—');
    setText('rBodyNumber', t.bodyNumber || '—');
    setText('rPlate', t.plateNumber || '—');
    setText('rPrev', peso(t.previousBalance));
    setText('rLoaded', peso(t.amount));
    setText('rAfter', peso(t.balanceAfter));
    setText('rMethod', t.paymentMethod || 'CASH');
    setText('rBy', t.processedBy || '—');
    setText('rStatus', String(t.status || 'SUCCESSFUL').toUpperCase());
    openModal('receiptModal');
}

document.getElementById('receiptDoneBtn')?.addEventListener('click', () => {
    closeModal('receiptModal');
    const cb = receiptOnDone;
    receiptOnDone = null;
    if (cb) cb();
});

document.getElementById('receiptPrintBtn')?.addEventListener('click', () => {
    document.body.classList.add('printing-receipt');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
});

document.getElementById('passwordForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const cp = document.getElementById('currentPassword');
    const np = document.getElementById('newPassword');
    const cf = document.getElementById('confirmPassword');
    const msg = document.getElementById('profileMsg');
    if (!cp || !np || !cf || !msg) return;
    msg.className = 'account-msg';
    msg.textContent = '';
    if (!cp.value) { msg.textContent = 'Enter your current password.'; msg.classList.add('error'); return; }
    if (np.value.length < 8) { msg.textContent = 'New password must be at least 8 characters.'; msg.classList.add('error'); return; }
    if (np.value !== cf.value) { msg.textContent = 'New passwords do not match.'; msg.classList.add('error'); return; }
    try {
        const res = await window.api('change_password.php', { method: 'POST', body: { currentPassword: cp.value, newPassword: np.value } });
        if (res.success) { msg.textContent = 'Password updated successfully.'; msg.classList.add('success'); document.getElementById('passwordForm').reset(); showToast('Password updated.', 'success'); }
        else { msg.textContent = res.message || 'Failed.'; msg.classList.add('error'); }
    } catch { msg.textContent = 'Server error. Please try again.'; msg.classList.add('error'); }
});

async function initCashierStationsMap(forceRefresh = false) {
    const mapEl = document.getElementById('cashierStationsMap');
    if (!mapEl || typeof L === 'undefined') return;
    if (!cashierStationsMapInstance) {
        cashierStationsMapInstance = L.map('cashierStationsMap', { center: [11.6080, 125.4316], zoom: 11, zoomControl: true, scrollWheelZoom: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap | Borongan BCTT' }).addTo(cashierStationsMapInstance);
    }
    try {
        const res = await window.api('terminals.php');
        const list = (res && res.success && res.data && res.data.terminals) ? res.data.terminals : [];
        if (!list.length) return;
        Object.values(cashierStationMarkers).forEach(m => cashierStationsMapInstance.removeLayer(m));
        cashierStationMarkers = {};
        const markersGroup = [];
        const gridEl = document.getElementById('cashierStationsList');
        let html = '';
        list.forEach(t => {
            const isReceiving = (t.code || '').startsWith('RS');
            const pinBg = isReceiving ? '#16A34A' : '#8B1D2C';
            const typeLabel = isReceiving ? 'Checkpoint' : 'Ticketing Station';
            const iconHtml = `<div style="width:34px;height:34px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.25);border:2px solid #fff;"><i class="fas ${isReceiving ? 'fa-clipboard-check' : 'fa-ticket'}" style="font-size:12px;"></i></div>`;
            const icon = L.divIcon({ html: iconHtml, className: 'cashier-map-pin', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
            const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(cashierStationsMapInstance);
            marker.bindPopup(`<div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:200px;"><span style="font-size:10px;font-weight:800;color:${pinBg};background:${isReceiving ? '#F0FDF4' : '#F5E8EA'};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span><h4 style="font-size:12px;font-weight:700;margin:5px 0 4px 0;color:#1F2937;">${escapeHtml(t.name)}</h4><p style="font-size:11px;color:#6B7280;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p></div>`);
            cashierStationMarkers[t.code] = marker;
            markersGroup.push(marker);
            html += `<div class="station-card" onclick="focusCashierStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})"><div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;"><span class="station-code ${isReceiving ? 'green' : 'maroon'}">${escapeHtml(t.code)}</span><span style="font-size:.6rem;font-weight:800;color:var(--text-soft);text-transform:uppercase;">${typeLabel}</span></div><div class="station-name">${escapeHtml(t.name)}</div><div class="station-address"><i class="fas fa-location-dot" style="color:var(--maroon);margin-right:.25rem;"></i>${escapeHtml(t.address || 'Borongan City')}</div></div><div class="station-foot"><span><i class="fas fa-location-crosshairs"></i> View on Map</span><i class="fas fa-arrow-right"></i></div></div>`;
        });
        if (gridEl) gridEl.innerHTML = html;
        if (markersGroup.length > 0) { const group = new L.featureGroup(markersGroup); cashierStationsMapInstance.fitBounds(group.getBounds().pad(0.12)); }
        if (forceRefresh) showToast('Stations updated.', 'success');
    } catch (e) { console.warn('Stations load failed:', e); }
}
window.initCashierStationsMap = initCashierStationsMap;
window.focusCashierStation = function(code, lat, lng) {
    if (cashierStationsMapInstance && lat && lng) {
        cashierStationsMapInstance.flyTo([lat, lng], 16, { duration: 1.2 });
        if (cashierStationMarkers[code]) setTimeout(() => cashierStationMarkers[code].openPopup(), 400);
    }
};

window.authReady.then(u => {
    if (!u) return;
    currentUser = u;
    const roleName = { cashier: 'Cashier', staff: 'Terminal Staff', admin: 'Administrator' }[u.role] || u.role;
    setText('userNameChip', u.fullName || u.username || 'Cashier');
    setText('greetingName', u.fullName || u.username || 'Cashier');
    setText('todayCashierName', u.fullName || u.username || '—');
    setText('profName', u.fullName || u.username || '—');
    setText('profUsername', '@' + (u.username || ''));
    setText('profRole', roleName.toUpperCase());
    setText('sidebarUser', (u.fullName || u.username || 'Cashier') + ' · ' + roleName);
    setText('dropdownUserName', u.fullName || u.username || 'Cashier');
    const avatarChip = document.getElementById('userAvatarChip');
    if (avatarChip) avatarChip.textContent = (u.fullName || u.username || 'C').charAt(0).toUpperCase();

    const shiftStart = Date.now();
    function tickShift() {
        const mins = Math.floor((Date.now() - shiftStart) / 60000);
        setText('shiftDuration', mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm');
    }
    tickShift();
    setInterval(tickShift, 30000);

    updateTopbarDateTime();
    setInterval(updateTopbarDateTime, 30000);

    refreshDashboard();
    loadAttendance();
    startDashboardPolling();
    startNotifPolling();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            if (currentPage === 'dashboard') refreshDashboard();
            startDashboardPolling();
            startNotifPolling();
        } else {
            stopDashboardPolling();
            stopNotifPolling();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.altKey && e.key === 'l') { e.preventDefault(); navigateTo('load'); }
        if (e.altKey && e.key === 'h') { e.preventDefault(); navigateTo('history'); }
    });
});