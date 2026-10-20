const LOW_BALANCE = 50;
const LARGE_AMOUNT_THRESHOLD = 500;
const TERMINAL_OFFLINE_MINUTES = 30;
const NOTIFICATION_REFRESH_MS = 60000;
const NOTIFICATION_DEDUP_HOURS = 6;

const VEHICLE_FEES = { Tricycle: 5, Jeepney: 60, Multicab: 60, Bus: 100 };

let drivers = [];
let transactions = [];
let users = [];
let auditLogs = [];
let notifications = [];
let feeHistory = [];
let fees = { Tricycle: 5, Jeepney: 60, Multicab: 60, Bus: 100 };
let currentAdminUser = null;
let __notificationPollTimer = null;
let __liveStatusTimer = null;
let __stationActivityTimer = null;
let __recentMovementsTimer = null;
let liveStatusData = null;
let stationActivityData = [];
let recentMovementsData = [];
let cashierActivityData = [];
let driverBalanceChart = null;

function $(id) { return document.getElementById(id); }
function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

function peso(n) {
  return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg, type) {
  const c = $("toastContainer");
  if (!c) return;
  const icons = { success: "fa-check-circle", error: "fa-exclamation-circle", warning: "fa-triangle-exclamation" };
  const t = document.createElement("div");
  t.className = "toast " + (type || "success");
  t.innerHTML = '<span class="toast-icon"><i class="fas ' + (icons[type] || icons.success) + '"></i></span>' +
                '<span class="toast-msg">' + escapeHtml(msg) + '</span>' +
                '<button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>';
  c.appendChild(t);
  setTimeout(() => { t.classList.add("hiding"); setTimeout(() => t.remove(), 300); }, 4000);
}
window.showToast = showToast;

function openModal(id) { const el = $(id); if (el) el.classList.add("active"); }
function closeModal(id) { const el = $(id); if (el) el.classList.remove("active"); }
window.openModal = openModal;
window.closeModal = closeModal;

function syncIndicator(state) {
  const el = $("syncIndicator");
  if (!el) return;
  el.className = "sync-indicator";
  if (state === "ok") el.innerHTML = '<span class="dot"></span> Live';
  else if (state === "warning") { el.className = "sync-indicator warning"; el.innerHTML = '<span class="dot"></span> Syncing…'; }
  else if (state === "error") { el.className = "sync-indicator error"; el.innerHTML = '<span class="dot"></span> Offline'; }
}
window.syncIndicator = syncIndicator;

function isFeeSuccess(t) {
  const s = String(t.status || "").toLowerCase();
  return t.type === "FEE" && (s === "successful" || s === "completed" || s === "success");
}
function isLoadSuccess(t) {
  const s = String(t.status || "").toLowerCase();
  return t.type === "LOAD" && (s === "successful" || s === "completed" || s === "success");
}

function navigateTo(page) {
  if (!page) return;
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  const target = $("page-" + page);
  if (target) target.classList.add("active");

  document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
  const btn = document.querySelector('.sidebar-item[data-page="' + page + '"]');
  if (btn) btn.classList.add("active");

  if (window.innerWidth <= 768) {
    const sb = $("sidebar");
    if (sb) sb.classList.remove("open");
  }
  window.scrollTo({ top: 0, behavior: "instant" });

  try {
    sessionStorage.setItem("admin_active_page", page);
    if ((location.hash || "").replace("#", "") !== page) {
      history.replaceState(null, "", "#" + page);
    }
  } catch (e) {}

  if (page === "terminals-map") {
    setTimeout(() => {
      if (adminMap) {
        adminMap.invalidateSize();
        if (terminalMarkers && terminalMarkers.length > 0) {
          const group = new L.featureGroup(terminalMarkers);
          adminMap.fitBounds(group.getBounds().pad(0.15));
        }
      }
    }, 50);
    setTimeout(() => { if (adminMap) adminMap.invalidateSize(); }, 150);
  } else if (page === "dashboard") {
    setTimeout(() => { if (dashboardMiniMap) dashboardMiniMap.invalidateSize(); }, 50);
    refreshLiveStatus();
    refreshStationActivity();
    refreshRecentMovements();
    refreshCashierActivity();
  }
}
window.navigateTo = navigateTo;

window.addEventListener("hashchange", () => {
  const p = (location.hash || "").replace("#", "").trim();
  if (p && $("page-" + p)) {
    navigateTo(p);
    refreshCurrentPage(p);
  }
});

function initSidebar() {
  if (window.__adminSidebarBound === true) return;
  window.__adminSidebarBound = true;

  document.querySelectorAll(".sidebar-item[data-page]").forEach(item => {
    item.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const page = this.dataset.page;
      if (!page) return;

      navigateTo(page);
      refreshCurrentPage(page);

      const dataPages = ['dashboard', 'wallet', 'transactions', 'verifications', 'references', 'report-terminal', 'report-daily', 'users', 'drivers', 'vehicles'];
      if (dataPages.includes(page)) {
        loadAllDataFromDB().then(() => refreshCurrentPage(page));
      }
    });
  });
}

function refreshCurrentPage(page) {
  switch (page) {
    case "dashboard":
      updateDashboard();
      loadActivityFeed();
      refreshLiveStatus();
      refreshStationActivity();
      refreshRecentMovements();
      refreshCashierActivity();
      break;
    case "users":                renderUsers(); break;
    case "drivers":              renderDrivers(); break;
    case "vehicles":             renderVehicles(); break;
    case "wallet":               renderWalletPage(); break;
    case "transactions":         renderTransactions(); break;
    case "verifications":        renderVerifications(); break; 
    case "references":           renderReferences(); break;
    case "report-transactions":  break;
    case "report-terminal":      renderTerminalReport(); break;
    case "terminals-map":        loadTerminalsData(); break;
    case "report-daily":         break;
    case "report-attendance":    break;
    case "attendance":           loadAttendance(); break;
    case "notifications":        renderNotificationsPage(); break;
    case "audit":                loadAuditLogs(); break;
    case "fees":                 loadFees(); break;
    case "fee-history":          loadFeeHistory(); break;
    case "settings":             break;
    case "change-password":      break;
    case "system-settings":      loadSystemSettings(); break;
    case "staff-assignments":    loadStaffAssignments(); break;
    case "inquiries":            if (typeof __refreshInquiries === 'function') __refreshInquiries(); break;
  }
}

let __dataCache = {
  drivers: null,
  transactions: null,
  fees: null,
  users: null,
  lastFetch: 0
};
const CACHE_TTL = 15000;
let __loadingPromise = null;

async function loadAllDataFromDB(forceRefresh = false) {
  const now = Date.now();
  const cacheValid = !forceRefresh && (now - __dataCache.lastFetch) < CACHE_TTL && __dataCache.drivers !== null;

  if (cacheValid) {
    syncIndicator("ok");
    return;
  }

  if (__loadingPromise) return __loadingPromise;

  syncIndicator("warning");

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 90);
  const fromStr = from.toLocaleDateString("en-CA");
  const toStr = today.toLocaleDateString("en-CA");

  __loadingPromise = (async () => {
    const results = await Promise.allSettled([
      window.api("drivers.php").catch(e => ({ success: false, _err: e })),
      window.api("payments.php", {
        query: { action: "list", type: "ALL", from: fromStr, to: toStr, limit: 1000 }  
      }).catch(e => ({ success: false, _err: e })),
      window.api("fees.php").catch(e => ({ success: false, _err: e })),
      window.api("users.php").catch(e => ({ success: false, _err: e })),
    ]);

    const [d, p, f, u] = results.map(r => r.status === "fulfilled" ? r.value : null);

    if (d && d.success && d.data) {
      drivers = d.data.drivers || [];
      __dataCache.drivers = drivers;
    } else if (d && d._err) console.error("[drivers.php] ERROR:", d._err);

    if (p && p.success && p.data) {
      transactions = (p.data.transactions || []).map(normalizeTransaction).reverse();
      __dataCache.transactions = transactions;
    } else if (p && p._err) console.error("[payments.php] ERROR:", p._err);

    if (f && f.success && f.data) {
      fees = f.data.fees || fees;
      __dataCache.fees = fees;
    } else if (f && f._err) console.error("[fees.php] ERROR:", f._err);

    if (u && u.success && u.data) {
      users = u.data.users || [];
      __dataCache.users = users;
    } else if (u && u._err) console.error("[users.php] ERROR:", u._err);

    __dataCache.lastFetch = Date.now();
    syncIndicator("ok");

    if (typeof loadNotifications === "function") {
      loadNotifications().catch(e => console.warn("notifications failed:", e));
    }
  })();

  try {
    await __loadingPromise;
  } finally {
    __loadingPromise = null;
  }
}
window.loadAllDataFromDB = loadAllDataFromDB;

async function refreshLiveStatus(btn = null) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const res = await window.api("payments.php", { query: { action: "live_status" } });
    if (!res || !res.success) {
      console.warn("live_status failed:", res && res.message);
      return;
    }
    liveStatusData = res.data || {};
    renderLiveStatus();
  } catch (e) {
    console.warn("Live status fetch failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i>'; }
  }
}
window.refreshLiveStatus = refreshLiveStatus;

function renderLiveStatus() {
  const online   = Number(liveStatusData?.onlineStaff    ?? 0);
  const stations = Number(liveStatusData?.activeStations ?? 0);
  const entries  = Number(liveStatusData?.recentEntries  ?? 0);
  const exits    = Number(liveStatusData?.recentExits    ?? 0);

  setText("liveOnlineStaff",    online);
  setText("liveActiveStations", stations);
  setText("liveRecentEntries",  entries);
  setText("liveRecentExits",    exits);

  const list = $("liveStaffList");
  if (!list) return;

  const staff = Array.isArray(liveStatusData?.staffList) ? liveStatusData.staffList : [];
  if (!staff.length) {
    list.innerHTML = '<div class="empty-inline">No staff activity in the last 15 minutes</div>';
    return;
  }

  list.innerHTML = staff.map(s => {
    const initial = (s.name || "S").charAt(0).toUpperCase();
    return `
      <div class="live-staff-item">
        <div class="live-staff-avatar">${escapeHtml(initial)}</div>
        <div class="live-staff-info">
          <div class="live-staff-name">${escapeHtml(s.name || "Staff")}</div>
          <div class="live-staff-station">${escapeHtml(s.station || "—")}${s.lastSeen ? ' · ' + formatRelativeTime(s.lastSeen) : ''}</div>
        </div>
        <div class="live-staff-dot"></div>
      </div>
    `;
  }).join("");
}

async function refreshStationActivity(btn = null) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const res = await window.api("payments.php", { query: { action: "station_activity", hours: 24 } });
    if (!res || !res.success) {
      console.warn("station_activity failed:", res && res.message);
      return;
    }
    stationActivityData = Array.isArray(res.data?.stations) ? res.data.stations : [];
    renderStationActivity();
  } catch (e) {
    console.warn("Station activity fetch failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i>'; }
  }
}
window.refreshStationActivity = refreshStationActivity;

function renderStationActivity() {
  const tbody = $("stationActivityTable");
  if (!tbody) return;

  if (!stationActivityData.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-inline">No station data available</div></td></tr>';
    setText("stationActivityTotalFees", "₱0.00");
    setText("stationActivityActiveCount", "0 active");
    return;
  }

  const now = Date.now();
  let totalFees = 0;
  let activeCount = 0;

  const rowsHtml = stationActivityData.map(s => {
    totalFees += Number(s.feeTotal || 0);
    if (String(s.status || "").toLowerCase() === "active") activeCount++;

    const lastMs = s.lastActivity ? new Date(s.lastActivity).getTime() : 0;
    const minutes = lastMs ? (now - lastMs) / 60000 : Infinity;

    let dotCls = "offline";
    if (s.status === "active") {
      if (minutes <= 15) dotCls = "online";
      else if (minutes <= 30) dotCls = "idle";
    }

    const lastText = s.lastActivity ? formatRelativeTime(s.lastActivity) : "No activity";
    
    const staffText = Number(s.feeStaffCount || 0) > 0
      ? `<span class="staff-count">${s.feeStaffCount}</span>`
      : `<span class="staff-count empty">—</span>`;

    return `<tr>
      <td>
        <div class="station-cell">
          <span class="live-dot ${dotCls}"></span>
          <span class="station-code">${escapeHtml(s.code)}</span>
        </div>
        <div class="station-name-sub">${escapeHtml(s.name)}</div>
      </td>
      <td class="text-center"><span class="metric-pill fee">${s.feeCount || 0}</span></td>
      <td class="text-right font-bold text-primary">₱${Number(s.feeTotal || 0).toFixed(2)}</td>
      <td class="text-center">${staffText}</td>
      <td class="text-sm text-gray-500">${lastText}</td>
    </tr>`;
  }).join("");

  tbody.innerHTML = rowsHtml;
  setText("stationActivityTotalFees", "₱" + totalFees.toFixed(2));
  setText("stationActivityActiveCount", activeCount + " active");
}

async function refreshCashierActivity(btn = null) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const res = await window.api("payments.php", { query: { action: "cashier_activity" } });
    if (!res || !res.success) return;
    cashierActivityData = Array.isArray(res.data?.cashiers) ? res.data.cashiers : [];
    renderCashierActivity();
  } catch (e) {
    console.warn("Cashier activity fetch failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i>'; }
  }
}
window.refreshCashierActivity = refreshCashierActivity;

function renderCashierActivity() {
  const list = $("cashierActivityList");
  if (!list) return;

  if (!cashierActivityData.length) {
    list.innerHTML = '<div class="empty-inline">No wallet loads processed today.</div>';
    return;
  }

  list.innerHTML = cashierActivityData.map(c => `
    <div class="live-staff-item" style="margin-bottom:.5rem;">
      <div class="live-staff-avatar" style="background:#059669;">${escapeHtml((c.name || 'C').charAt(0).toUpperCase())}</div>
      <div class="live-staff-info">
        <div class="live-staff-name">${escapeHtml(c.name)}</div>
        <div class="live-staff-station">
          <strong style="color:var(--green);">₱${Number(c.totalLoaded).toLocaleString('en-PH', {minimumFractionDigits: 2})}</strong> 
          · ${c.loadCount} load${c.loadCount === 1 ? '' : 's'}
        </div>
      </div>
      <div style="font-size:.65rem; color:var(--text-soft);">${formatRelativeTime(c.lastActive)}</div>
    </div>
  `).join("");
}

async function refreshRecentMovements(btn = null) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const res = await window.api("payments.php", { query: { action: "recent_movements", limit: 30 } });
    if (!res || !res.success) {
      console.warn("recent_movements failed:", res && res.message);
      return;
    }
    recentMovementsData = Array.isArray(res.data?.movements) ? res.data.movements : [];
    renderRecentMovements();
  } catch (e) {
    console.warn("Recent movements fetch failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i>'; }
  }
}
window.refreshRecentMovements = refreshRecentMovements;

function renderRecentMovements() {
  const container = $("recentMovementsList");
  if (!container) return;

  if (!recentMovementsData.length) {
    container.innerHTML = '<div class="empty-inline">No vehicle movements recorded yet</div>';
    return;
  }

  container.innerHTML = recentMovementsData.map(m => {
    const isEntry = m.movementType === "ENTRY";
    const color   = isEntry ? "entry" : "exit";
    const icon    = isEntry ? "fa-arrow-right-to-bracket" : "fa-arrow-right-from-bracket";
    const label   = isEntry ? "ENTRY" : "EXIT";
    return `
      <div class="movement-item ${color}">
        <div class="movement-icon ${color}"><i class="fas ${icon}"></i></div>
        <div class="movement-body">
          <div class="movement-header">
            <span class="movement-type ${color}">${label}</span>
            <span class="movement-station">${escapeHtml(m.stationName || m.stationCode || "—")}</span>
          </div>
          <div class="movement-driver">
            <strong>${escapeHtml(m.driverName || "Unknown")}</strong>
            <span class="movement-vehicle">${escapeHtml(m.vehicleType || "—")} · ${escapeHtml(m.plateNumber || "—")}</span>
          </div>
          <div class="movement-meta">
            <span><i class="fas fa-user"></i> ${escapeHtml(m.processedBy || "System")}</span>
            <span><i class="fas fa-clock"></i> ${m.createdAt ? formatRelativeTime(m.createdAt) : "—"}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function initDriverBalanceChart() {
  const canvas = $("driverBalanceChart");
  if (!canvas || typeof Chart === 'undefined') return;
  if (driverBalanceChart) driverBalanceChart.destroy();

  const brackets = { "₱0-50": 0, "₱51-200": 0, "₱201-500": 0, "₱500+": 0 };
  drivers.forEach(d => {
    const bal = Number(d.balance || 0);
    if (bal <= 50) brackets["₱0-50"]++;
    else if (bal <= 200) brackets["₱51-200"]++;
    else if (bal <= 500) brackets["₱201-500"]++;
    else brackets["₱500+"]++;
  });

  const ctx = canvas.getContext("2d");
  driverBalanceChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(brackets),
      datasets: [{
        data: Object.values(brackets),
        backgroundColor: ["#DC2626", "#CA8A04", "#2563EB", "#16A34A"],
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { family: "Inter", size: 11 } } },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.parsed} driver${c.parsed === 1 ? '' : 's'}`
          }
        }
      }
    }
  });
}

function checkEndOfDaySummary() {
  const lastShown = localStorage.getItem("bctt_eod_date");
  const todayStr = new Date().toLocaleDateString("en-CA");
  
  if (lastShown === todayStr) return;
  if (new Date().getHours() < 18) return;  

  const todayFees = transactions.filter(t => isFeeSuccess(t) && t.date === todayStr);
  const todayLoads = transactions.filter(t => isLoadSuccess(t) && t.date === todayStr);
  const feeTotal = todayFees.reduce((s, t) => s + t.amount, 0);
  const loadTotal = todayLoads.reduce((s, t) => s + t.amount, 0);
  const lowBal = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE).length;

  if (todayFees.length === 0 && todayLoads.length === 0) return;

  setText("eodScans", todayFees.length);
  setText("eodFees", peso(feeTotal));
  setText("eodLoads", peso(loadTotal));
  setText("eodAlerts", lowBal);
  
  openModal("eodSummaryModal");
  localStorage.setItem("bctt_eod_date", todayStr);
}

function startLiveMonitoring() {
  stopLiveMonitoring();
  refreshLiveStatus();
  refreshStationActivity();
  refreshRecentMovements();
  refreshCashierActivity();

  __liveStatusTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshLiveStatus();
  }, 15000);

  __stationActivityTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshStationActivity();
  }, 30000);

  __recentMovementsTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshRecentMovements();
  }, 20000);
  
  setInterval(() => {
    if (document.visibilityState === "visible") refreshCashierActivity();
  }, 30000);
}

function stopLiveMonitoring() {
  if (__liveStatusTimer) clearInterval(__liveStatusTimer);
  if (__stationActivityTimer) clearInterval(__stationActivityTimer);
  if (__recentMovementsTimer) clearInterval(__recentMovementsTimer);
  __liveStatusTimer = null;
  __stationActivityTimer = null;
  __recentMovementsTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if ((location.hash || "").includes("dashboard")) {
      refreshLiveStatus();
      refreshStationActivity();
      refreshRecentMovements();
      refreshCashierActivity();
    }
  }
});

function normalizeTransaction(t) {
  const created = t.created_at || t.createdAt;
  let date = t.date, time = t.time;
  if (created) {
    const d = new Date(created);
    if (!Number.isNaN(d.getTime())) {
      date = d.toLocaleDateString("en-CA");
      time = d.toTimeString().slice(0, 8);
    }
  }

  const rawType = String(t.type || "FEE").toUpperCase();
  const status = String(t.status || "SUCCESSFUL");
  
   const movementType = t.movementType || null;

  return {
    ...t,
    id: t.referenceNumber || t.id,
    vehicleType: t.vehicleType || "Not recorded",
    plateNumber: t.plateNumber || "Not recorded",
    driverId: t.driverId || "",
    driverName: t.driverName || "Unknown driver",
    amount: Number(t.amount || 0),
    type: rawType,  
    movementType: movementType,  
    status: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
    balance: t.balanceAfter != null ? Number(t.balanceAfter) : null,
    balanceBefore: t.balanceBefore != null ? Number(t.balanceBefore) : null,
    recordedBy: t.processedBy || t.staffName || "System",
    reference: t.referenceNumber || t.id || "",
    orNumber: t.orNumber || null,
    stationId: t.stationId || null,
    stationCode: t.stationCode || null,
    stationName: t.stationName || null,
    staffId: t.staffId || null,
    staffName: t.staffName || t.processedBy || null,
    date, time,
  };
}

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  let cls = "successful";
  if (s.includes("fail")) cls = "failed";
  else if (s.includes("insufficient")) cls = "insufficient";
  else if (s.includes("pending")) cls = "pending";
  return '<span class="status-badge ' + cls + '">' + escapeHtml(status) + '</span>';
}

function typeBadge(type) {
  const t = String(type || "FEE").toUpperCase();
  return '<span class="type-badge ' + (t === "LOAD" ? "load" : "fee") + '">' + t + '</span>';
}

function approvalBadge(approval) {
  const a = String(approval || "Active").toLowerCase();
  let cls = "active";
  if (a === "pending") cls = "pending";
  else if (a.includes("correction")) cls = "needs-correction";
  else if (a === "inactive") cls = "inactive";
  return '<span class="approval-badge ' + cls + '">' + escapeHtml(approval || "Active") + '</span>';
}

async function loadNotifications() {
  let loaded = null;
  try {
    const res = await window.api("notifications.php", { query: { limit: 100, unread_only: 0 } });
    if (res && res.success && res.data && Array.isArray(res.data.notifications)) {
      loaded = res.data.notifications.map(normalizeNotification);
    }
  } catch (err) {
    console.warn("Backend notifications unavailable, using client-side fallback");
  }

  if (loaded && loaded.length) {
    notifications = loaded;
  } else {
    notifications = await buildSupabaseNotifications();
  }

  notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
  renderNotificationPanel();
  updateNotificationBadge();
  if (typeof renderNotificationsPage === "function") renderNotificationsPage();
}
window.loadNotifications = loadNotifications;

function normalizeNotification(n) {
  return {
    id: String(n.id ?? Math.random().toString(36).slice(2)),
    type: normalizeNotifType(n.type),
    category: n.category || "system",
    title: n.title || "Notification",
    message: n.message || "",
    time: n.time || n.created_at || n.createdAt || new Date().toISOString(),
    unread: n.unread === true || n.is_read === false,
    actionUrl: n.actionUrl || n.action_url || null,
    actionLabel: n.actionLabel || n.action_label || null,
    referenceId: n.referenceId || n.reference_id || null,
  };
}

function normalizeNotifType(t) {
  const s = String(t || "info").toLowerCase();
  if (["critical", "error", "danger"].includes(s)) return "critical";
  if (["warning", "warn"].includes(s)) return "warning";
  if (["success", "ok"].includes(s)) return "success";
  return "info";
}

