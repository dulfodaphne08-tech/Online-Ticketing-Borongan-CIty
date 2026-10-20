const MAX_LOAD = 50000;
const POLL_MS = 3000;

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
let currentChartRange = 'days';
let loadChartInstance = null;
let paymentDonutInstance = null;
let cashierTransactionsCache = [];

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
    el.innerHTML = '<span class="dot"></span> Live';
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
    if (!page) return;
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

    try {
        sessionStorage.setItem('cashier_active_page', page);
        if ((location.hash || '').replace('#', '') !== page) {
            history.replaceState(null, '', '#' + page);
        }
    } catch (e) {}

       if (page === 'dashboard') refreshDashboard(true);    
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

window.addEventListener('hashchange', () => {
    const p = (location.hash || '').replace('#', '').trim();
    if (p && document.getElementById('page-' + p)) navigateTo(p);
});

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

async function refreshDashboard(forceAnalytics = false) {
    if (!currentUser) return;

 
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
            if (!show.length) {
                tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No loads recorded today.</div></td></tr>';
            } else {
                tb.innerHTML = show.map(t => `
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
        }

         setText('lastUpdatedTime', new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }));
        setSyncIndicator('ok');

         refreshCashierAnalytics(forceAnalytics);

    } catch (err) {
        console.error(err);
         setSyncIndicator('error');
    }
}

 function buildChartBuckets(range, transactions) {
    const now = new Date();
    const buckets = [];

    if (range === 'days') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toLocaleDateString('en-CA');
            const matches = transactions.filter(t => (t.date || '').startsWith(key));
            const value = matches.reduce((s, t) => s + Number(t.amount || 0), 0);
            buckets.push({
                label: days[d.getDay()],
                shortLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                value,
                count: matches.length,
                date: d
            });
        }
        return {
            buckets,
            title: `${buckets[0].shortLabel} – ${buckets[buckets.length - 1].shortLabel}`,
            avgLabel: 'Daily Avg'
        };
    }

    if (range === 'weeks') {
        for (let i = 5; i >= 0; i--) {
            const end = new Date(now);
            end.setDate(end.getDate() - i * 7);
            const start = new Date(end);
            start.setDate(start.getDate() - 6);
            const startKey = start.toLocaleDateString('en-CA');
            const endKey = end.toLocaleDateString('en-CA');
            let value = 0, count = 0;
            transactions.forEach(t => {
                const dk = (t.date || '').slice(0, 10);
                if (dk >= startKey && dk <= endKey) { value += Number(t.amount || 0); count++; }
            });
            buckets.push({
                label: `W${6 - i}`,
                shortLabel: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                value,
                count,
                date: end
            });
        }
        return { buckets, title: 'Last 6 Weeks', avgLabel: 'Weekly Avg' };
    }

    if (range === 'months') {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            let value = 0, count = 0;
            transactions.forEach(t => {
                if ((t.date || '').startsWith(key)) { value += Number(t.amount || 0); count++; }
            });
            buckets.push({
                label: monthNames[d.getMonth()],
                shortLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                value,
                count,
                date: d
            });
        }
        return { buckets, title: 'Last 6 Months', avgLabel: 'Monthly Avg' };
    }

    const currentYear = now.getFullYear();
    for (let i = 4; i >= 0; i--) {
        const y = currentYear - i;
        let value = 0, count = 0;
        transactions.forEach(t => {
            if ((t.date || '').startsWith(String(y))) { value += Number(t.amount || 0); count++; }
        });
        buckets.push({
            label: String(y),
            shortLabel: String(y),
            value,
            count,
            date: new Date(y, 0, 1)
        });
    }
    return { buckets, title: 'Last 5 Years', avgLabel: 'Yearly Avg' };
}

function computeNiceAxis(maxValue) {
    if (!maxValue || maxValue <= 0) {
        return { max: 500, step: 100 };
    }
    const padded = maxValue * 1.35;
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];
    let step = 1;
    for (const s of niceSteps) {
        if (padded / s <= 6) {
            step = s;
            break;
        }
    }
    if (step < 1) step = 1;
    const max = Math.ceil(padded / step) * step;
    return { max, step };
}

 let lastAnalyticsSignature = '';

async function refreshCashierAnalytics(force = false) {
    try {
        const res = await window.api('payments.php', { query: { action: 'list', type: 'LOAD', limit: 1000 } });
        if (!res || !res.success) return;

        const newTx = res.data.transactions || [];

         const firstKey = newTx[0]
            ? (newTx[0].referenceNumber || newTx[0].id || (newTx[0].date + newTx[0].time) || '')
            : '';
        const total = newTx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2);
        const signature = `${newTx.length}|${firstKey}|${total}`;

         if (!force && signature === lastAnalyticsSignature) return;

        lastAnalyticsSignature = signature;
        cashierTransactionsCache = newTx;

        setTimeout(() => {
            renderLoadChart();
            renderPaymentDonut();
        }, 100);

    } catch (err) {
        console.warn('Analytics load failed:', err);
    }
}
function renderLoadChart() {
    const canvas = document.getElementById('loadChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const { buckets, title, avgLabel } = buildChartBuckets(currentChartRange, cashierTransactionsCache);
    const values = buckets.map(b => b.value);
    const total = values.reduce((s, v) => s + v, 0);
    const activeBuckets = buckets.filter(b => b.value > 0).length;
    const avg = activeBuckets > 0 ? total / activeBuckets : 0;
    const best = buckets.reduce((b, x) => x.value > b.value ? x : b, buckets[0]);

    const rangeLabel = document.getElementById('chartRangeLabel');
    if (rangeLabel) rangeLabel.textContent = title;

    const statsEl = document.getElementById('loadChartStats');
    if (statsEl) {
        const bestLabel = currentChartRange === 'days' ? 'Best Day'
                       : currentChartRange === 'weeks' ? 'Best Week'
                       : currentChartRange === 'months' ? 'Best Month'
                       : 'Best Year';
        statsEl.innerHTML = `
            <div class="chart-stat">
                <span class="cs-label"><i class="fas fa-sigma"></i> Period Total</span>
                <span class="cs-value">${peso(total)}</span>
            </div>
            <div class="chart-stat">
                <span class="cs-label"><i class="fas fa-calculator"></i> ${avgLabel}</span>
                <span class="cs-value">${peso(avg)}</span>
            </div>
            <div class="chart-stat">
                <span class="cs-label"><i class="fas fa-trophy"></i> ${bestLabel}</span>
                <span class="cs-value">${best.value > 0 ? best.shortLabel : '—'}</span>
            </div>`;
    }

    const ctx = canvas.getContext('2d');
    if (loadChartInstance) loadChartInstance.destroy();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, 320);
    fillGrad.addColorStop(0, 'rgba(22, 163, 74, 0.2)');
    fillGrad.addColorStop(0.5, 'rgba(22, 163, 74, 0.05)');
    fillGrad.addColorStop(1, 'rgba(22, 163, 74, 0)');

    const maxData = Math.max(...values, 0);
    const { max: yMax, step: stepSize } = computeNiceAxis(maxData);

    loadChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Amount Loaded',
                data: values,
                borderColor: '#16A34A',
                borderWidth: 2.5,
                backgroundColor: fillGrad,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBackgroundColor: '#16A34A',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 20, right: 20, bottom: 6, left: 6 } },
            animation: { duration: 600, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1F2937',
                    titleColor: '#fff',
                    titleFont: { family: 'Inter', size: 13, weight: '800' },
                    bodyColor: '#E5E7EB',
                    bodyFont: { family: 'Inter', size: 12, weight: '600' },
                    padding: { top: 12, right: 16, bottom: 12, left: 16 },
                    cornerRadius: 10,
                    displayColors: true,
                    boxWidth: 10,
                    boxHeight: 10,
                    boxPadding: 6,
                    callbacks: {
                        title: (items) => buckets[items[0].dataIndex].shortLabel,
                        label: (c) => {
                            const i = c.dataIndex;
                            const v = Number(c.parsed.y) || 0;
                            return [`Amount: ${peso(v)}`, `Transactions: ${buckets[i].count}`];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: yMax,
                    ticks: {
                        stepSize: stepSize,
                        font: { family: 'Inter', size: 11, weight: '600' },
                        color: '#9CA3AF',
                        padding: 12,
                        callback: (v) => {
                            if (v === 0) return '₱0';
                            if (v >= 1000000) return '₱' + (v / 1000000).toFixed(1) + 'M';
                            if (v >= 1000)    return '₱' + (v / 1000).toFixed(1) + 'k';
                            return '₱' + v;
                        }
                    },
                    grid: { color: '#F3F4F6', drawBorder: false, drawTicks: false },
                    border: { display: false }
                },
                x: {
                    ticks: {
                        font: { family: 'Inter', size: 12, weight: '700' },
                        color: '#6B7280',
                        padding: 12
                    },
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
}

function renderPaymentDonut() {
    const canvas = document.getElementById('paymentDonut');
    if (!canvas || typeof Chart === 'undefined') return;

    const byMethod = {};
    cashierTransactionsCache.forEach(t => {
        const key = (t.paymentMethod || 'CASH').toUpperCase();
        byMethod[key] = (byMethod[key] || 0) + Number(t.amount || 0);
    });
    const entries = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);

    const palette      = ['#A83244', '#2563EB', '#EA580C', '#16A34A', '#7C3AED', '#0D9488', '#CA8A04'];
    const lightPalette = ['#C14056', '#60A5FA', '#FB923C', '#4ADE80', '#A78BFA', '#5EEAD4', '#FACC15'];

    const totalAmount = entries.reduce((s, [, v]) => s + v, 0);

    let labels, data, colors, lightColors;
    if (entries.length === 0) {
        labels      = ['No data'];
        data        = [1];
        colors      = ['#E5E7EB'];
        lightColors = ['#F3F4F6'];
    } else {
        labels      = entries.map(([k]) => k);
        data        = entries.map(([, v]) => v);
        colors      = palette.slice(0, labels.length);
        lightColors = lightPalette.slice(0, labels.length);
    }

    const ctx = canvas.getContext('2d');
    if (paymentDonutInstance) paymentDonutInstance.destroy();

    const centerText = {
        id: 'centerText',
        afterDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const centerX = (chartArea.left + chartArea.right) / 2;
            const centerY = (chartArea.top + chartArea.bottom) / 2;

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.font = '800 20px Inter, sans-serif';
            ctx.fillStyle = '#1F2937';
            const mainText = entries.length === 0
                ? '₱0'
                : (totalAmount >= 1000 ? '₱' + (totalAmount / 1000).toFixed(1) + 'k' : '₱' + totalAmount.toFixed(0));
            ctx.fillText(mainText, centerX, centerY - 8);

            ctx.font = '800 9px Inter, sans-serif';
            ctx.fillStyle = '#9CA3AF';
            ctx.fillText(entries.length === 0 ? 'NO DATA' : 'TOTAL LOADS', centerX, centerY + 12);

            ctx.restore();
        }
    };

    paymentDonutInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                hoverBackgroundColor: lightColors,
                borderWidth: 4,
                borderColor: '#fff',
                hoverOffset: 8,
                spacing: 3,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '74%',
            animation: { animateRotate: true, animateScale: false, duration: 900, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1F2937',
                    titleColor: '#fff',
                    titleFont: { family: 'Inter', size: 12, weight: '800' },
                    bodyColor: '#E5E7EB',
                    bodyFont: { family: 'Inter', size: 11, weight: '600' },
                    padding: { top: 10, right: 14, bottom: 10, left: 14 },
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: (c) => {
                            const v   = Number(c.parsed) || 0;
                            const tot = (c.dataset.data || []).reduce((a, b) => a + b, 0);
                            const pct = tot > 0 ? ((v / tot) * 100).toFixed(1) : '0.0';
                            return `  ${peso(v)} (${pct}%)`;
                        }
                    }
                }
            }
        },
        plugins: [centerText]
    });

    const legend = document.getElementById('paymentLegend');
    if (legend) {
        if (entries.length === 0) {
            legend.innerHTML = `
                <div class="donut-legend-empty">
                    <i class="fas fa-receipt"></i>
                    <div>No payment data yet</div>
                    <small>Payment method breakdown will appear here</small>
                </div>`;
        } else {
            const total = data.reduce((a, b) => a + b, 0);
            legend.innerHTML = entries.map(([lbl, v], i) => {
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                return `
                    <div class="lg-row">
                        <span class="lg-dot" style="background:${colors[i]}"></span>
                        <span class="lg-label">${escapeHtml(lbl)}</span>
                        <span class="lg-amount">${peso(v)}</span>
                        <span class="lg-value">${pct}%</span>
                    </div>`;
            }).join('');
        }
    }
}

document.getElementById('refreshStatsBtn')?.addEventListener('click', async () => {
    await refreshDashboard(true);
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

     let maxLimit = 150.00;
    if (d.vehicleType === 'Jeepney' || d.vehicleType === 'Multicab') maxLimit = 500.00;
    if (d.vehicleType === 'Bus') maxLimit = 1000.00;
    
    const capacity = maxLimit - Number(d.balance || 0);
    
     const limitWrap = document.getElementById('ldLimitWrap');
    if (limitWrap) {
        limitWrap.innerHTML = `
            <div class="driver-info-balance-label" style="margin-top:.5rem; color:var(--red);">Max Limit: ${peso(maxLimit)}</div>
            <div class="driver-info-balance-value" style="font-size:.8rem; color:var(--green);">Capacity: ${peso(capacity)}</div>
        `;
    }
 
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
    
     const limitWrap = document.getElementById('ldLimitWrap');
    if (limitWrap) limitWrap.innerHTML = '';
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
    
     let maxLimit = 150.00;
    if (currentDriver.vehicleType === 'Jeepney' || currentDriver.vehicleType === 'Multicab') maxLimit = 500.00;
    if (currentDriver.vehicleType === 'Bus') maxLimit = 1000.00;
    if ((Number(currentDriver.balance || 0) + amt) > maxLimit) {
        if (msg) msg.textContent = `Exceeds maximum wallet balance of ${peso(maxLimit)} for a ${currentDriver.vehicleType}.`;
        return;
    }

    if (msg) msg.textContent = '';

    if (!pendingORNumber) {
        pendingORNumber = generateORNumber();
        const orField = document.getElementById('orNumber');
        if (orField) orField.value = pendingORNumber;
    }

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

    const body = {
        action: 'load',
        driverId: currentDriver.driverId,
        amount: amountValue(),
        paymentMethod: pm ? pm.value : 'CASH',
        orNumber: orValue,
        referenceNumber: orValue,
        confirmDuplicate: false
    };
    
    try {
        const res = await window.api('wallet.php', { method: 'POST', body });
        setBusy(btn, false);
        loading = false;
        closeModal('confirmLoadModal');
        
        if (res.success) {
            pendingORNumber = '';
            showReceipt(res.data.receipt, () => resetLoad());
            refreshDashboard();
            return;
        }
        
        if (res.code === 'MAX_BALANCE_EXCEEDED') {
            showToast(res.message, 'error');
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
            const isOffice = (t.code || '') === 'BCTT';
            const pinBg = isOffice ? '#b22234' : (isReceiving ? '#16A34A' : '#8B1D2C');
            const typeLabel = isOffice ? 'Main Office' : (isReceiving ? 'Checkpoint' : 'Ticketing Station');
            const iconHtml = `<div style="width:34px;height:34px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.25);border:2px solid #fff;"><i class="fas ${isOffice ? 'fa-building' : (isReceiving ? 'fa-clipboard-check' : 'fa-ticket')}" style="font-size:12px;"></i></div>`;
            const icon = L.divIcon({ html: iconHtml, className: 'cashier-map-pin', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
            const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(cashierStationsMapInstance);
            marker.bindPopup(`<div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:200px;"><span style="font-size:10px;font-weight:800;color:${pinBg};background:${isOffice ? '#FDF2F4' : (isReceiving ? '#F0FDF4' : '#F5E8EA')};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span><h4 style="font-size:12px;font-weight:700;margin:5px 0 4px 0;color:#1F2937;">${escapeHtml(t.name)}</h4><p style="font-size:11px;color:#6B7280;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p></div>`);
            cashierStationMarkers[t.code] = marker;
            markersGroup.push(marker);
            
            html += `<div class="station-card" onclick="focusCashierStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})"><div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;"><span class="station-code ${isOffice ? 'maroon' : (isReceiving ? 'green' : 'maroon')}">${escapeHtml(t.code)}</span><span style="font-size:.6rem;font-weight:800;color:var(--text-soft);text-transform:uppercase;">${typeLabel}</span></div><div class="station-name">${escapeHtml(t.name)}</div><div class="station-address"><i class="fas fa-location-dot" style="color:var(--maroon);margin-right:.25rem;"></i>${escapeHtml(t.address || 'Borongan City')}</div></div><div class="station-foot"><span><i class="fas fa-location-crosshairs"></i> View on Map</span><i class="fas fa-arrow-right"></i></div></div>`;
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

document.querySelectorAll('#chartRangeToggle .range-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('#chartRangeToggle .range-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-selected', 'true');
        currentChartRange = this.dataset.range || 'days';
        renderLoadChart();
    });
});

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

    const fromHash = (location.hash || '').replace('#', '').trim();
    const activePage = fromHash || sessionStorage.getItem('cashier_active_page') || 'dashboard';
    if (activePage && document.getElementById('page-' + activePage)) {
        navigateTo(activePage);
    } else {
        refreshDashboard();
    }
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

 
document.getElementById('btnStartCamera')?.addEventListener('click', async () => {
    const btnStart = document.getElementById('btnStartCamera');
    const btnStop = document.getElementById('btnStopCamera');
    const container = document.getElementById('qrCameraReader');
    const statusText = document.getElementById('verifyStatus');

    try {
        container.style.display = 'block';
        btnStart.hidden = true;
        btnStop.hidden = false;
        statusText.textContent = "Opening camera...";
        
        await window.QrScanner.startCamera('qrCameraReader', onCameraScanSuccess);
        statusText.textContent = "Camera active. Point at driver's QR code.";
    } catch (err) {
        console.error(err);
        container.style.display = 'none';
        btnStart.hidden = false;
        btnStop.hidden = true;
        statusText.textContent = "Camera error: " + err.message;
        showToast("Could not start camera. Ensure you are on HTTPS or localhost.", "error");
    }
});

