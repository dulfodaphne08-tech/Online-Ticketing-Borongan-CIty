(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
    const escapeHtml = esc;

    const fmtDateTime = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true
        });
    };

    const fmtTime12 = (date) => {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return "—";
        let h = d.getHours();
        const m = String(d.getMinutes()).padStart(2, "0");
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12;
        if (h === 0) h = 12;
        return h + ":" + m + " " + ampm;
    };

    const localDateKey = (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");

    const shiftStart = Date.now();
    let user = null;
    let currentPage = "dashboard";
    let currentScan = null;
    let lastTransaction = null;
    let scanProcessing = false;
    let submitting = false;
    let cachedTx = [];
    let dashboardRefreshInFlight = false;
    let dashboardRefreshQueued = false;
    let LOW_BALANCE_THRESHOLD = 50;
    let DUP_WINDOW_SECONDS = 60;
    let notifPollTimer = null;
    let unreadNotifs = [];
    let assignedStation = null;
    let assignedStationMapInstance = null;
    let assignedStationMarker = null;
    let staffNotifs = [];
    let notifCurrentFilter = "all";

     let cameraScanActive = false;
    let cameraWasOnBeforeScan = false;

    function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

    function tickTopbarClock() {
        const el = $("topbarDateTime");
        if (!el) return;
        const now = new Date();
        const datePart = now.toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric", year: "numeric"
        });
        el.textContent = datePart + ", " + fmtTime12(now);
    }

    function toast(msg, type) {
        const c = $("toastContainer");
        if (!c) return;
        const icons = { success: "fa-check-circle", error: "fa-exclamation-circle", warning: "fa-triangle-exclamation" };
        const t = document.createElement("div");
        t.className = "toast " + (type || "success");
        t.innerHTML =
            '<span class="toast-icon"><i class="fas ' + (icons[type] || icons.success) + '"></i></span>' +
            '<span class="toast-msg">' + esc(msg) + '</span>' +
            '<button class="toast-close" aria-label="Close"><i class="fas fa-times"></i></button>';
        t.querySelector(".toast-close").addEventListener("click", () => t.remove());
        c.appendChild(t);
        setTimeout(() => { t.classList.add("hiding"); setTimeout(() => t.remove(), 300); }, 4000);
    }
    window.showToast = toast;

    function openModal(id) { const el = $(id); if (el) el.classList.add("active"); }
    function closeModal(id) { const el = $(id); if (el) el.classList.remove("active"); }
    window.openModal = openModal;
    window.closeModal = closeModal;

    document.querySelectorAll(".modal-overlay").forEach((m) => {
        m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); });
    });

    async function loadSystemSettings() {
        try {
            const res = await window.api("settings.php");
            if (!res || !res.success || !res.data) return;
            const s = res.data.settings || res.data || {};
            if (s.duplicate_scan_seconds) DUP_WINDOW_SECONDS = Number(s.duplicate_scan_seconds) || DUP_WINDOW_SECONDS;
            if (s.low_balance_threshold) LOW_BALANCE_THRESHOLD = Number(s.low_balance_threshold) || LOW_BALANCE_THRESHOLD;
        } catch (e) {}
    }
    window.loadSystemSettings = loadSystemSettings;

    async function identifyStation() {
        try {
            const res = await window.api("staff_station.php", { query: { action: "get-assigned" } });
            if (res && res.success && res.data && res.data.station) {
                assignedStation = res.data.station;
                window.assignedStation = assignedStation;
                renderStationBanner();
                const titleEl = $("stationTitle");
                if (titleEl) titleEl.textContent = (assignedStation.name || "Staff") + " Dashboard";
                return true;
            }
            assignedStation = null;
            renderNoStationWarning();
            return false;
        } catch (e) {
            console.warn("Station lookup failed:", e);
            assignedStation = null;
            renderNoStationWarning();
            return false;
        }
    }
    window.identifyStation = identifyStation;

    function renderStationBanner() {
        const banner = $("stationBanner");
        if (!banner) return;
        if (!assignedStation) { banner.hidden = true; return; }
        banner.hidden = false;
        setText("stationBannerCode", assignedStation.code || "—");
        setText("stationBannerName", assignedStation.name || "—");
        setText("stationBannerAddress", assignedStation.address || "Borongan City");
        setText("stationBannerType", (assignedStation.code || "").startsWith("RS") ? "Checkpoint" : "Ticketing Station");
    }

    function renderNoStationWarning() {
        const banner = $("stationBanner");
        if (banner) banner.hidden = true;
        const warn = $("noStationWarning");
        if (warn) warn.hidden = false;
        const scanInput = $("scannerInput");
        if (scanInput) {
            scanInput.disabled = true;
            scanInput.placeholder = "No station assigned — contact Admin";
        }
        const manualBtn = $("manualScanBtn");
        if (manualBtn) manualBtn.disabled = true;
        const camBtn = $("cameraToggleBtn");
        if (camBtn) camBtn.disabled = true;
    }

    async function loadAssignedStation() {
        const noStation = $("assignedNoStation");
        const content   = $("assignedStationContent");
        const mapEl     = $("assignedStationMap");

        try {
            const res = await window.api("staff_station.php", { query: { action: "get-assigned" } });

            if (!res || !res.success || !res.data || !res.data.station) {
                if (noStation) noStation.hidden = false;
                if (content)   content.hidden   = true;
                return;
            }

            const s = res.data.station;
            assignedStation = s;
            window.assignedStation = assignedStation;
            renderStationBanner();

            if (noStation) noStation.hidden = true;
            if (content)   content.hidden   = false;

            const isCheckpoint = (s.code || "").startsWith("RS");
            const typeLabel    = isCheckpoint ? "Checkpoint" : "Ticketing Station";

            setText("asCode",    s.code || "—");
            setText("asName",    s.name || "—");
            setText("asAddress", s.address || "Borongan City");
            setText("asStatusBadge", String(s.status || "Active").toUpperCase());

            setText("asTodayTxn",  s.todayTransactions || 0);
            setText("asTodayFees", peso(s.todayFees || 0));
            setText("asType",      typeLabel);
            setText("asTypeSub",   isCheckpoint ? "Receiving Station" : "Ticketing Booth");
            setText("asHours",     s.operatingHours || "—");

            setText("asCodeDetail",    s.code || "—");
            setText("asAssignedStaff", s.assignedStaff || "—");
            setText("asAssignedRole",  s.assignedRole || "—");
            setText("asRoutes",        s.routesCovered || "—");
            setText("asCoords",
                (s.latitude  ? Number(s.latitude).toFixed(6)  : "—") + ", " +
                (s.longitude ? Number(s.longitude).toFixed(6) : "—"));
            setText("asHoursDetail",   s.operatingHours || "—");
            setText("asLockCode",      s.code || "—");

            const statusDetail = $("asStatusDetail");
            if (statusDetail) {
                const cls = /^active$/i.test(s.status || "") ? "active" : "inactive";
                statusDetail.innerHTML = `<span class="status-badge ${cls}">${esc(String(s.status || "Active").toUpperCase())}</span>`;
            }

            const proc = $("asProcessingStatus");
            if (proc) {
                const ok = /^active$/i.test(s.status || "");
                proc.className = "status-badge " + (ok ? "active" : "failed");
                proc.textContent = ok ? "ENABLED" : "BLOCKED";
            }

            if (typeof L !== "undefined" && mapEl && s.latitude && s.longitude) {
                if (!assignedStationMapInstance) {
                    assignedStationMapInstance = L.map("assignedStationMap", {
                        center: [s.latitude, s.longitude],
                        zoom: 15,
                        zoomControl: true,
                        scrollWheelZoom: false
                    });
                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        maxZoom: 19,
                        attribution: "&copy; OpenStreetMap | Borongan BCTT"
                    }).addTo(assignedStationMapInstance);
                } else {
                    assignedStationMapInstance.setView([s.latitude, s.longitude], 15);
                }
                if (assignedStationMarker) {
                    assignedStationMapInstance.removeLayer(assignedStationMarker);
                }
                const pinBg = isCheckpoint ? "#059669" : "#6B1520";
                const iconHtml =
                    `<div style="width:38px;height:38px;border-radius:50%;background:${pinBg};color:#fff;` +
                    `display:flex;align-items:center;justify-content:center;` +
                    `box-shadow:0 3px 10px rgba(0,0,0,.25);border:2px solid #fff;">` +
                    `<i class="fas ${isCheckpoint ? "fa-clipboard-check" : "fa-ticket"}" style="font-size:13px;"></i>` +
                    `</div>`;
                const icon = L.divIcon({
                    html: iconHtml, className: "assigned-station-pin",
                    iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -22]
                });
                assignedStationMarker = L.marker([s.latitude, s.longitude], { icon })
                    .addTo(assignedStationMapInstance)
                    .bindPopup(
                        `<div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:200px;">` +
                        `<span style="font-size:10px;font-weight:800;color:${pinBg};background:#f8fafc;padding:2px 6px;border-radius:4px;">${esc(s.code)} · ${typeLabel}</span>` +
                        `<h4 style="font-size:13px;font-weight:700;margin:4px 0;color:#0f172a;">${esc(s.name)}</h4>` +
                        `<p style="font-size:11.5px;color:#64748b;margin:0;">${esc(s.address || "Borongan City")}</p>` +
                        `</div>`)
                    .openPopup();
                setTimeout(() => { assignedStationMapInstance.invalidateSize(); }, 200);
            }
        } catch (e) {
            console.warn("loadAssignedStation:", e);
            if (noStation) noStation.hidden = false;
            if (content)   content.hidden   = true;
        }
    }
    window.loadAssignedStation = loadAssignedStation;

    async function refreshAssignedStation() {
        const btn = document.querySelector('#page-assigned-station .btn-outline');
        const orig = btn ? btn.innerHTML : "";
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…'; }
        await loadAssignedStation();
        if (assignedStationMapInstance) {
            setTimeout(() => assignedStationMapInstance.invalidateSize(), 100);
        }
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
        toast("Station refreshed.", "success");
    }
    window.refreshAssignedStation = refreshAssignedStation;

    function focusAssignedStationOnMap() {
        if (!assignedStation || !assignedStationMapInstance) return;
        assignedStationMapInstance.flyTo(
            [assignedStation.latitude, assignedStation.longitude],
            17, { duration: 1.2 }
        );
        if (assignedStationMarker) {
            setTimeout(() => assignedStationMarker.openPopup(), 400);
        }
    }
    window.focusAssignedStationOnMap = focusAssignedStationOnMap;

    function startNotifPolling() {
        stopNotifPolling();
        refreshStaffNotifications(false);
        notifPollTimer = setInterval(() => refreshStaffNotifications(false), 20000);
    }
    window.startNotifPolling = startNotifPolling;

    function stopNotifPolling() {
        if (notifPollTimer) clearInterval(notifPollTimer);
        notifPollTimer = null;
    }
    window.stopNotifPolling = stopNotifPolling;

    async function refreshStaffNotifications(showToastFlag) {
        try {
            const res = await window.api("notifications.php", { query: { action: "list" } });
            if (!res || !res.success || !res.data) {
                renderNotifError((res && res.message) ? res.message : "Could not load notifications.");
                return;
            }
            staffNotifs = Array.isArray(res.data.notifications) ? res.data.notifications : [];
            renderNotifications();
            renderFullNotifications();
            updateNotifBadges();
            if (showToastFlag) toast("Notifications refreshed.", "success");
        } catch (err) {
            console.warn("Notification fetch failed:", err);
            renderNotifError("Network error while loading notifications.");
        }
    }
    window.refreshStaffNotifications = refreshStaffNotifications;

    function renderNotifError(msg) {
        const list = $("notifList");
        if (list) list.innerHTML =
            '<div class="notif-empty"><i class="fas fa-triangle-exclamation" style="color:var(--red);"></i><div>' +
            esc(msg) + '</div></div>';
    }

    function notifIcon(type) {
        return {
            transaction:      { icon: 'fa-check-circle',         cls: 'success' },
            insufficient:     { icon: 'fa-triangle-exclamation', cls: 'warning' },
            qr_invalid:       { icon: 'fa-qrcode',               cls: 'error' },
            low_balance:      { icon: 'fa-wallet',               cls: 'warning' },
            station_update:   { icon: 'fa-map-location-dot',     cls: 'info' },
            station_inactive: { icon: 'fa-circle-xmark',         cls: 'error' },
            announcement:     { icon: 'fa-bullhorn',             cls: 'info' }
        }[type] || { icon: 'fa-bell', cls: 'info' };
    }

    function fmtNotifTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return diffMin + ' min' + (diffMin === 1 ? '' : 's') + ' ago';
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return diffHr + ' hr' + (diffHr === 1 ? '' : 's') + ' ago';
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function updateNotifBadges() {
        const unreadCount = staffNotifs.filter((n) => !n.read).length;
        const badge = $("notifBadge");
        const sidebarBadge = $("notifBadgeSidebar");
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
                badge.hidden = false;
            } else {
                badge.hidden = true;
            }
        }
        if (sidebarBadge) {
            if (unreadCount > 0) {
                sidebarBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
                sidebarBadge.hidden = false;
            } else {
                sidebarBadge.hidden = true;
            }
        }
    }

    function renderNotifications() {
        const list = $("notifList");
        if (!list) return;

        if (!staffNotifs.length) {
            list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
            return;
        }

        const recent = staffNotifs.slice(0, 8);
        list.innerHTML = recent.map((n) => {
            const ic = notifIcon(n.type);
            return `
                <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}">
                    <div class="notif-icon notif-${ic.cls}"><i class="fas ${ic.icon}"></i></div>
                    <div class="notif-content">
                        <p class="notif-title">${esc(n.title)}</p>
                        <p class="notif-msg">${esc(n.message)}</p>
                        <small class="notif-time">${esc(fmtNotifTime(n.createdAt))}</small>
                    </div>
                </div>`;
        }).join("");
    }
    window.renderNotifications = renderNotifications;

    function renderFullNotifications() {
        const list = $("notificationsFullList");
        if (!list) return;

        let rows = staffNotifs.slice();
        if (notifCurrentFilter === 'unread') {
            rows = rows.filter((n) => !n.read);
        } else if (notifCurrentFilter === 'transaction') {
            rows = rows.filter((n) => ['transaction', 'insufficient', 'low_balance', 'qr_invalid'].includes(n.type));
        } else if (notifCurrentFilter === 'station') {
            rows = rows.filter((n) => ['station_update', 'station_inactive', 'announcement'].includes(n.type));
        }

        if (!rows.length) {
            list.innerHTML = '<div class="empty-inline">No notifications to display.</div>';
            return;
        }

        list.innerHTML = rows.map((n) => {
            const ic = notifIcon(n.type);
            return `
                <div class="notif-full-item ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}">
                    <div class="notif-icon notif-${ic.cls}"><i class="fas ${ic.icon}"></i></div>
                    <div class="notif-full-body">
                        <div class="notif-full-title">
                            ${esc(n.title)}
                            ${n.read ? '' : '<span class="notif-unread-pill">UNREAD</span>'}
                        </div>
                        <div class="notif-full-msg">${esc(n.message)}</div>
                        <div class="notif-full-meta">
                            <span><i class="far fa-clock"></i> ${esc(fmtNotifTime(n.createdAt))}</span>
                            ${n.stationCode ? `<span><i class="fas fa-map-marker-alt"></i> ${esc(n.stationCode)}</span>` : ''}
                            ${n.referenceId ? `<span><i class="fas fa-hashtag"></i> ${esc(n.referenceId)}</span>` : ''}
                        </div>
                    </div>
                </div>`;
        }).join("");

        list.querySelectorAll(".notif-full-item").forEach((el) => {
            el.addEventListener("click", () => markStaffNotificationRead(el.dataset.id));
        });
    }
    window.renderFullNotifications = renderFullNotifications;

    async function markStaffNotificationRead(id) {
        const n = staffNotifs.find((x) => String(x.id) === String(id));
        if (!n || n.read) return;
        n.read = true;
        renderNotifications();
        renderFullNotifications();
        updateNotifBadges();
        try {
            await window.api("notifications.php", {
                method: "PATCH",
                query: { action: "read" },
                body: { id }
            });
        } catch (e) { console.warn("Mark read failed:", e); }
    }
    window.markStaffNotificationRead = markStaffNotificationRead;

    async function markAllStaffNotificationsRead() {
        if (!staffNotifs.some((n) => !n.read)) {
            toast("No unread notifications.", "warning");
            return;
        }
        staffNotifs.forEach((n) => { n.read = true; });
        renderNotifications();
        renderFullNotifications();
        updateNotifBadges();
        try {
            await window.api("notifications.php", {
                method: "PATCH",
                query: { action: "read" },
                body: { markAll: true }
            });
            toast("All notifications marked as read.", "success");
        } catch (e) {
            toast("Could not update — will retry.", "error");
            refreshStaffNotifications(false);
        }
    }
    window.markAllStaffNotificationsRead = markAllStaffNotificationsRead;

    let staffStationsMapInstance = null;
    let staffStationMarkers = {};

    async function initStaffStationsMap(forceRefresh = false) {
        const mapEl = $("staffStationsMap");
        if (!mapEl || typeof L === "undefined") return;

        if (!staffStationsMapInstance) {
            staffStationsMapInstance = L.map("staffStationsMap", {
                center: [11.6080, 125.4316], zoom: 11, zoomControl: true, scrollWheelZoom: true
            });
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap | Borongan BCTT"
            }).addTo(staffStationsMapInstance);
        }

        try {
            const res = await window.api("terminals.php");
            const list = (res && res.success && res.data && res.data.terminals) ? res.data.terminals : [];
            if (!list.length) return;

            Object.values(staffStationMarkers).forEach((m) => staffStationsMapInstance.removeLayer(m));
            staffStationMarkers = {};

            const markersGroup = [];
            const gridEl = $("staffStationsList");
            let html = "";

            list.forEach((t) => {
                const isReceiving = (t.code || "").startsWith("RS");
                const pinBg = isReceiving ? "#059669" : "#6B1520";
                const typeLabel = isReceiving ? "Checkpoint" : "Ticketing Station";
                const codeClass = isReceiving ? "green" : "maroon";

                const iconHtml =
                    `<div style="width:36px;height:36px;border-radius:50%;background:${pinBg};color:#fff;` +
                    `display:flex;align-items:center;justify-content:center;` +
                    `box-shadow:0 3px 10px rgba(0,0,0,0.25);border:2px solid #fff;">` +
                    `<i class="fas ${isReceiving ? "fa-clipboard-check" : "fa-ticket"}" style="font-size:13px;"></i>` +
                    `</div>`;
                const icon = L.divIcon({
                    html: iconHtml, className: "staff-map-pin",
                    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20]
                });
                const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(staffStationsMapInstance);
                marker.bindPopup(
                    `<div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:210px;">` +
                    `<span style="font-size:10px;font-weight:800;color:${pinBg};background:#f8fafc;padding:2px 6px;border-radius:4px;">${esc(t.code)} · ${typeLabel}</span>` +
                    `<h4 style="font-size:13px;font-weight:700;margin:4px 0 4px 0;color:#0f172a;">${esc(t.name)}</h4>` +
                    `<p style="font-size:11.5px;color:#64748b;margin:0 0 6px 0;">${esc(t.address || "Borongan City")}</p>` +
                    `</div>`);
                staffStationMarkers[t.code] = marker;
                markersGroup.push(marker);

                const isAssigned = assignedStation && assignedStation.code === t.code;
                html += `
                    <div class="station-card" onclick="focusStaffStation('${esc(t.code)}', ${t.latitude}, ${t.longitude})" style="${isAssigned ? "border-color:var(--maroon);box-shadow:0 0 0 2px rgba(107,21,32,.15);" : ""}">
                        <div>
                            <div class="station-card-head">
                                <span class="station-code ${codeClass}">${esc(t.code)}</span>
                                <span class="station-type">${typeLabel}${isAssigned ? " · YOUR STATION" : ""}</span>
                            </div>
                            <div class="station-name">${esc(t.name)}</div>
                            <div class="station-address">
                                <i class="fas fa-location-dot"></i>
                                <span>${esc(t.address || "Borongan City")}</span>
                            </div>
                        </div>
                        <div class="station-foot">
                            <span><i class="fas fa-location-crosshairs"></i> Locate Station</span>
                            <i class="fas fa-arrow-right"></i>
                        </div>
                    </div>
                `;
            });

            if (gridEl) gridEl.innerHTML = html;

            if (markersGroup.length > 0) {
                const group = new L.featureGroup(markersGroup);
                staffStationsMapInstance.fitBounds(group.getBounds().pad(0.12));
            }
            if (forceRefresh) toast("Stations & checkpoints updated", "success");
        } catch (e) {
            console.warn("Could not load stations in staff:", e);
        }
    }
    window.initStaffStationsMap = initStaffStationsMap;

    function focusStaffStation(code, lat, lng) {
        if (staffStationsMapInstance && lat && lng) {
            staffStationsMapInstance.flyTo([lat, lng], 16, { duration: 1.2 });
            if (staffStationMarkers[code]) {
                setTimeout(() => staffStationMarkers[code].openPopup(), 400);
            }
        }
    }
    window.focusStaffStation = focusStaffStation;

    const PAGE_LABELS = {
        dashboard: "Dashboard",
        "assigned-station": "My Assigned Station",
        scan: "Scan Driver QR",
        today: "Today's Transactions",
        history: "Transaction History",
        drivers: "Driver Records",
        vehicles: "Vehicle Records",
        summary: "Daily Summary",
        attendance: "My Attendance",
        profile: "My Profile",
        "stations-map": "Stations & Checkpoints",
        notifications: "Notifications"
    };

    function navigateTo(page) {
        if (!page) return;
        currentPage = page;
        document.querySelectorAll(".page-section").forEach((s) =>
            s.classList.toggle("active", s.id === "page-" + page)
        );
        document.querySelectorAll(".sidebar-item").forEach((i) =>
            i.classList.toggle("active", i.dataset.page === page)
        );
        const sb = $("sidebar");
        if (sb) sb.classList.remove("open");
        window.scrollTo({ top: 0, behavior: "smooth" });
        setText("topbarCurrentPage", PAGE_LABELS[page] || "Dashboard");

        try {
            sessionStorage.setItem("staff_active_page", page);
            if ((location.hash || "").replace("#", "") !== page) {
                history.replaceState(null, "", "#" + page);
            }
        } catch (e) {}

         if (page !== "scan" && (cameraScanActive || (window.QrScanner && window.QrScanner.isCameraOn()))) {
            stopCameraScan(true);
        }

        if (page === "dashboard") refreshDashboard();
        if (page === "assigned-station") {
            loadAssignedStation();
            setTimeout(() => {
                if (assignedStationMapInstance) assignedStationMapInstance.invalidateSize();
            }, 200);
        }
        if (page === "scan") {
            setTimeout(() => {
                const el = $("scannerInput");
                if (el && !el.disabled) el.focus();
            }, 100);
        }
        if (page === "today") loadToday();
        if (page === "history") loadHistory();
        if (page === "drivers") loadDrivers();
        if (page === "vehicles") loadVehicles();
        if (page === "summary") loadSummary();
        if (page === "attendance") loadAttendance();
        if (page === "notifications") refreshStaffNotifications(false);
        if (page === "stations-map") {
            initStaffStationsMap();
            setTimeout(() => { if (staffStationsMapInstance) staffStationsMapInstance.invalidateSize(); }, 150);
        }
    }
    window.navigateTo = navigateTo;

    window.addEventListener("hashchange", () => {
        const p = (location.hash || "").replace("#", "").trim();
        if (p && $("page-" + p)) navigateTo(p);
    });

    async function refreshDashboard() {
        if (dashboardRefreshInFlight) { dashboardRefreshQueued = true; return; }
        dashboardRefreshInFlight = true;
        try {
            const today = localDateKey(new Date());
            const res = await window.api("payments.php", {
                query: { action: "list", type: "FEE", from: today, to: today, limit: 1000 }
            });
            if (!res.success) {
                const tb = $("recentTable");
                if (tb) tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">' +
                    esc(res.message || "Could not load today's transactions.") + '</div></td></tr>';
                setText("lastUpdatedTime", "Unavailable");
                return;
            }
            cachedTx = res.data.transactions || [];
            const ok = cachedTx.filter((t) => String(t.status).toUpperCase() === "SUCCESSFUL").length;
            const fail = cachedTx.length - ok;
            const total = cachedTx.reduce((a, t) => a + Number(t.amount || 0), 0);

            setText("statTransactions", cachedTx.length);
            setText("statSuccessful", ok);
            setText("statFailed", fail);
            setText("statFees", peso(total));
            setText("quickScans", cachedTx.length);
            setText("quickFees", peso(total));
            setText("lastUpdatedTime", fmtTime12(new Date()));

            const tb = $("recentTable");
            if (tb) {
                const recent = cachedTx.slice(0, 8);
                if (!recent.length) {
                    tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No transactions today.</div></td></tr>';
                } else {
                    tb.innerHTML = recent.map((t) =>
                        "<tr>" +
                        "<td>" + esc(t.time || "") + "</td>" +
                        '<td class="ref-mono">' + esc(t.referenceNumber) + "</td>" +
                        "<td>" + esc(t.driverName || t.driverId) + "</td>" +
                        "<td>" + esc(t.vehicleType || "—") + "</td>" +
                        "<td>" + peso(t.amount) + "</td>" +
                        "<td>" + peso(t.balanceAfter) + "</td>" +
                        '<td><span class="status-badge ' +
                            (String(t.status).toUpperCase() === "SUCCESSFUL" ? "successful" : "failed") +
                            '">' + esc(t.status) + "</span></td>" +
                        "</tr>"
                    ).join("");
                }
            }
        } catch (error) {
            const tb = $("recentTable");
            if (tb) tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">' +
                esc(error.message || "Could not load today's transactions.") + "</div></td></tr>";
            setText("lastUpdatedTime", "Unavailable");
        } finally {
            dashboardRefreshInFlight = false;
            if (dashboardRefreshQueued) { dashboardRefreshQueued = false; refreshDashboard(); }
        }
    }
    window.refreshDashboard = refreshDashboard;

    async function refreshAllData() {
        const btn = $("refreshStatsBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…'; }
        await refreshDashboard();
        if (currentPage === "today") await loadToday();
        if (currentPage === "history") await loadHistory();
        if (currentPage === "summary") await loadSummary();
        if (currentPage === "assigned-station") await loadAssignedStation();
        if (currentPage === "drivers") await loadDrivers();
        if (currentPage === "vehicles") await loadVehicles();
        if (currentPage === "attendance") await loadAttendance();
        if (currentPage === "notifications") await refreshStaffNotifications(false);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Refresh'; }
        toast("Refreshed.", "success");
    }
    window.refreshAllData = refreshAllData;

    async function refreshToday() { await loadToday(); toast("Refreshed.", "success"); }
    async function refreshHistory() { await loadHistory(); toast("Refreshed.", "success"); }
    async function refreshSummary() { await loadSummary(); toast("Refreshed.", "success"); }
    async function refreshDrivers() { await loadDrivers(); toast("Refreshed.", "success"); }
    async function refreshVehicles() { await loadVehicles(); toast("Refreshed.", "success"); }
    async function refreshAttendance() { await loadAttendance(); toast("Refreshed.", "success"); }
    async function refreshStationsMap() { await initStaffStationsMap(true); }
    window.refreshToday = refreshToday;
    window.refreshHistory = refreshHistory;
    window.refreshSummary = refreshSummary;
    window.refreshDrivers = refreshDrivers;
    window.refreshVehicles = refreshVehicles;
    window.refreshAttendance = refreshAttendance;
    window.refreshStationsMap = refreshStationsMap;

    setInterval(() => {
        if (document.visibilityState === "visible" && currentPage === "dashboard") refreshDashboard();
    }, 30000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            if (currentPage === "dashboard") refreshDashboard();
            startNotifPolling();
        } else { stopNotifPolling(); }
    });
    window.addEventListener("focus", () => { if (currentPage === "dashboard") refreshDashboard(); });

    function setScanStatus(text, tone) {
        const el = $("scanStatus");
        if (!el) return;
        el.textContent = text;
        el.className = "form-hint" + (tone ? " hint-" + tone : "");
    }

     function qrLibReady() {
        return !!(window.QrScanner && typeof window.QrScanner.startCamera === "function"
                  && typeof window.Html5Qrcode === "function");
    }

    function setCameraPill(live) {
        const pill = $("cameraStatusPill");
        if (!pill) return;
        if (live) {
            pill.classList.add("live");
            pill.innerHTML = '<span class="dot"></span> Camera live';
        } else {
            pill.classList.remove("live");
            pill.innerHTML = '<i class="fas fa-camera"></i> Camera off';
        }
    }

    function resetQrDebug() {
        const dbgRaw = $("qrDebugRaw");
        if (dbgRaw) {
            dbgRaw.textContent = "—";
            dbgRaw.style.color = "#a7f3d0";
        }
    }