async function buildSupabaseNotifications() {
  const list = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const failedTxns = transactions.filter(t => {
    const txDate = new Date(t.date + "T" + (t.time || "00:00:00"));
    return txDate >= oneDayAgo && /fail|error|declined/i.test(t.status);
  });
  if (failedTxns.length > 0) {
    const last = failedTxns[failedTxns.length - 1];
    list.push({
      id: "critical-failed-txns",
      type: "critical",
      category: "transaction",
      title: `${failedTxns.length} failed transaction${failedTxns.length > 1 ? "s" : ""}`,
      message: `Most recent: ${last.driverName} — ₱${last.amount.toFixed(2)}`,
      time: nowIso,
      unread: true,
      actionUrl: "transactions",
      actionLabel: "Review Failures",
      referenceId: last.reference || last.id,
    });
  }

  const lowBal = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE);
  if (lowBal.length > 0) {
    const lowest = Math.min(...lowBal.map(d => Number(d.balance || 0)));
    list.push({
      id: "low-balance-drivers",
      type: "warning",
      category: "driver",
      title: `${lowBal.length} driver${lowBal.length > 1 ? "s" : ""} with low balance`,
      message: `Below ₱${LOW_BALANCE} threshold. Lowest: ₱${lowest.toFixed(2)}`,
      time: nowIso,
      unread: true,
      actionUrl: "drivers",
      actionLabel: "View Drivers",
    });
  }

  const pendingDrivers = drivers.filter(d => String(d.approvalStatus || "").toLowerCase() === "pending");
  if (pendingDrivers.length > 0) {
    list.push({
      id: "pending-drivers",
      type: "warning",
      category: "driver",
      title: `${pendingDrivers.length} pending driver registration${pendingDrivers.length > 1 ? "s" : ""}`,
      message: `Awaiting admin review and approval`,
      time: nowIso,
      unread: true,
      actionUrl: "drivers",
      actionLabel: "Review Now",
    });
  }

  const largeTxns = transactions.filter(t => {
    const txDate = new Date(t.date + "T" + (t.time || "00:00:00"));
    return txDate >= oneDayAgo && t.amount >= LARGE_AMOUNT_THRESHOLD;
  });
  if (largeTxns.length > 0) {
    const largest = Math.max(...largeTxns.map(t => t.amount));
    list.push({
      id: "large-transactions",
      type: "info",
      category: "transaction",
      title: `${largeTxns.length} large transaction${largeTxns.length > 1 ? "s" : ""} (≥ ₱${LARGE_AMOUNT_THRESHOLD})`,
      message: `Largest: ₱${largest.toFixed(2)}`,
      time: nowIso,
      unread: true,
      actionUrl: "transactions",
      actionLabel: "View Details",
    });
  }

  const today = now.toLocaleDateString("en-CA");
  const todayTxns = transactions.filter(t => t.date === today);
  const todayFees = todayTxns.filter(t => t.type === "FEE");
  const todayLoads = todayTxns.filter(t => t.type === "LOAD");
  const todayFeesTotal = todayFees.reduce((s, t) => s + t.amount, 0);
  const todayLoadsTotal = todayLoads.reduce((s, t) => s + t.amount, 0);

  if (todayTxns.length > 0) {
    list.push({
      id: "daily-summary",
      type: "info",
      category: "system",
      title: `Today's Activity Summary`,
      message: `${todayTxns.length} transactions · Fees: ₱${todayFeesTotal.toFixed(2)} · Loads: ₱${todayLoadsTotal.toFixed(2)}`,
      time: nowIso,
      unread: false,
      actionUrl: "dashboard",
      actionLabel: "View Dashboard",
    });
  }

  const recentFees = transactions.filter(t => t.type === "FEE" && /success/i.test(t.status)).slice(-1);
  if (recentFees.length > 0) {
    const f = recentFees[0];
    list.push({
      id: "recent-fee-" + (f.reference || f.id),
      type: "success",
      category: "transaction",
      title: `Latest terminal fee collected`,
      message: `${f.driverName} — ₱${f.amount.toFixed(2)}${f.stationName ? " at " + f.stationName : ""}`,
      time: f.date ? (f.date + "T" + (f.time || "00:00:00")) : nowIso,
      unread: false,
      actionUrl: "transactions",
      actionLabel: "View Transaction",
    });
  }

  if (typeof terminals !== "undefined" && Array.isArray(terminals) && terminals.length > 0) {
    const offlineTerminals = terminals.filter(t => {
      if ((t.status || "").toLowerCase() !== "active") return false;
      const lastActivity = t.last_activity_at ? new Date(t.last_activity_at) : null;
      if (!lastActivity) return true;
      const minutesSince = (now - lastActivity) / 1000 / 60;
      return minutesSince > TERMINAL_OFFLINE_MINUTES;
    });

    if (offlineTerminals.length > 0) {
      list.push({
        id: "offline-terminals",
        type: "warning",
        category: "terminal",
        title: `${offlineTerminals.length} terminal${offlineTerminals.length > 1 ? "s" : ""} may be offline`,
        message: `No activity in the last ${TERMINAL_OFFLINE_MINUTES} minutes: ${offlineTerminals.slice(0, 3).map(t => t.code).join(", ")}${offlineTerminals.length > 3 ? "…" : ""}`,
        time: nowIso,
        unread: true,
        actionUrl: "terminals-map",
        actionLabel: "View Map",
      });
    }
  }

  if (typeof __inqList !== "undefined" && Array.isArray(__inqList)) {
    const newInqs = __inqList.filter(i => String(i.status || "").toLowerCase() === "new");
    if (newInqs.length > 0) {
      list.push({
        id: "new-inquiries",
        type: "info",
        category: "inquiry",
        title: `${newInqs.length} new inquir${newInqs.length > 1 ? "ies" : "y"}`,
        message: `From ${newInqs[0].name || "Anonymous"}${newInqs.length > 1 ? ` and ${newInqs.length - 1} more` : ""}`,
        time: nowIso,
        unread: true,
        actionUrl: "inquiries",
        actionLabel: "Read Messages",
      });
    }
  }

  return list;
}

function getNotificationVisual(type) {
  switch (type) {
    case "critical":
      return { icon: "fa-circle-exclamation", color: "#DC2626", bg: "#FEE2E2", ring: "rgba(220,38,38,0.15)" };
    case "warning":
      return { icon: "fa-triangle-exclamation", color: "#CA8A04", bg: "#FEFCE8", ring: "rgba(202,138,4,0.15)" };
    case "success":
      return { icon: "fa-circle-check", color: "#16A34A", bg: "#F0FDF4", ring: "rgba(22,163,74,0.15)" };
    default:
      return { icon: "fa-circle-info", color: "#2563EB", bg: "#EFF6FF", ring: "rgba(37,99,235,0.15)" };
  }
}

function renderNotificationPanel() {
  const listEl = $("notificationList");
  if (!listEl) return;

  if (!notifications.length) {
    listEl.innerHTML = '<div class="notification-empty"><i class="fas fa-bell-slash" style="display:block;font-size:1.5rem;margin-bottom:.5rem;opacity:.4;"></i>No notifications yet.</div>';
    return;
  }

  listEl.innerHTML = notifications.slice(0, 15).map(n => {
    const v = getNotificationVisual(n.type);
    const unreadCls = n.unread ? " is-unread" : "";
    const when = n.time ? formatRelativeTime(n.time) : "";

    return `<button type="button" class="notification-item${unreadCls}" data-id="${escapeHtml(n.id)}" data-action="${escapeHtml(n.actionUrl || '')}">
      <span class="notification-item__icon" style="background:${v.bg};color:${v.color};box-shadow:0 0 0 4px ${v.ring};">
        <i class="fas ${v.icon}"></i>
      </span>
      <span>
        <span class="notification-item__title">
          ${escapeHtml(n.title)}
          ${n.unread ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + v.color + ';margin-left:.4rem;vertical-align:middle;"></span>' : ''}
        </span>
        <span class="notification-item__message">${escapeHtml(n.message)}</span>
        <span class="notification-item__time">
          ${escapeHtml(when)}
          ${n.actionLabel ? `<span style="color:${v.color};font-weight:700;margin-left:.4rem;">· ${escapeHtml(n.actionLabel)} →</span>` : ''}
        </span>
      </span>
    </button>`;
  }).join("");

  listEl.querySelectorAll(".notification-item").forEach(item => {
    item.addEventListener("click", async () => {
      const id = item.dataset.id;
      const actionUrl = item.dataset.action;
      const n = notifications.find(x => String(x.id) === String(id));
      if (n && n.unread) {
        n.unread = false;
        try {
          await window.api("notifications.php", {
            method: "PATCH",
            body: { id: n.id, is_read: true }
          });
        } catch (e) {}
      }
      item.classList.remove("is-unread");
      updateNotificationBadge();
      if (typeof renderNotificationsPage === "function") renderNotificationsPage();

      if (actionUrl && $("page-" + actionUrl)) {
        navigateTo(actionUrl);
        const panel = $("notificationPanel");
        if (panel) panel.hidden = true;
      }
    });
  });
}
window.renderNotificationPanel = renderNotificationPanel;

function formatRelativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function updateNotificationBadge() {
  const badge = $("notificationBadge");
  if (!badge) return;
  const unread = notifications.filter(n => n.unread).length;
  badge.textContent = String(unread);
  badge.hidden = unread === 0;
}

async function markAllNotificationsRead() {
  notifications.forEach(n => { n.unread = false; });
  renderNotificationPanel();
  updateNotificationBadge();
  if (typeof renderNotificationsPage === "function") renderNotificationsPage();
  try {
    await window.api("notifications.php", { method: "PATCH", body: { markAll: true } });
  } catch (_) {}
  showToast("Notifications marked as read", "success");
}
window.markAllNotificationsRead = markAllNotificationsRead;

function renderNotificationsPage() {
  const container = $("notificationsFullList");
  if (!container) return;

  if (!notifications.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>No notifications</h3><p>You\'re all caught up.</p></div>';
    return;
  }

  const groups = {
    critical: notifications.filter(n => n.type === "critical"),
    warning:  notifications.filter(n => n.type === "warning"),
    info:     notifications.filter(n => n.type === "info"),
    success:  notifications.filter(n => n.type === "success"),
  };

  const groupLabels = {
    critical: { label: "Critical", color: "#DC2626", icon: "fa-circle-exclamation" },
    warning:  { label: "Warnings", color: "#CA8A04", icon: "fa-triangle-exclamation" },
    info:     { label: "Information", color: "#2563EB", icon: "fa-circle-info" },
    success:  { label: "Recent Activity", color: "#16A34A", icon: "fa-circle-check" },
  };

  let html = "";
  const totalUnread = notifications.filter(n => n.unread).length;

  html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;background:var(--bg-light);border-radius:.6rem;margin-bottom:1rem;">
    <span style="font-size:.8rem;color:var(--text-mid);">
      <strong style="color:var(--text-dark);">${notifications.length}</strong> total ·
      <strong style="color:var(--maroon);">${totalUnread}</strong> unread
    </span>
    ${totalUnread > 0 ? `<button type="button" class="btn-outline btn-sm" onclick="markAllNotificationsRead()"><i class="fas fa-check-double"></i> Mark all read</button>` : ''}
  </div>`;

  ["critical", "warning", "info", "success"].forEach(key => {
    const items = groups[key];
    if (!items.length) return;
    const g = groupLabels[key];
    html += `<div style="margin-bottom:1.25rem;">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;padding-bottom:.35rem;border-bottom:1px dashed var(--border);">
        <i class="fas ${g.icon}" style="color:${g.color};font-size:.85rem;"></i>
        <span style="font-size:.68rem;font-weight:800;color:${g.color};text-transform:uppercase;letter-spacing:.05em;">${g.label} (${items.length})</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:.5rem;">`;

    items.forEach(n => {
      const v = getNotificationVisual(n.type);
      const when = n.time ? formatRelativeTime(n.time) : "";
      html += `<div class="notification-card ${n.unread ? 'is-unread' : ''}" 
                    style="display:flex;gap:.75rem;padding:.85rem 1rem;background:${n.unread ? v.bg : '#fff'};border:1px solid var(--border-soft);border-left:4px solid ${v.color};border-radius:.6rem;transition:all .15s;${n.actionUrl ? 'cursor:pointer;' : ''}"
                    ${n.actionUrl ? `onclick="navigateTo('${escapeHtml(n.actionUrl)}')"` : ''}>
        <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${v.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.85rem;">
          <i class="fas ${v.icon}"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:.5rem;">
            <div style="font-weight:700;font-size:.85rem;color:var(--text-dark);">${escapeHtml(n.title)}</div>
            <div style="font-size:.68rem;color:var(--text-soft);white-space:nowrap;">${escapeHtml(when)}</div>
          </div>
          <div style="font-size:.78rem;color:var(--text-mid);margin-top:.2rem;line-height:1.4;">${escapeHtml(n.message)}</div>
          ${n.actionLabel ? `<div style="margin-top:.5rem;"><span style="font-size:.7rem;font-weight:700;color:${v.color};"><i class="fas fa-arrow-right"></i> ${escapeHtml(n.actionLabel)}</span></div>` : ''}
        </div>
      </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;
}
window.renderNotificationsPage = renderNotificationsPage;

function initNotificationBell() {
  const bell = $("notificationBell");
  const panel = $("notificationPanel");
  if (!bell || !panel) return;
  if (bell.dataset.bound === "1") return;
  bell.dataset.bound = "1";

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    bell.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) loadNotifications();
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }
  });

  const mark = $("markNotificationsRead");
  if (mark && mark.dataset.bound !== "1") {
    mark.dataset.bound = "1";
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      markAllNotificationsRead();
    });
  }

  loadNotifications();
  startNotificationPolling();
}

function startNotificationPolling() {
  if (__notificationPollTimer) clearInterval(__notificationPollTimer);
  __notificationPollTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      loadNotifications();
    }
  }, NOTIFICATION_REFRESH_MS);
}

window.addEventListener("focus", () => {
  if (document.visibilityState === "visible") loadNotifications();
});

let chartRange = 30;
let chartInstance = null;
let vehicleFeesChart = null;
let distributionRadar = null;
let revenueRing = null;

function initChart() {
  initMainAreaChart();
  initVehicleFeesChart();
  initDistributionRadar();
  initRevenueRing();
  initDriverBalanceChart();
}

function initMainAreaChart() {
  const canvas = $("collectionChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const feeGrad = ctx.createLinearGradient(0, 0, 0, 300);
  feeGrad.addColorStop(0, "rgba(107, 21, 32, 0.15)"); 
  feeGrad.addColorStop(1, "rgba(107, 21, 32, 0.0)");

  const loadGrad = ctx.createLinearGradient(0, 0, 0, 300);
  loadGrad.addColorStop(0, "rgba(74, 200, 130, 0.15)");
  loadGrad.addColorStop(1, "rgba(74, 200, 130, 0.0)");

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Fee Collections",
          data: [],
          borderColor: "#6B1520", 
          borderWidth: 2,
          backgroundColor: feeGrad,
          fill: true,
          tension: 0, 
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#6B1520",
          pointBorderWidth: 2,
          pointRadius: 0, 
          pointHoverRadius: 5, 
          pointHoverBackgroundColor: "#6B1520",
          pointHoverBorderColor: "#FFFFFF",
          pointHoverBorderWidth: 2,
          pointHitRadius: 20,
        },
        {
          label: "Wallet Loads",
          data: [],
          borderColor: "#4AC882", 
          borderWidth: 2,
          backgroundColor: loadGrad,
          fill: true,
          tension: 0, 
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#4AC882",
          pointBorderWidth: 2,
          pointRadius: 0, 
          pointHoverRadius: 5, 
          pointHoverBackgroundColor: "#4AC882",
          pointHoverBorderColor: "#FFFFFF",
          pointHoverBorderWidth: 2,
          pointHitRadius: 20,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 10, bottom: 0, left: 0 } },
      interaction: { mode: "index", intersect: false },
      animation: { duration: 800, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1F2937",
          titleColor: "#FFFFFF",
          titleFont: { family: "Inter", size: 11, weight: "700" },
          bodyColor: "#E5E7EB",
          bodyFont: { family: "Inter", size: 11, weight: "600" },
          padding: { top: 10, right: 14, bottom: 10, left: 14 },
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          callbacks: {
            label: (c) => {
              const v = Number(c.parsed.y) || 0;
              return ` ${c.dataset.label}: ₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { family: "Inter", size: 11, weight: "500" },
            color: "#94A3B8", 
            padding: 12,
            maxTicksLimit: 4, 
            callback: (v) => v >= 1000 ? "₱" + (v / 1000).toFixed(1) + "k" : "₱" + Number(v)
          },
          grid: {
            color: "#F1F5F9", 
            drawBorder: false,
            drawTicks: false,
          },
          border: { display: false }
        },
        x: {
          ticks: {
            font: { family: "Inter", size: 11, weight: "500" },
            color: "#94A3B8",
            padding: 12,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7 
          },
          grid: { display: false },
          border: { display: false }
        }
      }
    }
  });

  updateChartData();
}