document.getElementById('btnStopCamera')?.addEventListener('click', stopVerificationCamera);

async function stopVerificationCamera() {
    if (window.QrScanner) {
        await window.QrScanner.stopCamera();
    }
    const container = document.getElementById('qrCameraReader');
    container.style.display = 'none';
    container.innerHTML = '';
    document.getElementById('btnStartCamera').hidden = false;
    document.getElementById('btnStopCamera').hidden = true;
    document.getElementById('verifyStatus').textContent = "Camera stopped.";
}

 async function onCameraScanSuccess(payload, rawText) {
    if (!payload || !payload.driverId) {
        showToast("Invalid QR Code format.", "error");
        return;
    }
    
     document.getElementById('verifyPlaceholder').style.display = 'none';
    
    document.getElementById('verifyStatus').textContent = `Scanned ID: ${payload.driverId}. Fetching...`;
    await stopVerificationCamera();
    
    document.getElementById('verifyScannerInput').value = payload.driverId;
    await verifyDriverById(payload.driverId);
}

 document.getElementById('verifyManualBtn')?.addEventListener('click', () => {
    const id = document.getElementById('verifyScannerInput').value.trim();
    if (id) verifyDriverById(id);
});

 document.getElementById('verifyScannerInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const id = e.target.value.trim();
        if (id) verifyDriverById(id);
    }
});