async function startCameraScan() {
    const wrap   = $("cameraPreviewWrap");
    const btn    = $("cameraToggleBtn");
    const label  = $("cameraToggleLabel");
    const dbgBox = $("qrDebugBox");

    if (!window.QrScanner || !window.QrScanner.libReady()) {
        toast("QR camera library not loaded. Check internet.", "error");
        setScanStatus("Camera library unavailable.", "error");
        return;
    }
    if (!assignedStation) {
        openModal("noStationModal");
        return;
    }

    if (wrap) wrap.hidden = false;
    if (dbgBox) dbgBox.hidden = false;
    resetQrDebug();

    if (btn) btn.disabled = true;
    if (label) label.textContent = "Starting…";
    setScanStatus("Requesting camera permission…");

    try {
        await window.QrScanner.startCamera("qrCameraReader", function (payload, rawText) {
            cameraWasOnBeforeScan = true;
            cameraScanActive = false;

            const lbl = $("cameraToggleLabel");
            const ic  = $("cameraToggleBtn") ? $("cameraToggleBtn").querySelector("i") : null;
            if (lbl) lbl.textContent = "Start Camera";
            if (ic)  ic.className = "fas fa-camera";
            setCameraPill(false);

            const dbgRaw = $("qrDebugRaw");
            if (dbgRaw) {
                dbgRaw.textContent = rawText || "—";
                dbgRaw.style.color = "#22c55e";
            }

            if (!payload || !payload.driverId) {
                setScanStatus("QR detected but unreadable — try again.", "error");
                openModal("unreadableModal");
                return;
            }

            setScanStatus("QR detected — verifying " + payload.driverId + "…", "ok");

            setTimeout(function () {
                handleScan(rawText);
            }, 250);
        });

        cameraScanActive = true;
        if (btn) btn.disabled = false;
        if (label) label.textContent = "Stop Camera";
        const icon = btn ? btn.querySelector("i") : null;
        if (icon) icon.className = "fas fa-camera-slash";
        setCameraPill(true);
        setScanStatus("Camera active — point at the driver's QR code.", "ok");
    } catch (e) {
        cameraScanActive = false;
        if (wrap) wrap.hidden = true;
        if (dbgBox) dbgBox.hidden = true;
        if (btn) btn.disabled = false;
        if (label) label.textContent = "Start Camera";
        const icon = btn ? btn.querySelector("i") : null;
        if (icon) icon.className = "fas fa-camera";
        setCameraPill(false);
        const msg = (e && e.message) || "Could not start camera.";
        setScanStatus(msg, "error");
        toast(msg, "error");
    }
}