function updateChartData() {
  if (!chartInstance) return;

  const today = new Date();
  const days = chartRange === 7 ? 7 : chartRange === 30 ? 30 : new Date().getDate();
  const labels = [];
  const feeData = [];
  const loadData = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toLocaleDateString("en-CA");

    const feeTotal = transactions
      .filter(t => t.date === ds && isFeeSuccess(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    const loadTotal = transactions
      .filter(t => t.date === ds && isLoadSuccess(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    if (days <= 7) {
      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
    } else if (days <= 30) {
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    } else {
      labels.push(d.getDate() === 1 || i === 0 ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
    }

    feeData.push(Number(feeTotal.toFixed(2)));
    loadData.push(Number(loadTotal.toFixed(2)));
  }

  const maxVal = Math.max(...feeData, ...loadData, 0);

  let yMax;
  if (maxVal <= 10)         yMax = 10;
  else if (maxVal <= 25)    yMax = 25;
  else if (maxVal <= 50)    yMax = 50;
  else if (maxVal <= 100)   yMax = 100;
  else if (maxVal <= 250)   yMax = 250;
  else if (maxVal <= 500)   yMax = 500;
  else if (maxVal <= 1000)  yMax = 1000;
  else if (maxVal <= 2000)  yMax = 2000;
  else if (maxVal <= 3000)  yMax = 3000;
  else if (maxVal <= 5000)  yMax = 5000;
  else if (maxVal <= 10000) yMax = 10000;
  else                      yMax = Math.ceil(maxVal / 5000) * 5000;

  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = feeData;
  chartInstance.data.datasets[1].data = loadData;
  chartInstance.options.scales.y.max = yMax;
  chartInstance.options.scales.x.ticks.maxTicksLimit = days <= 7 ? 7 : days <= 30 ? 10 : 12;
  chartInstance.update();
  updateChartRangeButtons();
}

function updateChartRangeButtons() {
  ["chartRange7", "chartRange30", "chartRangeMonth"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive =
      (id === "chartRange7" && chartRange === 7) ||
      (id === "chartRange30" && chartRange === 30) ||
      (id === "chartRangeMonth" && chartRange === "month");
    el.classList.toggle("active", isActive);
  });
}

window.updateChartRange = function (range) {
  chartRange = range === "month" ? "month" : Number(range) || 7;
  updateChartData();
};

function initVehicleFeesChart() {
  const canvas = $("vehicleFeesChart");
  if (!canvas) return;
  if (vehicleFeesChart) vehicleFeesChart.destroy();

  const types  = ["Tricycle", "Jeepney", "Multicab", "Bus"];
  const colors = ["#A83244", "#4A6B7C", "#E89B5A", "#8B7BC7"];

  const stats = types.map(type => {
    const completed = transactions.filter(t =>
      isFeeSuccess(t) &&
      String(t.vehicleType || "").toLowerCase() === type.toLowerCase()
    );
    const revenue = completed.reduce((s, t) => s + Number(t.amount || 0), 0);
    return { type, revenue, count: completed.length };
  });

  const maxRevenue = Math.max(...stats.map(s => s.revenue), 0);

  let yMax;
  if (maxRevenue <= 50)         yMax = 50;
  else if (maxRevenue <= 100)   yMax = 100;
  else if (maxRevenue <= 200)   yMax = 200;
  else if (maxRevenue <= 500)   yMax = 500;
  else if (maxRevenue <= 1000)  yMax = 1000;
  else if (maxRevenue <= 2000)  yMax = Math.ceil(maxRevenue / 500) * 500;
  else if (maxRevenue <= 5000)  yMax = Math.ceil(maxRevenue / 1000) * 1000;
  else                          yMax = Math.ceil(maxRevenue / 5000) * 5000;

  vehicleFeesChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: types,
      datasets: [{
        label: "Total Fee Revenue",
        data: stats.map(s => s.revenue),
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 44
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 12, right: 8, bottom: 4, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1F2937",
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: "Inter", size: 11, weight: "700" },
          bodyFont: { family: "Inter", size: 11, weight: "600" },
          displayColors: false,
          callbacks: {
            label: (c) => {
              const s = stats[c.dataIndex];
              return [
                `Revenue: ₱${s.revenue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                `Transactions: ${s.count}`
              ];
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            color: "#B0BAC7",
            font: { family: "Inter", size: 10, weight: "600" },
            padding: 8,
            maxTicksLimit: 5,
            callback: (v) => v >= 1000 ? "₱" + (v / 1000).toFixed(0) + "k" : "₱" + Number(v).toLocaleString()
          },
          grid: { color: "rgba(228, 234, 238, 0.5)", drawBorder: false, drawTicks: false },
          border: { display: false }
        },
        x: {
          ticks: { color: "#6B7C87", font: { family: "Inter", size: 11, weight: "700" }, padding: 6 },
          grid: { display: false },
          border: { display: false }
        }
      }
    }
  });
}

function initDistributionRadar() {
  const canvas = $("distributionRadar");
  if (!canvas) return;
  if (distributionRadar) distributionRadar.destroy();

  const types = ["Tricycle", "Jeepney", "Multicab", "Bus"];
  const colors = ["#A83244", "#4A6B7C", "#E89B5A", "#8B7BC7"];

  const counts = types.map(type =>
    transactions.filter(t =>
      isFeeSuccess(t) &&
      String(t.vehicleType || "").toLowerCase() === type.toLowerCase()
    ).length
  );

  const maxCount = Math.max(...counts, 0);

  let xMax;
  if (maxCount <= 5)        xMax = 5;
  else if (maxCount <= 10)  xMax = 10;
  else if (maxCount <= 20)  xMax = 20;
  else if (maxCount <= 50)  xMax = 50;
  else if (maxCount <= 100) xMax = 100;
  else                      xMax = Math.ceil(maxCount / 100) * 100;

  distributionRadar = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: types,
      datasets: [{
        label: "Completed Transactions",
        data: counts,
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 24
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 6, right: 12, bottom: 6, left: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1F2937",
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: "Inter", size: 11, weight: "700" },
          bodyFont: { family: "Inter", size: 11, weight: "600" },
          displayColors: false,
          callbacks: {
            label: (c) => ` ${c.parsed.x} completed transaction${c.parsed.x === 1 ? "" : "s"}`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          max: xMax,
          ticks: {
            color: "#B0BAC7",
            font: { family: "Inter", size: 10, weight: "600" },
            padding: 6,
            precision: 0
          },
          grid: { color: "rgba(228, 234, 238, 0.5)", drawBorder: false, drawTicks: false },
          border: { display: false }
        },
        y: {
          ticks: { color: "#6B7C87", font: { family: "Inter", size: 11, weight: "700" }, padding: 6 },
          grid: { display: false },
          border: { display: false }
        }
      }
    }
  });
}

function initRevenueRing() {
  const canvas = $("revenueRing");
  if (!canvas) return;
  if (revenueRing) revenueRing.destroy();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-CA");

  const monthFeeRevenue = transactions
    .filter(t => isFeeSuccess(t) && t.date >= monthStart)
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const target = Number(localStorage.getItem("bctt_revenue_target") || 50000);
  const pct = Math.min(100, target > 0 ? (monthFeeRevenue / target) * 100 : 0);

  const pctEl = $("revenuePct");
  const labelEl = $("revenueLabel");
  const periodEl = $("revenuePeriodLabel");
  if (pctEl) pctEl.textContent = Math.round(pct) + "%";
  if (labelEl) labelEl.textContent = `₱${monthFeeRevenue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ₱${target.toLocaleString()}`;
  if (periodEl) periodEl.textContent = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  revenueRing = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["Collected", "Remaining"],
      datasets: [{
        data: [monthFeeRevenue || 0.01, Math.max(target - monthFeeRevenue, 0.01)],
        backgroundColor: ["#6B1520", "#EEF3F8"],
        borderWidth: 0,
        borderRadius: 10,
        spacing: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "78%",
      animation: { animateRotate: true, duration: 800, easing: "easeOutQuart" },
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    }
  });
}

window.updateChart = function () {
  updateChartData();
  initVehicleFeesChart();
  initDistributionRadar();
  initRevenueRing();
  initDriverBalanceChart();
};

window.openRevenueTargetModal = function () {
  const current = Number(localStorage.getItem("bctt_revenue_target") || 50000);
  const val = prompt("Set monthly revenue target (₱):", String(current));
  if (val === null) return;
  const n = Number(String(val).replace(/[^0-9.]/g, ""));
  if (!n || n <= 0) { showToast("Please enter a valid amount", "error"); return; }
  localStorage.setItem("bctt_revenue_target", String(n));
  initRevenueRing();
  showToast("Revenue target updated to ₱" + n.toLocaleString(), "success");
};

const ACTIVITY_ICONS = {
  login:       { icon: "fa-right-to-bracket",     color: "#2563EB", bg: "#EFF6FF" },
  logout:      { icon: "fa-right-from-bracket",   color: "#6B7280", bg: "#F3F4F6" },
  load:        { icon: "fa-wallet",               color: "#16A34A", bg: "#F0FDF4" },
  fee:         { icon: "fa-receipt",              color: "#8B1D2C", bg: "#F5E8EA" },
  low_balance: { icon: "fa-triangle-exclamation", color: "#DC2626", bg: "#FEE2E2" },
  driver:      { icon: "fa-id-card",              color: "#7C3AED", bg: "#F5F3FF" },
  vehicle:     { icon: "fa-car",                  color: "#0D9488", bg: "#F0FDFA" },
  user:        { icon: "fa-user-gear",            color: "#EA580C", bg: "#FFF7ED" },
  reference:   { icon: "fa-file-invoice",         color: "#CA8A04", bg: "#FEFCE8" },
  system:      { icon: "fa-gear",                 color: "#6B7280", bg: "#F3F4F6" }
};

function classifyActivity(log) {
  const action = String(log.action || log.Action || "").toLowerCase();
  if (action.includes("login")) return "login";
  if (action.includes("logout")) return "logout";
  if (action.includes("load")) return "load";
  if (action.includes("low") || action.includes("insufficient")) return "low_balance";
  if (action.includes("fee") || action.includes("collect") || action.includes("payment") || action.includes("transaction")) return "fee";
  if (action.includes("driver")) return "driver";
  if (action.includes("vehicle") || action.includes("plate")) return "vehicle";
  if (action.includes("user") || action.includes("account")) return "user";
  if (action.includes("reference") || action.includes("or number")) return "reference";
  return "system";
}

function formatActivityTime(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).replace(" ", "T"));
  if (isNaN(d)) return String(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + " min ago";
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + " hr ago";
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay + " day" + (diffDay === 1 ? "" : "s") + " ago";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function buildLocalActivityFeed() {
  const feed = [];
  const now = new Date();

  transactions.slice(-8).forEach(t => {
    const ts = t.date ? (t.date + "T" + (t.time || "00:00:00")) : now.toISOString();
    const kind = t.type === "LOAD" ? "load" : "fee";
    const verb = t.type === "LOAD" ? "loaded" : "collected fee from";
    const amt = "₱" + Number(t.amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
    feed.push({
      kind,
      title: kind === "load" ? "Wallet Load Processed" : "Terminal Fee Collected",
      message: `${t.recordedBy || "System"} ${verb} ${t.driverName || "driver"} — ${amt}`,
      time: ts
    });
  });

  drivers.slice(-4).forEach(d => {
    feed.push({
      kind: "driver",
      title: "Driver Registered",
      message: `${d.fullName || "New driver"}${d.vehicleType ? " · " + d.vehicleType : ""}${d.plateNumber ? " (" + d.plateNumber + ")" : ""}`,
      time: d.registrationDate || d.createdAt || now.toISOString()
    });
  });

  users.slice(-3).forEach(u => {
    feed.push({
      kind: "user",
      title: "Account Created",
      message: `${u.fullName || u.username} added as ${u.roleLabel || u.role}`,
      time: u.createdAt || u.registrationDate || now.toISOString()
    });
  });

  feed.sort((a, b) => new Date(b.time) - new Date(a.time));
  return feed.slice(0, 10);
}

function renderActivityFeed(container, activities) {
  container.innerHTML = activities.map(a => {
    const meta = ACTIVITY_ICONS[a.kind] || ACTIVITY_ICONS.system;
    return `
      <div style="display:flex;gap:.65rem;padding:.65rem .8rem;border-bottom:1px solid #F1F5F9;transition:background .15s;" onmouseover="this.style.background='#FDF2F4'" onmouseout="this.style.background='transparent'">
        <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:${meta.bg};color:${meta.color};display:flex;align-items:center;justify-content:center;font-size:.8rem;">
          <i class="fas ${meta.icon}"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:.5rem;">
            <div style="font-size:.75rem;font-weight:700;color:#1F2937;">${escapeHtml(a.title)}</div>
            <div style="font-size:.65rem;color:#9CA3AF;white-space:nowrap;">${escapeHtml(formatActivityTime(a.time))}</div>
          </div>
          <div style="font-size:.72rem;color:#6B7280;margin-top:.15rem;line-height:1.4;">${escapeHtml(a.message)}</div>
        </div>
      </div>`;
  }).join("");
}

async function loadActivityFeed(showToastFlag = false) {
  const container = $("recentActivities");
  if (!container) return;

  const local = buildLocalActivityFeed();

  if (local.length) {
    renderActivityFeed(container, local);
  } else {
    container.innerHTML = '<div class="empty-inline"><i class="fas fa-spinner fa-spin"></i> Loading activities…</div>';
  }

  try {
    const res = await window.api("audit_logs.php", { query: { limit: 30 } });
    if (res && res.success && res.data && Array.isArray(res.data.logs) && res.data.logs.length) {
      const activities = res.data.logs.map(log => ({
        kind: classifyActivity(log),
        title: log.action || "Activity",
        message: `${log.user || "System"}${log.recordRef ? " · " + log.recordRef : ""}${log.details ? " · " + log.details : ""}`,
        time: log.createdAt || log.timestamp || new Date().toISOString()
      }));
      renderActivityFeed(container, activities);
    } else if (!local.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:1.5rem 1rem;">
          <div style="width:48px;height:48px;border-radius:50%;background:#F3F4F6;display:inline-flex;align-items:center;justify-content:center;margin-bottom:.5rem;">
            <i class="fas fa-clock" style="color:#9CA3AF;font-size:1.1rem;"></i>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:#6B7280;">No activities yet</div>
          <div style="font-size:.75rem;color:#9CA3AF;margin-top:.15rem;">Recent actions will appear here</div>
        </div>`;
    }
  } catch (e) {
    if (!local.length) {
      container.innerHTML = '<div class="empty-inline">No activities yet</div>';
    }
  }

  if (showToastFlag) showToast("Activity feed refreshed", "success");
}

window.loadActivityFeed = loadActivityFeed;

function computeDashboardAlerts() {
  const alerts = [];

  const lowBal = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE);
  if (lowBal.length > 0) {
    const sorted = lowBal.slice().sort((a, b) => Number(a.balance || 0) - Number(b.balance || 0));
    alerts.push({
      severity: 'warning',
      icon: 'fa-triangle-exclamation',
      title: lowBal.length + ' driver' + (lowBal.length > 1 ? 's' : '') + ' below ₱' + LOW_BALANCE,
      message: 'Lowest: ' + (sorted[0].fullName || 'Unknown') + ' — ₱' + Number(sorted[0].balance || 0).toFixed(2),
      actionLabel: 'View Drivers',
      actionPage: 'drivers'
    });
  }

  const cutoff24 = Date.now() - 24 * 60 * 60 * 1000;
  const failed = transactions.filter(t => {
    if (!t.date) return false;
    const d = new Date(t.date + 'T' + (t.time || '00:00:00'));
    return d.getTime() >= cutoff24 && /fail|error|declined|insufficient/i.test(String(t.status || ''));
  });
  if (failed.length > 0) {
    const last = failed[failed.length - 1];
    alerts.push({
      severity: 'critical',
      icon: 'fa-circle-exclamation',
      title: failed.length + ' failed transaction' + (failed.length > 1 ? 's' : '') + ' (last 24h)',
      message: 'Most recent: ' + (last.driverName || 'Unknown') + ' — ₱' + Number(last.amount || 0).toFixed(2),
      actionLabel: 'Review Transactions',
      actionPage: 'transactions'
    });
  }

  const pending = drivers.filter(d => String(d.approvalStatus || '').toLowerCase() === 'pending');
  if (pending.length > 0) {
    alerts.push({
      severity: 'info',
      icon: 'fa-id-card',
      title: pending.length + ' driver registration' + (pending.length > 1 ? 's' : '') + ' pending',
      message: 'Awaiting admin review and approval',
      actionLabel: 'Review Now',
      actionPage: 'drivers'
    });
  }

  if (typeof terminals !== 'undefined' && Array.isArray(terminals) && terminals.length > 0) {
    const now = Date.now();
    const offline = terminals.filter(t => {
      if ((t.status || '').toLowerCase() !== 'active') return false;
      if (!t.last_activity_at) return true;
      return (now - new Date(t.last_activity_at).getTime()) / 60000 > TERMINAL_OFFLINE_MINUTES;
    });
    if (offline.length > 0) {
      alerts.push({
        severity: 'warning',
        icon: 'fa-map-location-dot',
        title: offline.length + ' terminal' + (offline.length > 1 ? 's' : '') + ' may be offline',
        message: 'No activity in ' + TERMINAL_OFFLINE_MINUTES + ' min: ' + offline.slice(0, 3).map(t => t.code).join(', '),
        actionLabel: 'View Map',
        actionPage: 'terminals-map'
      });
    }
  }

  if (typeof __inqList !== 'undefined' && Array.isArray(__inqList)) {
    const newInq = __inqList.filter(i => String(i.status || '').toLowerCase() === 'new');
    if (newInq.length > 0) {
      alerts.push({
        severity: 'info',
        icon: 'fa-envelope',
        title: newInq.length + ' new inquir' + (newInq.length > 1 ? 'ies' : 'y'),
        message: 'Awaiting response from admin',
        actionLabel: 'Read Messages',
        actionPage: 'inquiries'
      });
    }
  }

  return alerts;
}

function renderDashboardAlerts() {
  const container = $('dashboardAlerts');
  if (!container) return;

  const alerts = computeDashboardAlerts();

  if (!alerts.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:1.5rem 1rem;">
        <div style="width:48px;height:48px;border-radius:50%;background:var(--green-soft);display:inline-flex;align-items:center;justify-content:center;margin-bottom:.5rem;">
          <i class="fas fa-check-circle" style="color:var(--green);font-size:1.2rem;"></i>
        </div>
        <div style="font-size:.88rem;font-weight:700;color:var(--text-dark);">All systems normal</div>
        <div style="font-size:.74rem;color:var(--text-soft);margin-top:.15rem;">No alerts need your attention right now</div>
      </div>`;
    return;
  }

  const colors = {
    critical: { bg: '#FEE2E2', border: '#DC2626', icon: '#DC2626' },
    warning:  { bg: '#FEFCE8', border: '#CA8A04', icon: '#CA8A04' },
    info:     { bg: '#EFF6FF', border: '#2563EB', icon: '#2563EB' }
  };

  container.innerHTML = alerts.map(a => {
    const c = colors[a.severity] || colors.info;
    return `<div style="display:flex;gap:.7rem;padding:.7rem .85rem;margin-bottom:.55rem;background:${c.bg};border-left:4px solid ${c.border};border-radius:.55rem;">
      <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;">
        <i class="fas ${a.icon}" style="color:${c.icon};font-size:.85rem;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.82rem;font-weight:700;color:var(--text-dark);">${escapeHtml(a.title)}</div>
        <div style="font-size:.73rem;color:var(--text-mid);margin-top:.15rem;line-height:1.45;">${escapeHtml(a.message)}</div>
        ${a.actionPage ? `<button type="button" class="btn-outline btn-sm" style="margin-top:.45rem;" onclick="navigateTo('${escapeHtml(a.actionPage)}')">${escapeHtml(a.actionLabel)} <i class="fas fa-arrow-right"></i></button>` : ''}
      </div>
    </div>`;
  }).join('');
}
window.renderDashboardAlerts = renderDashboardAlerts;

function buildSystemInsights() {
  const insights = [];
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA');

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toLocaleDateString('en-CA');
  const vehicleCounts = {};
  transactions.forEach(t => {
    if (!isFeeSuccess(t) || !t.date || t.date < cutoffStr) return;
    const v = t.vehicleType || 'Unknown';
    vehicleCounts[v] = (vehicleCounts[v] || 0) + 1;
  });
  const topVehicle = Object.entries(vehicleCounts).sort((a, b) => b[1] - a[1])[0];
  if (topVehicle) {
    insights.push({
      icon: 'fa-trophy',
      color: '#7C3AED',
      bg: '#F5F3FF',
      text: '<strong>' + escapeHtml(topVehicle[0]) + '</strong> has the highest fee transactions (' + topVehicle[1] + ') over the last 30 days.'
    });
  }

  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const yestStr = yest.toLocaleDateString('en-CA');
  const todayFees = transactions.filter(t => isFeeSuccess(t) && t.date === todayStr).reduce((s, t) => s + Number(t.amount || 0), 0);
  const yestFees  = transactions.filter(t => isFeeSuccess(t) && t.date === yestStr).reduce((s, t) => s + Number(t.amount || 0), 0);

   if (yestFees > 0) {
    const pct = ((todayFees - yestFees) / yestFees) * 100;
    const up = pct >= 0;
    
    let text = "";
    if (pct > 500) {
       text = 'Fee collections are <strong>up significantly</strong> today (₱' + yestFees.toFixed(2) + ' → ₱' + todayFees.toFixed(2) + ').';
    } else if (pct > 0) {
       text = 'Fee collections are <strong>up ' + Math.abs(pct).toFixed(1) + '%</strong> versus yesterday (₱' + yestFees.toFixed(2) + ' → ₱' + todayFees.toFixed(2) + ').';
    } else {
       text = 'Fee collections are <strong>down ' + Math.abs(pct).toFixed(1) + '%</strong> versus yesterday (₱' + yestFees.toFixed(2) + ' → ₱' + todayFees.toFixed(2) + ').';
    }

    insights.push({
      icon: up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
      color: up ? '#16A34A' : '#DC2626',
      bg: up ? '#F0FDF4' : '#FEE2E2',
      text: text
    });
  }

  const lowBal = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE);
  if (lowBal.length > 0) {
    insights.push({
      icon: 'fa-wallet',
      color: '#CA8A04',
      bg: '#FEFCE8',
      text: '<strong>' + lowBal.length + ' driver' + (lowBal.length > 1 ? 's' : '') + '</strong> need wallet replenishment (below ₱' + LOW_BALANCE + '). Cashiers should notify them.'
    });
  }

  const totalTerm = typeof terminals !== 'undefined' ? terminals.length : 0;
  
   const currentHour = today.getHours();
  const isShiftOver = currentHour >= 17;  
  
  let activeTerm = 0;
  if (!isShiftOver && Array.isArray(stationActivityData)) {
    activeTerm = stationActivityData.filter(s => {
      if (!s.lastActivity) return false;
      const activityDate = new Date(s.lastActivity).toLocaleDateString("en-CA");
      return activityDate === todayStr;
    }).length;
  } else if (!isShiftOver) {
    activeTerm = terminals.filter(t => (t.status || 'active').toLowerCase() === 'active').length;
  }

  if (totalTerm > 0) {
    const statusText = isShiftOver 
      ? 'The terminal shift has ended (past 5:00 PM). All stations are offline.'
      : '<strong>' + activeTerm + '</strong> of <strong>' + totalTerm + '</strong> terminal stations are currently online.';
      
    insights.push({
      icon: isShiftOver ? 'fa-moon' : 'fa-map-location-dot',
      color: isShiftOver ? '#6B7280' : '#2563EB',
      bg: isShiftOver ? '#F3F4F6' : '#EFF6FF',
      text: statusText
    });
  }

  const todayLoads = transactions.filter(t => isLoadSuccess(t) && t.date === todayStr);
  if (todayLoads.length > 0) {
    const cashiers = new Set(todayLoads.map(t => t.recordedBy).filter(Boolean));
    const todayLoadsTotal = todayLoads.reduce((s, t) => s + Number(t.amount || 0), 0);
    insights.push({
      icon: 'fa-user-tie',
      color: '#0D9488',
      bg: '#F0FDFA',
      text: '<strong>' + cashiers.size + '</strong> cashier' + (cashiers.size !== 1 ? 's' : '') + ' processed ₱' + todayLoadsTotal.toFixed(2) + ' in wallet loads today.'
    });
  }

  const todayStaff = transactions.filter(t => isFeeSuccess(t) && t.date === todayStr);
  if (todayStaff.length > 0) {
    const staff = new Set(todayStaff.map(t => t.recordedBy || t.staffName).filter(Boolean));
    insights.push({
      icon: 'fa-qrcode',
      color: '#8B1D2C',
      bg: '#F5E8EA',
      text: '<strong>' + todayStaff.length + '</strong> QR fee scans collected today by <strong>' + staff.size + '</strong> terminal staff member' + (staff.size !== 1 ? 's' : '') + '.'
    });
  }

  return insights;
}

function renderSystemInsights() {
  const container = $('systemInsights');
  if (!container) return;

  const insights = buildSystemInsights();

  if (!insights.length) {
    container.innerHTML = '<div class="empty-inline">No insights yet. Data will appear as transactions are recorded.</div>';
    return;
  }

  container.innerHTML = insights.map(i => `
    <div style="display:flex;gap:.7rem;padding:.7rem .85rem;margin-bottom:.55rem;background:${i.bg};border-radius:.55rem;">
      <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;">
        <i class="fas ${i.icon}" style="color:${i.color};font-size:.85rem;"></i>
      </div>
      <div style="flex:1;font-size:.78rem;color:var(--text-dark);line-height:1.5;">${i.text}</div>
    </div>
  `).join('');
}
window.renderSystemInsights = renderSystemInsights;

async function hardRefreshDashboard() {
  const btn = event ? event.currentTarget : null;
  const orig = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…'; }

  __dataCache.lastFetch = 0;

  try {
    await loadAllDataFromDB(true);
    await updateDashboard(true);
    await loadActivityFeed(false);
    await refreshLiveStatus();
    await refreshStationActivity();
    await refreshRecentMovements();
    await refreshCashierActivity();
    showToast("Dashboard refreshed", "success");
  } catch (err) {
    console.error("hardRefreshDashboard failed:", err);
    showToast("Refresh failed — see console", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}
window.hardRefreshDashboard = hardRefreshDashboard;

async function updateDashboard(forceFresh = false) {
  try {
    const url = forceFresh ? "dashboard_stats.php?fresh=1" : "dashboard_stats.php";
    const res = await window.api(url);

    if (!res || !res.success || !res.data) {
      console.warn("dashboard_stats.php failed, falling back to client-side compute");
      return updateDashboardLocal();
    }

    const s = res.data;

    setText("statTodayFees",       "₱" + Number(s.today.fees).toLocaleString("en-PH", { minimumFractionDigits: 2 }));
    setText("statMonthlyFees",     "₱" + Number(s.month.fees).toLocaleString("en-PH", { minimumFractionDigits: 2 }));
    setText("statTodayLoads",      "₱" + Number(s.today.loads).toLocaleString("en-PH", { minimumFractionDigits: 2 }));
    setText("statCompletedFees",   s.completedFees);
    setText("statActiveDrivers",   s.drivers.active);
    setText("statDrivers",         s.drivers.total);
    setText("statVehicles",        s.vehicles.total);
    setText("statActiveVehicles",  s.vehicles.active);
    setText("statLowBalance",      s.drivers.lowBalance);
    setText("statActiveStations",  s.stations.active);
    setText("statTotalStations",   s.stations.total);
    setText("todayFeesTransCount", s.today.feesCount);
    setText("monthlyFeesTransCount", s.month.feesCount);
    setText("todayLoadsCount",     s.today.loadsCount);

    setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));

    const rb = $("recentTable");
    if (rb) {
      const recent = transactions.slice(-5).reverse();
      if (!recent.length) {
        rb.innerHTML = '<tr><td colspan="6"><div class="empty-state py-3"><i class="fas fa-inbox"></i><p class="text-sm">No transactions</p></div></td></tr>';
      } else {
        rb.innerHTML = recent.map(t => '<tr>' +
          '<td class="py-2 text-sm">' + escapeHtml(t.date || "") + '</td>' +
          '<td class="py-2">' + typeBadge(t.type) + '</td>' +
          '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
          '<td class="py-2 text-sm">' + escapeHtml(t.vehicleType) + '</td>' +
          '<td class="py-2 font-bold text-primary">₱' + t.amount.toFixed(2) + '</td>' +
          '<td class="py-2">' + statusBadge(t.status) + '</td>' +
          '</tr>').join("");
      }
    }

    updateChartData();
    initVehicleFeesChart();
    initDistributionRadar();
    initRevenueRing();
    initDriverBalanceChart();
    loadActivityFeed();
    renderDashboardAlerts();
    renderSystemInsights();
  } catch (err) {
    console.error("dashboard_stats.php exception, falling back:", err);
    return updateDashboardLocal();
  }
}

function updateDashboardLocal() {
  const todayStr = new Date().toLocaleDateString("en-CA");
  const monthStr = todayStr.slice(0, 7);

  const todayFees  = transactions.filter(t => isFeeSuccess(t) && t.date === todayStr);
  const monthFees  = transactions.filter(t => isFeeSuccess(t) && (t.date || "").startsWith(monthStr));
  const todayLoads = transactions.filter(t => isLoadSuccess(t) && t.date === todayStr);

  const todayFeesTotal  = todayFees.reduce((s, t) => s + Number(t.amount || 0), 0);
  const monthFeesTotal  = monthFees.reduce((s, t) => s + Number(t.amount || 0), 0);
  const todayLoadsTotal = todayLoads.reduce((s, t) => s + Number(t.amount || 0), 0);

  const activeDrivers  = drivers.filter(d => /^active$/i.test(d.status || "")).length;
  const activeVehicles = drivers.filter(d => d.plateNumber && /^active$/i.test(d.status || "")).length;
  const totalVehicles  = drivers.filter(d => d.plateNumber).length;
  const lowBalance     = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE).length;
  const activeStations = typeof terminals !== "undefined" ? terminals.filter(t => /^active$/i.test(t.status || "")).length : 0;
  const totalStations  = typeof terminals !== "undefined" ? terminals.length : 0;

  setText("statTodayFees",        "₱" + todayFeesTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 }));
  setText("statMonthlyFees",      "₱" + monthFeesTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 }));
  setText("statTodayLoads",       "₱" + todayLoadsTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 }));
  setText("statCompletedFees",    transactions.filter(isFeeSuccess).length);
  setText("statActiveDrivers",    activeDrivers);
  setText("statDrivers",          drivers.length);
  setText("statVehicles",         totalVehicles);
  setText("statActiveVehicles",   activeVehicles);
  setText("statLowBalance",       lowBalance);
  setText("statActiveStations",   activeStations);
  setText("statTotalStations",    totalStations);
  setText("todayFeesTransCount",  todayFees.length);
  setText("monthlyFeesTransCount", monthFees.length);
  setText("todayLoadsCount",      todayLoads.length);

  setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));

  updateChartData();
  initVehicleFeesChart();
  initDistributionRadar();
  initRevenueRing();
  initDriverBalanceChart();
  loadActivityFeed();
  renderDashboardAlerts();
  renderSystemInsights();
}

async function renderUsers() {
  const tb = $("userTable");
  if (!tb) return;

  if (!__stationMapLoaded) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline"><i class="fas fa-spinner fa-spin"></i> Loading assignments…</div></td></tr>';
    await __loadUserStationMap();
  }

  const filterRole = $("userRoleFilter")?.value || "";
  const search = ($("userSearch")?.value || "").toLowerCase();

  let list = users;
  if (filterRole) list = list.filter(u => String(u.role || "").toLowerCase() === filterRole.toLowerCase());
  if (search) {
    list = list.filter(u =>
      (u.fullName || "").toLowerCase().includes(search) ||
      (u.username || "").toLowerCase().includes(search) ||
      (u.email || "").toLowerCase().includes(search) ||
      (u.contact || "").toLowerCase().includes(search));
  }

  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-4"><i class="fas fa-users"></i><h3>No accounts found</h3></div></td></tr>';
    return;
  }

  const myId = currentAdminUser?.id || window.CURRENT_USER?.id;
  tb.innerHTML = list.map(u => {
    const isSelf = myId && String(u.id) === String(myId);
    return '<tr>' +
      '<td class="py-2 font-mono text-xs text-gray-500">' + escapeHtml(String(u.id || "—")) + '</td>' +
      '<td class="py-2">' +
        '<div class="font-medium text-gray-800">' + escapeHtml(u.fullName || u.username) +
          (isSelf ? ' <span class="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-1">You</span>' : '') +
        '</div>' +
        (u.email || u.contact ?
          '<div class="text-[11px] text-gray-400 font-normal flex items-center gap-2 flex-wrap mt-0.5">' +
            (u.email ? '<span><i class="fas fa-envelope text-[10px] text-gray-400 mr-1"></i>' + escapeHtml(u.email) + '</span>' : '') +
            (u.contact ? '<span><i class="fas fa-phone text-[10px] text-gray-400 mr-1"></i>' + escapeHtml(u.contact) + '</span>' : '') +
          '</div>' : '') +
      '</td>' +
      '<td class="py-2 text-sm text-gray-600 font-mono">' + escapeHtml(u.username) + '</td>' +
      '<td class="py-2"><span class="status-badge successful">' + escapeHtml(u.roleLabel || u.role) + '</span></td>' +
      '<td class="station-cell py-2 text-sm">—</td>' +
      '<td class="py-2"><span class="status-badge ' + (/^active$/i.test(u.status) ? "successful" : "failed") + '">' + escapeHtml(u.status || "Active") + '</span></td>' +
      '<td class="py-2">' +
        '<div class="flex items-center gap-1.5 flex-nowrap">' +
          '<button type="button" class="btn-primary btn-sm" onclick="editUser(\'' + escapeHtml(String(u.id)) + '\')" title="Edit"><i class="fas fa-edit"></i></button> ' +
          (isSelf ?
            '<span class="text-[11px] text-gray-400 italic px-1">Your Account</span>' :
            ((/^active$/i.test(u.status) ?
              '<button type="button" class="btn-danger btn-sm" onclick="toggleUserStatus(\'' + escapeHtml(String(u.id)) + '\')" title="Deactivate"><i class="fas fa-ban"></i></button>' :
              '<button type="button" class="btn-primary btn-sm" onclick="toggleUserStatus(\'' + escapeHtml(String(u.id)) + '\')" title="Activate"><i class="fas fa-check"></i></button>') + ' ' +
             '<button type="button" class="btn-danger btn-sm" onclick="deleteUser(\'' + escapeHtml(String(u.id)) + '\')" title="Delete Account"><i class="fas fa-trash"></i></button>')) +
        '</div>' +
      '</td>' +
      '</tr>';
  }).join("");

  __fillStationCells();
}
window.renderUsers = renderUsers;

let __userStationMap = {};
let __stationMapLoaded = false;

async function __loadUserStationMap() {
  try {
    const res = await window.api('station_assignments.php');
    if (res && res.success && Array.isArray(res.data.assignments)) {
      __userStationMap = {};
      res.data.assignments.forEach(a => {
        __userStationMap[String(a.staffId)] = {
          code: String(a.stationCode || ''),
          name: String(a.stationName || ''),
        };
      });
      __stationMapLoaded = true;
    }
  } catch (e) { 
    console.warn("Failed to load station map", e); 
  }
  return __userStationMap;
}

function __fillStationCells() {
  const tb = $('userTable');
  if (!tb) return;
  tb.querySelectorAll('tr').forEach(tr => {
    if (tr.querySelector('td[colspan]')) return;
    const cell = tr.querySelector('.station-cell');
    if (!cell) return;
    
    const tds = tr.querySelectorAll('td');
    if (tds.length < 6) return;
    
     const userId = (tds[0]?.textContent || '').trim();
    const info = __userStationMap[userId];
    const roleText = (tds[3]?.textContent || '').trim().toLowerCase();

    if (info && info.code) {
      cell.innerHTML =
        '<span class="font-mono font-bold">' + escapeHtml(info.code) + '</span>' +
        '<div class="text-[11px] text-gray-500">' + escapeHtml(info.name) + '</div>';
    } else {
      if (roleText.includes('admin')) {
        cell.innerHTML = '<span class="text-[11px] text-gray-400 italic">System-wide</span>';
      } else {
        cell.innerHTML = '<span class="text-[11px] text-gray-400 italic">Unassigned</span>';
      }
    }
  });
}

window.openAddUser = function () {
  const roleSelect = $("uRole");
  if (roleSelect) {
    const driverOption = roleSelect.querySelector('option[value="driver"]');
    if (driverOption) driverOption.remove();
    roleSelect.disabled = false;
    roleSelect.value = "";
  }
  const form = $("userForm");
  if (form) form.reset();
  if ($("userId")) $("userId").value = "";
  if ($("uFullName")) $("uFullName").value = "";
  if ($("uUsername")) $("uUsername").value = "";
  if ($("uEmail")) $("uEmail").value = "";
  if ($("uContact")) $("uContact").value = "";
  if ($("uPassword")) {
    $("uPassword").value = "";
    $("uPassword").type = "password";
    $("uPassword").required = true;
    $("uPassword").placeholder = "Min. 8 characters";
  }
  if ($("uConfirmPassword")) $("uConfirmPassword").value = "";
  if ($("uStatus")) $("uStatus").value = "Active";

  const passIcon = $("toggleUserPassIcon");
  if (passIcon) passIcon.className = "fas fa-eye";
  const cfIcon = $("toggleUserPassConfirmIcon");
  if (cfIcon) cfIcon.className = "fas fa-eye";

  const title = $("userModalTitle");
  if (title) title.textContent = "Create Account";
  const submitText = $("userSubmitText");
  if (submitText) submitText.textContent = "Create User";

  const delBtn = $("btnDeleteUserInModal");
  if (delBtn) delBtn.style.display = "none";

  const stationWrap = $("stationAssignWrap");
  if (stationWrap) stationWrap.style.display = "none";
  const adminNote = $("adminRoleNotice");
  if (adminNote) adminNote.style.display = "none";

  openModal("userModal");
};

window.editUser = async function (id) {
  const u = users.find(x => String(x.id) === String(id));
  if (!u) { showToast("User not found", "error"); return; }

   if ($("userId")) $("userId").value = String(u.id);
  if ($("uFullName")) $("uFullName").value = u.fullName || "";
  if ($("uUsername")) $("uUsername").value = u.username || "";
  if ($("uEmail")) $("uEmail").value = u.email || "";
  if ($("uContact")) $("uContact").value = u.contact || "";
  if ($("uPassword")) {
    $("uPassword").value = "";
    $("uPassword").type = "password";
    $("uPassword").required = false;
    $("uPassword").placeholder = "Leave blank to keep current password";
  }
  if ($("uConfirmPassword")) $("uConfirmPassword").value = "";
  if ($("uStatus")) $("uStatus").value = (/^active$/i.test(u.status || 'Active')) ? 'Active' : 'Inactive';

  const roleSelect = $("uRole");
  if (roleSelect) {
    roleSelect.disabled = false;
    let driverOption = roleSelect.querySelector('option[value="driver"]');
    if (String(u.role).toLowerCase() === "driver" && !driverOption) {
      driverOption = document.createElement("option");
      driverOption.value = "driver";
      driverOption.textContent = "Driver (managed in Driver Management)";
      roleSelect.appendChild(driverOption);
    }
    roleSelect.value = String(u.role || "").toLowerCase();
    roleSelect.disabled = String(u.role).toLowerCase() === "driver";
  }

  const title = $("userModalTitle");
  if (title) title.textContent = "Edit Account";
  const submitText = $("userSubmitText");
  if (submitText) submitText.textContent = "Save Changes";

  const delBtn = $("btnDeleteUserInModal");
  const myId = currentAdminUser?.id || window.CURRENT_USER?.id;
  if (delBtn) delBtn.style.display = (myId && String(u.id) === String(myId)) ? "none" : "";

   openModal("userModal");

   try {
     const stationSel = $("uStationId");
    if (stationSel && roleSelect.value !== 'admin') {
        stationSel.innerHTML = '<option value="">Loading stations...</option>';
    }

    if (typeof __loadStationsForUserForm === "function") {
      await __loadStationsForUserForm();
    }
    
    let existingStationId = '';
    try {
      const res = await window.api('station_assignments.php');
      if (res && res.success && Array.isArray(res.data.assignments)) {
         const row = res.data.assignments.find(a => String(a.staffId) === String(id));
        if (row) existingStationId = String(row.stationId || '');
      }
    } catch (e) {}

    if (typeof onUserRoleChange === "function") {
      await onUserRoleChange();
    }
    
    if (typeof __populateStationDropdown === "function") {
      __populateStationDropdown(existingStationId);
    }

  } catch (e) {
    console.warn("Station preload failed:", e);
  }
};

window.toggleUserStatus = async function (id) {
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;
  const next = /^active$/i.test(u.status) ? "Inactive" : "Active";

  const proceed = async () => {
    const res = await window.api("users.php", {
      method: "PATCH",
      query: { id },
      body: { status: next },
    });
    if (res && res.success) {
      showToast(res.message || ("Account " + next.toLowerCase()), "success");
      await loadAllDataFromDB(true);
      renderUsers();
    } else {
      showToast(res?.message || "Update failed", "error");
    }
  };

  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: next + " account?",
      message: next + " " + u.username + "?",
      confirmText: next,
      cancelText: "Cancel",
      onConfirm: proceed,
    });
  } else if (confirm(next + " " + u.username + "?")) {
    proceed();
  }
};

window.deleteUser = async function (id) {
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;

  const myId = currentAdminUser?.id || window.CURRENT_USER?.id;
  if (myId && String(u.id) === String(myId)) {
    showToast("You cannot delete your own account.", "error");
    return;
  }

  const proceed = async () => {
    try {
      const res = await window.api("users.php", {
        method: "DELETE",
        query: { id: u.id },
      });
      if (res && res.success) {
        showToast("Account " + (u.username || "") + " deleted successfully.", "success");
        closeModal("userModal");
        await loadAllDataFromDB(true);
        renderUsers();
      } else {
        showToast(res?.message || "Failed to delete account.", "error");
      }
    } catch (err) {
      console.error("Delete user error:", err);
      showToast("Error deleting account.", "error");
    }
  };

  const displayName = u.fullName ? `${u.fullName} (@${u.username})` : `@${u.username}`;
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: "Delete User Account?",
      message: "Are you sure you want to permanently delete account " + displayName + "? This action cannot be undone.",
      confirmText: "Delete Account",
      cancelText: "Cancel",
      onConfirm: proceed,
    });
  } else if (confirm("Permanently delete " + displayName + "?")) {
    proceed();
  }
};

window.deleteUserFromModal = function () {
  const id = $("userId")?.value;
  if (id) window.deleteUser(id);
};

let __adminStations = [];

async function __loadStationsForUserForm() {
  if (__adminStations.length > 0) return __adminStations;
  try {
    const res = await window.api('terminals.php');
    if (res && res.success && res.data && Array.isArray(res.data.terminals)) {
      __adminStations = res.data.terminals
        .filter(t => /^active$/i.test(t.status || 'Active'))
        .map(t => ({ id: String(t.id), code: String(t.code), name: String(t.name) }));
    }
  } catch (e) { console.warn('Could not load stations:', e); }
  return __adminStations;
}

function __populateStationDropdown(selectedId = '') {
  const sel = document.getElementById('uStationId');
  if (!sel) return;
  
  const role = (document.getElementById('uRole')?.value || '').toLowerCase();
  
   let availableStations = __adminStations;
  if (role === 'cashier') {
    availableStations = __adminStations.filter(s => 
      s.code.toUpperCase().includes('BCTT')
    );
  }

  const current = selectedId || sel.value || '';
  
  if (availableStations.length === 0) {
    sel.innerHTML = '<option value="">No BCTT Office found. Please add it in the GIS Map.</option>';
    return;
  }

  sel.innerHTML = '<option value="">— Select station —</option>' +
    availableStations.map(s =>
      `<option value="${escapeHtml(s.id)}">${escapeHtml(s.code)} — ${escapeHtml(s.name)}</option>`
    ).join('');
    
  if (current) sel.value = current;
}

async function onUserRoleChange() {
  const role = (document.getElementById('uRole')?.value || '').toLowerCase();
  const wrap       = document.getElementById('stationAssignWrap');
  const label      = document.getElementById('stationAssignLabel');
  const required   = document.getElementById('stationAssignRequired');
  const hint       = document.getElementById('stationAssignHint');
  const adminNote  = document.getElementById('adminRoleNotice');
  const sel        = document.getElementById('uStationId');
  if (!wrap || !sel) return;

  if (role === 'staff') {
    await __loadStationsForUserForm();
    __populateStationDropdown();
    wrap.style.display = '';
    label.textContent = 'Assign Terminal Station';
    required.style.display = '';
    sel.required = true;
    hint.textContent = 'Required for Terminal Staff. The staff will be restricted to this station.';
    adminNote.style.display = 'none';
  } else if (role === 'cashier') {
    await __loadStationsForUserForm();
    __populateStationDropdown();
    wrap.style.display = '';
    label.textContent = 'Assign Cashier Office';
    required.style.display = '';
    sel.required = true;
    hint.textContent = 'Required for Cashiers. They will be restricted to this office.';
    adminNote.style.display = 'none';
    
     const bcttOption = Array.from(sel.options).find(o => o.text.includes('BCTT'));
    if (bcttOption) sel.value = bcttOption.value;
    
  } else if (role === 'admin') {
    wrap.style.display = 'none';
    sel.required = false;
    sel.value = '';
    adminNote.style.display = '';
  } else {
    wrap.style.display = 'none';
    sel.required = false;
    sel.value = '';
    adminNote.style.display = 'none';
  }
}
window.onUserRoleChange = onUserRoleChange;

function initUserForm() {
  const form = $("userForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const toggleBtn = $("toggleUserPass");
  const passInput = $("uPassword");
  const passIcon = $("toggleUserPassIcon");
  if (toggleBtn && passInput) {
    toggleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isPass = passInput.type === "password";
      passInput.type = isPass ? "text" : "password";
      if (passIcon) passIcon.className = isPass ? "fas fa-eye-slash" : "fas fa-eye";
    });
  }

  const toggleConfirm = $("toggleUserPassConfirm");
  const confirmInput = $("uConfirmPassword");
  const confirmIcon = $("toggleUserPassConfirmIcon");
  if (toggleConfirm && confirmInput) {
    toggleConfirm.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isPass = confirmInput.type === "password";
      confirmInput.type = isPass ? "text" : "password";
      if (confirmIcon) confirmIcon.className = isPass ? "fas fa-eye-slash" : "fas fa-eye";
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const id = document.getElementById('userId')?.value || '';
    const role = document.getElementById('uRole')?.value || '';
    const status = document.getElementById('uStatus')?.value || 'Active';
    const password = document.getElementById('uPassword')?.value || '';
    const confirmPassword = document.getElementById('uConfirmPassword')?.value || '';

    const data = {
      fullName: (document.getElementById('uFullName')?.value || '').trim(),
      username: (document.getElementById('uUsername')?.value || '').trim(),
      email:    (document.getElementById('uEmail')?.value || '').trim(),
      contact:  (document.getElementById('uContact')?.value || '').trim(),
      role,
      status,
    };

    if (password) data.password = password;
    if (!id && password) data.confirmPassword = confirmPassword;

    const sel = document.getElementById('uStationId');
    const stationId = (sel && sel.style.display !== 'none') ? (sel.value || '') : '';

    if (!data.fullName || !data.username) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }
    if (!id) {
      if (!password || password.length < 8) {
        showToast('Password must be at least 8 characters.', 'error');
        return;
      }
      if (password !== confirmPassword) {
        showToast('Password and Confirm Password do not match.', 'error');
        return;
      }
    }
        if ((role === 'staff' || role === 'cashier') && !stationId) {
      showToast('Please select a station/office for this account.', 'error');
      return;
    }
    if (role !== 'admin' && stationId) {
      data.stationId = stationId;
    }

    try {
      const res = await window.api('users.php', {
        method: id ? 'PATCH' : 'POST',
        query: id ? { id } : {},
        body: data,
      });

      if (res && res.success) {
        showToast(id ? 'Account updated successfully.' : 'Account created successfully.', 'success');
        closeModal('userModal');
        form.reset();
        const uid = document.getElementById('userId');
        if (uid) uid.value = '';

        const wrap = document.getElementById('stationAssignWrap');
        if (wrap) wrap.style.display = 'none';
        const note = document.getElementById('adminRoleNotice');
        if (note) note.style.display = 'none';

        await loadAllDataFromDB(true);
        await __loadUserStationMap();
        renderUsers();
      } else {
        showToast(res?.message || 'Save failed.', 'error');
      }
    } catch (err) {
      console.error('User form submit error:', err);
      showToast('Network error while saving.', 'error');
    }
  });
}

function renderDrivers() {
  const search = ($("driverSearch")?.value || "").toLowerCase();
  const sort = $("driverSort")?.value || "newest";
  const approvalFilter = ($("driverApprovalFilter")?.value || "").toLowerCase();

  let filtered = drivers.filter(d =>
    (d.fullName || "").toLowerCase().includes(search) ||
    (d.driverId || "").toLowerCase().includes(search) ||
    (d.plateNumber || "").toLowerCase().includes(search));

  if (approvalFilter) {
    filtered = filtered.filter(d =>
      String(d.approvalStatus || "Active").toLowerCase() === approvalFilter);
  }

  if (sort === "newest") filtered.sort((a, b) => String(b.driverId).localeCompare(String(a.driverId)));
  else if (sort === "oldest") filtered.sort((a, b) => String(a.driverId).localeCompare(String(b.driverId)));
  else if (sort === "name") filtered.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));

  const tb = $("driverTable");
  if (!tb) return;
  if (!filtered.length) {
    tb.innerHTML = '<tr><td colspan="10"><div class="empty-state py-4"><i class="fas fa-user-slash"></i><h3>No drivers</h3></div></td></tr>';
    return;
  }
  
  tb.innerHTML = filtered.map(d => {
    const bal = Number(d.balance || 0);
    const balCls = bal < LOW_BALANCE ? "balance-low" : "balance-amount";
    const approval = String(d.approvalStatus || 'Active');
    const isPending = approval.toLowerCase() === 'pending';
    
    const designatedTerminal = d.toda || d.designatedTerminal || d.station || "Not Assigned";

    return '<tr>' +
      '<td class="py-2"><div class="profile-photo">' +
        (d.photo ? '<img src="' + d.photo + '" alt="">' : '<span>' + escapeHtml((d.fullName || '?').charAt(0).toUpperCase()) + '</span>') +
      '</div></td>' +
      '<td class="py-2 font-mono text-xs">' + escapeHtml(d.driverId) + '</td>' +
      '<td class="py-2 font-medium">' + escapeHtml(d.fullName) + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml((d.vehicleType || "N/A") + " - " + (d.plateNumber || "N/A")) + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(d.contact || "N/A") + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(d.licenseNo || "N/A") + '</td>' +
      '<td class="py-2 text-sm"><strong>' + escapeHtml(designatedTerminal) + '</strong></td>' +
      '<td class="py-2"><span class="' + balCls + '">₱' + bal.toFixed(2) + '</span></td>' +
      '<td class="py-2">' + approvalBadge(approval) + '</td>' +
      '<td class="py-2">' +
        '<div class="flex items-center gap-1.5 flex-nowrap">' +
          (isPending ?
            '<button type="button" class="btn-success btn-sm" onclick="approveDriver(\'' + escapeHtml(d.driverId) + '\')" title="Approve"><i class="fas fa-check"></i></button> ' +
            '<button type="button" class="btn-return btn-sm" onclick="returnForCorrection(\'' + escapeHtml(d.driverId) + '\')" title="Return for Correction"><i class="fas fa-undo"></i></button> '
            : '') +
          '<button type="button" class="btn-primary btn-sm" onclick="editDriver(\'' + escapeHtml(d.driverId) + '\')" title="Edit Driver"><i class="fas fa-edit"></i></button> ' +
          (/^active$/i.test(d.status || "") ?
            '<button type="button" class="btn-outline btn-sm" onclick="toggleDriverStatus(\'' + escapeHtml(d.driverId) + '\')" title="Deactivate Driver"><i class="fas fa-ban"></i></button>' :
            '<button type="button" class="btn-primary btn-sm" onclick="toggleDriverStatus(\'' + escapeHtml(d.driverId) + '\')" title="Activate Driver"><i class="fas fa-check"></i></button>') + ' ' +
          '<button type="button" class="btn-danger btn-sm" onclick="deleteDriver(\'' + escapeHtml(d.driverId) + '\')" title="Delete Driver & Vehicle"><i class="fas fa-trash"></i></button>' +
        '</div>' +
      '</td>' +
      '</tr>';
  }).join("");
}
window.renderDrivers = renderDrivers;
window.filterDrivers = renderDrivers;

window.openAddDriver = function () {
  setText("driverModalTitle", "Add Driver");
  setText("driverSubmitText", "Save Driver");
  const form = $("driverForm");
  if (form) form.reset();
  if ($("editDriverId")) $("editDriverId").value = "";
  const delBtn = $("btnDeleteDriverInModal");
  if (delBtn) delBtn.style.display = "none";
  openModal("driverModal");
};

window.editDriver = function (id) {
  const d = drivers.find(x => x.driverId === id);
  if (!d) return;
  setText("driverModalTitle", "Edit Driver");
  setText("driverSubmitText", "Save Changes");
  $("editDriverId").value = d.driverId;
  $("dFullName").value = d.fullName || "";
  $("dAddress").value = d.address || "";
  $("dContact").value = d.contact || "";
  $("dBirthdate").value = d.birthdate || "";
  $("dGender").value = d.gender || "";
  $("dVehicleType").value = d.vehicleType || "";
  $("dPlateNumber").value = d.plateNumber || "";
  $("dBodyNumber").value = d.bodyNumber || "";
  $("dLicenseNo").value = d.licenseNo || "";
  $("dUsername").value = d.username || "";
  $("dPassword").value = "";
  const delBtn = $("btnDeleteDriverInModal");
  if (delBtn) delBtn.style.display = "inline-flex";
  openModal("driverModal");
};

window.toggleDriverStatus = async function (id) {
  const d = drivers.find(x => x.driverId === id);
  if (!d) return;
  const isActive = /^active$/i.test(d.status || "");
  const next = isActive ? "Inactive" : "Active";
  const action = isActive ? "deactivate" : "activate";
  const proceed = async () => {
    const res = await window.api("drivers.php", {
      method: "PATCH",
      query: { id, action },
      body: { status: next },
    });
    if (res && res.success) {
      showToast(res.message || ("Driver " + d.fullName + " " + next.toLowerCase()), "success");
      await loadAllDataFromDB(true);
      renderDrivers();
      renderVehicles();
    } else showToast(res?.message || "Failed to update driver status", "error");
  };
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: next + " Driver?", message: `${next} driver "${d.fullName}"?`,
      confirmText: next, cancelText: "Cancel", onConfirm: proceed,
    });
  } else if (confirm(`${next} driver "${d.fullName}"?`)) proceed();
};

window.approveDriver = function (driverId) {
  const proceed = async () => {
    const res = await window.api("drivers.php", {
      method: "PATCH", query: { id: driverId, action: "approve" },
    });
    if (res && res.success) {
      showToast("Driver approved and activated", "success");
      await loadAllDataFromDB(true); renderDrivers();
    } else showToast(res?.message || "Approval failed", "error");
  };
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: "Approve Driver?", message: "Approve this driver?",
      confirmText: "Approve", cancelText: "Cancel", onConfirm: proceed,
    });
  } else if (confirm("Approve this driver?")) proceed();
};

window.returnForCorrection = function (driverId) {
  const reason = prompt("Reason for returning this registration for correction:");
  if (!reason) return;
  (async () => {
    const res = await window.api("drivers.php", {
      method: "PATCH", query: { id: driverId, action: "return" }, body: { reason }
    });
    if (res && res.success) {
      showToast("Driver marked as Needs Correction", "warning");
      await loadAllDataFromDB(true); renderDrivers();
    } else showToast(res?.message || "Action failed", "error");
  })();
};

window.deleteDriver = async function (id) {
  const d = drivers.find(x => x.driverId === id);
  if (!d) return;
  const proceed = async () => {
    try {
      const res = await window.api("drivers.php", { method: "DELETE", query: { id, purge: "1" } });
      if (res && res.success) {
        showToast("Driver " + d.fullName + " and vehicle deleted", "success");
        closeModal("driverModal");
        await loadAllDataFromDB(true); renderDrivers(); renderVehicles();
      } else showToast(res?.message || "Failed to delete driver", "error");
    } catch (err) { showToast("Error deleting driver", "error"); }
  };
  const vehicleInfo = d.plateNumber ? ` (Plate: ${d.plateNumber})` : "";
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: "Delete Driver & Vehicle?",
      message: `Permanently delete driver "${d.fullName}"${vehicleInfo}? This cannot be undone.`,
      confirmText: "Delete Driver & Vehicle", cancelText: "Cancel", onConfirm: proceed,
    });
  } else if (confirm(`Permanently delete "${d.fullName}"?`)) proceed();
};
window.deleteDriverFromModal = function () {
  const id = $("editDriverId")?.value;
  if (id) window.deleteDriver(id);
};

function initDriverForm() {
  const form = $("driverForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("editDriverId").value;
    const data = {
      fullName: $("dFullName").value.trim(),
      address: $("dAddress").value.trim(),
      contact: $("dContact").value.trim(),
      birthdate: $("dBirthdate").value,
      gender: $("dGender").value,
      vehicleType: $("dVehicleType").value,
      plateNumber: $("dPlateNumber").value.trim().toUpperCase(),
      bodyNumber: $("dBodyNumber").value.trim(),
      licenseNo: $("dLicenseNo").value.trim().toUpperCase(),
      username: $("dUsername").value.trim(),
      password: $("dPassword").value,
    };
    if (!data.fullName || !data.username) { showToast("Fill required fields", "error"); return; }
    if (!id && data.password.length < 8) { showToast("Password must be 8+ characters", "error"); return; }
    const res = await window.api("drivers.php", { method: "POST", query: id ? { id } : {}, body: data });
    if (res.success) {
      showToast("Driver " + (id ? "updated" : "added"), "success");
      closeModal("driverModal"); form.reset();
      $("editDriverId").value = "";
      setText("driverModalTitle", "Add Driver");
      await loadAllDataFromDB(true); renderDrivers();
    } else showToast(res.message || "Save failed", "error");
  });
}

window.previewPhoto = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ph = $("photoPlaceholder"); if (ph) ph.style.display = "none";
    const p = $("photoPreview");
    if (p) { p.src = e.target.result; p.style.display = "block"; }
  };
  reader.readAsDataURL(file);
};

function renderVehicles() {
  const search = ($("vehicleSearch")?.value || "").toLowerCase();
  const list = drivers.filter(d => d.plateNumber);
  const filtered = search ? list.filter(d =>
    (d.plateNumber || "").toLowerCase().includes(search) ||
    (d.vehicleType || "").toLowerCase().includes(search)) : list;
  setText("vehicleCount", list.length);
  setText("activeVehicleCount", list.filter(d => /^active$/i.test(d.status)).length);
  setText("inactiveVehicleCount", list.filter(d => !/^active$/i.test(d.status)).length);
  const tb = $("vehicleTable");
  if (!tb) return;
  if (!filtered.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state py-4"><i class="fas fa-truck"></i><h3>No vehicles</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = filtered.map(d => '<tr>' +
    '<td class="py-2 font-mono font-bold">' + escapeHtml(d.plateNumber) + '</td>' +
    '<td class="py-2">' + escapeHtml(d.vehicleType || "—") + '</td>' +
    '<td class="py-2">' + escapeHtml(d.fullName) + '</td>' +
    '<td class="py-2"><span class="status-badge ' + (/^active$/i.test(d.status) ? "successful" : "failed") + '">' + escapeHtml(d.status || "Active") + '</span></td>' +
    '<td class="py-2"><button type="button" class="btn-primary btn-sm" onclick="editDriver(\'' + escapeHtml(d.driverId) + '\')"><i class="fas fa-edit"></i></button></td>' +
    '</tr>').join("");
}
window.renderVehicles = renderVehicles;
window.syncVehiclesFromDrivers = async () => {
  await loadAllDataFromDB(true); renderVehicles();
  showToast("Vehicles refreshed", "success");
};

function renderWalletPage() {
  const today = new Date().toLocaleDateString("en-CA");
  const month = today.slice(0, 7);
  const loads = transactions.filter(t => t.type === "LOAD");
  const todayLoads = loads.filter(t => (t.date || "") === today);
  const monthLoads = loads.filter(t => (t.date || "").startsWith(month));
  setText("walletTotalToday", "₱" + todayLoads.reduce((s, t) => s + t.amount, 0).toLocaleString());
  setText("walletTotalMonth", "₱" + monthLoads.reduce((s, t) => s + t.amount, 0).toLocaleString());
  setText("walletLoadCount", todayLoads.length);
  setText("walletActiveCashiers", new Set(todayLoads.map(t => t.recordedBy)).size);
  renderWalletLoads();
}
window.renderWalletPage = renderWalletPage;

function renderWalletLoads() {
  const search = ($("walletSearch")?.value || "").toLowerCase();
  let data = transactions.filter(t => t.type === "LOAD");
  if (search) data = data.filter(t =>
    (t.driverName || "").toLowerCase().includes(search) ||
    (t.recordedBy || "").toLowerCase().includes(search));
  const tb = $("walletTable");
  if (!tb) return;
    if (!data.length) {
    tb.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-state-icon"><i class="fas fa-receipt"></i></div>
            <h3>No Transactions Found</h3>
            <p>There are no fee collections or wallet loads recorded for this period.</p>
          </div>
        </td>
      </tr>`;
    return;
  }
  tb.innerHTML = data.slice().reverse().slice(0, 200).map(t => '<tr>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.date) + '</td>' +
    '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
    '<td class="py-2 font-bold text-green">+₱' + t.amount.toFixed(2) + '</td>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.recordedBy || "Cashier") + '</td>' +
    '<td class="py-2 font-mono text-xs">' + escapeHtml(t.reference || t.id) + '</td>' +
    '<td class="py-2">' + statusBadge(t.status) + '</td>' +
    '<td class="py-2"><button type="button" class="btn-primary btn-sm" onclick="printLoadRecord(\'' + escapeHtml(String(t.reference || t.id)) + '\')" title="Print record"><i class="fas fa-print"></i></button></td>' +
    '</tr>').join("");
}
window.renderWalletLoads = renderWalletLoads;

window.renderTransactions = function () {
  const search = ($("transSearch")?.value || "").toLowerCase();
  const dateF = $("transDate")?.value || "";
  const typeF = $("transType")?.value || "";
  
   let data = transactions.filter(t => t.type === 'FEE' || t.type === 'LOAD');

  if (search) data = data.filter(t =>
    (t.driverName || "").toLowerCase().includes(search) ||
    (t.reference || "").toLowerCase().includes(search) ||
    (t.stationName || "").toLowerCase().includes(search) ||
    (t.staffName || "").toLowerCase().includes(search) ||
    (t.plateNumber || "").toLowerCase().includes(search));
    
  if (dateF) data = data.filter(t => t.date === dateF);
  if (typeF) data = data.filter(t => t.type === typeF);

  window.__currentTransactionList = data;
  const tb = $("transTable");
  if (!tb) return;
  
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state py-4"><i class="fas fa-receipt"></i><h3>No financial transactions</h3></div></td></tr>';
    return;
  }

  tb.innerHTML = data.slice().reverse().slice(0, 500).map(t => {
    const printAction = t.type === "LOAD"
      ? `printLoadRecord('${escapeHtml(String(t.reference || t.id))}')`
      : `printReceiptById('${escapeHtml(String(t.id))}')`;
    const printTitle = t.type === "LOAD" ? "Print Load Record" : "Print Terminal Fee Receipt";
    
    const amountSign = t.type === "LOAD" ? "+" : "−";
    const amountCls = t.type === "LOAD" ? "text-green" : "text-primary";

    const stationInfo = t.stationName
      ? `<div class="text-[10px] text-gray-400 mt-0.5"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(t.stationName)}</div>`
      : '';

    return '<tr>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.date) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.driverName) + stationInfo + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.vehicleType) +
        (t.plateNumber && t.plateNumber !== "Not recorded" ? '<br><span class="text-[10px] text-gray-400 font-mono">' + escapeHtml(t.plateNumber) + '</span>' : '') + '</td>' +
      '<td class="py-2">' + typeBadge(t.type) + '</td>' +
      '<td class="py-2"><span class="' + amountCls + ' font-bold">' + amountSign + '₱' + t.amount.toFixed(2) + '</span></td>' +
      '<td class="py-2 text-sm">' + (t.balance != null ? "₱" + t.balance.toFixed(2) : "—") + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.recordedBy || "System") + '</td>' +
      '<td class="py-2">' + statusBadge(t.status) + '</td>' +
      '<td class="py-2"><button type="button" class="btn-primary btn-sm" onclick="' + printAction + '" title="' + printTitle + '"><i class="fas fa-print"></i></button></td>' +
      '</tr>';
  }).join("");
}
window.renderTransactions = renderTransactions;

window.renderVerifications = function () {
  const search = ($("verifySearch")?.value || "").toLowerCase();
  const dateF = $("verifyDate")?.value || "";
  
   let data = transactions.filter(t => t.type === 'VERIFY');

  if (search) data = data.filter(t =>
    (t.driverName || "").toLowerCase().includes(search) ||
    (t.plateNumber || "").toLowerCase().includes(search) ||
    (t.stationName || "").toLowerCase().includes(search) ||
    (t.recordedBy || "").toLowerCase().includes(search));
    
  if (dateF) data = data.filter(t => t.date === dateF);

  const tb = $("verifyTable");
  if (!tb) return;
  
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-4"><i class="fas fa-check-double"></i><h3>No verification logs</h3></div></td></tr>';
    return;
  }

  tb.innerHTML = data.slice().reverse().slice(0, 500).map(t => {
    const isExit = t.movementType === 'EXIT';
    const badgeStyle = isExit ? 'background:#FCE7F3; color:#BE185D;' : 'background:#E0F2FE; color:#0369A1;';
    const badgeText = isExit ? 'VERIFY (EXIT)' : 'VERIFY (ENTRY)';

    return '<tr>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.date) + ' <span class="text-gray-400 text-xs ml-1">' + escapeHtml(t.time) + '</span></td>' +
      '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.vehicleType) +
        (t.plateNumber && t.plateNumber !== "Not recorded" ? '<br><span class="text-[10px] text-gray-400 font-mono">' + escapeHtml(t.plateNumber) + '</span>' : '') + '</td>' +
      '<td class="py-2"><span class="type-badge" style="' + badgeStyle + ' font-weight:800; font-size:0.62rem; padding:0.2rem 0.55rem; border-radius:999px;">' + badgeText + '</span></td>' +
      '<td class="py-2 text-sm"><i class="fas fa-map-marker-alt text-gray-400 mr-1"></i>' + escapeHtml(t.stationName || "—") + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(t.recordedBy || "System") + '</td>' +
     '<td class="py-2"><button type="button" class="btn-primary btn-sm" onclick="printVerificationLog(\'' + escapeHtml(String(t.id)) + '\')" title="Print Verify Log"><i class="fas fa-print"></i></button></td>' +
      '</tr>';
  }).join("");
}

window.exportTransactionsExcel = function () {
  if (!transactions.length) { showToast("Nothing to export", "warning"); return; }
  const cell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  let csv = "Date,Reference,Type,Driver,Vehicle,Plate,Station,Amount,Balance,Processed By,Status\r\n";
  transactions.forEach(t => {
    csv += [
      t.date, t.reference, t.type, t.driverName, t.vehicleType,
      t.plateNumber || "", t.stationName || "",
      t.amount.toFixed(2), (t.balance || 0).toFixed(2),
      t.recordedBy, t.status
    ].map(cell).join(",") + "\r\n";
  });
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "transactions.csv";
  a.click();
};

function renderReferences() {
  const tb = $("refTable");
  if (!tb) return;
  const search = ($("refSearch")?.value || "").toLowerCase();
  let data = transactions.filter(t => t.type === "LOAD");
  if (search) data = data.filter(t =>
    (t.reference || "").toLowerCase().includes(search) ||
    (t.driverName || "").toLowerCase().includes(search) ||
    (t.orNumber || "").toLowerCase().includes(search));
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-4"><i class="fas fa-file-invoice"></i><h3>No payment references</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = data.slice().reverse().slice(0, 500).map(t => '<tr>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.date) + '</td>' +
    '<td class="py-2 font-mono text-xs">' + escapeHtml(t.orNumber || "—") + '</td>' +
    '<td class="py-2 font-mono text-xs text-gray-500">' + escapeHtml(t.reference) + '</td>' +
    '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
    '<td class="py-2 font-bold text-green">₱' + t.amount.toFixed(2) + '</td>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.recordedBy || "—") + '</td>' +
    '<td class="py-2">' + statusBadge(t.status) + '</td>' +
    '</tr>').join("");
}
window.renderReferences = renderReferences;

window.generateTransactionReport = function () {
  const from = $("rptTransFrom")?.value || "";
  const to = $("rptTransTo")?.value || "";
  const type = $("rptTransType")?.value || "";
  const driverQ = ($("rptTransDriver")?.value || "").toLowerCase().trim();
  const plateQ = ($("rptTransPlate")?.value || "").toLowerCase().trim();
  const stationQ = ($("rptTransStation")?.value || "").toLowerCase().trim();
  const statusQ = ($("rptTransStatus")?.value || "").toUpperCase().trim();
  
  const container = $("rptTransData");
  if (!container) return;
  let data = transactions;
  
  if (from) data = data.filter(t => t.date >= from);
  if (to) data = data.filter(t => t.date <= to);
  if (type) data = data.filter(t => t.type === type);
  if (driverQ) data = data.filter(t => (t.driverName || "").toLowerCase().includes(driverQ) || (t.driverId || "").toLowerCase().includes(driverQ));
  if (plateQ) data = data.filter(t => (t.plateNumber || "").toLowerCase().includes(plateQ));
  if (stationQ) data = data.filter(t => (t.stationName || "").toLowerCase().includes(stationQ) || (t.stationCode || "").toLowerCase().includes(stationQ));
  if (statusQ) data = data.filter(t => (t.status || "").toUpperCase() === statusQ);

  if (!data.length) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No transactions match your filters.</p>';
    return;
  }
  const total = data.reduce((s, t) => s + t.amount, 0);
  const label = (from || to ? `${from || '…'} to ${to || '…'}` : 'All transactions') + (type ? ` · ${type}` : '');
  window.currentReportData = { list: data.slice().reverse(), label, total };
  container.innerHTML = '<div class="flex justify-between items-center mb-3">' +
    '<span class="font-semibold">' + data.length + ' transactions · Total ₱' + total.toFixed(2) + '</span>' +
    '<button type="button" class="btn-outline btn-sm" onclick="printTransactionReport(window.currentReportData.list, window.currentReportData.label, window.currentReportData.total)">' +
      '<i class="fas fa-print"></i> Print</button></div>' +
    '<table class="w-full text-sm"><thead><tr class="border-b">' +
    '<th class="py-2 text-left">Date</th><th class="py-2 text-left">Reference</th>' +
    '<th class="py-2 text-left">Driver</th><th class="py-2 text-left">Type</th>' +
    '<th class="py-2 text-right">Amount</th></tr></thead><tbody>' +
    data.slice().reverse().map(t => '<tr>' +
      '<td class="py-2">' + escapeHtml(t.date) + '</td>' +
      '<td class="py-2 font-mono text-xs">' + escapeHtml(t.reference) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.type) + '</td>' +
      '<td class="py-2 text-right font-bold">₱' + t.amount.toFixed(2) + '</td>' +
    '</tr>').join("") + '</tbody></table>';
};