async function verifyDriverById(driverId) {
    const statusText = document.getElementById('verifyStatus');
    const resultBox = document.getElementById('verifyResult');
    const placeholder = document.getElementById('verifyPlaceholder');
    const btn = document.getElementById('verifyManualBtn');
    
    statusText.textContent = "Searching for driver...";
    resultBox.hidden = true;
    if (placeholder) placeholder.style.display = 'flex';  
    
     if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        const res = await window.api('wallet.php', { query: { action: 'search', q: driverId } });
        
        if (res && res.success && res.data && res.data.drivers && res.data.drivers.length > 0) {
             const d = res.data.drivers[0]; 
            
            if (placeholder) placeholder.style.display = 'none';  
            resultBox.hidden = false;
            resultBox.style.display = 'flex'; 

            const av = document.getElementById('vAvatar');
            if (av) av.innerHTML = d.photo ? `<img src="${escapeHtml(d.photo)}" alt="">` : `<span>${escapeHtml((d.fullName || 'D').charAt(0).toUpperCase())}</span>`;
            
            setText('vName', d.fullName || '—');
            setText('vDriverId', d.driverId || '—');
            setText('vVehicle', d.vehicleType || '—');
            setText('vPlate', d.plateNumber || '—');
            setText('vBalance', peso(d.balance));
            
            const loadBtn = document.getElementById('verifyLoadBtn');
            if (loadBtn) {
                const newLoadBtn = loadBtn.cloneNode(true);
                loadBtn.parentNode.replaceChild(newLoadBtn, loadBtn);
                newLoadBtn.addEventListener('click', () => {
                    currentDriver = d;
                    navigateTo('load');
                    selectLoadDriver(d);
                });
            }

             showToast("Driver identified!", "success");
            
        } else {
             statusText.textContent = `No driver found. Scanned text: "${driverId}"`;
            showToast(`Not found: "${driverId}"`, "error");
            if (placeholder) placeholder.style.display = 'flex';  
        }
    } catch (err) {
        console.error(err);
        statusText.textContent = "Error fetching driver data.";
        showToast("Server error while searching.", "error");
        if (placeholder) placeholder.style.display = 'flex';  
    } finally {
         if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-search"></i> Verify';
        }
    }
}

 const originalNavigateTo = window.navigateTo;
window.navigateTo = function(page) {
    if (page !== 'verify') {
        stopVerificationCamera();
    }
    originalNavigateTo(page);
};