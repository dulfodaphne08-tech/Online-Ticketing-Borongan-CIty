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
        return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        });
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

    function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

    function tickTopbarClock() {
        const el = $("topbarDateTime");
        if (!el) return;
        const now = new Date();
        const datePart = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        const timePart = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        el.textContent = datePart + ", " + timePart;
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
            if (s.low_balance_threshold)  LOW_BALANCE_THRESHOLD = Number(s.low_balance_threshold) || LOW_BALANCE_THRESHOLD;
        } catch (e) {  }
    }

    async function identifyStation() {
        try {
            const res = await window.api("staff_station.php", { query: { action: "get-assigned" } });
            if (res && res.success && res.data && res.data.station) {
                assignedStation = res.data.station;
                renderStationBanner();
                setText("stationTitle", assignedStation.name + " Dashboard");
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
        const scanBtn = $("scannerInput");
        if (scanBtn) {
            scanBtn.disabled = true;
            scanBtn.placeholder = "No station assigned — contact Admin";
        }
        const manualBtn = $("manualScanBtn");
        if (manualBtn) manualBtn.disabled = true;
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
        checkNotifications();
        notifPollTimer = setInterval(checkNotifications, 15000);
    }
    function stopNotifPolling() {
        if (notifPollTimer) clearInterval(notifPollTimer);
        notifPollTimer = null;
    }

    async function checkNotifications() {
        try {
            const res = await window.api("payments.php", { query: { action: "list", type: "ALL", limit: 10 } });
            if (res && res.success && res.data.transactions) {
                const savedReadIds = JSON.parse(localStorage.getItem("bctt_read_notifs") || "[]");
                unreadNotifs = res.data.transactions.map((t) => {
                    const notifId = t.id || t.referenceNumber || t.date + t.time;
                    return {
                        id: notifId,
                        title: t.type === "LOAD" ? "Balance Loaded" : "Fee Collected",
                        message: `${t.type === "LOAD" ? "Loaded" : "Collected"} ${peso(t.amount)} for ${t.driverName || "Driver"}`,
                        time: t.date + " " + t.time,
                        isRead: savedReadIds.includes(notifId)
                    };
                });
                renderNotifications();
            }
        } catch (err) { console.warn("Notif fetch failed", err); }
    }

    function renderNotifications() {
        const badge = $("notifBadge");
        const list = $("notifList");
        if (!badge || !list) return;
        const unreadCount = unreadNotifs.filter((n) => !n.isRead).length;
        if (unreadCount > 0) { badge.textContent = unreadCount > 9 ? "9+" : unreadCount; badge.hidden = false; }
        else badge.hidden = true;
        if (unreadNotifs.length === 0) { list.innerHTML = '<div class="notif-empty">No new notifications.</div>'; return; }
        list.innerHTML = unreadNotifs.map((n) => `
            <div class="notif-item ${n.isRead ? "" : "unread"}" data-id="${escapeHtml(n.id)}">
                <div class="notif-icon"><i class="fas fa-money-bill-wave"></i></div>
                <div class="notif-content">
                    <p>${escapeHtml(n.title)}</p>
                    <p style="font-weight:400; font-size:.7rem; color:var(--text-mid);">${escapeHtml(n.message)}</p>
                    <small>${escapeHtml(n.time)}</small>
                </div>
            </div>
        `).join("");
    }

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
                    `<span style="font-size:10px;font-weight:800;color:${pinBg};background:#f8fafc;padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span>` +
                    `<h4 style="font-size:13px;font-weight:700;margin:4px 0 4px 0;color:#0f172a;">${escapeHtml(t.name)}</h4>` +
                    `<p style="font-size:11.5px;color:#64748b;margin:0 0 6px 0;">${escapeHtml(t.address || "Borongan City")}</p>` +
                    `</div>`);
                staffStationMarkers[t.code] = marker;
                markersGroup.push(marker);

                const isAssigned = assignedStation && assignedStation.code === t.code;
                html += `
                    <div class="station-card" onclick="focusStaffStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})" style="${isAssigned ? "border-color:var(--maroon);box-shadow:0 0 0 2px rgba(107,21,32,.15);" : ""}">
                        <div>
                            <div class="station-card-head">
                                <span class="station-code ${codeClass}">${escapeHtml(t.code)}</span>
                                <span class="station-type">${typeLabel}${isAssigned ? " · YOUR STATION" : ""}</span>
                            </div>
                            <div class="station-name">${escapeHtml(t.name)}</div>
                            <div class="station-address">
                                <i class="fas fa-location-dot"></i>
                                <span>${escapeHtml(t.address || "Borongan City")}</span>
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
        "stations-map": "Stations & Checkpoints"
    };

    function navigateTo(page) {
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

        if (page === "dashboard") refreshDashboard();
        if (page === "assigned-station") {
            loadAssignedStation();
            setTimeout(() => {
                if (assignedStationMapInstance) assignedStationMapInstance.invalidateSize();
            }, 200);
        }
        if (page === "scan") setTimeout(() => { const el = $("scannerInput"); if (el && !el.disabled) el.focus(); }, 100);
        if (page === "today") loadToday();
        if (page === "history") loadHistory();
        if (page === "drivers") loadDrivers();
        if (page === "vehicles") loadVehicles();
        if (page === "summary") loadSummary();
        if (page === "attendance") loadAttendance();
        if (page === "stations-map") {
            initStaffStationsMap();
            setTimeout(() => { if (staffStationsMapInstance) staffStationsMapInstance.invalidateSize(); }, 150);
        }
    }
    window.navigateTo = navigateTo;

    document.querySelectorAll(".sidebar-item[data-page]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.page));
    });
    document.querySelectorAll("[data-goto]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.goto));
    });
    $("mobileToggle")?.addEventListener("click", () => $("sidebar")?.classList.toggle("open"));
    $("logoutBtn")?.addEventListener("click", () => {
        if (window.ConfirmModal) {
            window.ConfirmModal.show({
                title: "Log out?", message: "Log out of the station?",
                confirmText: "Yes, log out",
                onConfirm: () => window.logoutAndRedirect()
            });
        } else if (confirm("Log out?")) {
            window.logoutAndRedirect();
        }
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
            setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));

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

    $("refreshStatsBtn")?.addEventListener("click", async () => {
        const btn = $("refreshStatsBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…'; }
        await refreshDashboard();
        if (currentPage === "today") await loadToday();
        if (currentPage === "history") await loadHistory();
        if (currentPage === "summary") await loadSummary();
        if (currentPage === "assigned-station") await loadAssignedStation();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Refresh'; }
        toast("Refreshed.", "success");
    });

    $("refreshStatsBtnToday")?.addEventListener("click", async () => { await loadToday(); toast("Refreshed.", "success"); });
    $("refreshStatsBtnHistory")?.addEventListener("click", async () => { await loadHistory(); toast("Refreshed.", "success"); });
    $("refreshStatsBtnSummary")?.addEventListener("click", async () => { await loadSummary(); toast("Refreshed.", "success"); });

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
        } catch (e) {  }

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

    $("scannerInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); parseScanned(); }
    });
    $("manualScanBtn")?.addEventListener("click", parseScanned);

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
    }

    $("processTransactionBtn")?.addEventListener("click", async () => {
        if (!currentScan || submitting) return;
        submitting = true;
        const btn = $("processTransactionBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…'; }

        const res = await window.api("payments.php", {
            method: "POST",
            body: {
                action: "collect",
                driverId: currentScan.driver.driverId,
                stationId: currentScan.station ? currentScan.station.code : (assignedStation ? assignedStation.code : "")
            }
        });

        submitting = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm &amp; Process'; }
        closeConfirmModal();

        if (res.success) {
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
            openModal("duplicateModal");
            return;
        }

        if (res.code === "INSUFFICIENT_BALANCE") {
            setText("inDriver", currentScan ? currentScan.driver.fullName || "—" : "—");
            setText("inBalance", peso(res.data ? res.data.balance : 0));
            setText("inFee", peso(res.data ? res.data.fee : 0));
            setText("inShortage", peso(res.data ? res.data.shortBy : 0));
            openModal("insufficientModal");
            return;
        }

        if (res.code === "STATION_NOT_AUTHORIZED") {
            openModal("noStationModal");
            toast(res.message || "Station not authorized.", "error");
            return;
        }

        toast(res.message || "Transaction failed.", "error");
    });

    window.cancelDuplicateScan = function () { closeModal("duplicateModal"); resetScan(); };

    window.confirmDuplicateScan = async function () {
        closeModal("duplicateModal");
        if (!currentScan || submitting) return;
        submitting = true;
        const btn = $("processTransactionBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…'; }

        const res = await window.api("payments.php", {
            method: "POST",
            body: {
                action: "collect",
                driverId: currentScan.driver.driverId,
                stationId: currentScan.station ? currentScan.station.code : (assignedStation ? assignedStation.code : ""),
                confirmDuplicate: true
            }
        });

        submitting = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm &amp; Process'; }

        if (res.success) {
            const lowFlag = !!(res.data && res.data.lowBalance);
            const lowThresh = (res.data && res.data.lowBalanceThreshold) || LOW_BALANCE_THRESHOLD;
            handleSuccessfulTransaction(res.data.receipt, lowFlag, lowThresh);
        } else if (res.code === "INSUFFICIENT_BALANCE") {
            setText("inDriver", currentScan ? currentScan.driver.fullName || "—" : "—");
            setText("inBalance", peso(res.data ? res.data.balance : 0));
            setText("inFee", peso(res.data ? res.data.fee : 0));
            setText("inShortage", peso(res.data ? res.data.shortBy : 0));
            openModal("insufficientModal");
        } else {
            toast(res.message || "Transaction failed.", "error");
        }
    };

    window.scanNextDriver = function () {
        closeModal("successModal"); closeModal("lowBalanceModal");
        resetScan(); navigateTo("scan");
    };
    window.backToDashboardFromSuccess = function () {
        closeModal("successModal"); closeModal("lowBalanceModal");
        resetScan(); navigateTo("dashboard");
    };
    window.closeInvalidModal = function () { closeModal("invalidModal"); resetScan(); };
    window.closeInactiveModal = function () { closeModal("inactiveModal"); resetScan(); };
    window.scanNextDriverFromInsufficient = function () {
        closeModal("insufficientModal"); resetScan(); navigateTo("scan");
    };
    window.closeNoStationModal = function () { closeModal("noStationModal"); navigateTo("dashboard"); };

    function fillReceipt() {
        if (!lastTransaction) { toast("No transaction to print.", "warning"); return false; }
        const info = lastTransaction;
        const d = info.driver || {};
        const now = new Date();
        setText("rctTxn", info.transactionId || "—");
        setText("rctDate", now.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }));
        setText("rctTime", now.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));
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

    async function loadToday() {
        const today = localDateKey(new Date());
        const res = await window.api("payments.php", {
            query: { action: "list", type: "FEE", from: today, to: today, limit: 1000 }
        });
        if (!res.success) return;
        cachedTx = res.data.transactions || [];
        renderToday();
    }

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

    ["todaySearch", "todayVehicle", "todayStatus"].forEach((id) => {
        const el = $(id);
        if (el) el.addEventListener("input", renderToday);
        if (el) el.addEventListener("change", renderToday);
    });
    $("todayClearBtn")?.addEventListener("click", () => {
        if ($("todaySearch")) $("todaySearch").value = "";
        if ($("todayVehicle")) $("todayVehicle").value = "";
        if ($("todayStatus")) $("todayStatus").value = "";
        renderToday();
    });

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

    ["histSearch", "histDriverId", "histVehicle", "histStatus", "histFrom", "histTo"].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("input", () => { clearTimeout(window.__hT); window.__hT = setTimeout(loadHistory, 350); });
        el.addEventListener("change", loadHistory);
    });
    $("histClearBtn")?.addEventListener("click", () => {
        ["histSearch", "histFrom", "histTo", "histDriverId", "histVehicle", "histStatus"].forEach((id) => {
            const el = $(id); if (el) el.value = "";
        });
        loadHistory();
    });

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
    $("driverSearch")?.addEventListener("input", () => {
        clearTimeout(window.__dT);
        window.__dT = setTimeout(loadDrivers, 350);
    });

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
    $("vehicleSearch")?.addEventListener("input", () => loadVehicles());

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
    $("summaryPrintBtn")?.addEventListener("click", () => window.print());

    async function loadAttendance() {
        const res = await window.api("attendance.php", { query: { action: "list", date: localDateKey(new Date()) } });
        if (!res || !res.success) return;
        const myName = (user ? (user.fullName || user.username || "") : "").toLowerCase();
        const mine = (res.data.records || []).find((r) => (r.name || "").toLowerCase() === myName);
        if (!mine) return;
        setText("attTimeIn", mine.timeIn);
        setText("attTimeOut", mine.timeOut);
        const s = (mine.status || "").toUpperCase();
        const cls = s === "ON TIME" ? "successful" : s === "LATE" ? "pending" : "failed";
        const el = $("attStatus");
        if (el) el.innerHTML = '<span class="status-badge ' + cls + '">' + esc(s || "—") + "</span>";
    }
    $("timeInBtn")?.addEventListener("click", async () => {
        const res = await window.api("attendance.php", { method: "POST", body: { action: "time-in" } });
        setText("attMessage", res.success ? "Time In recorded." : (res.message || "Failed."));
        if (res.success) loadAttendance();
    });
    $("timeOutBtn")?.addEventListener("click", () => {
        if (window.ConfirmModal) {
            window.ConfirmModal.show({
                title: "Confirm Time Out?", message: "Record your time out?", confirmText: "Confirm",
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
        setText("rctTime", new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }));
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

    document.addEventListener("DOMContentLoaded", () => {
        const notifBell = $("notifBellBtn");
        const notifDropdown = $("notifDropdown");
        if (notifBell && notifDropdown) {
            notifBell.addEventListener("click", (e) => {
                e.stopPropagation();
                notifDropdown.classList.toggle("active");
                const ud = $("userDropdown");
                if (ud) ud.classList.remove("active");
            });
        }
        document.addEventListener("click", (e) => {
            const nw = document.querySelector(".notif-wrapper");
            if (nw && !nw.contains(e.target)) { const nd = $("notifDropdown"); if (nd) nd.classList.remove("active"); }
            const uw = document.querySelector(".user-chip-wrapper");
            if (uw && !uw.contains(e.target)) { const ud = $("userDropdown"); if (ud) ud.classList.remove("active"); }
        });
        $("markAllReadBtn")?.addEventListener("click", () => {
            const savedReadIds = JSON.parse(localStorage.getItem("bctt_read_notifs") || "[]");
            const allIds = unreadNotifs.map((n) => n.id);
            const newReadIds = [...new Set([...savedReadIds, ...allIds])];
            localStorage.setItem("bctt_read_notifs", JSON.stringify(newReadIds));
            unreadNotifs.forEach((n) => n.isRead = true);
            renderNotifications();
            toast("All notifications marked as read.", "success");
        });
        $("notifList")?.addEventListener("click", (e) => {
            const item = e.target.closest(".notif-item");
            if (item && item.classList.contains("unread")) {
                const id = item.dataset.id;
                const savedReadIds = JSON.parse(localStorage.getItem("bctt_read_notifs") || "[]");
                if (!savedReadIds.includes(id)) {
                    savedReadIds.push(id);
                    localStorage.setItem("bctt_read_notifs", JSON.stringify(savedReadIds));
                }
                const notif = unreadNotifs.find((n) => n.id === id);
                if (notif) notif.isRead = true;
                renderNotifications();
            }
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
    });

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
        refreshDashboard();
        loadAttendance();
        startNotifPolling();
        setTimeout(() => { const el = $("scannerInput"); if (el && !el.disabled) el.focus(); }, 500);
    });

    document.addEventListener("click", (e) => {
        if (currentPage === "scan" && !e.target.closest("input, button, select, textarea, a")) {
            const el = $("scannerInput");
            if (el && !el.disabled) setTimeout(() => el.focus(), 100);
        }
    });
})();