function renderTerminalReport() {
  const tb = $("terminalReportTable");
  if (!tb) return;
  const feesOnly = transactions.filter(t => t.type === "FEE");
  const vbreak = {};
  feesOnly.forEach(t => {
    const v = t.vehicleType || "Unknown";
    if (!vbreak[v]) vbreak[v] = { count: 0, total: 0 };
    vbreak[v].count++;
    vbreak[v].total += t.amount;
  });
  const entries = Object.entries(vbreak);
  tb.innerHTML = entries.length
    ? entries.map(([k, v]) => '<tr><td class="py-2">' + escapeHtml(k) + '</td><td class="py-2">' + v.count + '</td><td class="py-2">₱' + v.total.toFixed(2) + '</td></tr>').join("")
    : '<tr><td colspan="3"><div class="empty-state py-4"><i class="fas fa-truck"></i><p class="text-sm">No transactions yet</p></div></td></tr>';
}
window.renderTerminalReport = renderTerminalReport;

function getSafeDateKey(dateStr) {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }
  return String(dateStr).slice(0, 10);
}

window.generateReport = async function (type) {
  window.currentSummaryType = type;
  const container = $("reportData");
  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8"><i class="fas fa-spinner fa-spin"></i> Fetching transaction records...</p>';
    await loadAllDataFromDB(true);
  }

  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA");
  const monthStr = todayStr.slice(0, 7);
  const yearStr = todayStr.slice(0, 4);
  
  let filtered = [], label = "";
  
  if (type === "daily") {
    filtered = transactions.filter(t => getSafeDateKey(t.date) === todayStr && t.type === "FEE");
    label = "Daily · " + todayStr;
  } else if (type === "weekly") {
    const s = new Date(now); s.setDate(now.getDate() - now.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    const ss = s.toLocaleDateString("en-CA"), ee = e.toLocaleDateString("en-CA");
    filtered = transactions.filter(t => {
      const dk = getSafeDateKey(t.date);
      return t.type === "FEE" && dk >= ss && dk <= ee;
    });
    label = "Weekly · " + ss + " to " + ee;
  } else if (type === "monthly") {
    filtered = transactions.filter(t => t.type === "FEE" && getSafeDateKey(t.date).startsWith(monthStr));
    label = "Monthly · " + now.toLocaleString("default", { month: "long", year: "numeric" });
  } else if (type === "yearly") {
    filtered = transactions.filter(t => t.type === "FEE" && getSafeDateKey(t.date).startsWith(yearStr));
    label = "Yearly · " + yearStr;
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="text-center py-10">
        <div class="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-folder-open text-2xl text-gray-300"></i>
        </div>
        <h4 class="text-gray-700 font-bold mb-1">No fee collections for this period</h4>
        <p class="text-xs text-gray-400">There are no successful FEE transactions recorded for <strong>${label}</strong>.</p>
      </div>`;
    showToast("No data for this period", "warning");
    return;
  }

  const total = filtered.reduce((s, t) => s + Number(t.amount || 0), 0);
  window.currentReportData = { list: filtered.slice().reverse(), label, total };
  
  container.innerHTML = '<div class="flex justify-between items-center mb-3">' +
    '<span class="font-semibold">' + filtered.length + ' transactions · Total ₱' + total.toFixed(2) + '</span>' +
    '<button type="button" class="btn-outline btn-sm" onclick="printSummaryReport(\'' + type + '\')">' +
      '<i class="fas fa-print"></i> Print</button></div>' +
    '<table class="w-full text-sm"><thead><tr class="border-b">' +
    '<th class="py-2 text-left">Reference</th><th class="py-2 text-left">Driver</th>' +
    '<th class="py-2 text-left">Amount</th><th class="py-2 text-left">Date</th></tr></thead><tbody>' +
    filtered.slice().reverse().map(t => '<tr>' +
      '<td class="py-2 font-mono text-xs">' + escapeHtml(t.reference || t.id) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
      '<td class="py-2 font-bold text-primary">₱' + t.amount.toFixed(2) + '</td>' +
      '<td class="py-2 text-gray-500">' + getSafeDateKey(t.date) + '</td>' +
    '</tr>').join("") + '</tbody></table>';
    
  showToast("Report generated successfully", "success");
};

async function loadAttendance() {
  const dt = $("attendanceDate");
  const dateF = dt?.value || new Date().toLocaleDateString("en-CA");
  if (dt && !dt.value) dt.value = dateF;
  const tb = $("attendanceTable");
  if (!tb) return;
  const res = await window.api("attendance.php", { query: { action: "list", date: dateF } }).catch(() => null);
  if (!res || !res.success) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state py-6"><i class="fas fa-user-clock"></i><h3>No attendance records</h3></div></td></tr>';
    return;
  }
  const records = res.data.records || [];
  tb.innerHTML = records.length
    ? records.map(r => '<tr>' +
        '<td class="py-2">' + escapeHtml(r.name) + '</td>' +
        '<td class="py-2 text-sm">' + escapeHtml(r.role) + '</td>' +
        '<td class="py-2">' + escapeHtml(r.timeIn) + '</td>' +
        '<td class="py-2">' + escapeHtml(r.timeOut) + '</td>' +
        '<td class="py-2"><span class="status-badge ' + (String(r.status).toUpperCase() === "ON TIME" ? "successful" : "pending") + '">' + escapeHtml(r.status) + '</span></td>' +
        '</tr>').join("")
    : '<tr><td colspan="5"><div class="empty-state py-6"><i class="fas fa-user-clock"></i><h3>No attendance for this date</h3></div></td></tr>';
}
window.loadAttendance = loadAttendance;

async function loadAuditLogs() {
  const tb = $("auditTable");
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="5"><div class="empty-state py-6"><i class="fas fa-spinner fa-spin"></i><h3>Loading…</h3></div></td></tr>';
  const res = await window.api("audit_logs.php", { query: { limit: 500 } }).catch(() => null);
  if (!res || !res.success) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state py-6"><i class="fas fa-clipboard-list"></i><h3>No audit logs</h3></div></td></tr>';
    return;
  }
  auditLogs = res.data.logs || [];
  renderAuditLogs();
}
window.loadAuditLogs = loadAuditLogs;

function renderAuditLogs() {
  const tb = $("auditTable");
  if (!tb) return;
  const search = ($("auditSearch")?.value || "").toLowerCase();
  const dateF = $("auditDate")?.value || "";
  let rows = auditLogs;
  if (search) rows = rows.filter(l =>
    (l.user || "").toLowerCase().includes(search) ||
    (l.action || "").toLowerCase().includes(search));
  if (dateF) rows = rows.filter(l => String(l.createdAt || "").startsWith(dateF));
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty-state py-4"><i class="fas fa-clipboard-list"></i><h3>No audit logs</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = rows.map(l => '<tr>' +
    '<td class="py-2 text-xs">' + escapeHtml(l.timestamp || l.createdAt || "") + '</td>' +
    '<td class="py-2">' + escapeHtml(l.user || "System") + '</td>' +
    '<td class="py-2"><span class="status-badge successful">' + escapeHtml(l.role || "System") + '</span></td>' +
    '<td class="py-2 text-sm">' + escapeHtml(l.action || "") + '</td>' +
    '<td class="py-2 text-sm text-gray-500">' + escapeHtml(l.recordRef || l.details || "") + '</td>' +
    '</tr>').join("");
}
window.renderAuditLogs = renderAuditLogs;

function loadFees() {
  if ($("feeTricycle")) $("feeTricycle").value = fees.Tricycle || 5;
  if ($("feeJeepney")) $("feeJeepney").value = fees.Jeepney || 60;
  if ($("feeMulticab")) $("feeMulticab").value = fees.Multicab || 60;
  if ($("feeBus")) $("feeBus").value = fees.Bus || 100;
}
window.loadFees = loadFees;

window.saveFees = async function () {
  const feeTricycle = parseFloat($("feeTricycle").value) || 0;
  const feeJeepney = parseFloat($("feeJeepney").value) || 0;
  const feeMulticab = parseFloat($("feeMulticab").value) || 0;
  const feeBus = parseFloat($("feeBus").value) || 0;

   if (feeTricycle <= 0 || feeJeepney <= 0 || feeMulticab <= 0 || feeBus <= 0) {
    showToast("Fee amounts must be greater than ₱0.00", "error");
    return;
  }

  const next = {
    Tricycle: feeTricycle,
    Jeepney: feeJeepney,
    Multicab: feeMulticab,
    Bus: feeBus,
  };

  const res = await window.api("fees.php", { method: "POST", body: next });
  if (res.success) {
    fees = res.data.fees || next;
    showToast("Fee rates saved successfully", "success");
    if (typeof loadFeeHistory === "function") loadFeeHistory();
  } else {
    showToast(res.message || "Save failed", "error");
  }
};
async function loadFeeHistory() {
  const tb = $("feeHistoryTable");
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-6"><i class="fas fa-spinner fa-spin"></i><h3>Loading…</h3></div></td></tr>';
  const res = await window.api("fees.php", { query: { history: 1 } }).catch(() => null);
  if (!res || !res.success || !res.data || !Array.isArray(res.data.history)) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-6"><i class="fas fa-clock-rotate-left"></i><h3>No fee history available</h3></div></td></tr>';
    return;
  }
  feeHistory = res.data.history;
  if (!feeHistory.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-6"><i class="fas fa-clock-rotate-left"></i><h3>No fee changes recorded yet</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = feeHistory.map(h => {
    const oldFee = h.oldFee != null ? "₱" + h.oldFee.toFixed(2) : "—";
    const newFee = "₱" + h.newFee.toFixed(2);
    let change = "—";
    if (h.oldFee != null) {
      const diff = h.newFee - h.oldFee;
      const cls = diff > 0 ? "fee-change-up" : (diff < 0 ? "fee-change-down" : "fee-change-none");
      change = '<span class="' + cls + '">' + (diff > 0 ? "+" : "") + "₱" + diff.toFixed(2) + '</span>';
    }
    const when = h.createdAt ? new Date(h.createdAt).toLocaleString("en-PH", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    }) : "—";
    return '<tr>' +
      '<td class="py-2 text-xs">' + escapeHtml(when) + '</td>' +
      '<td class="py-2 font-medium">' + escapeHtml(h.vehicleType) + '</td>' +
      '<td class="py-2">' + oldFee + '</td>' +
      '<td class="py-2 font-bold">' + newFee + '</td>' +
      '<td class="py-2">' + change + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(h.changedBy || "—") + '</td>' +
      '<td class="py-2 text-sm text-gray-500">' + escapeHtml(h.reason || "—") + '</td>' +
      '</tr>';
  }).join("");
}
window.loadFeeHistory = loadFeeHistory;

window.openLowBalanceModal = function () {
  const list = $("lowBalanceList");
  if (!list) return;
  const low = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE)
    .sort((a, b) => Number(a.balance || 0) - Number(b.balance || 0));
  if (!low.length) {
    list.innerHTML = '<p class="text-gray-400 text-center py-4">No low-balance drivers.</p>';
  } else {
    list.innerHTML = low.map(d => '<div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg">' +
      '<div><div class="font-medium">' + escapeHtml(d.fullName) + '</div>' +
      '<div class="text-xs text-gray-500">' + escapeHtml(d.vehicleType || "") + ' · ' + escapeHtml(d.plateNumber || "") + '</div></div>' +
      '<div class="balance-low">₱' + Number(d.balance || 0).toFixed(2) + '</div>' +
      '</div>').join("");
  }
  openModal("lowBalanceModal");
};

window.globalSearch = function () {
  const q = ($("globalSearch")?.value || "").trim();
  if (!q) { showToast("Enter a search term", "warning"); return; }

   const searchBtn = document.querySelector(".unified-search button");
  const origHtml = searchBtn ? searchBtn.innerHTML : "";
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';
  }

   setTimeout(() => {
    const found = drivers.filter(d =>
      (d.fullName || "").toLowerCase().includes(q.toLowerCase()) ||
      (d.driverId || "").toLowerCase().includes(q.toLowerCase()) ||
      (d.plateNumber || "").toLowerCase().includes(q.toLowerCase()));
      
    if (found.length) {
      navigateTo("drivers");
      if ($("driverSearch")) $("driverSearch").value = q;
      renderDrivers();
      showToast("Found " + found.length + " driver(s)", "success");
    } else {
      showToast("No drivers found matching: " + q, "warning");
    }

     if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = origHtml;
    }
  }, 300); 
};

window.logout = function () {
  const doLogout = () => {
    try {
      if (typeof window.logoutAndRedirect === "function") {
        window.logoutAndRedirect();
        return;
      }
    } catch (e) {
      console.warn("logoutAndRedirect failed:", e);
    }

    try {
      sessionStorage.clear();
      localStorage.removeItem("user");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("bctt_user");
      localStorage.removeItem("admin_active_page");
      localStorage.removeItem("CURRENT_USER");
    } catch (e) {}

    fetch("api/logout.php", { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => {
        window.location.replace("login.html");
      });
  };

  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: "Logout?",
      message: "Log out of the admin panel?",
      confirmText: "Yes, logout",
      cancelText: "Cancel",
      onConfirm: doLogout,
    });
  } else if (confirm("Log out of the admin panel?")) {
    doLogout();
  }
};

window.updateAdmin = async function () {
  const nameEl = $("adminName");
  const emailEl = $("adminEmail");
  if (!nameEl || !emailEl) return;

  const fullName = nameEl.value.trim();
  const email = emailEl.value.trim();

  if (!fullName) {
    showToast("Full name is required", "error");
    nameEl.focus();
    return;
  }

  const p = $("adminPassword")?.value || "";
  const c = $("adminConfirmPassword")?.value || "";
  if (p && p !== c) { showToast("Passwords do not match", "error"); return; }
  const currentPassword = $("adminCurrentPassword")?.value || "";
  if (p && !currentPassword) {
    showToast("Enter your current password to change it", "error");
    return;
  }

  const btn = document.querySelector("#page-settings button.btn-primary") ||
              document.querySelector("#adminName")?.closest(".card")?.querySelector("button.btn-primary");
  const origBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
  }

  try {
    const res = await window.api("users.php", {
      method: "PATCH",
      query: { me: 1 },
      body: { fullName, email, currentPassword, newPassword: p },
    });

    if (!res.success) {
      showToast(res.message || "Profile could not be updated", "error");
      return;
    }

    const updatedUser = res.data?.user;
    if (updatedUser) {
      if (window.CURRENT_USER) {
        window.CURRENT_USER.fullName = updatedUser.fullName;
        window.CURRENT_USER.email = updatedUser.email;
      }
      const displayName = updatedUser.fullName || updatedUser.username || "Admin";
      setText("adminGreetingName", displayName);
      setText("sidebarUser", displayName);
      setText("userNameChip", displayName);
      const av = $("userAvatarChip");
      if (av) av.textContent = displayName.charAt(0).toUpperCase();

      nameEl.value = updatedUser.fullName || "";
      emailEl.value = updatedUser.email || "";
    }

    if ($("adminCurrentPassword")) $("adminCurrentPassword").value = "";
    if ($("adminPassword")) $("adminPassword").value = "";
    if ($("adminConfirmPassword")) $("adminConfirmPassword").value = "";

    showToast("Profile updated successfully!", "success");
  } catch (err) {
    console.error("updateAdmin error:", err);
    showToast("An unexpected error occurred while updating profile", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
};

window.changeOwnPassword = async function () {
  const currentEl = $("cpCurrent");
  const nextEl    = $("cpNew");
  const confirmEl = $("cpConfirm");
  const current   = currentEl?.value || "";
  const next      = nextEl?.value || "";
  const confirm   = confirmEl?.value || "";

  if (!current || !next || !confirm) { showToast("Fill in all password fields", "error"); return; }
  if (next.length < 8) { showToast("New password must be at least 8 characters", "error"); return; }
  if (next !== confirm) { showToast("New passwords do not match", "error"); return; }

  const btn = document.querySelector("#page-change-password button.btn-primary") ||
              document.querySelector("#cpCurrent")?.closest(".card")?.querySelector("button.btn-primary");
  const origBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
  }

  try {
    const res = await window.api("users.php", {
      method: "PATCH",
      query: { me: 1 },
      body: {
        currentPassword: current,
        newPassword: next,
        fullName: window.CURRENT_USER?.fullName || $("adminName")?.value || "",
        email: window.CURRENT_USER?.email || $("adminEmail")?.value || "",
      },
    });

    if (res.success) {
      showToast("Password updated successfully!", "success");
      if (currentEl) currentEl.value = "";
      if (nextEl) nextEl.value = "";
      if (confirmEl) confirmEl.value = "";
    } else {
      showToast(res.message || "Password update failed", "error");
    }
  } catch (err) {
    console.error("changeOwnPassword error:", err);
    showToast("An unexpected error occurred while updating password", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
};

async function loadSystemSettings() {
  const res = await window.api("settings.php");
  if (!res.success) { showToast(res.message || "Settings could not be loaded", "error"); return; }
  const s = res.data.settings || {};
  if ($("sysName")) $("sysName").value = s.system_name || "";
  if ($("sysTerminal")) $("sysTerminal").value = s.terminal_name || "";
  if ($("sysOffice")) $("sysOffice").value = s.office_info || "";
  if ($("sysLowBalance")) $("sysLowBalance").value = s.low_balance_threshold || "50";
  if ($("prefEmailToggle")) $("prefEmailToggle").checked = s.admin_email_notifications !== "false";
  if ($("prefPushToggle")) $("prefPushToggle").checked = s.admin_push_notifications !== "false";
  if ($("prefSoundToggle")) $("prefSoundToggle").checked = s.admin_sound_alerts !== "false";
}
window.loadSystemSettings = loadSystemSettings;

window.saveSystemSettings = async function () {
  const payload = {
    system_name: $("sysName")?.value || "",
    terminal_name: $("sysTerminal")?.value || "",
    office_info: $("sysOffice")?.value || "",
    low_balance_threshold: $("sysLowBalance")?.value || "50",
  };
  const res = await window.api("settings.php", { method: "POST", body: payload });
  showToast(res.success ? "Settings saved" : (res.message || "Failed"), res.success ? "success" : "error");
};

window.savePreferences = async function () {
  const res = await window.api("settings.php", {
    method: "POST",
    body: {
      admin_email_notifications: String($("prefEmailToggle")?.checked ?? true),
      admin_push_notifications: String($("prefPushToggle")?.checked ?? true),
      admin_sound_alerts: String($("prefSoundToggle")?.checked ?? true)
    }
  });
  showToast(res.success ? "Preferences saved" : (res.message || "Failed"), res.success ? "success" : "error");
};

let terminals = [];
let adminMap = null;
let dashboardMiniMap = null;
let terminalMarkers = [];
let miniMapMarkers = [];
let selectedTerminal = null;
let qgisPendingGeoJson = null;

const BORONGAN_CENTER = [11.6080, 125.4316];
const BORONGAN_DEFAULT_ZOOM = 11;

const TILE_SERVERS = {
  osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap' },
  esri: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri' }
};

let currentTileLayer = null;

function initAdminMap() {
  const container = $("adminGisMap");
  if (!container || typeof L === "undefined") return;
  if (adminMap) { adminMap.invalidateSize(); return; }
  adminMap = L.map('adminGisMap', { center: BORONGAN_CENTER, zoom: BORONGAN_DEFAULT_ZOOM, zoomControl: true });
  currentTileLayer = L.tileLayer(TILE_SERVERS.osm.url, { maxZoom: 19, attribution: TILE_SERVERS.osm.attribution }).addTo(adminMap);
  adminMap.on('mousemove', (e) => {
    const coordsEl = $("gisCursorCoords");
    if (coordsEl) coordsEl.textContent = `${e.latlng.lat.toFixed(4)}° N, ${e.latlng.lng.toFixed(4)}° E`;
  });
  adminMap.on('click', (e) => {
    const modal = $("terminalModal");
    if (modal && modal.classList.contains("active")) {
      $("termLat").value = e.latlng.lat.toFixed(6);
      $("termLng").value = e.latlng.lng.toFixed(6);
      showToast(`Selected: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`, "success");
    }
  });
}

function initDashboardMiniMap() {
  const container = $("dashboardMiniMap");
  if (!container || typeof L === "undefined") return;
  if (dashboardMiniMap) { dashboardMiniMap.invalidateSize(); return; }
  dashboardMiniMap = L.map('dashboardMiniMap', { center: BORONGAN_CENTER, zoom: 12, zoomControl: false, scrollWheelZoom: false });
  L.tileLayer(TILE_SERVERS.osm.url, { maxZoom: 18, attribution: '&copy; OpenStreetMap & BCTT' }).addTo(dashboardMiniMap);
}

function switchMapTileLayer(key) {
  if (!adminMap || !TILE_SERVERS[key]) return;
  if (currentTileLayer) adminMap.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(TILE_SERVERS[key].url, { maxZoom: 19, attribution: TILE_SERVERS[key].attribution }).addTo(adminMap);
}
window.switchMapTileLayer = switchMapTileLayer;

function recenterAdminMap() {
  if (adminMap) {
    if (terminalMarkers && terminalMarkers.length > 0) {
      const group = new L.featureGroup(terminalMarkers);
      adminMap.fitBounds(group.getBounds().pad(0.15));
    } else {
      adminMap.setView(BORONGAN_CENTER, BORONGAN_DEFAULT_ZOOM, { animate: true });
    }
    showToast("Map centered", "success");
  }
}
window.recenterAdminMap = recenterAdminMap;

async function loadTerminalsData(forceRefresh = false) {
  try {
    const res = await window.api("terminals.php");
    if (res && res.success && res.data && Array.isArray(res.data.terminals)) terminals = res.data.terminals;
  } catch (e) { console.warn("Could not load terminals:", e); }
  initAdminMap();
  initDashboardMiniMap();
  setTimeout(() => {
    if (adminMap) adminMap.invalidateSize();
    if (dashboardMiniMap) dashboardMiniMap.invalidateSize();
  }, 100);
  renderTerminalsOnMap();
  renderMiniMapTerminals();
  renderTerminalsList();
  updateGisStats();
  renderDashboardAlerts();
  renderSystemInsights();
  if (forceRefresh) showToast("GIS Terminals updated", "success");
}
window.loadTerminalsData = loadTerminalsData;

function renderTerminalsOnMap() {
  if (!adminMap || typeof L === "undefined") return;
  terminalMarkers.forEach(m => adminMap.removeLayer(m));
  terminalMarkers = [];
  terminals.forEach((term, idx) => {
    const isActive = (term.status || "Active").toLowerCase() === "active";
    const markerHtml = `<div class="custom-pin-marker" title="${escapeHtml(term.name)}">
      ${isActive ? '<div class="pin-pulse"></div>' : ''}
      <div class="pin-badge ${isActive ? 'active-booth' : 'inactive-booth'}"><i class="fas fa-bus-simple"></i></div>
    </div>`;
    const customIcon = L.divIcon({ html: markerHtml, className: 'custom-leaflet-pin', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22] });
    const marker = L.marker([term.latitude, term.longitude], { icon: customIcon }).addTo(adminMap);
    const popupContent = `<div class="terminal-popup-header">
      <div class="text-[10px] font-bold uppercase opacity-80">${escapeHtml(term.code)}</div>
      <div class="font-bold text-sm leading-tight">${escapeHtml(term.name)}</div>
    </div>
    <div class="terminal-popup-body">
      <div class="mb-2 text-gray-500 text-xs">${escapeHtml(term.address || 'Borongan City')}</div>
      <div class="terminal-stat-chip">
        <span class="text-gray-500"><i class="fas fa-user-shield text-primary mr-1"></i> Ticketer:</span>
        <strong>${escapeHtml(term.assigned_staff_name || 'Unassigned')}</strong>
      </div>
    </div>`;
    marker.bindPopup(popupContent, { maxWidth: 300 });
    marker.on('click', () => selectTerminal(term.id, false));
    terminalMarkers.push(marker);
    if (idx === 0 && !selectedTerminal) selectTerminal(term.id, false);
  });
}

function renderMiniMapTerminals() {
  if (!dashboardMiniMap || typeof L === "undefined") return;
  miniMapMarkers.forEach(m => dashboardMiniMap.removeLayer(m));
  miniMapMarkers = [];
  terminals.forEach(term => {
    const isActive = (term.status || "Active").toLowerCase() === "active";
    const markerHtml = `<div class="custom-pin-marker" style="transform: scale(0.75);">
      <div class="pin-badge ${isActive ? 'active-booth' : 'inactive-booth'}"><i class="fas fa-bus-simple"></i></div>
    </div>`;
    const icon = L.divIcon({ html: markerHtml, className: 'custom-leaflet-pin-mini', iconSize: [30, 30], iconAnchor: [15, 15] });
    const marker = L.marker([term.latitude, term.longitude], { icon }).addTo(dashboardMiniMap);
    marker.bindTooltip(`<strong>${escapeHtml(term.name)}</strong>`, { direction: 'top' });
    miniMapMarkers.push(marker);
  });
}

function renderTerminalsList() {
  const listEl = $("terminalsQuickList");
  if (!listEl) return;
  setText("terminalsCountBadge", String(terminals.length));
  if (!terminals.length) {
    listEl.innerHTML = '<div class="text-center py-6 text-gray-400 text-xs">No terminals found.</div>';
    return;
  }
  listEl.innerHTML = terminals.map(t => {
    const isSelected = selectedTerminal && selectedTerminal.id === t.id;
    const isActive = (t.status || "Active").toLowerCase() === "active";
    return `<div class="p-2.5 rounded-lg border transition cursor-pointer ${isSelected ? 'border-primary bg-red-50/50 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}"
                 onclick="selectTerminal('${escapeHtml(t.id)}')">
      <div class="flex justify-between items-start">
        <div>
          <span class="text-[10px] font-mono font-bold text-gray-500">${escapeHtml(t.code)}</span>
          <h5 class="font-bold text-xs text-gray-900 leading-tight">${escapeHtml(t.name)}</h5>
        </div>
        <span class="w-2 h-2 rounded-full mt-1 ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}"></span>
      </div>
      <div class="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
        <span><i class="fas fa-user-shield text-gray-400 mr-1"></i>${escapeHtml(t.assigned_staff_name || 'Unassigned')}</span>
        <span class="font-semibold text-emerald-700">₱${Number(t.today_collections || 0).toLocaleString()}</span>
      </div>
    </div>`;
  }).join("");
}

function selectTerminal(id, panTo = true) {
  const term = terminals.find(t => t.id === id);
  if (!term) return;
  selectedTerminal = term;
  setText("inspectCode", term.code);
  setText("inspectName", term.name);
  setText("inspectAddress", term.address || "Borongan City");
  setText("inspectStatus", (term.status || "Active").toUpperCase());
  setText("inspectStaff", `${term.assigned_staff_name || 'Unassigned'} (${term.assigned_staff_role || 'Ticketer'})`);
  setText("inspectCollection", `₱${Number(term.today_collections || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}`);
  setText("inspectTickets", `${term.today_tickets || 0} tickets issued`);
  setText("inspectHours", term.operating_hours || "5:00 AM - 8:00 PM");
  setText("inspectRoutes", term.routes_covered || "Borongan City Routes");
  setText("inspectCoords", `${term.latitude}, ${term.longitude}`);
  const statusEl = $("inspectStatus");
  if (statusEl) statusEl.className = `inq-status ${(term.status || "Active").toLowerCase() === 'active' ? 'resolved' : 'read'} text-xs`;
  renderTerminalsList();
  if (panTo && adminMap) {
    adminMap.setView([term.latitude, term.longitude], 16, { animate: true });
    const marker = terminalMarkers.find(m => {
      const ll = m.getLatLng();
      return Math.abs(ll.lat - term.latitude) < 0.0001 && Math.abs(ll.lng - term.longitude) < 0.0001;
    });
    if (marker) marker.openPopup();
  }
}
window.selectTerminal = selectTerminal;

function zoomToSelectedTerminal() {
  if (selectedTerminal && adminMap) adminMap.setView([selectedTerminal.latitude, selectedTerminal.longitude], 17, { animate: true });
}
window.zoomToSelectedTerminal = zoomToSelectedTerminal;

function updateGisStats() {
  const total = terminals.length;
  const active = terminals.filter(t => (t.status || "Active").toLowerCase() === "active").length;
  const totalFees = terminals.reduce((sum, t) => sum + (Number(t.today_collections) || 0), 0);
  const totalTickets = terminals.reduce((sum, t) => sum + (Number(t.today_tickets) || 0), 0);
  setText("gisTotalTerminals", String(total));
  setText("gisActiveTerminals", String(active));
  setText("gisActiveBooths", String(active));
  setText("gisTodayCollections", `₱${totalFees.toLocaleString('en-PH', {minimumFractionDigits: 2})}`);
  setText("gisTodayTickets", String(totalTickets));
}

let _staffList = [];
let _staffPickerOpen = false;

async function loadStaffPickerData() {
  if (_staffList.length > 0) return;
  try {
    const res = await window.api('terminals.php', { query: { action: 'staff_list' } });
    if (res && res.success && Array.isArray(res.data.staff)) _staffList = res.data.staff;
  } catch (e) { console.warn('Could not load staff list', e); }
}

function renderStaffList(query = '') {
  const ul = $('staffPickerList');
  if (!ul) return;
  const q = query.toLowerCase();
  const filtered = _staffList.filter(s =>
    !q || s.fullName.toLowerCase().includes(q) || s.roleLabel.toLowerCase().includes(q) || s.username.toLowerCase().includes(q));
  if (!filtered.length) {
    ul.innerHTML = '<li class="px-4 py-3 text-gray-400 text-xs text-center">No staff accounts found</li>';
    return;
  }
  const groups = { cashier: [], staff: [] };
  filtered.forEach(s => (groups[s.role] = groups[s.role] || []).push(s));
  let html = '';
  const roleLabels = { cashier: 'Cashier', staff: 'Terminal Staff' };
  ['cashier', 'staff'].forEach(role => {
    const members = groups[role];
    if (!members || !members.length) return;
    html += `<li class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50">${roleLabels[role]}</li>`;
    members.forEach(s => {
      html += `<li class="px-3 py-2 flex items-center gap-2 hover:bg-primary/5 cursor-pointer rounded-lg mx-1 transition"
                   onclick="selectStaffMember('${escapeHtml(s.id)}','${escapeHtml(s.fullName)}','${escapeHtml(s.roleLabel)}')">
        <span class="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
              style="background:${role === 'cashier' ? '#b22234' : '#059669'}">${escapeHtml(s.fullName.charAt(0).toUpperCase())}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-gray-800 truncate">${escapeHtml(s.fullName)}</div>
          <div class="text-[11px] text-gray-400">${escapeHtml(s.roleLabel)}</div>
        </div>
      </li>`;
    });
  });
  ul.innerHTML = html;
}

