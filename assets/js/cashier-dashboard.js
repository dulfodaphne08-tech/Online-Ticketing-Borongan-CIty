/* ============================================================
   CASHIER DASHBOARD — matches api/wallet.php + api/payments.php
   ============================================================ */
(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
    const escapeHtml = esc;  

    const shiftStart = Date.now();
    let user = null;
    let currentPage = "dashboard";
    let loadDriver = null;
    let searchResults = [];
    let loading = false;
    let receiptOnDone = null;
    let historyRows = [];

    function refreshTransactionRef() {
        const el = $("transactionRef");
        if (!el) return;
        el.value = "Generated when saved";
    }

     function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
    function setValue(id, v) { const e = $(id); if (e) e.value = v; }

    function toast(msg, type) {
        const c = $("toastContainer");
        if (!c) return;
        const icons = {
            success: "fa-check-circle",
            error: "fa-exclamation-circle",
            warning: "fa-triangle-exclamation"
        };
        const t = document.createElement("div");
        t.className = "toast " + (type || "success");
        t.innerHTML =
            '<span class="toast-icon"><i class="fas ' + (icons[type] || icons.success) + '"></i></span>' +
            '<span class="toast-msg">' + esc(msg) + '</span>' +
            '<button class="toast-close" aria-label="Close"><i class="fas fa-times"></i></button>';
        t.querySelector(".toast-close").addEventListener("click", () => t.remove());
        c.appendChild(t);
        setTimeout(() => {
            t.classList.add("hiding");
            setTimeout(() => t.remove(), 300);
        }, 4000);
    }

    function openModal(id) { const el = $(id); if (el) el.classList.add("active"); }
    function closeModal(id) { const el = $(id); if (el) el.classList.remove("active"); }

    function setBusy(btn, busy, text) {
        if (!btn) return;
        if (busy) {
            btn.dataset.label = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + esc(text || "Please wait…");
        } else {
            btn.disabled = false;
            if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
        }
    }

     document.querySelectorAll(".modal-overlay").forEach((m) => {
        m.addEventListener("click", (e) => {
            if (e.target === m && m.id !== "receiptModal") closeModal(m.id);
            if (e.target.closest("[data-close-modal]")) closeModal(m.id);
        });
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal("confirmLoadModal");
    });

     let cashierStationsMapInstance = null;
    let cashierStationMarkers = {};

    async function initCashierStationsMap(forceRefresh = false) {
        const mapEl = $("cashierStationsMap");
        if (!mapEl || typeof L === "undefined") return;

        if (!cashierStationsMapInstance) {
            cashierStationsMapInstance = L.map("cashierStationsMap", {
                center: [11.6080, 125.4316],
                zoom: 11,
                zoomControl: true,
                scrollWheelZoom: true
            });

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Borongan BCTT'
            }).addTo(cashierStationsMapInstance);
        }

        try {
            const res = await window.api("terminals.php");
            const list = (res && res.success && res.data && res.data.terminals) ? res.data.terminals : [];
            if (!list.length) return;

            Object.values(cashierStationMarkers).forEach(m => cashierStationsMapInstance.removeLayer(m));
            cashierStationMarkers = {};

            const markersGroup = [];
            const gridEl = $("cashierStationsList");
            let html = "";

            list.forEach(t => {
                const isReceiving = (t.code || "").startsWith("RS");
                const badgeBg = isReceiving ? "#ecfdf5" : "#fef2f2";
                const badgeColor = isReceiving ? "#059669" : "#b22234";
                const pinBg = isReceiving ? "#059669" : "#b22234";
                const typeLabel = isReceiving ? "Checkpoint" : "Ticketing Station";

                const iconHtml = `<div style="width:36px;height:36px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.25);border:2px solid #fff;"><i class="fas ${isReceiving ? 'fa-clipboard-check' : 'fa-ticket'}" style="font-size:13px;"></i></div>`;
                const icon = L.divIcon({ html: iconHtml, className: "cashier-map-pin", iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] });
                const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(cashierStationsMapInstance);

                const popup = `
                    <div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:210px;">
                        <span style="font-size:10px;font-weight:800;color:${badgeColor};background:${badgeBg};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span>
                        <h4 style="font-size:13px;font-weight:700;margin:4px 0 4px 0;color:#0f172a;">${escapeHtml(t.name)}</h4>
                        <p style="font-size:11.5px;color:#64748b;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p>
                        <div style="background:#f8fafc;padding:5px 7px;border-radius:6px;font-size:11px;color:#334155;border:1px solid #e2e8f0;line-height:1.4;">
                            <div><strong>Hours:</strong> ${escapeHtml(t.operating_hours || '5:00 AM - 8:00 PM')}</div>
                            <div style="margin-top:2px;"><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'Borongan Lines')}</div>
                            <div style="margin-top:2px;"><strong>Staff:</strong> ${escapeHtml(t.assigned_staff_name || 'Assigned')}</div>
                        </div>
                    </div>
                `;
                marker.bindPopup(popup);
                cashierStationMarkers[t.code] = marker;
                markersGroup.push(marker);

                html += `
                    <div class="p-3 rounded-xl border border-gray-200 bg-white hover:border-primary transition cursor-pointer flex flex-col justify-between"
                         onclick="focusCashierStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})">
                        <div>
                            <div class="flex justify-between items-center mb-1.5">
                                <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded" style="background:${badgeBg};color:${badgeColor}">${escapeHtml(t.code)}</span>
                                <span class="text-[10px] font-bold text-gray-500 uppercase">${typeLabel}</span>
                            </div>
                            <h5 class="font-bold text-xs text-gray-900 leading-snug mb-1">${escapeHtml(t.name)}</h5>
                            <p class="text-[11px] text-gray-500 mb-1.5"><i class="fas fa-location-dot text-primary mr-1"></i>${escapeHtml(t.address || 'Borongan City')}</p>
                            <div class="text-[11px] text-gray-600 bg-gray-50 p-1.5 rounded border border-gray-100 mb-2">
                                <div><i class="fas fa-route text-primary mr-1"></i><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'City Proper')}</div>
                                <div class="mt-1"><i class="fas fa-user-shield text-emerald-600 mr-1"></i><strong>Assigned:</strong> ${escapeHtml(t.assigned_staff_name || 'Staff')}</div>
                            </div>
                        </div>
                        <div class="flex justify-between items-center text-[11px] text-primary font-bold pt-1.5 border-t border-gray-100">
                            <span><i class="fas fa-location-crosshairs mr-1"></i> Locate Station</span>
                            <i class="fas fa-arrow-right text-[10px]"></i>
                        </div>
                    </div>
                `;
            });

            if (gridEl) gridEl.innerHTML = html;

            if (markersGroup.length > 0) {
                const group = new L.featureGroup(markersGroup);
                cashierStationsMapInstance.fitBounds(group.getBounds().pad(0.12));
            }

            if (forceRefresh) {
                showToast("Terminal stations updated", "success");
            }
        } catch (e) {
            console.warn("Could not load stations in cashier:", e);
        }
    }
    window.initCashierStationsMap = initCashierStationsMap;

    function focusCashierStation(code, lat, lng) {
        if (cashierStationsMapInstance && lat && lng) {
            cashierStationsMapInstance.flyTo([lat, lng], 16, { duration: 1.2 });
            if (cashierStationMarkers[code]) {
                setTimeout(() => cashierStationMarkers[code].openPopup(), 400);
            }
        }
    }
    window.focusCashierStation = focusCashierStation;

    function navigateTo(page) {
        currentPage = page;
        document.querySelectorAll(".page-section").forEach((s) => {
            s.classList.toggle("active", s.id === "page-" + page);
        });
        document.querySelectorAll(".sidebar-item").forEach((i) => {
            i.classList.toggle("active", i.dataset.page === page);
        });
        const sb = $("sidebar");
        if (sb) sb.classList.remove("open");
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (page === "dashboard") refreshDashboard();
        if (page === "history") loadHistory();
        if (page === "references") loadReferences();
        if (page === "today") loadToday();
        if (page === "attendance") loadAttendance();
        if (page === "stations-map") {
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
            }, 180);
            setTimeout(() => {
                if (cashierStationsMapInstance) cashierStationsMapInstance.invalidateSize();
            }, 350);
        }
    }
    window.navigateTo = navigateTo;

    document.querySelectorAll(".sidebar-item[data-page]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.page));
    });
    document.querySelectorAll("[data-goto]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.goto));
    });
    $("mobileToggle")?.addEventListener("click", () => {
        $("sidebar")?.classList.toggle("open");
    });
    $("logoutBtn")?.addEventListener("click", () => {
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

     async function refreshDashboard() {
        const [stats, recent] = await Promise.all([
            window.api("payments.php", { query: { action: "stats" } }),
            window.api("payments.php", { query: { action: "list", limit: 20 } })
        ]);
        if (stats && stats.success) {
            const s = stats.data.stats;
            setText("statLoads", peso(s.loadsToday));
            setText("statLoadsCount", s.loadsCountToday);
        }
        const list = recent && recent.success ? recent.data.transactions : [];
        const today = new Date().toLocaleDateString("en-CA");
        const todayList = list.filter((t) => (t.date || "").startsWith(today));
        const loadList = todayList.filter((t) => String(t.type).toUpperCase() === "LOAD");
        const ok = loadList.filter((t) => String(t.status).toUpperCase() === "SUCCESSFUL").length;
        setText("statSuccessfulLoads", ok);
        setText("statFailedLoads", loadList.length - ok);

        const tb = $("recentTable");
        if (tb) {
            const show = todayList.slice(0, 8);
            if (!show.length) {
                tb.innerHTML = '<tr><td colspan="6"><div class="empty-state">' +
                    '<i class="fas fa-inbox"></i><p>No transactions today.</p></div></td></tr>';
            } else {
                tb.innerHTML = show.map((t) => '<tr>' +
                    '<td>' + esc(t.time || "") + '</td>' +
                    '<td>' + esc(t.driverName || t.driverId) + '</td>' +
                    '<td class="ref-mono">' + esc(t.driverId) + '</td>' +
                    '<td>' + (t.type === "LOAD" ? "+" : "−") + peso(t.amount) + '</td>' +
                    '<td>' + peso(t.balanceAfter) + '</td>' +
                    '<td class="ref-mono">' + esc(t.referenceNumber || "—") + '</td>' +
                    '</tr>').join("");
            }
        }
        setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", {
            hour: "numeric", minute: "2-digit"
        }));
    }
    $("refreshStatsBtn")?.addEventListener("click", refreshDashboard);

     async function searchDrivers(q) {
        const box = $("loadSearchResults");
        if (!box) return;
        if (!q) {
            box.innerHTML = '<p class="form-hint hint-error">Enter a name, Driver ID, or plate.</p>';
            return;
        }
        box.innerHTML = '<p class="form-hint"><i class="fas fa-spinner fa-spin"></i> Searching…</p>';
        const res = await window.api("wallet.php", { query: { action: "search", q } });
        if (!res.success) {
            box.innerHTML = '<p class="form-hint hint-error">' + esc(res.message) + '</p>';
            return;
        }
        searchResults = res.data.drivers;
        if (!searchResults.length) {
            box.innerHTML = '<div class="empty-state"><i class="fas fa-user-slash"></i>' +
                '<p>No driver matches "' + esc(q) + '".</p></div>';
            return;
        }
        box.innerHTML = '<div class="result-list">' +
            searchResults.map((d, i) =>
                '<button type="button" class="result-item" data-pick="' + i + '">' +
                '<span class="driver-info-avatar">' +
                (d.photo
                    ? '<img src="' + esc(d.photo) + '" alt="">'
                    : '<span>' + esc((d.fullName || "D").charAt(0).toUpperCase()) + '</span>') +
                '</span>' +
                '<span class="result-main">' +
                '<strong>' + esc(d.fullName) + '</strong>' +
                '<small>' + esc(d.driverId) + ' · ' + esc(d.vehicleType) + ' · ' + esc(d.plateNumber) + '</small>' +
                '</span>' +
                '<span class="result-balance' + (d.balance < d.fee ? ' is-low' : '') + '">' + peso(d.balance) + '</span>' +
                '</button>').join("") +
            '</div>';
        box.querySelectorAll("[data-pick]").forEach((b) => {
            b.addEventListener("click", () => selectLoadDriver(searchResults[Number(b.dataset.pick)]));
        });
    }

    function selectLoadDriver(d) {
        loadDriver = d;
        const ls = $("loadStepSearch"); if (ls) ls.hidden = true;
        const lf = $("loadStepForm"); if (lf) lf.hidden = false;
        const av = $("ldAvatar");
        if (av) av.innerHTML = d.photo
            ? '<img src="' + esc(d.photo) + '" alt="">'
            : '<span>' + esc((d.fullName || "D").charAt(0).toUpperCase()) + '</span>';
        setText("ldName", d.fullName);
        setText("ldDriverId", d.driverId);
        setText("ldVehicle", d.vehicleType || "—");
        setText("ldPlate", d.plateNumber || "—");
        setText("ldBalance", peso(d.balance));
        setValue("loadAmount", "");
        setValue("orNumber", "");
        refreshTransactionRef();
        updateLoadPreview();
    }

    function resetLoad() {
        loadDriver = null;
        const lf = $("loadStepForm"); if (lf) lf.hidden = true;
        const ls = $("loadStepSearch"); if (ls) ls.hidden = false;
        const rs = $("loadSearchResults"); if (rs) rs.innerHTML = "";
        setValue("loadSearchInput", "");
        setValue("orNumber", "");
        const ref = $("transactionRef");
        if (ref) ref.value = "";
    }

    function amountValue() {
        const el = $("loadAmount");
        if (!el) return 0;
        const n = Number(el.value);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    }

    function updateLoadPreview() {
        const amt = amountValue();
        const lp = $("loadPreview");
        if (lp) lp.hidden = !(loadDriver && amt > 0);
        if (!loadDriver) return;
        setText("pvCurrent", peso(loadDriver.balance));
        setText("pvAmount", peso(amt));
        setText("pvNew", peso(loadDriver.balance + amt));
    }

    $("loadSearchForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const el = $("loadSearchInput");
        if (el) searchDrivers(el.value.trim());
    });
    $("changeDriverBtn")?.addEventListener("click", resetLoad);
    $("loadAmount")?.addEventListener("input", updateLoadPreview);
    document.querySelectorAll(".quick-btn").forEach((b) => {
        b.addEventListener("click", () => {
            setValue("loadAmount", b.dataset.amount);
            updateLoadPreview();
        });
    });

    $("loadForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const amt = amountValue();
        const msg = $("loadMsg");
        if (!loadDriver) return;
        if (!(amt > 0)) {
            if (msg) msg.textContent = "Enter an amount greater than ₱0.";
            return;
        }
        if (amt > 50000) {
            if (msg) msg.textContent = "Max is ₱50,000.";
            return;
        }
        if (msg) msg.textContent = "";

        const refEl = $("transactionRef");
        refreshTransactionRef();

        setText("cfDriver", loadDriver.fullName);
        setText("cfDriverId", loadDriver.driverId);
        setText("cfPrev", peso(loadDriver.balance));
        setText("cfAmount", peso(amt));
        setText("cfNew", peso(loadDriver.balance + amt));
        setText("cfTxRef", refEl ? refEl.value : "—");

        const orEl = $("orNumber");
        const orVal = (orEl && orEl.value ? orEl.value : "").trim();
        const cfOR = $("cfOR");
        if (cfOR) cfOR.textContent = orVal || "—";

        const pm = $("paymentMethod");
        if (pm) setText("cfMethod", pm.selectedOptions[0].textContent);
        openModal("confirmLoadModal");
    });

    $("confirmLoadBtn")?.addEventListener("click", async () => {
        if (!loadDriver || loading) return;
        loading = true;
        const btn = $("confirmLoadBtn");
        setBusy(btn, true, "Loading…");

        const orEl = $("orNumber");
        const orNumber = (orEl && orEl.value ? orEl.value : "").trim();
        const pm = $("paymentMethod");

        const body = {
            action: "load",
            driverId: loadDriver.driverId,
            amount: amountValue(),
            paymentMethod: pm ? pm.value : "CASH",
            orNumber: orNumber || null,
            confirmDuplicate: false
        };

        const res = await window.api("wallet.php", { method: "POST", body });
        setBusy(btn, false);
        loading = false;
        closeModal("confirmLoadModal");

        if (res.success) {
            showReceipt(res.data.receipt, () => resetLoad());
            refreshDashboard();
            return;
        }

        if (res.code === "DUPLICATE_LOAD") {
            if (confirm(res.message + "\n\nLoad again anyway?")) {
                const res2 = await window.api("wallet.php", {
                    method: "POST",
                    body: Object.assign({}, body, { confirmDuplicate: true })
                });
                if (res2.success) {
                    showReceipt(res2.data.receipt, () => resetLoad());
                    refreshDashboard();
                } else {
                    toast(res2.message || "Load failed.", "error");
                }
            }
            return;
        }

        if (res.code === "DUPLICATE_OR") {
            toast(res.message || "That OR number is already recorded.", "error");
            return;
        }

        toast(res.message || "Load failed.", "error");
    });

     async function loadHistory() {
        const tb = $("historyTable");
        if (!tb) return;
        tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
            '<i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div></td></tr>';
        const q = ($("histSearch")?.value || "").trim();
        const res = await window.api("payments.php", {
            query: { action: "list", type: "ALL", q, limit: 500 }
        });
        if (!res.success) {
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>' +
                esc(res.message) + '</p></div></td></tr>';
            return;
        }
        historyRows = res.data.transactions;
        setText("historyCount", historyRows.length + " record" +
            (historyRows.length === 1 ? "" : "s"));
        if (!historyRows.length) {
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                '<i class="fas fa-clock-rotate-left"></i><p>No records.</p></div></td></tr>';
            return;
        }
        tb.innerHTML = historyRows.map((t) => '<tr>' +
            '<td>' + esc(t.date) + ' ' + esc(t.time) + '</td>' +
            '<td>' + (t.type === "LOAD" ? "Load" : "Fee") + '</td>' +
            '<td>' + esc(t.driverName || t.driverId) + '</td>' +
            '<td>' + (t.type === "LOAD" ? "+" : "−") + peso(t.amount) + '</td>' +
            '<td>' + peso(t.previousBalance) + '</td>' +
            '<td>' + peso(t.balanceAfter) + '</td>' +
            '<td class="ref-mono">' + esc(t.referenceNumber || "—") + '</td>' +
            '</tr>').join("");
    }
    $("histSearch")?.addEventListener("input", () => {
        clearTimeout(window.__hsT);
        window.__hsT = setTimeout(loadHistory, 350);
    });
    $("histClearBtn")?.addEventListener("click", () => {
        setValue("histSearch", "");
        loadHistory();
    });
    $("exportCsvBtn")?.addEventListener("click", () => {
        if (!historyRows.length) { toast("Nothing to export.", "warning"); return; }
        const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
        const lines = [["Date", "Time", "Type", "Transaction Ref", "OR Number",
            "Driver ID", "Driver", "Amount", "Balance After", "Processed By", "Status"].map(cell).join(",")];
        historyRows.forEach((t) => lines.push([
            t.date, t.time, t.type,
            t.referenceNumber || "",
            t.orNumber || "",
            t.driverId, t.driverName,
            t.amount, t.balanceAfter, t.processedBy, t.status
        ].map(cell).join(",")));
        const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
            type: "text/csv;charset=utf-8"
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "bctt-history-" + new Date().toISOString().slice(0, 10) + ".csv";
        a.click();
    });

     async function loadReferences() {
        const tb = $("refTable");
        if (!tb) return;
        tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
            '<i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div></td></tr>';
        const q = ($("refSearch")?.value || "").trim();
        const res = await window.api("payments.php", {
            query: { action: "list", type: "LOAD", q, limit: 500 }
        });
        if (!res.success || !res.data.transactions.length) {
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                '<i class="fas fa-receipt"></i><p>No reference records.</p></div></td></tr>';
            return;
        }
        tb.innerHTML = res.data.transactions.map((t) => '<tr>' +
            '<td class="ref-mono">' + esc(t.referenceNumber || "—") + '</td>' +
            '<td class="ref-mono">' + esc(t.orNumber || "—") + '</td>' +
            '<td>' + esc(t.driverName || t.driverId) + '</td>' +
            '<td>+' + peso(t.amount) + '</td>' +
            '<td>' + esc(t.processedBy || "—") + '</td>' +
            '<td>' + esc(t.date || "") + '<br>' +
            '<span class="text-xs text-gray-400">' + esc(t.time || "") + '</span></td>' +
            '<td><span class="status-badge successful">' + esc(t.status) + '</span></td>' +
            '</tr>').join("");
    }
    $("refSearch")?.addEventListener("input", () => {
        clearTimeout(window.__rsT);
        window.__rsT = setTimeout(loadReferences, 350);
    });

     async function loadToday() {
        const res = await window.api("payments.php", {
            query: { action: "list", type: "LOAD", limit: 500 }
        });
        if (!res.success) return;
        const today = new Date().toLocaleDateString("en-CA");
        const tx = res.data.transactions.filter((t) => (t.date || "").startsWith(today));
        const ok = tx.filter((t) => String(t.status).toUpperCase() === "SUCCESSFUL").length;
        setText("todayTotalCount", tx.length);
        setText("todayTotalAmount", peso(tx.reduce((a, t) => a + Number(t.amount || 0), 0)));
        setText("todaySuccessful", ok);
        setText("todayFailed", tx.length - ok);
        setText("todayDate", new Date().toLocaleDateString("en-PH", {
            month: "long", day: "numeric", year: "numeric"
        }));
        const tb = $("todayTable");
        if (tb) {
            if (!tx.length) {
                tb.innerHTML = '<tr><td colspan="6"><div class="empty-state">' +
                    '<i class="fas fa-inbox"></i><p>No loads today.</p></div></td></tr>';
            } else {
                tb.innerHTML = tx.map((t) => '<tr>' +
                    '<td>' + esc(t.time || "") + '</td>' +
                    '<td>' + esc(t.driverName || t.driverId) + '</td>' +
                    '<td class="ref-mono">' + esc(t.driverId) + '</td>' +
                    '<td>+' + peso(t.amount) + '</td>' +
                    '<td class="ref-mono">' + esc(t.referenceNumber || "—") + '</td>' +
                    '<td><span class="status-badge successful">' + esc(t.status) + '</span></td>' +
                    '</tr>').join("");
            }
        }
    }

     async function loadAttendance() {
        const res = await window.api("attendance.php", {
            query: { action: "list", date: new Date().toLocaleDateString("en-CA") }
        });
        if (!res || !res.success) return;
        const me = window.CURRENT_USER || {};
        const myName = (me.fullName || me.username || "").toLowerCase();
        const mine = (res.data.records || []).find((r) =>
            (r.name || "").toLowerCase() === myName
        );
        if (!mine) return;
        setText("attTimeIn", mine.timeIn);
        setText("attTimeOut", mine.timeOut);
        setText("cashierTimeIn", mine.timeIn);
        const s = (mine.status || "").toUpperCase();
        const cls = s === "ON TIME" ? "successful" : s === "LATE" ? "pending" : "failed";
        const html = '<span class="status-badge ' + cls + '">' + esc(s || "—") + '</span>';
        const el1 = $("attStatus"); if (el1) el1.innerHTML = html;
        const el2 = $("cashierAttStatus"); if (el2) el2.innerHTML = html;
    }
    $("timeInBtn")?.addEventListener("click", async () => {
        const res = await window.api("attendance.php", {
            method: "POST", body: { action: "time-in" }
        });
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
                    const res = await window.api("attendance.php", {
                        method: "POST", body: { action: "time-out" }
                    });
                    setText("attMessage", res.success ? "Time Out recorded." : (res.message || "Failed."));
                    if (res.success) loadAttendance();
                }
            });
        }
    });

     function showReceipt(t, onDone) {
        receiptOnDone = onDone || null;
        const isLoad = String(t.type).toUpperCase() === "LOAD";
        setText("receiptHeading", isLoad ? "WALLET LOAD RECEIPT" : "TERMINAL FEE RECEIPT");
        const st = $("receiptStamp");
        if (st) {
            st.textContent = isLoad ? "LOADED" : "PAID";
            st.className = "receipt-stamp " + (isLoad ? "is-load" : "is-fee");
        }
        setText("rAmount", (isLoad ? "+" : "") + peso(t.amount));
        setText("rRef", t.referenceNumber || "—");
        setText("rDate", (t.date || "") + " · " + (t.time || ""));
        setText("rDriver", t.driverName || "—");
        setText("rDriverId", t.driverId || "—");
        setText("rPlate", [t.plateNumber, t.vehicleType].filter(Boolean).join(" · ") || "—");
        setText("rPrev", peso(t.previousBalance));
        setText("rAfter", peso(t.balanceAfter));
        setText("rBy", t.processedBy || "—");

        const orVal = t.orNumber || "";
        const orRow = $("rORRow");
        if (orRow) orRow.hidden = !orVal;
        if (orVal) setText("rOR", orVal);

        openModal("receiptModal");
    }
    $("receiptDoneBtn")?.addEventListener("click", () => {
        closeModal("receiptModal");
        const cb = receiptOnDone;
        receiptOnDone = null;
        if (cb) cb();
    });
    $("receiptPrintBtn")?.addEventListener("click", () => {
        document.body.classList.add("printing-receipt");
        window.print();
        setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
    });

     $("passwordForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const cp = $("currentPassword");
        const np = $("newPassword");
        const cf = $("confirmPassword");
        const msg = $("profileMsg");
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

     window.authReady.then((u) => {
        if (!u) return;
        user = u;
        const roleName = {
            cashier: "Cashier",
            staff: "Terminal Staff",
            admin: "Administrator"
        }[u.role] || u.role;

        setText("brandTitle", u.role === "staff"
            ? "STAFF PANEL"
            : u.role === "admin"
                ? "ADMIN · STATION"
                : "CASHIER PANEL");
        setText("stationTitle", roleName + " Dashboard");
        setText("greetingName", u.fullName || u.username || "User");
        setText("sidebarUser", (u.fullName || u.username || "") + " · " + roleName);
        setText("profName", u.fullName || u.username || "");
        setText("profUsername", "@" + (u.username || ""));
        setText("profRole", roleName);
        setText("todayCashierName", u.fullName || u.username || "—");

        function tickShift() {
            const mins = Math.floor((Date.now() - shiftStart) / 60000);
            setText("shiftDuration",
                mins < 60
                    ? mins + "m"
                    : Math.floor(mins / 60) + "h " + (mins % 60) + "m");
        }
        tickShift();
        setInterval(tickShift, 30000);
        setInterval(() => {
            if (currentPage === "dashboard" && !document.hidden) refreshDashboard();
        }, 30000);

        refreshDashboard();
        loadAttendance();
    });
})();