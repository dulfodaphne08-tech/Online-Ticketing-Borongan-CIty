const LOW_BALANCE = 50;
let drivers = [];
let transactions = [];
let users = [];
let auditLogs = [];
let notifications = [];
let feeHistory = [];
let fees = { Tricycle: 5, Jeepney: 60, Multicab: 60, Bus: 100 };
let chartInstance = null;
let currentAdminUser = null;

function $(id) { return document.getElementById(id); }
function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

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

function navigateTo(page) {
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

  if (page === "terminals-map") {
    setTimeout(() => {
      if (adminMap) {
        adminMap.invalidateSize();
        if (terminalMarkers && terminalMarkers.length > 0) {
          const group = new L.featureGroup(terminalMarkers);
          adminMap.fitBounds(group.getBounds().pad(0.15));
        }
      }
    }, 120);
    setTimeout(() => { if (adminMap) adminMap.invalidateSize(); }, 350);
  } else if (page === "dashboard") {
    setTimeout(() => { if (dashboardMiniMap) dashboardMiniMap.invalidateSize(); }, 120);
  }
}
window.navigateTo = navigateTo;

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
      loadAllDataFromDB().then(() => refreshCurrentPage(page));
    });
  });
}

function refreshCurrentPage(page) {
  switch (page) {
    case "dashboard":            updateDashboard(); break;
    case "users":                renderUsers(); break;
    case "drivers":              renderDrivers(); break;
    case "vehicles":             renderVehicles(); break;
    case "wallet":               renderWalletPage(); break;
    case "transactions":         renderTransactions(); break;
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
  }
}

async function loadAllDataFromDB() {
  syncIndicator("warning");
  try {
    const [d, p, f, u] = await Promise.all([
      window.api("drivers.php"),
      window.api("payments.php", { query: { action: "list", type: "ALL", limit: 1000 } }),
      window.api("fees.php"),
      window.api("users.php"),
    ]);
    if (d && d.success) drivers = d.data.drivers || [];
    if (p && p.success) transactions = (p.data.transactions || []).map(normalizeTransaction).reverse();
    if (f && f.success) fees = f.data.fees || fees;
    if (u && u.success) users = u.data.users || [];
    syncIndicator("ok");
    if (typeof loadNotifications === "function") loadNotifications();
  } catch (err) {
    console.error("Data load failed:", err);
    syncIndicator("error");
  }
}

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
  const status = String(t.status || "SUCCESSFUL");
  return {
    ...t,
    id: t.referenceNumber || t.id,
    vehicleType: t.vehicleType || "Not recorded",
    plateNumber: t.plateNumber || "Not recorded",
    driverId: t.driverId || "",
    driverName: t.driverName || "Unknown driver",
    amount: Number(t.amount || 0),
    type: (t.type || "FEE").toUpperCase(),
    status: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
    balance: t.balanceAfter != null ? Number(t.balanceAfter) : null,
    recordedBy: t.processedBy || "System",
    reference: t.referenceNumber || t.id || "",
    orNumber: t.orNumber || null,
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
    const res = await window.api("notifications.php", { query: { limit: 30 } });
    if (res && res.success && res.data && Array.isArray(res.data.notifications)) {
      loaded = res.data.notifications.map(normalizeNotification);
    }
  } catch (err) {}
  notifications = (loaded && loaded.length) ? loaded : buildDerivedNotifications();
  renderNotificationPanel();
  updateNotificationBadge();
  if (typeof renderNotificationsPage === "function") renderNotificationsPage();
}
window.loadNotifications = loadNotifications;

function normalizeNotification(n) {
  return {
    id: String(n.id ?? Math.random().toString(36).slice(2)),
    type: n.type || "info",
    title: n.title || "Notification",
    message: n.message || "",
    time: n.time || n.createdAt || n.created_at || new Date().toISOString(),
    unread: n.unread === true || n.read === false,
  };
}