function filterStaffList(q) { renderStaffList(q); }
window.filterStaffList = filterStaffList;

function toggleStaffDropdown() {
  const panel = $('staffPickerPanel');
  if (!panel) return;
  _staffPickerOpen = !_staffPickerOpen;
  panel.classList.toggle('hidden', !_staffPickerOpen);
  if ($('staffPickerCaret')) $('staffPickerCaret').style.transform = _staffPickerOpen ? 'rotate(180deg)' : '';
  if (_staffPickerOpen) { renderStaffList($('staffSearchInput')?.value || ''); $('staffSearchInput')?.focus(); }
}
window.toggleStaffDropdown = toggleStaffDropdown;

function selectStaffMember(id, name, roleLabel) {
  $('termStaffName').value   = name;
  $('termStaffUserId').value = id;
  $('termStaffRole').value   = roleLabel;
  const label = $('staffPickerLabel');
  label.textContent = name;
  label.classList.remove('text-gray-500');
  label.classList.add('text-gray-900', 'font-semibold');
  const badge = document.createElement('span');
  badge.className = 'ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold ' +
    (roleLabel.toLowerCase().includes('cashier') ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700');
  badge.textContent = roleLabel;
  label.appendChild(badge);
  $('staffPickerPanel').classList.add('hidden');
  _staffPickerOpen = false;
  if ($('staffPickerCaret')) $('staffPickerCaret').style.transform = '';
}
window.selectStaffMember = selectStaffMember;

function clearStaffPicker() {
  $('termStaffName').value   = '';
  $('termStaffUserId').value = '';
  $('termStaffRole').value   = '';
  $('staffPickerLabel').textContent = '— Select staff / cashier —';
  $('staffPickerLabel').className = 'flex-1 text-sm text-gray-500';
  $('staffPickerPanel').classList.add('hidden');
  _staffPickerOpen = false;
  if ($('staffPickerCaret')) $('staffPickerCaret').style.transform = '';
}
window.clearStaffPicker = clearStaffPicker;

function setStaffPickerValue(name, role) {
  if (!name) { clearStaffPicker(); return; }
  $('termStaffName').value = name;
  $('termStaffRole').value = role || '';
  const label = $('staffPickerLabel');
  label.textContent = name;
  label.className = 'flex-1 text-sm text-gray-900 font-semibold';
  const isC = (role || '').toLowerCase().includes('cashier');
  const badge = document.createElement('span');
  badge.className = 'ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold ' +
    (isC ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700');
  badge.textContent = isC ? 'Cashier' : 'Terminal Staff';
  label.appendChild(badge);
}

document.addEventListener('click', (e) => {
  if (_staffPickerOpen && !$('staffPickerWrap')?.contains(e.target)) {
    $('staffPickerPanel')?.classList.add('hidden');
    _staffPickerOpen = false;
    if ($('staffPickerCaret')) $('staffPickerCaret').style.transform = '';
  }
});

async function openAddTerminalModal() {
  await loadStaffPickerData();
  $("terminalModalTitle").textContent = "Add Terminal Station";
  $("termId").value = "";
  $("termName").value = "";
  $("termCode").value = `BCTT-0${terminals.length + 1}`;
  $("termLat").value = BORONGAN_CENTER[0];
  $("termLng").value = BORONGAN_CENTER[1];
  $("termAddress").value = "Borongan City, Eastern Samar";
  $("termHours").value = "5:00 AM - 8:00 PM";
  $("termCapacity").value = "50";
  $("termStatus").value = "Active";
  clearStaffPicker();
  $("termRoutes").value = "Borongan City Proper";
  openModal("terminalModal");
}
window.openAddTerminalModal = openAddTerminalModal;

async function editSelectedTerminal() {
  if (!selectedTerminal) return;
  
   if (selectedTerminal.code.toUpperCase() === 'BCTT' || selectedTerminal.name.toUpperCase().includes('MAIN OFFICE')) {
      showToast("The BCTT Main Office is a protected system station and cannot be edited or deleted.", "warning");
      return; 
  }
  
  await loadStaffPickerData();
  
  $("terminalModalTitle").textContent = "Edit Terminal Station";
  $("termId").value = selectedTerminal.id;
  $("termName").value = selectedTerminal.name;
  $("termCode").value = selectedTerminal.code;
  $("termLat").value = selectedTerminal.latitude;
  $("termLng").value = selectedTerminal.longitude;
  $("termAddress").value = selectedTerminal.address || "";
  $("termHours").value = selectedTerminal.operating_hours || "5:00 AM - 8:00 PM";
  $("termCapacity").value = selectedTerminal.capacity || 50;
  $("termStatus").value = selectedTerminal.status || "Active";
  
  setStaffPickerValue(selectedTerminal.assigned_staff_name || '', selectedTerminal.assigned_staff_role || '');
  $("termStaffUserId").value = selectedTerminal.assigned_staff_id || '';
  $("termRoutes").value = selectedTerminal.routes_covered || "";
  
  openModal("terminalModal");
}
window.editSelectedTerminal = editSelectedTerminal;

async function saveTerminalForm(e) {
  e.preventDefault();
  const payload = {
    id: $("termId").value.trim(),
    name: $("termName").value.trim(),
    code: $("termCode").value.trim(),
    latitude: parseFloat($("termLat").value),
    longitude: parseFloat($("termLng").value),
    address: $("termAddress").value.trim(),
    operating_hours: $("termHours").value.trim(),
    capacity: parseInt($("termCapacity").value, 10) || 50,
    status: $("termStatus").value,
    assigned_staff_name: $("termStaffName").value.trim(),
    assigned_staff_role: $("termStaffRole").value.trim(),
    assigned_staff_id: $("termStaffUserId").value.trim(),
    routes_covered: $("termRoutes").value.trim()
  };
  try {
    const res = await window.api("terminals.php", { method: "POST", body: payload });
    if (res && res.success) {
      showToast(res.message || "Terminal saved successfully!", "success");
      closeModal("terminalModal");
      await loadTerminalsData();
      if (res.data && res.data.terminal_id) selectTerminal(res.data.terminal_id);
    } else showToast(res?.message || "Could not save terminal", "error");
  } catch (err) { showToast("Error saving terminal details", "error"); }
}
window.saveTerminalForm = saveTerminalForm;

function openQgisModal() {
  qgisPendingGeoJson = null;
  const fileInput = $("qgisFileInput");
  if (fileInput) fileInput.value = "";
  setText("qgisFileLabel", "Click to select GeoJSON file");
  const uploadBtn = $("qgisUploadBtn");
  if (uploadBtn) uploadBtn.disabled = true;
  openModal("qgisModal");
}
window.openQgisModal = openQgisModal;

function exportQgisGeoJson() {
  window.location.href = "api/terminals.php?export=geojson";
  showToast("Exporting GeoJSON layer for QGIS...", "success");
}
window.exportQgisGeoJson = exportQgisGeoJson;

function handleQgisFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || (!parsed.features && parsed.type !== "FeatureCollection")) {
        showToast("Invalid GeoJSON file format", "error");
        return;
      }
      qgisPendingGeoJson = parsed;
      const count = parsed.features ? parsed.features.length : 1;
      setText("qgisFileLabel", `${file.name} (${count} features detected)`);
      const uploadBtn = $("qgisUploadBtn");
      if (uploadBtn) uploadBtn.disabled = false;
      showToast(`GeoJSON loaded: ${count} features`, "success");
    } catch (err) { showToast("Error parsing JSON file.", "error"); }
  };
  reader.readAsText(file);
}
window.handleQgisFileSelect = handleQgisFileSelect;