async function stopCameraScan(silent) {
    try {
        if (window.QrScanner && window.QrScanner.isCameraOn()) {
            await window.QrScanner.stopCamera();
        }
    } catch (e) {  }

    cameraScanActive = false;

    const wrap   = $("cameraPreviewWrap");
    const btn    = $("cameraToggleBtn");
    const label  = $("cameraToggleLabel");
    const dbgBox = $("qrDebugBox");
    if (wrap) wrap.hidden = true;
    if (dbgBox) dbgBox.hidden = true;
    if (btn) btn.disabled = false;
    if (label) label.textContent = "Start Camera";
    const icon = btn ? btn.querySelector("i") : null;
    if (icon) icon.className = "fas fa-camera";
    setCameraPill(false);

    if (!silent) setScanStatus("Camera stopped.");
}

    async function toggleCameraScan() {
        if (cameraScanActive || (window.QrScanner && window.QrScanner.isCameraOn())) {
            await stopCameraScan();
        } else {
            await startCameraScan();
        }
    }
    window.toggleCameraScan = toggleCameraScan;
    window.stopCameraScan = stopCameraScan;
    window.startCameraScan = startCameraScan;

async function handleQrImageUpload(file) {
    if (!file) return;
    if (!window.QrScanner || !window.QrScanner.libReady()) {
        toast("QR library not loaded.", "error");
        return;
    }

    await stopCameraScan(true);

    const wrap = $("cameraPreviewWrap");
    const dbgBox = $("qrDebugBox");
    if (wrap) wrap.hidden = false;
    if (dbgBox) dbgBox.hidden = false;
    resetQrDebug();

    setScanStatus("Reading QR from image…");

    try {
        const result = await window.QrScanner.scanImageFile("qrCameraReader", file);
        if (!result || !result.payload || !result.payload.driverId) {
            openModal("unreadableModal");
            setScanStatus("No readable QR code in that image.", "error");
            if (wrap) wrap.hidden = true;
            if (dbgBox) dbgBox.hidden = true;
            return;
        }
        setScanStatus("QR detected — verifying " + result.payload.driverId + "…", "ok");
        if (wrap) wrap.hidden = true;
        if (dbgBox) dbgBox.hidden = true;
        handleScan(result.text);
    } catch (e) {
        const msg = (e && e.message) || "Could not read QR from image.";
        setScanStatus(msg, "error");
        toast(msg, "error");
        if (wrap) wrap.hidden = true;
        if (dbgBox) dbgBox.hidden = true;
    }
}
    window.handleQrImageUpload = handleQrImageUpload;

     async function handleScan(raw) {
        if (!assignedStation) {
            setScanStatus("No station assigned — cannot process.", "error");
            openModal("noStationModal");
            return;
        }
        if (scanProcessing) return;
        const text = String(raw || "").trim();
        if (!text) return;
        if (text.length < 3) {
            openModal("unreadableModal");
            setScanStatus("Unable to read QR code.", "error");
            return;
        }

        let driverId = text;
        try {
            const obj = JSON.parse(text);
            if (obj && obj.driverId) driverId = String(obj.driverId).trim();
        } catch (e) {}

        scanProcessing = true;
        setScanStatus("Checking " + driverId + "…");

        const res = await window.api("payments.php", {
            query: { action: "verify", driverId, stationId: assignedStation.code }
        });

        if (!res.success) {
            scanProcessing = false;
            setScanStatus(res.message, "error");
            openModal("invalidModal");
            return;
        }

        const driver = res.data.driver;

        if (Array.isArray(res.data.missingInfo) && res.data.missingInfo.length) {
            setText("viDriverId", driver.driverId || "—");
            setText("viIssue", "Missing: " + res.data.missingInfo.join(", "));
            openModal("verifyInfoModal");
            setScanStatus("Driver information requires verification.", "error");
            scanProcessing = false;
            return;
        }

        if (String(driver.status || "").toUpperCase() !== "ACTIVE") {
            scanProcessing = false;
            setText("inactDriver", driver.fullName || "—");
            setText("inactDriverId", driver.driverId || "—");
            openModal("inactiveModal");
            setScanStatus("Account inactive.", "error");
            return;
        }

        const fee = Number(res.data.fee || 0);
        const balance = Number(driver.balance || 0);
        const after = balance - fee;

        if (balance < fee) {
            scanProcessing = false;
            setText("inDriver", driver.fullName || "—");
            setText("inBalance", peso(balance));
            setText("inFee", peso(fee));
            setText("inShortage", peso(fee - balance));
            openModal("insufficientModal");
            setScanStatus("Insufficient balance.", "error");
            return;
        }

        currentScan = {
            driver, fee, balance, after,
            station: assignedStation,
            recentPayment: res.data.recentPayment || null,
            lowBalanceThreshold: res.data.lowBalanceThreshold || LOW_BALANCE_THRESHOLD
        };

        setText("vdName", driver.fullName || "—");
        setText("vdId", driver.driverId || "—");
        setText("vdVehicle", driver.vehicleType || "—");
        setText("vdBody", driver.bodyNumber || "—");
        setText("vdPlate", driver.plateNumber || "—");
        setText("vdStatus", driver.status || "ACTIVE");
        setText("vdBalance", peso(balance));
        setText("vdFee", peso(fee));
        setText("vdRemaining", peso(after));

        const tr = $("terminalReady"); if (tr) tr.hidden = true;
        const vs = $("verifyStep"); if (vs) vs.hidden = false;

        setScanStatus("Driver verified — review and confirm.", "ok");
        scanProcessing = false;
    }
    window.handleScan = handleScan;

    function parseScanned() {
        const el = $("scannerInput");
        if (!el || el.disabled) return;
        const text = el.value.trim();
        el.value = "";
        if (text) handleScan(text);
    }
    window.parseScanned = parseScanned;

    function resetScan() {
        currentScan = null;
        const tr = $("terminalReady"); if (tr) tr.hidden = false;
        const vs = $("verifyStep"); if (vs) vs.hidden = true;
        const dw = $("duplicateWarning"); if (dw) dw.style.display = "none";
        setScanStatus("Ready — waiting for a driver QR.");
        const el = $("scannerInput"); if (el && !el.disabled) el.focus();
    }
    window.resetScan = resetScan;

    function reviewTransaction() {
        if (!currentScan) return;
        const d = currentScan.driver;
        setText("cfDriver", d.fullName || "—");
        setText("cfDriverId", d.driverId || "—");
        setText("cfVehicle", d.vehicleType || "—");
        setText("cfBody", d.bodyNumber || "—");
        setText("cfPlate", d.plateNumber || "—");
        setText("cfPrev", peso(currentScan.balance));
        setText("cfFee", peso(currentScan.fee));
        setText("cfAfter", peso(currentScan.after));
        setText("cfStaff", user ? (user.fullName || user.username) : "Staff");
        const cfStation = $("cfStation");
        if (cfStation && assignedStation) {
            cfStation.textContent = assignedStation.code + " · " + assignedStation.name;
        }
        openModal("confirmModal");
    }
    window.reviewTransaction = reviewTransaction;

    function closeConfirmModal() { closeModal("confirmModal"); }
    window.closeConfirmModal = closeConfirmModal;

    function handleSuccessfulTransaction(receipt, lowBalanceFlag, lowThreshold) {
        lastTransaction = {
            transactionId: receipt.referenceNumber,
            driver: currentScan ? currentScan.driver : {
                fullName: receipt.driverName, driverId: receipt.driverId,
                vehicleType: receipt.vehicleType, bodyNumber: receipt.bodyNumber,
                plateNumber: receipt.plateNumber
            },
            station: currentScan ? currentScan.station : assignedStation,
            fee: receipt.amount,
            prevBalance: receipt.previousBalance,
            newBalance: receipt.balanceAfter
        };

        setText("scRef", receipt.referenceNumber);
        setText("scDriver", lastTransaction.driver.fullName || "—");
        setText("scVehicle", lastTransaction.driver.vehicleType || "—");
        setText("scFeeBig", peso(receipt.amount));
        setText("scPrev", peso(receipt.previousBalance));
        setText("scAfter", peso(receipt.balanceAfter));
        setText("scStaff", user ? (user.fullName || user.username) : "Staff");
        const scStation = $("scStation");
        if (scStation && lastTransaction.station) {
            scStation.textContent = lastTransaction.station.code + " · " + lastTransaction.station.name;
        }
        openModal("successModal");
        toast("Transaction successful — " + peso(receipt.amount) + " deducted.", "success");

        if (lowBalanceFlag) {
            setText("lbDriver", lastTransaction.driver.fullName || "—");
            setText("lbBalance", peso(receipt.balanceAfter));
            setText("lbThreshold", peso(lowThreshold || LOW_BALANCE_THRESHOLD));
            setTimeout(() => openModal("lowBalanceModal"), 400);
        }

        currentScan = null;
        const tr = $("terminalReady"); if (tr) tr.hidden = false;
        const vs = $("verifyStep"); if (vs) vs.hidden = true;
        setScanStatus("Paid — ready for the next driver.", "ok");
        refreshDashboard();
        refreshStaffNotifications(false);
    }

    async function processTransaction(confirmDuplicate) {
        if (!currentScan || submitting) return;
        submitting = true;
        const btn = $("processTransactionBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…'; }

        const body = {
            action: "collect",
            driverId: currentScan.driver.driverId,
            stationId: currentScan.station ? currentScan.station.code : (assignedStation ? assignedStation.code : "")
        };
        if (confirmDuplicate) body.confirmDuplicate = true;

        const res = await window.api("payments.php", { method: "POST", body });

        submitting = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm &amp; Process'; }

        if (res.success) {
            closeConfirmModal();
            closeModal("duplicateModal");
            const lowFlag = !!(res.data && res.data.lowBalance);
            const lowThresh = (res.data && res.data.lowBalanceThreshold) || LOW_BALANCE_THRESHOLD;
            handleSuccessfulTransaction(res.data.receipt, lowFlag, lowThresh);
            return;
        }

        if (res.code === "DUPLICATE_SCAN") {
            const d = res.data || {};
            setText("dupDriver", currentScan ? currentScan.driver.fullName || "—" : "—");
            setText("dupPrevTxn", d.reference || d.previousTransaction || "—");
            setText("dupPrevTime", d.previousTime ? fmtDateTime(d.previousTime)
                : (currentScan && currentScan.recentPayment ? fmtDateTime(currentScan.recentPayment.createdAt) : "—"));
            setText("dupPrevFee", d.previousFee ? peso(d.previousFee)
                : (currentScan && currentScan.recentPayment ? peso(currentScan.recentPayment.amount) : "—"));
            closeConfirmModal();
            openModal("duplicateModal");
            return;
        }

        if (res.code === "INSUFFICIENT_BALANCE") {
            closeConfirmModal();
            setText("inDriver", currentScan ? currentScan.driver.fullName || "—" : "—");
            setText("inBalance", peso(res.data ? res.data.balance : 0));
            setText("inFee", peso(res.data ? res.data.fee : 0));
            setText("inShortage", peso(res.data ? res.data.shortBy : 0));
            openModal("insufficientModal");
            return;
        }

        if (res.code === "STATION_NOT_AUTHORIZED") {
            closeConfirmModal();
            openModal("noStationModal");
            toast(res.message || "Station not authorized.", "error");
            return;
        }

        closeConfirmModal();
        toast(res.message || "Transaction failed.", "error");
    }

    window.cancelDuplicateScan = function () { closeModal("duplicateModal"); resetScan(); };
    window.confirmDuplicateScan = function () { processTransaction(true); };

    window.scanNextDriver = function () {
        const wasCameraOn = cameraWasOnBeforeScan || cameraScanActive
            || (window.QrScanner && window.QrScanner.isCameraOn());
        closeModal("successModal");
        closeModal("lowBalanceModal");
        resetScan();
        navigateTo("scan");
        if (wasCameraOn) {
            cameraWasOnBeforeScan = false;
            setTimeout(() => startCameraScan(), 350);
        }
    };
    window.backToDashboardFromSuccess = function () {
        closeModal("successModal");
        closeModal("lowBalanceModal");
        resetScan();
        navigateTo("dashboard");
    };
    window.closeInvalidModal = function () { closeModal("invalidModal"); resetScan(); };
    window.closeInactiveModal = function () { closeModal("inactiveModal"); resetScan(); };
    window.scanNextDriverFromInsufficient = function () {
        const wasCameraOn = cameraWasOnBeforeScan || cameraScanActive
            || (window.QrScanner && window.QrScanner.isCameraOn());
        closeModal("insufficientModal");
        resetScan();
        navigateTo("scan");
        if (wasCameraOn) {
            cameraWasOnBeforeScan = false;
            setTimeout(() => startCameraScan(), 350);
        }
    };
    window.closeNoStationModal = function () { closeModal("noStationModal"); navigateTo("dashboard"); };

    function fillReceipt() {
        if (!lastTransaction) { toast("No transaction to print.", "warning"); return false; }
        const info = lastTransaction;
        const d = info.driver || {};
        const now = new Date();
        setText("rctTxn", info.transactionId || "—");
        setText("rctDate", now.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }));
        setText("rctTime", fmtTime12(now));
        setText("rctDriver", d.fullName || "—");
        setText("rctDriverId", d.driverId || "—");
        setText("rctVehicle", d.vehicleType || "—");
        setText("rctBody", d.bodyNumber || "—");
        setText("rctPlate", d.plateNumber || "—");
        setText("rctFee", peso(info.fee));
        setText("rctAfter", peso(info.newBalance));
        setText("rctStaff", user ? (user.username || "Staff") : "Staff");
        const rctStation = $("rctStation");
        if (rctStation && info.station) {
            rctStation.textContent = info.station.code + " · " + info.station.name;
        }
        return true;
    }

    async function loadToday() {
        const today = localDateKey(new Date());
        const res = await window.api("payments.php", {
            query: { action: "list", type: "FEE", from: today, to: today, limit: 1000 }
        });
        if (!res.success) return;
        cachedTx = res.data.transactions || [];
        renderToday();
    }
    window.loadToday = loadToday;

    function renderToday() {
        const search  = ($("todaySearch")?.value || "").toLowerCase();
        const vehicle = $("todayVehicle")?.value || "";
        const status  = ($("todayStatus")?.value || "").toUpperCase();
        const today   = localDateKey(new Date());

        let rows = cachedTx.filter((t) => (t.date || "").startsWith(today));
        if (search) rows = rows.filter((t) =>
            (t.driverName || "").toLowerCase().includes(search) ||
            (t.referenceNumber || "").toLowerCase().includes(search));
        if (vehicle) rows = rows.filter((t) => t.vehicleType === vehicle);
        if (status)  rows = rows.filter((t) => String(t.status).toUpperCase() === status);

        const tb = $("todayTable");
        if (!tb) return;

        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="6"><div class="empty-inline">No transactions match.</div></td></tr>';
        } else {
            tb.innerHTML = rows.map((t, i) =>
                '<tr class="history-row" data-idx="' + i + '" title="Click to view details">' +
                '<td class="ref-mono">' + esc(t.referenceNumber) + '</td>' +
                '<td>' + esc(t.time || "") + '</td>' +
                '<td>' + esc(t.driverName || t.driverId) + '</td>' +
                '<td>' + esc(t.vehicleType || "—") + '</td>' +
                '<td>' + peso(t.amount) + '</td>' +
                '<td><span class="status-badge ' +
                    (String(t.status).toUpperCase() === "SUCCESSFUL" ? "successful" : "failed") +
                    '">' + esc(t.status) + '</span></td>' +
                '</tr>'
            ).join("");

            tb.querySelectorAll(".history-row").forEach((row) => {
                row.addEventListener("click", () => openTransactionDetails(rows[Number(row.dataset.idx)]));
            });
        }
        setText("todayCount", rows.length + " transaction" + (rows.length === 1 ? "" : "s"));
    }
    window.renderToday = renderToday;

    async function loadHistory() {
        const q        = ($("histSearch")?.value || "").trim();
        const from     = $("histFrom")?.value || "";
        const to       = $("histTo")?.value || "";
        const driverId = ($("histDriverId")?.value || "").trim();
        const vehicle  = $("histVehicle")?.value || "";
        const status   = ($("histStatus")?.value || "").toUpperCase();

        const res = await window.api("payments.php", {
            query: { action: "list", type: "FEE", q, from, to, limit: 500 }
        });
        if (!res.success) return;

        let rows = res.data.transactions || [];
        if (driverId) rows = rows.filter((t) => (t.driverId || "").toLowerCase().includes(driverId.toLowerCase()));
        if (vehicle)  rows = rows.filter((t) => t.vehicleType === vehicle);
        if (status)   rows = rows.filter((t) => String(t.status).toUpperCase() === status);

        const tb = $("historyTable");
        if (!tb) return;
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="8"><div class="empty-inline">No transactions.</div></td></tr>';
        } else {
            tb.innerHTML = rows.map((t, i) =>
                '<tr class="history-row" data-idx="' + i + '">' +
                '<td>' + esc(t.date) + " " + esc(t.time) + '</td>' +
                '<td class="ref-mono">' + esc(t.referenceNumber) + '</td>' +
                '<td>' + esc(t.driverName || t.driverId) + '</td>' +
                '<td>' + esc(t.vehicleType || "—") + '</td>' +
                '<td>' + peso(t.amount) + '</td>' +
                '<td>' + peso(t.previousBalance) + '</td>' +
                '<td>' + peso(t.balanceAfter) + '</td>' +
                '<td><span class="status-badge ' +
                    (String(t.status).toUpperCase() === "SUCCESSFUL" ? "successful" : "failed") +
                    '">' + esc(t.status) + '</span></td>' +
                '</tr>'
            ).join("");
            tb.querySelectorAll(".history-row").forEach((row) => {
                row.addEventListener("click", () => openTransactionDetails(rows[Number(row.dataset.idx)]));
            });
        }
        setText("historyCount", rows.length + " record" + (rows.length === 1 ? "" : "s"));
    }
    window.loadHistory = loadHistory;

    function openTransactionDetails(t) {
        lastTransaction = {
            transactionId: t.referenceNumber,
            driver: {
                fullName: t.driverName, driverId: t.driverId,
                vehicleType: t.vehicleType, bodyNumber: t.bodyNumber,
                plateNumber: t.plateNumber
            },
            station: t.stationId ? { code: t.stationId, name: t.stationName || t.stationId } : assignedStation,
            fee: t.amount, prevBalance: t.previousBalance, newBalance: t.balanceAfter
        };
        setText("tdRef", t.referenceNumber || "—");
        setText("tdDateTime", (t.date || "") + " " + (t.time || ""));
        setText("tdDriver", t.driverName || "—");
        setText("tdDriverId", t.driverId || "—");
        setText("tdVehicle", t.vehicleType || "—");
        setText("tdBody", t.bodyNumber || "—");
        setText("tdPlate", t.plateNumber || "—");
        setText("tdFee", peso(t.amount));
        setText("tdPrev", peso(t.previousBalance));
        setText("tdAfter", peso(t.balanceAfter));
        setText("tdStaff", t.processedBy || t.recordedBy || "—");
        setText("tdStatus", t.status || "—");
        const tdStation = $("tdStation");
        if (tdStation && t.stationId) {
            tdStation.textContent = t.stationId + (t.stationName ? " · " + t.stationName : "");
        }
        openModal("txnDetailsModal");
    }
    window.openTransactionDetails = openTransactionDetails;

    async function loadDrivers() {
        const q = ($("driverSearch")?.value || "").trim();
        const res = await window.api("drivers.php", { query: q ? { q } : {} });
        const tb = $("driverTable");
        if (!tb) return;
        if (!res.success || !res.data.drivers.length) {
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-inline">No drivers found.</div></td></tr>';
            return;
        }
        tb.innerHTML = res.data.drivers.map((d) =>
            "<tr>" +
            '<td class="ref-mono">' + esc(d.driverId) + "</td>" +
            "<td>" + esc(d.fullName) + "</td>" +
            "<td>" + esc(d.vehicleType || "—") + "</td>" +
            "<td>" + esc(d.bodyNumber || "—") + "</td>" +
            '<td class="ref-mono">' + esc(d.plateNumber || "—") + "</td>" +
            '<td><span class="status-badge ' +
                (/^active$/i.test(d.status) ? "successful" : "failed") +
                '">' + esc(d.status || "—") + "</span></td>" +
            '<td><button class="btn-outline btn-sm" data-report="' + esc(d.driverId) + '"><i class="fas fa-flag"></i> Report</button></td>' +
            "</tr>"
        ).join("");
        tb.querySelectorAll("[data-report]").forEach((b) =>
            b.addEventListener("click", () => reportIssue(b.dataset.report))
        );
    }
    window.loadDrivers = loadDrivers;

    async function reportIssue(driverId) {
        if (!window.ConfirmModal) return;
        window.ConfirmModal.show({
            title: "Report Information Issue?",
            message: "Send a note to Admin about driver " + driverId + "?",
            confirmText: "Report",
            onConfirm: async () => {
                const res = await window.api("audit_logs.php", {
                    method: "POST",
                    body: { action: "Reported Information Issue", recordType: "DRIVER", recordRef: driverId, details: "Staff reported" }
                });
                toast(res.success ? "Report sent to Admin." : "Could not send.", res.success ? "success" : "error");
            }
        });
    }

    async function loadVehicles() {
        const res = await window.api("drivers.php");
        const tb = $("vehicleTable");
        if (!tb) return;
        if (!res.success) {
            tb.innerHTML = '<tr><td colspan="5"><div class="empty-inline">Could not load.</div></td></tr>';
            return;
        }
        const search = ($("vehicleSearch")?.value || "").toLowerCase();
        let drivers = res.data.drivers.filter((d) => d.plateNumber);
        if (search) {
            drivers = drivers.filter((d) =>
                (d.plateNumber || "").toLowerCase().includes(search) ||
                (d.vehicleType || "").toLowerCase().includes(search));
        }
        if (!drivers.length) {
            tb.innerHTML = '<tr><td colspan="5"><div class="empty-inline">No vehicles.</div></td></tr>';
            return;
        }
        tb.innerHTML = drivers.map((d) =>
            "<tr>" +
            "<td>" + esc(d.vehicleType || "—") + "</td>" +
            "<td>" + esc(d.bodyNumber || "—") + "</td>" +
            '<td class="ref-mono">' + esc(d.plateNumber || "—") + "</td>" +
            "<td>" + esc(d.fullName || "—") + "</td>" +
            '<td><span class="status-badge ' +
                (/^active$/i.test(d.status) ? "successful" : "failed") +
                '">' + esc(d.status) + "</span></td>" +
            "</tr>"
        ).join("");
    }
    window.loadVehicles = loadVehicles;

    async function loadSummary() {
        const today = localDateKey(new Date());
        const res = await window.api("payments.php", {
            query: { action: "list", type: "FEE", from: today, to: today, limit: 1000 }
        });
        if (!res.success) return;
        const rows = res.data.transactions || [];
        const ok = rows.filter((t) => String(t.status).toUpperCase() === "SUCCESSFUL").length;
        const total = rows.reduce((a, t) => a + Number(t.amount || 0), 0);

        setText("summaryDate", new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }));
        setText("summaryScans", rows.length);
        setText("summarySuccessful", ok);
        setText("summaryFailed", rows.length - ok);
        setText("summaryFees", peso(total));

        const map = {};
        rows.forEach((t) => {
            const v = t.vehicleType || "Unknown";
            if (!map[v]) map[v] = { count: 0, total: 0 };
            map[v].count++;
            map[v].total += Number(t.amount || 0);
        });
        const tb = $("summaryVehicleTable");
        if (!tb) return;
        const entries = Object.entries(map);
        if (!entries.length) {
            tb.innerHTML = '<tr><td colspan="3"><div class="empty-inline">No transactions today.</div></td></tr>';
        } else {
            tb.innerHTML = entries.map(([k, v]) =>
                "<tr><td>" + esc(k) + "</td><td>" + v.count + "</td><td>" + peso(v.total) + "</td></tr>"
            ).join("");
        }
    }
    window.loadSummary = loadSummary;

    async function loadAttendance() {
        const res = await window.api("attendance.php", { query: { action: "list", date: localDateKey(new Date()) } });
        if (!res || !res.success) return;
        const myName = (user ? (user.fullName || user.username || "") : "").toLowerCase();
        const mine = (res.data.records || []).find((r) => (r.name || "").toLowerCase() === myName);
        if (!mine) {
            setText("attTimeIn", "—");
            setText("attTimeOut", "—");
            const st = $("attStatus");
            if (st) st.innerHTML = '<span class="status-badge neutral">NOT CLOCKED IN</span>';
            return;
        }
        setText("attTimeIn", mine.timeIn || "—");
        setText("attTimeOut", mine.timeOut || "—");
        const s = (mine.status || "").toUpperCase();
        const cls = s === "ON TIME" ? "successful" : s === "LATE" ? "pending" : "failed";
        const el = $("attStatus");
        if (el) el.innerHTML = '<span class="status-badge ' + cls + '">' + esc(s || "—") + "</span>";
    }
    window.loadAttendance = loadAttendance;

    function bindAllButtons() {
        $("notifBellBtn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const nd = $("notifDropdown");
            if (nd) nd.classList.toggle("active");
            const ud = $("userDropdown");
            if (ud) ud.classList.remove("active");
            if (nd && nd.classList.contains("active")) refreshStaffNotifications(false);
        });

        $("markAllReadBtn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            markAllStaffNotificationsRead();
        });

        $("notifList")?.addEventListener("click", (e) => {
            const item = e.target.closest(".notif-item");
            if (item) markStaffNotificationRead(item.dataset.id);
        });

        const userChipBtn = $("userChipBtn");
        const userDropdown = $("userDropdown");
        if (userChipBtn && userDropdown) {
            userChipBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle("active");
                const nd = $("notifDropdown");
                if (nd) nd.classList.remove("active");
            });
            userDropdown.querySelectorAll(".dropdown-item[data-goto]").forEach((item) => {
                item.addEventListener("click", (e) => {
                    e.preventDefault();
                    userDropdown.classList.remove("active");
                    const gotoPage = item.getAttribute("data-goto");
                    if (gotoPage && typeof navigateTo === "function") navigateTo(gotoPage);
                });
            });
            $("dropdownLogoutBtn")?.addEventListener("click", (e) => {
                e.preventDefault();
                userDropdown.classList.remove("active");
                $("logoutBtn")?.click();
            });
        }

        document.addEventListener("click", (e) => {
            const nw = document.querySelector(".notif-wrapper");
            if (nw && !nw.contains(e.target)) { const nd = $("notifDropdown"); if (nd) nd.classList.remove("active"); }
            const uw = document.querySelector(".user-chip-wrapper");
            if (uw && !uw.contains(e.target)) { const ud = $("userDropdown"); if (ud) ud.classList.remove("active"); }
            const tab = e.target.closest("#notifTabBar .notif-tab");
            if (tab) {
                document.querySelectorAll("#notifTabBar .notif-tab").forEach((t) => t.classList.remove("active"));
                tab.classList.add("active");
                notifCurrentFilter = tab.dataset.filter || "all";
                renderFullNotifications();
            }
        });

        $("mobileToggle")?.addEventListener("click", () => $("sidebar")?.classList.toggle("open"));
        $("logoutBtn")?.addEventListener("click", () => {
            if (cameraScanActive || (window.QrScanner && window.QrScanner.isCameraOn())) {
                stopCameraScan(true);
            }
            if (window.ConfirmModal) {
                window.ConfirmModal.show({
                    title: "Log out?",
                    message: "Log out of the station?",
                    confirmText: "Yes, log out",
                    onConfirm: () => window.logoutAndRedirect()
                });
            } else if (confirm("Log out?")) {
                window.logoutAndRedirect();
            }
        });

        document.querySelectorAll(".sidebar-item[data-page]").forEach((b) => {
            b.addEventListener("click", () => navigateTo(b.dataset.page));
        });
        document.querySelectorAll("[data-goto]").forEach((b) => {
            b.addEventListener("click", () => navigateTo(b.dataset.goto));
        });

        $("refreshStatsBtn")?.addEventListener("click", refreshAllData);
        $("refreshStatsBtnToday")?.addEventListener("click", refreshToday);
        $("refreshStatsBtnHistory")?.addEventListener("click", refreshHistory);
        $("refreshStatsBtnSummary")?.addEventListener("click", refreshSummary);

        $("summaryPrintBtn")?.addEventListener("click", () => window.print());

        $("exportCsvBtn")?.addEventListener("click", () => {
            const rows = cachedTx.filter((t) => String(t.type).toUpperCase() === "FEE");
            if (!rows.length) { toast("Nothing to export.", "warning"); return; }
            const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
            const lines = [["Date", "Time", "Reference", "Driver", "Vehicle", "Plate", "Fee", "Previous", "Balance After", "Station", "Status"].map(cell).join(",")];
            rows.forEach((t) => lines.push([t.date, t.time, t.referenceNumber, t.driverName, t.vehicleType, t.plateNumber, t.amount, t.previousBalance, t.balanceAfter, t.stationId || "", t.status].map(cell).join(",")));
            const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "staff-transactions-" + new Date().toISOString().slice(0, 10) + ".csv";
            a.click();
        });

        ["todaySearch", "todayVehicle", "todayStatus"].forEach((id) => {
            const el = $(id);
            if (el) el.addEventListener("input", renderToday);
            if (el) el.addEventListener("change", renderToday);
        });

        ["histSearch", "histDriverId", "histVehicle", "histStatus", "histFrom", "histTo"].forEach((id) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener("input", () => { clearTimeout(window.__hT); window.__hT = setTimeout(loadHistory, 350); });
            el.addEventListener("change", loadHistory);
        });

        $("driverSearch")?.addEventListener("input", () => {
            clearTimeout(window.__dT);
            window.__dT = setTimeout(loadDrivers, 350);
        });

        $("vehicleSearch")?.addEventListener("input", () => loadVehicles());

        $("scannerInput")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); parseScanned(); }
        });
        $("manualScanBtn")?.addEventListener("click", parseScanned);

         $("cameraToggleBtn")?.addEventListener("click", () => toggleCameraScan());
        $("qrImageInput")?.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (file) handleQrImageUpload(file);
        });

        $("processTransactionBtn")?.addEventListener("click", () => processTransaction(false));

        $("printReceiptBtn")?.addEventListener("click", () => {
            if (!fillReceipt()) return;
            const area = $("receiptPrintArea");
            if (area) area.style.display = "block";
            setTimeout(() => {
                window.print();
                setTimeout(() => { if (area) area.style.display = "none"; }, 500);
            }, 100);
        });

        $("reprintTxnBtn")?.addEventListener("click", () => {
            if (!fillReceipt()) return;
            closeModal("txnDetailsModal");
            const area = $("receiptPrintArea");
            if (area) area.style.display = "block";
            setTimeout(() => {
                window.print();
                setTimeout(() => { if (area) area.style.display = "none"; }, 500);
            }, 100);
        });

        $("timeInBtn")?.addEventListener("click", async () => {
            const res = await window.api("attendance.php", { method: "POST", body: { action: "time-in" } });
            setText("attMessage", res.success ? "Time In recorded." : (res.message || "Failed."));
            if (res.success) loadAttendance();
        });
        $("timeOutBtn")?.addEventListener("click", () => {
            if (window.ConfirmModal) {
                window.ConfirmModal.show({
                    title: "Confirm Time Out?",
                    message: "Record your time out?",
                    confirmText: "Confirm",
                    onConfirm: async () => {
                        const res = await window.api("attendance.php", { method: "POST", body: { action: "time-out" } });
                        setText("attMessage", res.success ? "Time Out recorded." : (res.message || "Failed."));
                        if (res.success) loadAttendance();
                    }
                });
            }
        });

        $("testScannerBtn")?.addEventListener("click", () => {
            const el = $("scannerInput");
            if (el && !el.disabled) { el.focus(); el.value = ""; el.placeholder = "Test: scan any QR"; }
            toast("Scanner ready — scan any QR to test.", "success");
        });

        $("testPrinterBtn")?.addEventListener("click", () => {
            setText("rctTxn", "TEST-" + Date.now());
            setText("rctDate", new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }));
            setText("rctTime", fmtTime12(new Date()));
            setText("rctDriver", "Test Driver");
            setText("rctDriverId", "TEST-000");
            setText("rctVehicle", "Tricycle");
            setText("rctBody", "0000");
            setText("rctPlate", "TEST-0000");
            setText("rctFee", "₱5.00");
            setText("rctAfter", "₱95.00");
            setText("rctStaff", user ? (user.username || "Staff") : "Staff");
            setText("rctStation", assignedStation ? (assignedStation.code + " · " + assignedStation.name) : "—");
            const area = $("receiptPrintArea");
            if (area) area.style.display = "block";
            setTimeout(() => {
                window.print();
                setTimeout(() => { if (area) area.style.display = "none"; }, 500);
            }, 100);
        });

        $("passwordForm")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const cp = $("currentPassword"), np = $("newPassword"), cf = $("confirmPassword"), msg = $("profileMsg");
            if (!cp || !np || !cf || !msg) return;
            if (!cp.value) { msg.textContent = "Enter your current password."; return; }
            if (np.value.length < 8) { msg.textContent = "New password must be at least 8 characters."; return; }
            if (np.value !== cf.value) { msg.textContent = "New passwords do not match."; return; }
            const res = await window.api("change_password.php", {
                method: "POST",
                body: { currentPassword: cp.value, newPassword: np.value }
            });
            msg.textContent = res.message || (res.success ? "Password updated." : "Failed.");
            if (res.success) $("passwordForm").reset();
        });

        $("captureQrBtn")?.addEventListener("click", async () => {
    const v = document.querySelector("#qrCameraReader video");
    if (!v || v.readyState < 2) {
        toast("Camera not ready yet.", "warning");
        return;
    }
    
    setScanStatus("Capturing frame…");
    
    try {
        const d = new BarcodeDetector({ formats: ["qr_code"] });
        const codes = await d.detect(v);
        
        if (!codes || codes.length === 0) {
            setScanStatus("No QR detected in frame. Try again.", "error");
            toast("No QR in frame", "warning");
            return;
        }
        
        const raw = codes[0].rawValue;
        console.log("[QR MANUAL CAPTURE]", raw);
        
        const dbgRaw = $("qrDebugRaw");
        if (dbgRaw) { dbgRaw.textContent = raw; dbgRaw.style.color = "#22c55e"; }
        
        setScanStatus("QR detected — verifying…", "ok");
        
         await stopCameraScan(true);
        handleScan(raw);
    } catch (e) {
        setScanStatus("Capture error: " + e.message, "error");
    }
});
    }

    window.authReady.then(async (u) => {
        if (!u) return;
        user = u;
        if (u.role !== "staff" && u.role !== "admin") {
            window.location.href = "login.html";
            return;
        }
        const roleName = { staff: "Terminal Staff", admin: "Administrator" }[u.role] || u.role;
        setText("stationTitle", roleName + " Dashboard");
        setText("greetingName", u.fullName || u.username || "User");
        setText("sidebarUser", (u.fullName || u.username || "") + " · " + roleName);
        setText("profName", u.fullName || u.username || "");
        setText("profUsername", "@" + (u.username || ""));
        setText("profRole", roleName);
        document.title = "Borongan Transport · " + roleName + " Panel";
        const chipAvatar = $("userAvatarChip");
        if (chipAvatar) chipAvatar.textContent = (u.fullName || u.username || "S").charAt(0).toUpperCase();
        setText("userNameChip", (u.fullName || u.username || "Staff").split(" ")[0]);
        setText("userRoleChip", roleName);
        setText("dropdownUserName", u.fullName || u.username || "Staff");

        tickTopbarClock();
        setInterval(tickTopbarClock, 30000);

        function tickShift() {
            const mins = Math.floor((Date.now() - shiftStart) / 60000);
            setText("shiftDuration", mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m");
        }
        tickShift();
        setInterval(tickShift, 30000);

        await identifyStation();
        loadSystemSettings();
        bindAllButtons();

        const fromHash = (location.hash || "").replace("#", "").trim();
        const activePage = fromHash || sessionStorage.getItem("staff_active_page") || "dashboard";
        if (activePage && $("page-" + activePage)) {
            navigateTo(activePage);
        } else {
            refreshDashboard();
        }

        loadAttendance();
        startNotifPolling();
        setTimeout(() => { const el = $("scannerInput"); if (el && !el.disabled) el.focus(); }, 500);
    });

    document.addEventListener("click", (e) => {
        if (currentPage === "scan" && !e.target.closest("input, button, select, textarea, a, label")) {
            const el = $("scannerInput");
            if (el && !el.disabled) setTimeout(() => el.focus(), 100);
        }
    });
})();