function buildDerivedNotifications() {
  const list = [];
  const nowIso = new Date().toISOString();
  const lowBal = drivers.filter(d => Number(d.balance || 0) < LOW_BALANCE);
  if (lowBal.length) {
    list.push({ id: "lowbal", type: "warning", title: "Low balance drivers",
      message: `${lowBal.length} driver(s) below ₱${LOW_BALANCE}.`, time: nowIso, unread: true });
  }
  const pendingDrivers = drivers.filter(d => String(d.approvalStatus || "").toLowerCase() === "pending");
  if (pendingDrivers.length) {
    list.push({ id: "pending-drivers", type: "info", title: "Pending driver approvals",
      message: `${pendingDrivers.length} registration(s) awaiting review.`, time: nowIso, unread: true });
  }
  const recent = transactions.slice(-3).reverse();
  recent.forEach(t => {
    list.push({
      id: "tx-" + (t.reference || t.id), type: "success",
      title: (t.type === "LOAD" ? "Wallet load" : "Fee payment"),
      message: `${t.driverName || "Driver"} — ₱${Number(t.amount || 0).toFixed(2)}`,
      time: t.date ? (t.date + "T" + (t.time || "00:00:00")) : nowIso,
      unread: false,
    });
  });
  return list;
}

function renderNotificationPanel() {
  const listEl = $("notificationList");
  if (!listEl) return;
  if (!notifications.length) {
    listEl.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
    return;
  }
  const iconFor = (type) => {
    if (type === "success") return "fa-check-circle";
    if (type === "warning") return "fa-triangle-exclamation";
    if (type === "error")   return "fa-circle-exclamation";
    return "fa-bell";
  };
  listEl.innerHTML = notifications.map(n => {
    const unreadCls = n.unread ? " is-unread" : "";
    const when = n.time ? new Date(n.time).toLocaleString("en-PH", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }) : "";
    return '<button type="button" class="notification-item' + unreadCls + '" data-id="' + escapeHtml(n.id) + '">' +
      '<span class="notification-item__icon"><i class="fas ' + iconFor(n.type) + '"></i></span>' +
      '<span>' +
        '<span class="notification-item__title">' + escapeHtml(n.title) + '</span>' +
        '<span class="notification-item__message">' + escapeHtml(n.message) + '</span>' +
        '<span class="notification-item__time">' + escapeHtml(when) + '</span>' +
      '</span>' +
    '</button>';
  }).join("");

  listEl.querySelectorAll(".notification-item").forEach(item => {
    item.addEventListener("click", () => {
      item.classList.remove("is-unread");
      const id = item.dataset.id;
      const n = notifications.find(x => String(x.id) === String(id));
      if (n) n.unread = false;
      updateNotificationBadge();
      if (id === "lowbal" && typeof openLowBalanceModal === "function") openLowBalanceModal();
      else if (id === "pending-drivers") navigateTo("drivers");
      else if (String(id).indexOf("tx-") === 0) navigateTo("transactions");
    });
  });
}
window.renderNotificationPanel = renderNotificationPanel;

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
    container.innerHTML = '<div class="empty-state"><i class="fas fa-bell"></i><p>No notifications yet.</p></div>';
    return;
  }
  container.innerHTML = notifications.map(n => {
    const iconCls = n.type === "warning" ? "text-yellow"
                  : n.type === "error"   ? "text-red"
                  : n.type === "success" ? "text-green"
                  : "text-primary";
    const when = n.time ? new Date(n.time).toLocaleString("en-PH", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }) : "";
    return '<div class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">' +
      '<div class="' + iconCls + '"><i class="fas fa-bell"></i></div>' +
      '<div class="flex-1">' +
        '<div class="font-medium text-sm">' + escapeHtml(n.title) + '</div>' +
        '<div class="text-xs text-gray-500">' + escapeHtml(n.message) + '</div>' +
        '<div class="text-xs text-gray-400 mt-0.5">' + escapeHtml(when) + '</div>' +
      '</div>' +
    '</div>';
  }).join("");
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
}