async function uploadQgisGeoJson() {
  if (!qgisPendingGeoJson) { showToast("Please select a valid GeoJSON file first", "warning"); return; }
  const uploadBtn = $("qgisUploadBtn");
  if (uploadBtn) uploadBtn.disabled = true;
  try {
    const res = await window.api("terminals.php?action=import_geojson", { method: "POST", body: { geojson: qgisPendingGeoJson } });
    if (res && res.success) {
      showToast(res.message || "QGIS layer imported successfully!", "success");
      closeModal("qgisModal");
      await loadTerminalsData(true);
    } else {
      showToast(res?.message || "Import failed", "error");
      if (uploadBtn) uploadBtn.disabled = false;
    }
  } catch (err) {
    showToast("Network error importing GeoJSON", "error");
    if (uploadBtn) uploadBtn.disabled = false;
  }
}
window.uploadQgisGeoJson = uploadQgisGeoJson;

let __assignStaff = [];
let __assignStations = [];
let __assignList = [];

async function loadStaffAssignments() {
  const tb = document.getElementById('assignTable');
  if (tb) tb.innerHTML = '<tr><td colspan="6"><div class="empty-inline">Loading…</div></td></tr>';
  try {
    const res = await window.api('station_assignments.php');
    if (!res || !res.success) {
      if (tb) tb.innerHTML = '<tr><td colspan="6"><div class="empty-inline">Could not load assignments.</div></td></tr>';
      return;
    }
    __assignStaff    = res.data.staff       || [];
    __assignStations = res.data.stations    || [];
    __assignList     = res.data.assignments || [];
    renderAssignTable();
    populateAssignDropdowns();
  } catch (e) {
    console.error('loadStaffAssignments:', e);
    if (tb) tb.innerHTML = '<tr><td colspan="6"><div class="empty-inline">Network error.</div></td></tr>';
  }
}
window.loadStaffAssignments = loadStaffAssignments;

function renderAssignTable() {
  const tb = document.getElementById('assignTable');
  const counter = document.getElementById('assignCount');
  if (counter) counter.textContent = __assignList.length;
  if (!tb) return;
  if (!__assignList.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty-state py-6"><i class="fas fa-user-shield"></i><h3>No assignments yet</h3><p class="text-sm">Click "Assign Staff" to create the first one.</p></div></td></tr>';
    return;
  }
  tb.innerHTML = __assignList.map(a => `
    <tr>
      <td><div class="font-medium">${escapeHtml(a.staffName)}</div>
          <div class="text-xs text-gray-500">@${escapeHtml(a.username)}</div></td>
      <td><span class="status-badge successful">${escapeHtml(a.role)}</span></td>
      <td><span class="font-mono font-bold">${escapeHtml(a.stationCode)}</span></td>
      <td>${escapeHtml(a.stationName)}</td>
      <td class="text-sm">${formatAssignDate(a.assignedAt)}</td>
      <td><button type="button" class="btn-danger btn-sm" onclick="removeAssignment(${a.id})" title="Remove"><i class="fas fa-trash"></i></button></td>
    </tr>
  `).join('');
}
window.renderAssignTable = renderAssignTable;

function populateAssignDropdowns() {
  const staffSel = document.getElementById('assignStaffId');
  const stSel    = document.getElementById('assignStationId');
  if (staffSel) {
    staffSel.innerHTML = '<option value="">— Select staff —</option>' +
      __assignStaff.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.fullName)} (${escapeHtml(s.role)})</option>`).join('');
  }
  if (stSel) {
    stSel.innerHTML = '<option value="">— Select station —</option>' +
      __assignStations.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.code)} · ${escapeHtml(s.name)}</option>`).join('');
  }
}
window.populateAssignDropdowns = populateAssignDropdowns;

function formatAssignDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function openAssignModal() {
  const form = document.getElementById('assignForm');
  if (form) form.reset();
  populateAssignDropdowns();
  openModal('assignModal');
}
window.openAssignModal = openAssignModal;

async function saveAssignment(e) {
  e.preventDefault();
  const staffId   = document.getElementById('assignStaffId').value;
  const stationId = document.getElementById('assignStationId').value;
  if (!staffId || !stationId) { showToast('Select both staff and station.', 'error'); return; }
  try {
    const res = await window.api('station_assignments.php', { method: 'POST', body: { staffId, stationId } });
    if (res && res.success) {
      showToast(res.message || 'Assigned.', 'success');
      closeModal('assignModal');
      loadStaffAssignments();
      await __loadUserStationMap();
      if (typeof renderUsers === 'function') renderUsers();
    } else showToast(res?.message || 'Assignment failed.', 'error');
  } catch (err) { console.error('saveAssignment:', err); showToast('Network error.', 'error'); }
}
window.saveAssignment = saveAssignment;

async function removeAssignment(id) {
  if (!id) return;
  const proceed = async () => {
    try {
      const res = await window.api('station_assignments.php', { method: 'DELETE', query: { id } });
      if (res && res.success) {
        showToast('Assignment removed.', 'success');
        loadStaffAssignments();
        await __loadUserStationMap();
        if (typeof renderUsers === 'function') renderUsers();
      } else showToast(res?.message || 'Remove failed.', 'error');
    } catch (err) { console.error(err); }
  };
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: 'Remove Assignment?',
      message: 'The staff member will no longer be able to process transactions at this station.',
      confirmText: 'Remove', cancelText: 'Cancel', onConfirm: proceed
    });
  } else if (confirm('Remove this assignment?')) proceed();
}
window.removeAssignment = removeAssignment;

async function viewStationTransactions() {
  if (!selectedTerminal) { showToast('Select a station first.', 'warning'); return; }
  const stationId = selectedTerminal.id;
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('page-station-transactions');
  if (target) target.classList.add('active');
  const topbar = document.getElementById('topbarCurrentPage');
  if (topbar) topbar.textContent = 'Station Transactions';
  const title = document.getElementById('stationTxnTitle');
  if (title) title.textContent = selectedTerminal.code + ' · ' + selectedTerminal.name;
  const tbody = document.getElementById('stationTxnTable');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty-inline">Loading…</div></td></tr>';
  try {
    const res = await window.api('station_transactions.php', { query: { stationId, limit: 500 } });
    if (!res || !res.success) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty-inline">Could not load.</div></td></tr>';
      return;
    }
    const list = res.data.transactions || [];
    const summary = res.data.summary || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stTxnTotalCount',   summary.totalCount   ?? 0);
    set('stTxnSuccessCount', summary.successCount ?? 0);
    set('stTxnFailedCount',  summary.failedCount  ?? 0);
    set('stTxnTotalFees',    '₱' + Number(summary.totalFees  || 0).toFixed(2));
    set('stTxnTotalLoads',   '₱' + Number(summary.totalLoads || 0).toFixed(2));
    if (!list.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state py-6"><i class="fas fa-receipt"></i><h3>No transactions yet</h3><p class="text-sm">No activity recorded at this station.</p></div></td></tr>';
      return;
    }
    if (tbody) tbody.innerHTML = list.map(t => `
      <tr>
        <td class="text-sm">${escapeHtml(t.date)} ${escapeHtml(t.time)}</td>
        <td class="font-mono text-xs">${escapeHtml(t.referenceNumber)}</td>
        <td>${escapeHtml(t.driverName || '—')}</td>
        <td>${escapeHtml(t.vehicleType || '—')}</td>
        <td><span class="type-badge ${t.type === 'LOAD' ? 'load' : 'fee'}">${escapeHtml(t.type)}</span></td>
        <td class="font-bold ${t.type === 'LOAD' ? 'text-green' : 'text-primary'}">${t.type === 'LOAD' ? '+' : '-'}₱${Number(t.amount).toFixed(2)}</td>
        <td><span class="status-badge ${t.status === 'SUCCESSFUL' ? 'successful' : 'failed'}">${escapeHtml(t.status)}</span></td>
        <td>${escapeHtml(t.processedBy || '—')}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('viewStationTransactions:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty-inline">Network error.</div></td></tr>';
  }
}
window.viewStationTransactions = viewStationTransactions;

function __adminPrint(htmlContent, title = 'Print') {
  const existing = document.getElementById('__adminPrintFrame');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = '__adminPrintFrame';
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 portrait; margin: 15mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Georgia, serif; font-size: 11pt; line-height: 1.45; color: #000; background: #fff; padding: 0; margin: 0; }
      .header { text-align: center; border-bottom: 3px double #000; padding-bottom: 14px; margin-bottom: 20px; }
      .header::before { content: ""; display: block; width: 60px; height: 3px; background: #000; margin: 0 auto 12px; }
      .header h1 { font-size: 16pt; font-weight: bold; letter-spacing: 2.5px; text-transform: uppercase; margin: 0 0 4px; }
      .header h1::after { content: ""; display: block; width: 100%; height: 1px; background: #000; margin-top: 10px; }
      .header p { font-size: 10pt; color: #333; margin: 3px 0; font-style: italic; }
      .header p:first-of-type { font-size: 11pt; font-weight: bold; font-style: normal; letter-spacing: 1px; }
      h3 { font-size: 12pt; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #666; padding-bottom: 4px; margin: 20px 0 10px; }
      .meta { display: flex; justify-content: space-between; gap: 2rem; font-size: 10pt; margin: 8px 0 12px; padding: 8px 12px; background: #f2f2f2; border: 1px solid #999; }
      .meta strong { font-weight: bold; text-transform: uppercase; font-size: 9pt; letter-spacing: .5px; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 10pt; }
      thead { display: table-header-group; }
      thead th { background: #e8e8e8 !important; color: #000 !important; border: 1px solid #000; padding: 7px 8px; font-weight: bold; font-size: 9pt; text-transform: uppercase; letter-spacing: .5px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tbody td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #f8f8f8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tbody tr { page-break-inside: avoid; }
      tr.total-row td { border-top: 2px solid #000; border-bottom: 3px double #000; font-weight: bold; font-size: 11pt; background: #f2f2f2 !important; padding: 8px; }
      td[style*="text-align:right"], td.amount, th.amount { text-align: right !important; font-family: 'Courier New', monospace; }
      .receipt { max-width: 420px; margin: 0 auto; padding: 20px; border: 2px solid #000; font-family: 'Courier New', monospace; font-size: 10pt; }
      .receipt .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #666; }
      .receipt .row:last-of-type { border-bottom: none; }
      .receipt .row span:first-child { color: #333; }
      .receipt .row strong { text-align: right; }
      .receipt .total { display: flex; justify-content: space-between; padding: 8px 0; margin-top: 8px; border-top: 2px solid #000; border-bottom: 1px solid #000; font-weight: bold; font-size: 11pt; }
      .receipt .status { text-align: center; margin: 14px 0; padding: 8px; border: 3px double #000; font-weight: bold; letter-spacing: 3px; font-size: 12pt; text-transform: uppercase; background: #f2f2f2 !important; }
      .receipt .footer { text-align: center; margin-top: 16px; padding-top: 12px; border-top: 1px dashed #666; font-size: 8pt; color: #333; font-style: italic; }
      .signature { display: flex; justify-content: space-between; gap: 40px; margin-top: 50px; page-break-inside: avoid; }
      .signature > div { flex: 1; text-align: center; padding-top: 32px; border-top: 1px solid #000; font-size: 9pt; color: #333; text-transform: uppercase; font-weight: bold; }
      .footer { text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #999; font-size: 9pt; color: #333; font-style: italic; }
      h1, h2, h3, h4 { page-break-after: avoid; }
      tr { page-break-inside: avoid; }
      img { max-width: 100%; }
    </style></head><body>${htmlContent}</body></html>`);
  doc.close();
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.error('Print failed:', e); }
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1500);
  }, 300);
}
window.__adminPrint = __adminPrint;

window.printLoadRecord = function (reference) {
  if (!reference) { showToast("Missing reference number", "error"); return; }
  const t = transactions.find(x => String(x.reference || x.id) === String(reference));
  if (!t) { showToast("Load record not found", "error"); return; }
  const fmtMoney = v => (v == null ? "—" : "₱" + Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2 }));
  const prevBalance = (t.balance != null ? (t.balance - t.amount) : null);
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>PREPAID BALANCE LOAD RECORD</p></div>
    <div class="receipt">
      <div class="row"><span>Reference No.</span><strong>${escapeHtml(t.reference || "—")}</strong></div>
      ${t.orNumber ? `<div class="row"><span>OR Number</span><strong>${escapeHtml(t.orNumber)}</strong></div>` : ''}
      <div class="row"><span>Date / Time</span><strong>${escapeHtml((t.date || "") + " " + (t.time || ""))}</strong></div>
      <div class="row"><span>Driver Name</span><strong>${escapeHtml(t.driverName || "—")}</strong></div>
      <div class="row"><span>Driver ID</span><strong>${escapeHtml(t.driverId || "—")}</strong></div>
      <div class="row"><span>Vehicle Type</span><strong>${escapeHtml(t.vehicleType || "—")}</strong></div>
      <div class="row"><span>Plate Number</span><strong>${escapeHtml(t.plateNumber || "—")}</strong></div>
      <div class="total"><span>Previous Balance</span><span>${fmtMoney(prevBalance)}</span></div>
      <div class="total"><span>Amount Loaded</span><span>+ ${fmtMoney(t.amount)}</span></div>
      <div class="total"><span>New Balance</span><span>${fmtMoney(t.balance)}</span></div>
      <div class="row"><span>Payment Method</span><strong>Cash</strong></div>
      <div class="row"><span>Cashier</span><strong>${escapeHtml(t.recordedBy || "—")}</strong></div>
      <div class="status">${escapeHtml(String(t.status || "SUCCESSFUL").toUpperCase())}</div>
      <div class="footer">This is a system-generated record.<br>Not an official receipt unless authorized.<br>Printed: ${new Date().toLocaleString("en-PH")}</div>
    </div>`;
  __adminPrint(html, `Load Receipt — ${t.reference}`);
};

window.printReceiptById = function (id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) { showToast("Receipt not found", "error"); return; }
  const fmt = v => (v == null ? "—" : "₱" + Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2 }));
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>TERMINAL FEE RECEIPT</p></div>
    <div class="receipt">
      <div class="row"><span>Reference No.</span><strong>${escapeHtml(t.reference || "—")}</strong></div>
      <div class="row"><span>Date / Time</span><strong>${escapeHtml((t.date || "") + " " + (t.time || ""))}</strong></div>
      <div class="row"><span>Driver Name</span><strong>${escapeHtml(t.driverName || "—")}</strong></div>
      <div class="row"><span>Driver ID</span><strong>${escapeHtml(t.driverId || "—")}</strong></div>
      <div class="row"><span>Vehicle Type</span><strong>${escapeHtml(t.vehicleType || "—")}</strong></div>
      <div class="row"><span>Plate Number</span><strong>${escapeHtml(t.plateNumber || "—")}</strong></div>
      ${t.stationName ? `<div class="row"><span>Station</span><strong>${escapeHtml(t.stationName)}</strong></div>` : ''}
      <div class="total"><span>Fee Collected</span><span>− ${fmt(t.amount)}</span></div>
      <div class="total"><span>Balance After</span><span>${fmt(t.balance)}</span></div>
      <div class="row"><span>Processed By</span><strong>${escapeHtml(t.recordedBy || "—")}</strong></div>
      <div class="status">${escapeHtml(String(t.status || "SUCCESSFUL").toUpperCase())}</div>
      <div class="footer">This is a system-generated record.<br>Thank you for using Borongan Transport.<br>Printed: ${new Date().toLocaleString("en-PH")}</div>
    </div>`;
  __adminPrint(html, `Receipt — ${t.reference}`);
};

window.printTransactionReport = function (list, label, total) {
  const rows = (list || []).map(t => `
    <tr>
      <td>${escapeHtml(t.date || "")}</td>
      <td>${escapeHtml(t.reference || "")}</td>
      <td>${escapeHtml(t.driverName || "")}</td>
      <td>${escapeHtml(t.vehicleType || "")}</td>
      <td style="text-align:right;">₱${Number(t.amount || 0).toFixed(2)}</td>
      <td>${escapeHtml(t.status || "")}</td>
    </tr>`).join("");
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>TRANSACTION REPORT</p></div>
    <div class="meta"><span><strong>Period:</strong> ${escapeHtml(label || '—')}</span><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <div class="meta"><span><strong>Total Transactions:</strong> ${(list || []).length}</span><span><strong>Total Amount:</strong> ₱${Number(total || 0).toFixed(2)}</span></div>
    <table><thead><tr><th>Date</th><th>Reference</th><th>Driver</th><th>Vehicle</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;">No records</td></tr>'}</tbody></table>
    <div class="signature"><div>Prepared by</div><div>Approved by</div></div>
    <div class="footer">This report was generated from saved transaction records.</div>`;
  __adminPrint(html, `Transaction Report — ${label}`);
};

window.printSummaryReport = function (type) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA");
  const monthStr = todayStr.slice(0, 7);
  const yearStr = todayStr.slice(0, 4);
  let filtered = [], label = "";
  if (type === "daily") { filtered = transactions.filter(t => t.date === todayStr && t.type === "FEE"); label = "Daily Summary · " + todayStr; }
  else if (type === "weekly") {
    const s = new Date(now); s.setDate(now.getDate() - now.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    const ss = s.toLocaleDateString("en-CA"), ee = e.toLocaleDateString("en-CA");
    filtered = transactions.filter(t => t.type === "FEE" && t.date >= ss && t.date <= ee);
    label = "Weekly Summary · " + ss + " to " + ee;
  } else if (type === "monthly") { filtered = transactions.filter(t => t.type === "FEE" && (t.date || "").startsWith(monthStr)); label = "Monthly Summary · " + now.toLocaleString("default", { month: "long", year: "numeric" }); }
  else if (type === "yearly") { filtered = transactions.filter(t => t.type === "FEE" && (t.date || "").startsWith(yearStr)); label = "Yearly Summary · " + yearStr; }
  else { showToast("Unknown report type", "error"); return; }
  const total = filtered.reduce((s, t) => s + Number(t.amount || 0), 0);
  const byVehicle = {};
  filtered.forEach(t => { const v = t.vehicleType || "Unknown"; if (!byVehicle[v]) byVehicle[v] = { count: 0, total: 0 }; byVehicle[v].count++; byVehicle[v].total += Number(t.amount || 0); });
  const vehicleRows = Object.entries(byVehicle).map(([v, d]) => `<tr><td>${escapeHtml(v)}</td><td style="text-align:right;">${d.count}</td><td style="text-align:right;">₱${d.total.toFixed(2)}</td></tr>`).join("");
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>FEE SUMMARY</p></div>
    <div class="meta"><span><strong>Period:</strong> ${escapeHtml(label)}</span><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <div class="meta"><span><strong>Total Transactions:</strong> ${filtered.length}</span><span><strong>Total Fees Collected:</strong> ₱${total.toFixed(2)}</span></div>
    <h3>Breakdown by Vehicle Type</h3>
    <table><thead><tr><th>Vehicle Type</th><th style="text-align:right;">Transactions</th><th style="text-align:right;">Total Fees</th></tr></thead>
      <tbody>${vehicleRows || '<tr><td colspan="3" style="text-align:center;">No records</td></tr>'}</tbody>
      <tfoot><tr class="total-row"><td>TOTAL</td><td style="text-align:right;">${filtered.length}</td><td style="text-align:right;">₱${total.toFixed(2)}</td></tr></tfoot>
    </table>
    <div class="signature"><div>Prepared by</div><div>Approved by</div></div>
    <div class="footer">This report was generated from saved transaction records.</div>`;
  __adminPrint(html, `Fee Summary — ${type}`);
};

window.printStationTransactions = function () {
  const title = document.getElementById('stationTxnTitle')?.textContent || 'Station';
  const tbody = document.getElementById('stationTxnTable');
  if (!tbody) { showToast('No station selected', 'warning'); return; }
  const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 8) return '';
    return `<tr>
      <td>${escapeHtml(tds[0].textContent.trim())}</td>
      <td>${escapeHtml(tds[1].textContent.trim())}</td>
      <td>${escapeHtml(tds[2].textContent.trim())}</td>
      <td>${escapeHtml(tds[3].textContent.trim())}</td>
      <td>${escapeHtml(tds[4].textContent.trim())}</td>
      <td style="text-align:right;">${escapeHtml(tds[5].textContent.trim())}</td>
      <td>${escapeHtml(tds[6].textContent.trim())}</td>
      <td>${escapeHtml(tds[7].textContent.trim())}</td>
    </tr>`;
  }).filter(r => r).join("");
  const summaryTotal   = document.getElementById('stTxnTotalCount')?.textContent || '0';
  const summarySuccess = document.getElementById('stTxnSuccessCount')?.textContent || '0';
  const summaryFailed  = document.getElementById('stTxnFailedCount')?.textContent || '0';
  const summaryFees    = document.getElementById('stTxnTotalFees')?.textContent || '₱0.00';
  const summaryLoads   = document.getElementById('stTxnTotalLoads')?.textContent || '₱0.00';
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>STATION TRANSACTIONS</p></div>
    <div class="meta"><span><strong>Station:</strong> ${escapeHtml(title)}</span><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <div class="meta"><span><strong>Total:</strong> ${escapeHtml(summaryTotal)}</span><span><strong>Successful:</strong> ${escapeHtml(summarySuccess)}</span><span><strong>Failed:</strong> ${escapeHtml(summaryFailed)}</span></div>
    <div class="meta"><span><strong>Total Fees:</strong> ${escapeHtml(summaryFees)}</span><span><strong>Total Loads:</strong> ${escapeHtml(summaryLoads)}</span></div>
    <table><thead><tr><th>Date &amp; Time</th><th>Reference</th><th>Driver</th><th>Vehicle</th><th>Type</th><th style="text-align:right;">Amount</th><th>Status</th><th>Processed By</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" style="text-align:center;">No transactions</td></tr>'}</tbody></table>
    <div class="signature"><div>Prepared by</div><div>Approved by</div></div>
    <div class="footer">Station-scoped transaction report.</div>`;
  __adminPrint(html, `Station Report — ${title}`);
};

window.printAuditLogs = function () {
  const rows = (typeof auditLogs !== 'undefined' ? auditLogs : []).map(l => `<tr>
    <td>${escapeHtml(l.timestamp || l.createdAt || '')}</td>
    <td>${escapeHtml(l.user || 'System')}</td>
    <td>${escapeHtml(l.role || 'System')}</td>
    <td>${escapeHtml(l.action || '')}</td>
    <td>${escapeHtml(l.recordRef || l.details || '')}</td>
  </tr>`).join("");
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>AUDIT LOG</p></div>
    <div class="meta"><span><strong>Total Entries:</strong> ${(typeof auditLogs !== 'undefined' ? auditLogs.length : 0)}</span><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <table><thead><tr><th>Date/Time</th><th>User</th><th>Role</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No logs</td></tr>'}</tbody></table>
    <div class="footer">Generated from saved audit log records.</div>`;
  __adminPrint(html, 'Audit Log');
};

window.printFeeHistory = function () {
  const rows = (typeof feeHistory !== 'undefined' ? feeHistory : []).map(h => `<tr>
    <td>${h.createdAt ? new Date(h.createdAt).toLocaleString('en-PH') : '—'}</td>
    <td>${escapeHtml(h.vehicleType || '')}</td>
    <td>${h.oldFee != null ? '₱' + Number(h.oldFee).toFixed(2) : '—'}</td>
    <td>₱${Number(h.newFee).toFixed(2)}</td>
    <td>${escapeHtml(h.changedBy || '—')}</td>
    <td>${escapeHtml(h.reason || '—')}</td>
  </tr>`).join("");
  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>FEE CHANGE HISTORY</p></div>
    <div class="meta"><span><strong>Total Entries:</strong> ${(typeof feeHistory !== 'undefined' ? feeHistory.length : 0)}</span><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <table><thead><tr><th>Date/Time</th><th>Vehicle Type</th><th>Old Fee</th><th>New Fee</th><th>Changed By</th><th>Reason</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;">No changes recorded</td></tr>'}</tbody></table>
    <div class="footer">Generated from saved fee change records.</div>`;
  __adminPrint(html, 'Fee Change History');
};

function initUserChip() {
  const chip = document.querySelector(".user-chip");
  if (!chip) return;
  if (!$("userChipMenu")) {
    const menu = document.createElement("div");
    menu.id = "userChipMenu";
    menu.style.cssText = `position:absolute;display:none;min-width:220px;padding:.4rem 0;border:1px solid var(--border);border-radius:.65rem;background:#fff;box-shadow:0 18px 40px rgba(15,23,42,0.16);z-index:2500;font-family:'Inter',system-ui,sans-serif;`;
    menu.innerHTML = `
      <div style="padding:.7rem 1rem .6rem;border-bottom:1px solid var(--border-soft);">
        <div id="menuUserName" style="font-weight:700;font-size:.85rem;color:var(--text-dark);">Admin</div>
        <div id="menuUserRole" style="font-size:.7rem;color:var(--text-mid);margin-top:.1rem;">Administrator</div>
      </div>
      <button type="button" class="user-chip-menu-item" data-action="profile" style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:var(--text-dark);cursor:pointer;"><i class="fas fa-user-circle" style="color:var(--maroon);width:16px;"></i> My Profile</button>
      <button type="button" class="user-chip-menu-item" data-action="change-password" style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:var(--text-dark);cursor:pointer;"><i class="fas fa-key" style="color:var(--maroon);width:16px;"></i> Change Password</button>
      <button type="button" class="user-chip-menu-item" data-action="settings" style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:var(--text-dark);cursor:pointer;"><i class="fas fa-sliders" style="color:var(--maroon);width:16px;"></i> Settings</button>
      <div style="height:1px;background:var(--border-soft);margin:.35rem 0;"></div>
      <button type="button" class="user-chip-menu-item" data-action="logout" style="display:flex;align-items:center;gap:.6rem;width:100%;padding:.6rem 1rem;border:none;background:none;text-align:left;font-size:.8rem;color:var(--red);cursor:pointer;"><i class="fas fa-right-from-bracket" style="width:16px;"></i> Logout</button>
    `;
    document.body.appendChild(menu);
    menu.querySelectorAll(".user-chip-menu-item").forEach(item => {
      item.addEventListener("mouseenter", () => { item.style.background = "var(--maroon-tint)"; });
      item.addEventListener("mouseleave", () => { item.style.background = "none"; });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        closeUserChipMenu();
        switch (action) {
          case "profile":         navigateTo("settings"); break;
          case "change-password": navigateTo("change-password"); break;
          case "settings":        navigateTo("system-settings"); break;
          case "logout":          if (typeof window.logout === "function") window.logout(); break;
        }
      });
    });
  }
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("userChipMenu");
    if (!menu) return;
    if (window.CURRENT_USER) {
      setText("menuUserName", window.CURRENT_USER.fullName || window.CURRENT_USER.username || "Admin");
      setText("menuUserRole", "Administrator");
    }
    const rect = chip.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 8) + "px";
    menu.style.left = (rect.right + window.scrollX - 220) + "px";
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    const menu = $("userChipMenu");
    if (!menu || menu.style.display !== "block") return;
    if (!chip.contains(e.target) && !menu.contains(e.target)) closeUserChipMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeUserChipMenu(); });
}

function closeUserChipMenu() {
  const menu = $("userChipMenu");
  if (menu) menu.style.display = "none";
}
window.closeUserChipMenu = closeUserChipMenu;

function updateTopbarClock() {
  const el = $("topbarDateTime");
  if (!el) return;
  const now = new Date();
  const datePart = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timePart = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  el.textContent = `${datePart}, ${timePart}`;
}

let __inqCurrentId = null;
let __inqList = [];
let __inqOriginalReply = "";
let __inqLoading = false;
let __inqError = null;
let __inqBusy = false;

const __INQ_STATUS = {
  new:      { dbValue: 'new',      wire: 'new',      display: 'new',         filter: 'new',         label: 'New' },
  read:     { dbValue: 'read',     wire: 'read',     display: 'in_progress', filter: 'in_progress', label: 'In Progress' },
  replied:  { dbValue: 'replied',  wire: 'replied',  display: 'replied',     filter: 'replied',     label: 'Replied' },
  resolved: { dbValue: 'resolved', wire: 'resolved', display: 'resolved',    filter: 'resolved',    label: 'Resolved' }
};

function __inqStatusKey(raw) {
  const s = String(raw || 'new').toLowerCase().trim();
  if (__INQ_STATUS[s]) return s;
  for (const k of Object.keys(__INQ_STATUS)) {
    if (__INQ_STATUS[k].display === s || __INQ_STATUS[k].filter === s) return k;
  }
  return 'new';
}
function __inqStatusInfo(raw) { return __INQ_STATUS[__inqStatusKey(raw)]; }

function __inqEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function __inqFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function __inqUpdateSidebarBadge() {
  const newCount = __inqList.filter(i => __inqStatusKey(i.status) === 'new').length;
  const badge = document.getElementById('inquirySidebarBadge');
  if (!badge) return;
  badge.textContent = newCount;
  badge.hidden = newCount === 0;
}

function renderInquiryStats(list) {
  const counts = { new: 0, read: 0, replied: 0, resolved: 0 };
  list.forEach(i => { counts[__inqStatusKey(i.status)]++; });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('inqStatTotal',    list.length);
  set('inqStatNew',      counts.new);
  set('inqStatReplied',  counts.replied);
  set('inqStatResolved', counts.resolved);
}