async function updateDashboard() {
  try {
    const res = await window.api("admin_stats.php");
    if (res.success) {
      const s = res.data.stats;
      setText("statActiveToday", s.activeToday);
      setText("statDrivers", s.totalDrivers);
      setText("statActiveDrivers", s.activeDrivers);
      setText("statInactiveDrivers", s.inactiveDrivers);
      setText("statPendingDrivers", s.pendingDrivers);
      setText("statVehicles", s.totalVehicles);
      setText("statActiveVehicles", s.activeVehicles);
      setText("statTodayFees", "₱" + Number(s.todayFees).toLocaleString());
      setText("todayFeesTransCount", s.todayFeesCount);
      setText("statMonthlyFees", "₱" + Number(s.monthFees).toLocaleString());
      setText("monthlyFeesTransCount", s.monthFeesCount);
      setText("statTodayLoads", "₱" + Number(s.todayLoads).toLocaleString());
      setText("todayLoadsCount", s.todayLoadsCount);
      setText("statLowBalance", s.lowBalance);
      setText("statQR", s.qrActive);
      setText("statActiveCashiers", s.activeCashiers);
      setText("statActiveStaff", s.activeStaff);
      setText("statActiveStations", s.activeStations || 0);
      setText("statTotalStations", s.totalStations || 0);
    }
  } catch (e) {}

  setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));

  const rb = $("recentTable");
  if (rb) {
    const recent = transactions.slice(-5).reverse();
    if (!recent.length) {
      rb.innerHTML = '<tr><td colspan="6"><div class="empty-state py-3"><i class="fas fa-inbox"></i><p class="text-sm">No transactions</p></div></td></tr>';
    } else {
      rb.innerHTML = recent.map(t => '<tr>' +
        '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
        '<td class="py-2">' + escapeHtml(t.vehicleType) + '</td>' +
        '<td class="py-2">' + typeBadge(t.type) + '</td>' +
        '<td class="py-2 font-bold text-primary">₱' + t.amount.toFixed(2) + '</td>' +
        '<td class="py-2">' + statusBadge(t.status) + '</td>' +
        '<td class="py-2 text-sm text-gray-500">' + escapeHtml(t.time || "") + '</td>' +
        '</tr>').join("");
    }
  }
  updateChartData();
}

function initChart() {
  const ctx = $("collectionChart");
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [{
        label: "Fee (₱)", data: [],
        backgroundColor: "rgba(107,21,32,0.7)",
        borderColor: "#6B1520", borderWidth: 2, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => "₱" + v } },
        x: { grid: { display: false } },
      },
    },
  });
  updateChartData();
}

function updateChartData() {
  if (!chartInstance) return;
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toLocaleDateString("en-CA");
    const total = transactions.filter(t => t.date === ds && t.type === "FEE")
      .reduce((s, t) => s + t.amount, 0);
    labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    data.push(total);
  }
  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = data;
  chartInstance.update();
}

function updateChart(type) {
  if (chartInstance) {
    chartInstance.config.type = type;
    chartInstance.update();
    showToast("Chart: " + type, "success");
  }
}
window.updateChart = updateChart;

function renderUsers() {
  const tb = $("userTable");
  if (!tb) return;
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
  } catch (e) {}
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

    if (info && info.code) {
      cell.innerHTML =
        '<span class="font-mono font-bold">' + escapeHtml(info.code) + '</span>' +
        '<div class="text-[11px] text-gray-500">' + escapeHtml(info.name) + '</div>';
    } else {
      const roleText = (tds[3]?.textContent || '').trim().toLowerCase();
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

  try {
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

    if (typeof __populateStationDropdown === "function") {
      __populateStationDropdown(existingStationId);
    }
    if (typeof onUserRoleChange === "function") {
      await onUserRoleChange();
    }
    const sel = $("uStationId");
    if (sel && existingStationId) sel.value = existingStationId;
  } catch (e) {
    console.warn("Station preload failed:", e);
  }

  openModal("userModal");
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
      await loadAllDataFromDB();
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
        await loadAllDataFromDB();
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
      __adminStations = res.data.terminals        .filter(t => /^active$/i.test(t.status || 'Active'))
        .map(t => ({ id: String(t.id), code: String(t.code), name: String(t.name) }));
    }
  } catch (e) { console.warn('Could not load stations:', e); }
  return __adminStations;
}