function renderInquiries() {
  const table   = document.getElementById('inquiryTable');
  const counter = document.getElementById('inquiryCount');
  if (!table) return;

  if (__inqLoading) {
    table.innerHTML = '<tr><td colspan="6"><div class="empty-inline">' +
      '<i class="fas fa-spinner fa-spin" style="margin-right:.4rem;"></i> Loading inquiries…' +
      '</div></td></tr>';
    if (counter) counter.textContent = '…';
    return;
  }

  if (__inqError) {
    table.innerHTML = '<tr><td colspan="6"><div class="empty-state py-6">' +
      '<i class="fas fa-triangle-exclamation" style="color:var(--red);"></i>' +
      '<h3>Could not load inquiries</h3>' +
      '<p class="text-sm">' + __inqEscape(__inqError) + '</p>' +
      '<button class="btn-outline btn-sm" style="margin-top:.75rem;" ' +
        'onclick="refreshInquiries()"><i class="fas fa-sync"></i> Retry</button>' +
      '</div></td></tr>';
    if (counter) counter.textContent = '0';
    return;
  }

  const filterValue = document.getElementById('inquiryStatusFilter')?.value || '';
  const search      = (document.getElementById('inquirySearch')?.value || '').toLowerCase().trim();

  renderInquiryStats(__inqList);
  __inqUpdateSidebarBadge();

  let list = __inqList.slice();
  list.sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));

  if (filterValue) list = list.filter(i => __inqStatusInfo(i.status).filter === filterValue);
  if (search) {
    list = list.filter(i =>
      (i.name    || '').toLowerCase().includes(search) ||
      (i.email   || '').toLowerCase().includes(search) ||
      (i.subject || '').toLowerCase().includes(search) ||
      (i.message || '').toLowerCase().includes(search));
  }

  if (counter) counter.textContent = list.length;

  if (!list.length) {
    const filtered = !!(filterValue || search);
    table.innerHTML = '<tr><td colspan="6"><div class="empty-state py-6">' +
      '<i class="fas fa-inbox"></i>' +
      '<h3>' + (filtered ? 'No matching inquiries' : 'No inquiries yet') + '</h3>' +
      '<p class="text-sm">' +
        (filtered ? 'Try clearing filters or search.' : 'Public and driver messages will appear here.') +
      '</p></div></td></tr>';
    return;
  }

  table.innerHTML = list.map(inq => {
    const info    = __inqStatusInfo(inq.status);
    const preview = (inq.message || '').length > 70 ? inq.message.slice(0, 70) + '…' : (inq.message || '');
    const isDriver = inq.isDriver === true;
    const driverBadge = isDriver
      ? ' <span style="font-size:.6rem;background:var(--maroon-soft);color:var(--maroon);padding:.1rem .4rem;border-radius:4px;font-weight:700;letter-spacing:.03em;vertical-align:middle;">DRIVER</span>'
      : '';
    return '<tr>' +
      '<td>' + __inqEscape(__inqFormatDate(inq.receivedAt)) + '</td>' +
      '<td><div class="inq-subject">' + __inqEscape(inq.name || 'Anonymous') + driverBadge + '</div>' +
        '<div class="inq-email">' + __inqEscape(inq.email || '—') + '</div></td>' +
      '<td><strong>' + __inqEscape(inq.subject || '—') + '</strong></td>' +
      '<td><div class="inq-preview">' + __inqEscape(preview) + '</div></td>' +
      '<td><span class="inq-status ' + info.display + '">' + __inqEscape(info.label) + '</span></td>' +
      '<td><button class="btn-primary btn-sm" onclick="openInquiry(\'' + __inqEscape(inq.id) + '\')">' +
        '<i class="fas fa-eye"></i> View</button></td>' +
    '</tr>';
  }).join('');
}
window.renderInquiries = renderInquiries;

async function __refreshInquiries(showSuccess = false) {
  __inqLoading = true; __inqError = null; renderInquiries();
  try {
    const result = await window.api('inquiries.php');
    if (!result || !result.success || !result.data || !Array.isArray(result.data.inquiries)) {
      __inqLoading = false;
      __inqError = (result && result.message) || 'Inquiries could not be loaded.';
      renderInquiries();
      if (typeof showToast === 'function') showToast(__inqError, 'error');
      return false;
    }
    __inqList = result.data.inquiries;
    __inqLoading = false; __inqError = null;
    renderInquiries();
    if (showSuccess && typeof showToast === 'function') showToast('Inquiries refreshed.', 'success');
    if (typeof window.loadNotifications === 'function') window.loadNotifications();
    return true;
  } catch (err) {
    console.error('Inquiry load failed:', err);
    __inqLoading = false;
    __inqError = 'Network error. Please check your connection.';
    renderInquiries();
    if (typeof showToast === 'function') showToast(__inqError, 'error');
    return false;
  }
}

async function openInquiry(id) {
  let inq = __inqList.find(i => i.id === id);
  if (!inq) return;
  __inqCurrentId = id;
  const dbStatus = __inqStatusKey(inq.status);
  if (dbStatus === 'new') {
    try {
      const res = await window.api('inquiries.php', { method: 'PATCH', body: { id, status: __INQ_STATUS.read.wire } });
      if (res && res.success && res.data && res.data.inquiry) {
        inq = res.data.inquiry;
        __inqList = __inqList.map(item => item.id === id ? inq : item);
        renderInquiries();
      }
    } catch (err) { console.warn('Auto-bump network error:', err); }
  }
  document.getElementById('inqModalName').textContent    = inq.name || 'Anonymous';
  document.getElementById('inqModalEmail').textContent   = inq.email || '—';
  document.getElementById('inqModalSubject').textContent = inq.subject || '—';
  document.getElementById('inqModalBody').textContent    = inq.message || '—';
  document.getElementById('inqModalDate').textContent    = __inqFormatDate(inq.receivedAt);
  document.getElementById('inqModalType').textContent    = inq.topic || inq.subject || 'General';
  const info = __inqStatusInfo(inq.status);
  const statusEl = document.getElementById('inqModalStatus');
  statusEl.className = 'inq-status ' + info.display;
  statusEl.textContent = info.label.toUpperCase();
  const replyEl = document.getElementById('inqReplyText');
  replyEl.value = inq.reply || '';
  __inqOriginalReply = replyEl.value;
  __renderPreviousResponse(inq);
  openModal('inquiryModal');
}
window.openInquiry = openInquiry;

function __renderPreviousResponse(inq) {
  let wrap = document.getElementById('inqResponseHistory');
  const form = document.querySelector('.inq-reply-form');
  if (!form) return;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'inqResponseHistory';
    wrap.style.cssText = 'margin:.75rem 0;';
    form.parentNode.insertBefore(wrap, form);
  }
  if (!inq.reply || !inq.repliedAt) { wrap.innerHTML = ''; return; }
  wrap.innerHTML =
    '<div class="section-mini-title"><i class="fas fa-comments"></i> Previous Response</div>' +
    '<div style="background:var(--maroon-tint);border-left:3px solid var(--maroon);' +
         'padding:.6rem .75rem;border-radius:.5rem;margin-bottom:.5rem;">' +
      '<div style="font-size:.7rem;color:var(--text-mid);margin-bottom:.2rem;">' +
        '<strong>Admin</strong> · ' + __inqEscape(__inqFormatDate(inq.repliedAt)) + '</div>' +
      '<div style="font-size:.82rem;white-space:pre-wrap;">' + __inqEscape(inq.reply) + '</div>' +
    '</div>';
}

async function __inqPatch(body, successMessage) {
  if (!__inqCurrentId) return false;
  if (__inqBusy) { if (typeof showToast === 'function') showToast('Please wait…', 'warning'); return false; }
  __inqBusy = true;
  try {
    const res = await window.api('inquiries.php', { method: 'PATCH', body: { id: __inqCurrentId, ...body } });
    if (!res || !res.success || !res.data || !res.data.inquiry) {
      const msg = (res && res.message) || 'Inquiry could not be saved.';
      if (typeof showToast === 'function') showToast(msg, 'error');
      return false;
    }
    const updated = res.data.inquiry;
    __inqList = __inqList.map(item => item.id === updated.id ? updated : item);
    renderInquiries();
    if (typeof showToast === 'function') showToast(successMessage, 'success');
    if (typeof window.loadNotifications === 'function') window.loadNotifications();
    closeModal('inquiryModal');
    return true;
  } catch (err) {
    console.error('Inquiry update failed:', err);
    if (typeof showToast === 'function') showToast('Network error saving inquiry.', 'error');
    return false;
  } finally { __inqBusy = false; }
}

function saveInquiryReply() {
  const reply = document.getElementById('inqReplyText').value.trim();
  if (!reply) { if (typeof showToast === 'function') showToast('Enter a response before saving.', 'error'); return; }
  return __inqPatch({ reply }, 'Response saved.');
}
window.saveInquiryReply = saveInquiryReply;

function resolveInquiry() {
  const replyEl = document.getElementById('inqReplyText');
  const typed   = replyEl.value.trim();
  const hasUnsaved = typed && typed !== __inqOriginalReply;
  if (hasUnsaved) {
    if (window.ConfirmModal) {
      window.ConfirmModal.show({
        title: 'Unsaved response',
        message: 'You have unsaved response text. Resolving without saving will discard the typed text.',
        confirmText: 'Resolve without saving',
        cancelText: 'Cancel',
        onConfirm: () => __inqPatch({ status: __INQ_STATUS.resolved.wire }, 'Inquiry marked as resolved.')
      });
      return;
    }
  }
  return __inqPatch({ status: __INQ_STATUS.resolved.wire }, 'Inquiry marked as resolved.');
}
window.resolveInquiry = resolveInquiry;

function closeInquiryModalSafe() {
  const current = document.getElementById('inqReplyText')?.value.trim() || '';
  if (current && current !== __inqOriginalReply) {
    if (window.ConfirmModal) {
      window.ConfirmModal.show({
        title: 'Discard unsaved changes?',
        message: 'Your response text has not been saved. Close anyway?',
        confirmText: 'Discard', cancelText: 'Keep editing',
        onConfirm: () => closeModal('inquiryModal')
      });
      return;
    }
    if (!confirm('Discard unsaved response?')) return;
  }
  closeModal('inquiryModal');
}
window.closeInquiryModalSafe = closeInquiryModalSafe;

window.refreshInquiries = function () { return __refreshInquiries(true); };

function __wireInqStatCard(cardId, filterKey) {
  const el = document.getElementById(cardId)?.closest('.kpi-tile');
  if (!el) return;
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    const sf = document.getElementById('inquiryStatusFilter');
    if (sf) sf.value = filterKey;
    renderInquiries();
  });
}

window.authReady.then(async (me) => {
  if (!me) return;
  currentAdminUser = me;
  if (window.__adminBooted === true) return;
  window.__adminBooted = true;

  initSidebar();
  initDriverForm();
  initUserForm();
  initNotificationBell();
  initUserChip();

  document.querySelectorAll(".modal-overlay").forEach(m => {
    m.addEventListener("click", e => { if (e.target === m) m.classList.remove("active"); });
  });

  $("mobileToggle")?.addEventListener("click", () => {
    const sb = $("sidebar");
    if (sb) sb.classList.toggle("open");
  });

  $("driverSearch")?.addEventListener("input", renderDrivers);
  $("driverSort")?.addEventListener("change", renderDrivers);
  $("driverApprovalFilter")?.addEventListener("change", renderDrivers);
  $("vehicleSearch")?.addEventListener("input", renderVehicles);
  $("walletSearch")?.addEventListener("input", renderWalletLoads);
  $("transSearch")?.addEventListener("input", renderTransactions);
  $("transDate")?.addEventListener("change", renderTransactions);
   $("transType")?.addEventListener("change", renderTransactions);
  $("verifySearch")?.addEventListener("input", renderVerifications);    
  $("verifyDate")?.addEventListener("change", renderVerifications);    
  $("auditSearch")?.addEventListener("input", renderAuditLogs);
  $("auditDate")?.addEventListener("change", renderAuditLogs);
  $("attendanceDate")?.addEventListener("change", loadAttendance);
  $("userSearch")?.addEventListener("input", renderUsers);
  $("userRoleFilter")?.addEventListener("change", renderUsers);
  $("refSearch")?.addEventListener("input", renderReferences);
  $("inquiryStatusFilter")?.addEventListener("change", renderInquiries);
  $("inquirySearch")?.addEventListener("input", renderInquiries);

  document.querySelectorAll('.sidebar-item[data-page="inquiries"]').forEach(btn => {
    btn.addEventListener('click', function () { __refreshInquiries(); });
  });
  document.querySelectorAll('.sidebar-item[data-page="staff-assignments"]').forEach(btn => {
    btn.addEventListener('click', function () { setTimeout(loadStaffAssignments, 100); });
  });

  __wireInqStatCard('inqStatTotal',    '');
  __wireInqStatCard('inqStatNew',      __INQ_STATUS.new.filter);
  __wireInqStatCard('inqStatReplied',  __INQ_STATUS.replied.filter);
  __wireInqStatCard('inqStatResolved', __INQ_STATUS.resolved.filter);

  updateTopbarClock();
  setInterval(updateTopbarClock, 30000);

  setText("adminGreetingName", me.fullName || me.username || "Admin");
  if ($("adminName")) $("adminName").value = me.fullName || me.username;
  if ($("profileLastLogin")) $("profileLastLogin").textContent = new Date().toLocaleString("en-PH");

  const finalTarget = (location.hash || "").replace("#", "").trim() || sessionStorage.getItem("admin_active_page") || "dashboard";
  if (finalTarget && $("page-" + finalTarget)) {
    navigateTo(finalTarget);
  } else {
    navigateTo("dashboard");
  }

  initChart();
  loadFees();
  refreshCurrentPage(finalTarget || "dashboard");

  loadAllDataFromDB().then(() => {
    refreshCurrentPage(finalTarget || "dashboard");
    loadTerminalsData();
    loadActivityFeed();
    refreshLiveStatus();
    refreshStationActivity();
    refreshRecentMovements();
    refreshCashierActivity();
  });

  loadActivityFeed();
  __refreshInquiries();
  startLiveMonitoring();
  setTimeout(checkEndOfDaySummary, 2000);

  const profile = await window.api("users.php", { query: { me: 1 } });
  if (profile.success && profile.data && profile.data.user) {
    window.CURRENT_USER = profile.data.user;
    if ($("adminName")) $("adminName").value = profile.data.user.fullName || me.fullName || me.username;
    if ($("adminEmail")) $("adminEmail").value = profile.data.user.email || "";
    setText("sidebarUser", profile.data.user.fullName || profile.data.user.username || "Admin");
    const chip = $("userNameChip"); if (chip) chip.textContent = profile.data.user.fullName || profile.data.user.username || "Admin";
    const av = $("userAvatarChip"); if (av) av.textContent = (profile.data.user.fullName || "A").charAt(0).toUpperCase();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshLiveStatus();
      refreshStationActivity();
      refreshRecentMovements();
      refreshCashierActivity();
      startLiveMonitoring();
    } else {
      stopLiveMonitoring();
    }
  });
});


window.generateAttendanceReport = async function() {
  const from = $('attReportFrom')?.value;
  const to = $('attReportTo')?.value;
  const table = $('attendanceReportTable');
  if (!table) return;

  if (!from || !to) {
      showToast('Please select both From and To dates.', 'warning');
      return;
  }

  table.innerHTML = '<tr><td colspan="6"><div class="empty-inline"><i class="fas fa-spinner fa-spin"></i> Loading records...</div></td></tr>';

  try {
      const res = await window.api('attendance.php', { query: { action: 'list', from, to } });
      if (!res.success) throw new Error(res.message || 'Failed to load data');

      let records = res.data.records || [];
      
      records = records.filter(r => {
          const dateStr = r.date || (r.timeIn ? r.timeIn.slice(0, 10) : '');
          return dateStr >= from && dateStr <= to;
      });

      if (!records.length) {
          table.innerHTML = '<tr><td colspan="6"><div class="empty-state py-6"><i class="fas fa-user-clock"></i><h3>No records found</h3><p class="text-sm">No attendance data for the selected period.</p></div></td></tr>';
          $('attReportSummary').style.display = 'none';
          return;
      }

      records.sort((a, b) => {
          const d1 = a.date || a.timeIn || '';
          const d2 = b.date || b.timeIn || '';
          return d2.localeCompare(d1);
      });

      let presentCount = 0, lateCount = 0;

      table.innerHTML = records.map(r => {
          const statusStr = String(r.status || 'UNKNOWN').toUpperCase();
          if (statusStr.includes('ON TIME') || statusStr.includes('PRESENT')) presentCount++;
          else if (statusStr.includes('LATE')) lateCount++;

          const badgeCls = statusStr.includes('ON TIME') ? 'successful' : statusStr.includes('LATE') ? 'pending' : 'failed';
          const dateStr = r.date || (r.timeIn ? r.timeIn.slice(0, 10) : '—');

          return `<tr>
            <td class="text-sm">${escapeHtml(dateStr)}</td>
            <td class="font-medium">${escapeHtml(r.name || '—')}</td>
            <td class="text-sm">${escapeHtml(r.role || '—')}</td>
            <td>${escapeHtml(r.timeIn || '—')}</td>
            <td>${escapeHtml(r.timeOut || '—')}</td>
            <td><span class="status-badge ${badgeCls}">${escapeHtml(statusStr)}</span></td>
          </tr>`;
      }).join('');

      const summaryEl = $('attReportSummary');
      summaryEl.style.display = 'grid';
      summaryEl.innerHTML = `
          <div class="kpi-tile">
              <div class="kpi-body"><div class="kpi-label">Total Records</div><div class="kpi-value">${records.length}</div></div>
              <div class="kpi-icon kpi-icon-blue"><i class="fas fa-list"></i></div>
          </div>
          <div class="kpi-tile">
              <div class="kpi-body"><div class="kpi-label">On Time</div><div class="kpi-value text-green">${presentCount}</div></div>
              <div class="kpi-icon kpi-icon-green"><i class="fas fa-check"></i></div>
          </div>
          <div class="kpi-tile">
              <div class="kpi-body"><div class="kpi-label">Late</div><div class="kpi-value text-yellow">${lateCount}</div></div>
              <div class="kpi-icon kpi-icon-yellow"><i class="fas fa-clock"></i></div>
          </div>
      `;

      window.__currentAttendanceData = { list: records, from, to };
      showToast('Attendance report generated.', 'success');

  } catch (err) {
      console.error(err);
      table.innerHTML = `<tr><td colspan="6"><div class="empty-inline text-red">${escapeHtml(err.message)}</div></td></tr>`;
  }
};

window.printAttendanceReport = function() {
  if (!window.__currentAttendanceData) {
      showToast('Generate a report first.', 'warning');
      return;
  }
  const { list, from, to } = window.__currentAttendanceData;
  
  const rows = list.map(r => `
    <tr>
      <td>${escapeHtml(r.date || '—')}</td>
      <td>${escapeHtml(r.name || '—')}</td>
      <td>${escapeHtml(r.role || '—')}</td>
      <td>${escapeHtml(r.timeIn || '—')}</td>
      <td>${escapeHtml(r.timeOut || '—')}</td>
      <td>${escapeHtml(String(r.status || '—').toUpperCase())}</td>
    </tr>
  `).join('');

  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>ATTENDANCE REPORT</p></div>
    <div class="meta">
      <span><strong>Period:</strong> ${escapeHtml(from)} to ${escapeHtml(to)}</span>
      <span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span>
    </div>
    <div class="meta">
      <span><strong>Total Records:</strong> ${list.length}</span>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Employee</th><th>Role</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;">No records</td></tr>'}</tbody>
    </table>
    <div class="signature"><div>Prepared by</div><div>Approved by</div></div>
    <div class="footer">This report was generated from saved attendance records.</div>
  `;
  __adminPrint(html, `Attendance Report — ${from} to ${to}`);
};

   const scrollTopBtn = document.getElementById('scrollToTopBtn');
  const mainContent = document.querySelector('.main-content');
  
  if (mainContent && scrollTopBtn) {
    mainContent.addEventListener('scroll', () => {
      if (mainContent.scrollTop > 300) {
        scrollTopBtn.classList.add('show');
      } else {
        scrollTopBtn.classList.remove('show');
      }
    });

    scrollTopBtn.addEventListener('click', () => {
      mainContent.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  window.printVerificationLog = function (id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) { showToast("Verification log not found", "error"); return; }
  
  const isExit = t.movementType === 'EXIT';
  const logType = isExit ? "VEHICLE EXIT VERIFICATION" : "VEHICLE ENTRY VERIFICATION";
  
  const html = `
    <div class="header">
      <h1>BORONGAN TRANSPORT</h1>
      <p>Borongan City Transport Terminal</p>
      <p>${logType}</p>
    </div>
    <div class="receipt">
      <div class="row"><span>Reference No.</span><strong>${escapeHtml(t.reference || "—")}</strong></div>
      <div class="row"><span>Date / Time</span><strong>${escapeHtml((t.date || "") + " " + (t.time || ""))}</strong></div>
      <div class="row"><span>Driver Name</span><strong>${escapeHtml(t.driverName || "—")}</strong></div>
      <div class="row"><span>Driver ID</span><strong>${escapeHtml(t.driverId || "—")}</strong></div>
      <div class="row"><span>Vehicle Type</span><strong>${escapeHtml(t.vehicleType || "—")}</strong></div>
      <div class="row"><span>Plate Number</span><strong>${escapeHtml(t.plateNumber || "—")}</strong></div>
      <div class="row"><span>Station</span><strong>${escapeHtml(t.stationName || "—")}</strong></div>
      
      <div class="total" style="justify-content:center; margin-top:20px;">
        <span style="font-size:14pt;">${isExit ? 'EXIT AUTHORIZED' : 'ENTRY LOGGED'}</span>
      </div>
      
      <div class="row"><span>Processed By</span><strong>${escapeHtml(t.recordedBy || "System")}</strong></div>
      <div class="status">VERIFIED</div>
      
      <div class="footer">
        This is a system-generated verification log.<br>
        Gate pass is valid for the current shift only.<br>
        Printed: ${new Date().toLocaleString("en-PH")}
      </div>
    </div>`;
    
  __adminPrint(html, `Verification Log — ${t.reference}`);
};

 window.printVerificationReport = function () {
   const table = document.getElementById("verifyTable");
  if (!table) return;
  
  const rows = Array.from(table.querySelectorAll("tr")).map(tr => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 6) return "";
    return `
      <tr>
        <td>${escapeHtml(tds[0].textContent.trim())}</td>
        <td>${escapeHtml(tds[1].textContent.trim())}</td>
        <td>${escapeHtml(tds[2].textContent.trim())}</td>
        <td>${escapeHtml(tds[3].textContent.trim())}</td>
        <td>${escapeHtml(tds[4].textContent.trim())}</td>
        <td>${escapeHtml(tds[5].textContent.trim())}</td>
      </tr>`;
  }).filter(r => r).join("");

  const html = `
    <div class="header"><h1>BORONGAN TRANSPORT</h1><p>Borongan City Transport Terminal</p><p>VEHICLE VERIFICATION & EXIT LOGS</p></div>
    <div class="meta"><span><strong>Generated:</strong> ${new Date().toLocaleString("en-PH")}</span></div>
    <table>
      <thead><tr><th>Date & Time</th><th>Driver</th><th>Vehicle</th><th>Movement</th><th>Station</th><th>Processed By</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;">No records found</td></tr>'}</tbody>
    </table>
    <div class="signature"><div>Prepared by</div><div>Approved by</div></div>
  `;
  __adminPrint(html, "Verification Logs");
};

 window.printVerificationLog = function (id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) { showToast("Verification log not found", "error"); return; }
  
  const isExit = t.movementType === 'EXIT';
  const logType = isExit ? "VEHICLE EXIT VERIFICATION" : "VEHICLE ENTRY VERIFICATION";
  
  const html = `
    <div class="header">
      <h1>BORONGAN TRANSPORT</h1>
      <p>Borongan City Transport Terminal</p>
      <p>${logType}</p>
    </div>
    <div class="receipt">
      <div class="row"><span>Reference No.</span><strong>${escapeHtml(t.reference || "—")}</strong></div>
      <div class="row"><span>Date / Time</span><strong>${escapeHtml((t.date || "") + " " + (t.time || ""))}</strong></div>
      <div class="row"><span>Driver Name</span><strong>${escapeHtml(t.driverName || "—")}</strong></div>
      <div class="row"><span>Driver ID</span><strong>${escapeHtml(t.driverId || "—")}</strong></div>
      <div class="row"><span>Vehicle Type</span><strong>${escapeHtml(t.vehicleType || "—")}</strong></div>
      <div class="row"><span>Plate Number</span><strong>${escapeHtml(t.plateNumber || "—")}</strong></div>
      <div class="row"><span>Station</span><strong>${escapeHtml(t.stationName || "—")}</strong></div>
      
      <div class="total" style="justify-content:center; margin-top:20px;">
        <span style="font-size:14pt;">${isExit ? 'EXIT AUTHORIZED' : 'ENTRY LOGGED'}</span>
      </div>
      
      <div class="row"><span>Processed By</span><strong>${escapeHtml(t.recordedBy || "System")}</strong></div>
      <div class="status">VERIFIED</div>
      
      <div class="footer">
        This is a system-generated verification log.<br>
        Gate pass is valid for the current shift only.<br>
        Printed: ${new Date().toLocaleString("en-PH")}
      </div>
    </div>`;
    
  __adminPrint(html, `Verification Log — ${t.reference}`);
};