function __populateStationDropdown(selectedId = '') {
  const sel = document.getElementById('uStationId');
  if (!sel) return;
  const current = selectedId || sel.value || '';
  sel.innerHTML = '<option value="">— Select station —</option>' +
    __adminStations.map(s =>
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
    label.textContent = 'Assign Cashier Booth / Office (Optional)';
    required.style.display = 'none';
    sel.required = false;
    hint.textContent = 'Optional. Set this if the cashier works at a specific booth; leave blank for a central cashier office.';
    adminNote.style.display = 'none';
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
    if (role === 'staff' && !stationId) {
      showToast('Please select a station for this staff member.', 'error');
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

        await loadAllDataFromDB();
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
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state py-4"><i class="fas fa-user-slash"></i><h3>No drivers</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = filtered.map(d => {
    const bal = Number(d.balance || 0);
    const balCls = bal < LOW_BALANCE ? "balance-low" : "balance-amount";
    const approval = String(d.approvalStatus || 'Active');
    const isPending = approval.toLowerCase() === 'pending';
    return '<tr>' +
      '<td class="py-2"><div class="profile-photo">' +
        (d.photo ? '<img src="' + d.photo + '" alt="">' : '<span>' + escapeHtml((d.fullName || '?').charAt(0).toUpperCase()) + '</span>') +
      '</div></td>' +
      '<td class="py-2 font-mono text-xs">' + escapeHtml(d.driverId) + '</td>' +
      '<td class="py-2 font-medium">' + escapeHtml(d.fullName) + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml((d.vehicleType || "N/A") + " - " + (d.plateNumber || "N/A")) + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(d.contact || "N/A") + '</td>' +
      '<td class="py-2 text-sm">' + escapeHtml(d.licenseNo || "N/A") + '</td>' +
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
      await loadAllDataFromDB();
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
      await loadAllDataFromDB(); renderDrivers();
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
      await loadAllDataFromDB(); renderDrivers();
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
        await loadAllDataFromDB(); renderDrivers(); renderVehicles();
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
      await loadAllDataFromDB(); renderDrivers();
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
  await loadAllDataFromDB(); renderVehicles();
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
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state py-4"><i class="fas fa-wallet"></i><h3>No load transactions</h3></div></td></tr>';
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

function renderTransactions() {
  const search = ($("transSearch")?.value || "").toLowerCase();
  const dateF = $("transDate")?.value || "";
  const typeF = $("transType")?.value || "";
  let data = transactions;
  if (search) data = data.filter(t =>
    (t.driverName || "").toLowerCase().includes(search) ||
    (t.reference || "").toLowerCase().includes(search));
  if (dateF) data = data.filter(t => t.date === dateF);
  if (typeF) data = data.filter(t => t.type === typeF);
  window.__currentTransactionList = data;
  const tb = $("transTable");
  if (!tb) return;
  if (!data.length) {
    tb.innerHTML = '<tr><td colspan="9"><div class="empty-state py-4"><i class="fas fa-receipt"></i><h3>No transactions</h3></div></td></tr>';
    return;
  }
  tb.innerHTML = data.slice().reverse().slice(0, 500).map(t => '<tr>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.date) + '</td>' +
    '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.vehicleType) + '</td>' +
    '<td class="py-2">' + typeBadge(t.type) + '</td>' +
    '<td class="py-2 font-bold ' + (t.type === "LOAD" ? "text-green" : "text-primary") + '">' + (t.type === "LOAD" ? "+" : "-") + '₱' + t.amount.toFixed(2) + '</td>' +
    '<td class="py-2 text-sm">' + (t.balance != null ? "₱" + t.balance.toFixed(2) : "—") + '</td>' +
    '<td class="py-2 text-sm">' + escapeHtml(t.recordedBy || "System") + '</td>' +
    '<td class="py-2">' + statusBadge(t.status) + '</td>' +
    '<td class="py-2">' +
      (t.type === "LOAD" ?
        '<button type="button" class="btn-primary btn-sm" onclick="printLoadRecord(\'' + escapeHtml(String(t.reference || t.id)) + '\')" title="Print record"><i class="fas fa-print"></i></button>' :
        '<button type="button" class="btn-primary btn-sm" onclick="printReceiptById(\'' + escapeHtml(String(t.id)) + '\')" title="Print receipt"><i class="fas fa-print"></i></button>') +
    '</td>' +
    '</tr>').join("");
}
window.renderTransactions = renderTransactions;

window.exportTransactionsExcel = function () {
  if (!transactions.length) { showToast("Nothing to export", "warning"); return; }
  const cell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  let csv = "Date,Reference,Type,Driver,Vehicle,Amount,Balance,Processed By,Status\r\n";
  transactions.forEach(t => {
    csv += [t.date, t.reference, t.type, t.driverName, t.vehicleType, t.amount.toFixed(2), (t.balance || 0).toFixed(2), t.recordedBy, t.status].map(cell).join(",") + "\r\n";
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
  const container = $("rptTransData");
  if (!container) return;
  let data = transactions;
  if (from) data = data.filter(t => t.date >= from);
  if (to) data = data.filter(t => t.date <= to);
  if (type) data = data.filter(t => t.type === type);
  if (!data.length) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No transactions in this range.</p>';
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

window.generateReport = function (type) {
  window.currentSummaryType = type;
  const container = $("reportData");
  if (!container) return;
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA");
  const monthStr = todayStr.slice(0, 7);
  const yearStr = todayStr.slice(0, 4);
  let filtered = [], label = "";
  if (type === "daily") {
    filtered = transactions.filter(t => t.date === todayStr && t.type === "FEE");
    label = "Daily · " + todayStr;
  } else if (type === "weekly") {
    const s = new Date(now); s.setDate(now.getDate() - now.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    const ss = s.toLocaleDateString("en-CA"), ee = e.toLocaleDateString("en-CA");
    filtered = transactions.filter(t => t.type === "FEE" && t.date >= ss && t.date <= ee);
    label = "Weekly · " + ss + " to " + ee;
  } else if (type === "monthly") {
    filtered = transactions.filter(t => t.type === "FEE" && (t.date || "").startsWith(monthStr));
    label = "Monthly · " + now.toLocaleString("default", { month: "long", year: "numeric" });
  } else if (type === "yearly") {
    filtered = transactions.filter(t => t.type === "FEE" && (t.date || "").startsWith(yearStr));
    label = "Yearly · " + yearStr;
  }
  if (!filtered.length) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">No fee collections for this period</p>';
    showToast("No data", "warning");
    return;
  }
  const total = filtered.reduce((s, t) => s + t.amount, 0);
  container.innerHTML = '<div class="flex justify-between items-center mb-3">' +
    '<span class="font-semibold">' + label + '</span>' +
    '<button type="button" class="btn-outline btn-sm" onclick="printSummaryReport(\'' + type + '\')">' +
      '<i class="fas fa-print"></i> Print</button></div>' +
    '<p class="text-sm mb-3">' + filtered.length + ' transactions · Total ₱' + total.toFixed(2) + '</p>' +
    '<table class="w-full text-sm"><thead><tr class="border-b">' +
    '<th class="py-2 text-left">Reference</th><th class="py-2 text-left">Driver</th>' +
    '<th class="py-2 text-left">Amount</th><th class="py-2 text-left">Date</th></tr></thead><tbody>' +
    filtered.slice().reverse().map(t => '<tr>' +
      '<td class="py-2">' + escapeHtml(t.reference) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.driverName) + '</td>' +
      '<td class="py-2">₱' + t.amount.toFixed(2) + '</td>' +
      '<td class="py-2">' + escapeHtml(t.date) + '</td>' +
    '</tr>').join("") + '</tbody></table>';
  showToast("Report generated", "success");
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
  const next = {
    Tricycle: parseFloat($("feeTricycle").value) || 5,
    Jeepney: parseFloat($("feeJeepney").value) || 60,
    Multicab: parseFloat($("feeMulticab").value) || 60,
    Bus: parseFloat($("feeBus").value) || 100,
  };
  const res = await window.api("fees.php", { method: "POST", body: next });
  if (res.success) {
    fees = res.data.fees || next;
    showToast("Fee rates saved", "success");
    if (typeof loadFeeHistory === "function") loadFeeHistory();
  } else showToast(res.message || "Save failed", "error");
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
  const found = drivers.filter(d =>
    (d.fullName || "").toLowerCase().includes(q.toLowerCase()) ||
    (d.driverId || "").toLowerCase().includes(q.toLowerCase()) ||
    (d.plateNumber || "").toLowerCase().includes(q.toLowerCase()));
  if (found.length) {
    navigateTo("drivers");
    if ($("driverSearch")) $("driverSearch").value = q;
    renderDrivers();
    showToast("Found " + found.length + " driver(s)", "success");
  } else showToast("No results found", "warning");
};

window.logout = function () {
  if (window.ConfirmModal) {
    window.ConfirmModal.show({
      title: "Logout?", message: "Log out of the admin panel?",
      confirmText: "Yes, logout",
      onConfirm: () => window.logoutAndRedirect(),
    });
  } else if (confirm("Log out?")) {
    window.logoutAndRedirect();
  }
};

window.updateAdmin = async function () {
  const p = $("adminPassword")?.value || "";
  const c = $("adminConfirmPassword")?.value || "";
  if (p && p !== c) { showToast("Passwords do not match", "error"); return; }
  const currentPassword = $("adminCurrentPassword")?.value || "";
  if (p && !currentPassword) {
    showToast("Enter your current password to change it", "error");
    return;
  }
  const res = await window.api("users.php", {
    method: "PATCH", query: { me: 1 },
    body: {
      fullName: $("adminName").value.trim(),
      email: $("adminEmail").value.trim(),
      currentPassword, newPassword: p,
    },
  });
  if (!res.success) { showToast(res.message || "Profile could not be updated", "error"); return; }
  if (window.CURRENT_USER && res.data && res.data.user) {
    window.CURRENT_USER.fullName = res.data.user.fullName;
  }
  if (res.data && res.data.user) setText("adminGreetingName", res.data.user.fullName || res.data.user.username);
  $("adminCurrentPassword").value = "";
  $("adminPassword").value = "";
  $("adminConfirmPassword").value = "";
  showToast("Profile updated", "success");
};

window.changeOwnPassword = async function () {
  const current = $("cpCurrent")?.value || "";
  const next    = $("cpNew")?.value || "";
  const confirm = $("cpConfirm")?.value || "";
  if (!current || !next || !confirm) { showToast("Fill in all password fields", "error"); return; }
  if (next.length < 8) { showToast("New password must be 8+ characters", "error"); return; }
  if (next !== confirm) { showToast("New passwords do not match", "error"); return; }
  const res = await window.api("users.php", {
    method: "PATCH", query: { me: 1 },
    body: {
      currentPassword: current, newPassword: next,
      fullName: window.CURRENT_USER?.fullName || $("adminName")?.value || "",
      email: window.CURRENT_USER?.email || $("adminEmail")?.value || ""
    }
  });
  if (res.success) {
    showToast("Password updated", "success");
    $("cpCurrent").value = ""; $("cpNew").value = ""; $("cpConfirm").value = "";
  } else showToast(res.message || "Password update failed", "error");
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
  $("auditSearch")?.addEventListener("input", renderAuditLogs);
  $("auditDate")?.addEventListener("change", renderAuditLogs);
  $("attendanceDate")?.addEventListener("change", loadAttendance);
  $("userSearch")?.addEventListener("input", renderUsers);
  $("userRoleFilter")?.addEventListener("change", renderUsers);
  $("refSearch")?.addEventListener("input", renderReferences);

  updateTopbarClock();
  setInterval(updateTopbarClock, 30000);

  setText("adminGreetingName", me.fullName || me.username || "Admin");
  if ($("adminName")) $("adminName").value = me.fullName || me.username;
  if ($("profileLastLogin")) $("profileLastLogin").textContent = new Date().toLocaleString("en-PH");

  await loadAllDataFromDB();
  await __loadUserStationMap();

  const profile = await window.api("users.php", { query: { me: 1 } });
  if (profile.success && profile.data && profile.data.user) {
    window.CURRENT_USER = profile.data.user;
    if ($("adminName")) $("adminName").value = profile.data.user.fullName || me.fullName || me.username;
    if ($("adminEmail")) $("adminEmail").value = profile.data.user.email || "";
    setText("sidebarUser", profile.data.user.fullName || profile.data.user.username || "Admin");
    const chip = $("userNameChip"); if (chip) chip.textContent = profile.data.user.fullName || profile.data.user.username || "Admin";
    const av = $("userAvatarChip"); if (av) av.textContent = (profile.data.user.fullName || "A").charAt(0).toUpperCase();
  } else {
    showToast(profile.message || "Profile could not be loaded", "error");
  }

  initChart();
  updateDashboard();
  loadFees();
  loadTerminalsData();
});