/* ============================================================
   STAFF DASHBOARD — JavaScript
   Works with: api/payments.php (verify, collect, list, stats)
               api/wallet.php   (search)
               api/drivers.php  (records)
               api/attendance.php (time-in/out)
               api/change_password.php
   Requires: guard.js (window.api, window.authReady, window.CURRENT_USER)
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
    const fmtTime = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-PH", {
            hour: "numeric", minute: "2-digit"
        });
    };
    const fmtDateTime = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit"
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
    let cachedTx = [];
    let dashboardRefreshInFlight = false;
    let dashboardRefreshQueued = false;

     function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

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
    window.showToast = toast;

    function openModal(id) { const el = $(id); if (el) el.classList.add("active"); }
    function closeModal(id) { const el = $(id); if (el) el.classList.remove("active"); }
    window.openModal = openModal;
    window.closeModal = closeModal;

    document.querySelectorAll(".modal-overlay").forEach((m) => {
        m.addEventListener("click", (e) => {
            if (e.target === m) closeModal(m.id);
        });
    });
     let staffStationsMapInstance = null;
    let staffStationMarkers = {};

    async function initStaffStationsMap(forceRefresh = false) {
        const mapEl = $("staffStationsMap");
        if (!mapEl || typeof L === "undefined") return;

        if (!staffStationsMapInstance) {
            staffStationsMapInstance = L.map("staffStationsMap", {
                center: [11.6080, 125.4316],
                zoom: 11,
                zoomControl: true,
                scrollWheelZoom: true
            });

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Borongan BCTT'
            }).addTo(staffStationsMapInstance);
        }

        try {
            const res = await window.api("terminals.php");
            const list = (res && res.success && res.data && res.data.terminals) ? res.data.terminals : [];
            if (!list.length) return;

            Object.values(staffStationMarkers).forEach(m => staffStationsMapInstance.removeLayer(m));
            staffStationMarkers = {};

            const markersGroup = [];
            const gridEl = $("staffStationsList");
            let html = "";

            list.forEach(t => {
                const isReceiving = (t.code || "").startsWith("RS");
                const badgeBg = isReceiving ? "#ecfdf5" : "#fef2f2";
                const badgeColor = isReceiving ? "#059669" : "#b22234";
                const pinBg = isReceiving ? "#059669" : "#b22234";
                const typeLabel = isReceiving ? "Checkpoint" : "Ticketing Station";

                const iconHtml = `<div style="width:36px;height:36px;border-radius:50%;background:${pinBg};color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.25);border:2px solid #fff;"><i class="fas ${isReceiving ? 'fa-clipboard-check' : 'fa-ticket'}" style="font-size:13px;"></i></div>`;
                const icon = L.divIcon({ html: iconHtml, className: "staff-map-pin", iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] });
                const marker = L.marker([t.latitude, t.longitude], { icon }).addTo(staffStationsMapInstance);

                const popup = `
                    <div style="font-family:'Inter',sans-serif;padding:4px 2px;min-width:210px;">
                        <span style="font-size:10px;font-weight:800;color:${badgeColor};background:${badgeBg};padding:2px 6px;border-radius:4px;">${escapeHtml(t.code)} · ${typeLabel}</span>
                        <h4 style="font-size:13px;font-weight:700;margin:4px 0 4px 0;color:#0f172a;">${escapeHtml(t.name)}</h4>
                        <p style="font-size:11.5px;color:#64748b;margin:0 0 6px 0;">${escapeHtml(t.address || 'Borongan City')}</p>
                        <div style="background:#f8fafc;padding:5px 7px;border-radius:6px;font-size:11px;color:#334155;border:1px solid #e2e8f0;line-height:1.4;">
                            <div><strong>Hours:</strong> ${escapeHtml(t.operating_hours || '5:00 AM - 8:00 PM')}</div>
                            <div style="margin-top:2px;"><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'Borongan Lines')}</div>
                            <div style="margin-top:2px;"><strong>Assigned:</strong> ${escapeHtml(t.assigned_staff_name || 'Staff')}</div>
                        </div>
                    </div>
                `;
                marker.bindPopup(popup);
                staffStationMarkers[t.code] = marker;
                markersGroup.push(marker);

                html += `
                    <div class="p-3 rounded-xl border border-gray-200 bg-white hover:border-primary transition cursor-pointer flex flex-col justify-between"
                         onclick="focusStaffStation('${escapeHtml(t.code)}', ${t.latitude}, ${t.longitude})">
                        <div>
                            <div class="flex justify-between items-center mb-1.5">
                                <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded" style="background:${badgeBg};color:${badgeColor}">${escapeHtml(t.code)}</span>
                                <span class="text-[10px] font-bold text-gray-500 uppercase">${typeLabel}</span>
                            </div>
                            <h5 class="font-bold text-xs text-gray-900 leading-snug mb-1">${escapeHtml(t.name)}</h5>
                            <p class="text-[11px] text-gray-500 mb-1.5"><i class="fas fa-location-dot text-primary mr-1"></i>${escapeHtml(t.address || 'Borongan City')}</p>
                            <div class="text-[11px] text-gray-600 bg-gray-50 p-1.5 rounded border border-gray-100 mb-2">
                                <div><i class="fas fa-route text-primary mr-1"></i><strong>Route:</strong> ${escapeHtml(t.routes_covered || 'City Proper')}</div>
                                <div class="mt-1"><i class="fas fa-user-shield text-emerald-600 mr-1"></i><strong>Officer:</strong> ${escapeHtml(t.assigned_staff_name || 'Assigned')}</div>
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
                staffStationsMapInstance.fitBounds(group.getBounds().pad(0.12));
            }

            if (forceRefresh) {
                showToast("Stations & checkpoints updated", "success");
            }
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

        if (page === "dashboard") refreshDashboard();
        if (page === "scan") setTimeout(() => {
            const el = $("scannerInput"); if (el) el.focus();
        }, 100);
        if (page === "today") loadToday();
        if (page === "history") loadHistory();
        if (page === "drivers") loadDrivers();
        if (page === "vehicles") loadVehicles();
        if (page === "summary") loadSummary();
        if (page === "attendance") loadAttendance();
        if (page === "stations-map") {
            initStaffStationsMap();
            setTimeout(() => {
                if (staffStationsMapInstance) staffStationsMapInstance.invalidateSize();
            }, 150);
        }
    }
    window.navigateTo = navigateTo;

    document.querySelectorAll(".sidebar-item[data-page]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.page));
    });
    document.querySelectorAll("[data-goto]").forEach((b) => {
        b.addEventListener("click", () => navigateTo(b.dataset.goto));
    });
    $("mobileToggle")?.addEventListener("click", () =>
        $("sidebar")?.classList.toggle("open")
    );
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
        if (dashboardRefreshInFlight) {
            dashboardRefreshQueued = true;
            return;
        }
        dashboardRefreshInFlight = true;
        try {
            const today = localDateKey(new Date());
            const res = await window.api("payments.php", {
                query: { action: "list", type: "FEE", from: today, to: today, limit: 1000 }
            });
            if (!res.success) {
                const tb = $("recentTable");
                if (tb) {
                    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                        '<i class="fas fa-triangle-exclamation"></i><p>' +
                        esc(res.message || "Could not load today’s transactions.") +
                        '</p><p>Check your connection and try Refresh again.</p></div></td></tr>';
                }
                setText("lastUpdatedTime", "Unavailable");
                return;
            }
            if (!res.data || !Array.isArray(res.data.transactions)) {
                throw new Error("The server returned an invalid transactions response.");
            }
            cachedTx = res.data.transactions;
            const todayTx = cachedTx;
            const ok = todayTx.filter((t) => String(t.status).toUpperCase() === "SUCCESSFUL").length;
            const fail = todayTx.length - ok;
            const total = todayTx.reduce((a, t) => a + Number(t.amount || 0), 0);

            setText("statTransactions", todayTx.length);
            setText("statSuccessful", ok);
            setText("statFailed", fail);
            setText("statFees", peso(total));
            setText("lastUpdatedTime", new Date().toLocaleTimeString("en-PH", {
                hour: "numeric", minute: "2-digit"
            }));

            const tb = $("recentTable");
            if (tb) {
                const recent = todayTx.slice(0, 8);
                if (!recent.length) {
                    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                        '<i class="fas fa-inbox"></i><p>No transactions today.</p></div></td></tr>';
                } else {
                    tb.innerHTML = recent.map((t) =>
                        '<tr>' +
                        '<td>' + esc(t.time || "") + '</td>' +
                        '<td class="ref-mono">' + esc(t.referenceNumber) + '</td>' +
                        '<td>' + esc(t.driverName || t.driverId) + '</td>' +
                        '<td>' + esc(t.vehicleType || "—") + '</td>' +
                        '<td>' + peso(t.amount) + '</td>' +
                        '<td>' + peso(t.balanceAfter) + '</td>' +
                        '<td><span class="status-badge ' +
                            (String(t.status).toUpperCase() === "SUCCESSFUL" ? "successful" : "failed") +
                            '">' + esc(t.status) + '</span></td>' +
                        '</tr>'
                    ).join("");
                }
            }
        } catch (error) {
            const tb = $("recentTable");
            if (tb) {
                tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                    '<i class="fas fa-triangle-exclamation"></i><p>' +
                    esc(error.message || "Could not load today’s transactions.") +
                    '</p><p>Check your connection and try Refresh again.</p></div></td></tr>';
            }
            setText("lastUpdatedTime", "Unavailable");
        } finally {
            dashboardRefreshInFlight = false;
            if (dashboardRefreshQueued) {
                dashboardRefreshQueued = false;
                refreshDashboard();
            }
        }
    }
    $("refreshStatsBtn")?.addEventListener("click", refreshDashboard);
    setInterval(() => {
        if (document.visibilityState === "visible" && currentPage === "dashboard") {
            refreshDashboard();
        }
    }, 30000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && currentPage === "dashboard") {
            refreshDashboard();
        }
    });
    window.addEventListener("focus", () => {
        if (currentPage === "dashboard") refreshDashboard();
    });

     function setScanStatus(text, tone) {
        const el = $("scanStatus");
        if (!el) return;
        el.textContent = text;
        el.className = "form-hint" + (tone ? " hint-" + tone : "");
    }

    async function handleScan(raw) {
        if (scanProcessing) return;
        const text = String(raw || "").trim();
        if (!text) return;

        let driverId = text;
        try {
            const obj = JSON.parse(text);
            if (obj && obj.driverId) driverId = String(obj.driverId).trim();
        } catch (e) {   }

        scanProcessing = true;
        setScanStatus("Checking " + driverId + "…");

        const res = await window.api("payments.php", {
            query: { action: "verify", driverId }
        });

        if (!res.success) {
            scanProcessing = false;
            setScanStatus(res.message, "error");
            openModal("invalidModal");
            return;
        }

        const driver = res.data.driver;
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

        currentScan = { driver, fee, balance, after };

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
        if (!el) return;
        const text = el.value.trim();
        el.value = "";
        if (text) handleScan(text);
    }

    $("scannerInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            parseScanned();
        }
    });
    $("manualScanBtn")?.addEventListener("click", parseScanned);

    function resetScan() {
        currentScan = null;
        const tr = $("terminalReady"); if (tr) tr.hidden = false;
        const vs = $("verifyStep"); if (vs) vs.hidden = true;
        const dw = $("duplicateWarning"); if (dw) dw.style.display = "none";
        setScanStatus("Ready — waiting for a driver QR.");
        const el = $("scannerInput"); if (el) el.focus();
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
        openModal("confirmModal");
    }
    window.reviewTransaction = reviewTransaction;

    function closeConfirmModal() { closeModal("confirmModal"); }
    window.closeConfirmModal = closeConfirmModal;

    $("processTransactionBtn")?.addEventListener("click", async () => {
        if (!currentScan) return;
        const btn = $("processTransactionBtn");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';
        }

        const res = await window.api("payments.php", {
            method: "POST",
            body: { action: "collect", driverId: currentScan.driver.driverId }
        });

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm &amp; Process';
        }
        closeConfirmModal();

        if (res.success) {
            const receipt = res.data.receipt;
            lastTransaction = {
                transactionId: receipt.referenceNumber,
                driver: currentScan.driver,
                fee: receipt.amount,
                prevBalance: receipt.previousBalance,
                newBalance: receipt.balanceAfter
            };
            setText("scRef", receipt.referenceNumber);
            setText("scDriver", currentScan.driver.fullName || "—");
            setText("scVehicle", currentScan.driver.vehicleType || "—");
            setText("scFeeBig", peso(receipt.amount));
            setText("scPrev", peso(receipt.previousBalance));
            setText("scAfter", peso(receipt.balanceAfter));
            setText("scStaff", user ? (user.fullName || user.username) : "Staff");
            openModal("successModal");
            toast("Transaction successful — " + peso(receipt.amount) + " deducted.", "success");

            currentScan = null;
            const tr = $("terminalReady"); if (tr) tr.hidden = false;
            const vs = $("verifyStep"); if (vs) vs.hidden = true;
            setScanStatus("Paid — ready for the next driver.", "ok");
            refreshDashboard();
            return;
        }

        if (res.code === "DUPLICATE_SCAN") {
            if (confirm(res.message + "\n\nCharge again?")) {
                const res2 = await window.api("payments.php", {
                    method: "POST",
                    body: {
                        action: "collect",
                        driverId: currentScan.driver.driverId,
                        confirmDuplicate: true
                    }
                });
                if (res2.success) {
                    const r = res2.data.receipt;
                    lastTransaction = {
                        transactionId: r.referenceNumber,
                        driver: currentScan.driver,
                        fee: r.amount,
                        prevBalance: r.previousBalance,
                        newBalance: r.balanceAfter
                    };
                    setText("scRef", r.referenceNumber);
                    setText("scDriver", currentScan.driver.fullName || "—");
                    setText("scVehicle", currentScan.driver.vehicleType || "—");
                    setText("scFeeBig", peso(r.amount));
                    setText("scPrev", peso(r.previousBalance));
                    setText("scAfter", peso(r.balanceAfter));
                    setText("scStaff", user ? (user.fullName || user.username) : "Staff");
                    openModal("successModal");
                    currentScan = null;
                    const tr = $("terminalReady"); if (tr) tr.hidden = false;
                    const vs = $("verifyStep"); if (vs) vs.hidden = true;
                    refreshDashboard();
                }
            }
            return;
        }

        if (res.code === "INSUFFICIENT_BALANCE") {
            setText("inDriver", currentScan.driver.fullName || "—");
            setText("inBalance", peso(res.data ? res.data.balance : 0));
            setText("inFee", peso(res.data ? res.data.fee : 0));
            setText("inShortage", peso(res.data ? res.data.shortBy : 0));
            openModal("insufficientModal");
            return;
        }

        toast(res.message || "Transaction failed.", "error");
    });

    window.scanNextDriver = function () {
        closeModal("successModal");
        resetScan();
        navigateTo("scan");
    };
    window.backToDashboardFromSuccess = function () {
        closeModal("successModal");
        resetScan();
        navigateTo("dashboard");
    };
    window.closeInvalidModal = function () {
        closeModal("invalidModal");
        resetScan();
    };
    window.closeInactiveModal = function () {
        closeModal("inactiveModal");
        resetScan();
    };
    window.scanNextDriverFromInsufficient = function () {
        closeModal("insufficientModal");
        resetScan();
        navigateTo("scan");
    };

     $("printReceiptBtn")?.addEventListener("click", () => {
        if (!lastTransaction) {
            toast("No transaction to print.", "warning");
            return;
        }
        const info = lastTransaction;
        const d = info.driver;
        const now = new Date();
        setText("rctTxn", info.transactionId || "—");
        setText("rctDate", now.toLocaleDateString("en-PH", {
            year: "numeric", month: "long", day: "numeric"
        }));
        setText("rctTime", now.toLocaleTimeString("en-PH", {
            hour: "numeric", minute: "2-digit"
        }));
        setText("rctDriver", d.fullName || "—");
        setText("rctDriverId", d.driverId || "—");
        setText("rctVehicle", d.vehicleType || "—");
        setText("rctBody", d.bodyNumber || "—");
        setText("rctPlate", d.plateNumber || "—");
        setText("rctFee", peso(info.fee));
        setText("rctAfter", peso(info.newBalance));
        setText("rctStaff", user ? (user.username || "Staff") : "Staff");

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
        const search = ($("todaySearch")?.value || "").toLowerCase();
        const vehicle = $("todayVehicle")?.value || "";
        const status = ($("todayStatus")?.value || "").toUpperCase();
        const today = localDateKey(new Date());

        let rows = cachedTx.filter((t) => (t.date || "").startsWith(today));
        if (search) {
            rows = rows.filter((t) =>
                (t.driverName || "").toLowerCase().includes(search) ||
                (t.referenceNumber || "").toLowerCase().includes(search)
            );
        }
        if (vehicle) rows = rows.filter((t) => t.vehicleType === vehicle);
        if (status) rows = rows.filter((t) => String(t.status).toUpperCase() === status);

        const tb = $("todayTable");
        if (!tb) return;
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="6"><div class="empty-state">' +
                '<i class="fas fa-inbox"></i><p>No transactions match.</p></div></td></tr>';
        } else {
            tb.innerHTML = rows.map((t) =>
                '<tr>' +
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
        const q = ($("histSearch")?.value || "").trim();
        const from = $("histFrom")?.value || "";
        const to = $("histTo")?.value || "";
        const res = await window.api("payments.php", {
            query: { action: "list", type: "FEE", q, from, to, limit: 500 }
        });
        if (!res.success) return;
        const rows = res.data.transactions || [];
        const tb = $("historyTable");
        if (!tb) return;
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="8"><div class="empty-state">' +
                '<i class="fas fa-clock-rotate-left"></i><p>No transactions.</p></div></td></tr>';
        } else {
            tb.innerHTML = rows.map((t) =>
                '<tr>' +
                '<td>' + esc(t.date) + ' ' + esc(t.time) + '</td>' +
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
        }
        setText("historyCount", rows.length + " record" + (rows.length === 1 ? "" : "s"));
    }

    $("histSearch")?.addEventListener("input", () => {
        clearTimeout(window.__hT);
        window.__hT = setTimeout(loadHistory, 350);
    });
    $("histFrom")?.addEventListener("change", loadHistory);
    $("histTo")?.addEventListener("change", loadHistory);
    $("histClearBtn")?.addEventListener("click", () => {
        if ($("histSearch")) $("histSearch").value = "";
        if ($("histFrom")) $("histFrom").value = "";
        if ($("histTo")) $("histTo").value = "";
        loadHistory();
    });

    $("exportCsvBtn")?.addEventListener("click", () => {
        const rows = cachedTx.filter((t) => String(t.type).toUpperCase() === "FEE");
        if (!rows.length) {
            toast("Nothing to export.", "warning");
            return;
        }
        const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
        const lines = [["Date", "Time", "Reference", "Driver", "Vehicle",
            "Plate", "Fee", "Previous", "Balance After", "Status"].map(cell).join(",")];
        rows.forEach((t) => lines.push([
            t.date, t.time, t.referenceNumber, t.driverName, t.vehicleType,
            t.plateNumber, t.amount, t.previousBalance, t.balanceAfter, t.status
        ].map(cell).join(",")));
        const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
            type: "text/csv;charset=utf-8"
        });
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
            tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">' +
                '<i class="fas fa-id-card"></i><p>No drivers found.</p></div></td></tr>';
            return;
        }
        tb.innerHTML = res.data.drivers.map((d) =>
            '<tr>' +
            '<td class="ref-mono">' + esc(d.driverId) + '</td>' +
            '<td>' + esc(d.fullName) + '</td>' +
            '<td>' + esc(d.vehicleType || "—") + '</td>' +
            '<td>' + esc(d.bodyNumber || "—") + '</td>' +
            '<td class="ref-mono">' + esc(d.plateNumber || "—") + '</td>' +
            '<td><span class="status-badge ' +
                (/^active$/i.test(d.status) ? "successful" : "failed") +
                '">' + esc(d.status || "—") + '</span></td>' +
            '<td><button class="btn-outline btn-sm" data-report="' +
                esc(d.driverId) + '"><i class="fas fa-flag"></i> Report</button></td>' +
            '</tr>'
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
                    body: {
                        action: "Reported Information Issue",
                        recordType: "DRIVER",
                        recordRef: driverId,
                        details: "Staff reported"
                    }
                });
                toast(
                    res.success ? "Report sent to Admin." : "Could not send.",
                    res.success ? "success" : "error"
                );
            }
        });
    }

     async function loadVehicles() {
        const res = await window.api("drivers.php");
        const tb = $("vehicleTable");
        if (!tb) return;
        if (!res.success) {
            tb.innerHTML = '<tr><td colspan="5"><div class="empty-state">' +
                '<p>Could not load.</p></div></td></tr>';
            return;
        }
        const search = ($("vehicleSearch")?.value || "").toLowerCase();
        let drivers = res.data.drivers.filter((d) => d.plateNumber);
        if (search) {
            drivers = drivers.filter((d) =>
                (d.plateNumber || "").toLowerCase().includes(search) ||
                (d.vehicleType || "").toLowerCase().includes(search)
            );
        }
        if (!drivers.length) {
            tb.innerHTML = '<tr><td colspan="5"><div class="empty-state">' +
                '<i class="fas fa-car"></i><p>No vehicles.</p></div></td></tr>';
            return;
        }
        tb.innerHTML = drivers.map((d) =>
            '<tr>' +
            '<td>' + esc(d.vehicleType || "—") + '</td>' +
            '<td>' + esc(d.bodyNumber || "—") + '</td>' +
            '<td class="ref-mono">' + esc(d.plateNumber || "—") + '</td>' +
            '<td>' + esc(d.fullName || "—") + '</td>' +
            '<td><span class="status-badge ' +
                (/^active$/i.test(d.status) ? "successful" : "failed") +
                '">' + esc(d.status) + '</span></td>' +
            '</tr>'
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

        setText("summaryDate", new Date().toLocaleDateString("en-PH", {
            month: "long", day: "numeric", year: "numeric"
        }));
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
            tb.innerHTML = '<tr><td colspan="3"><div class="empty-state">' +
                '<i class="fas fa-truck"></i><p>No transactions today.</p></div></td></tr>';
        } else {
            tb.innerHTML = entries.map(([k, v]) =>
                '<tr><td>' + esc(k) + '</td><td>' + v.count + '</td><td>' + peso(v.total) + '</td></tr>'
            ).join("");
        }
    }
    $("summaryPrintBtn")?.addEventListener("click", () => window.print());

     async function loadAttendance() {
        const res = await window.api("attendance.php", {
            query: { action: "list", date: localDateKey(new Date()) }
        });
        if (!res || !res.success) return;
        const myName = (user ? (user.fullName || user.username || "") : "").toLowerCase();
        const mine = (res.data.records || []).find((r) =>
            (r.name || "").toLowerCase() === myName
        );
        if (!mine) return;
        setText("attTimeIn", mine.timeIn);
        setText("attTimeOut", mine.timeOut);
        const s = (mine.status || "").toUpperCase();
        const cls = s === "ON TIME" ? "successful" : s === "LATE" ? "pending" : "failed";
        const el = $("attStatus");
        if (el) el.innerHTML = '<span class="status-badge ' + cls + '">' + esc(s || "—") + '</span>';
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

     $("testScannerBtn")?.addEventListener("click", () => {
        const el = $("scannerInput");
        if (el) {
            el.focus();
            el.value = "";
            el.placeholder = "Test: scan any QR";
        }
        toast("Scanner ready — scan any QR to test.", "success");
    });
    $("testPrinterBtn")?.addEventListener("click", () => {
        setText("rctTxn", "TEST-" + Date.now());
        setText("rctDate", new Date().toLocaleDateString("en-PH", {
            year: "numeric", month: "long", day: "numeric"
        }));
        setText("rctTime", new Date().toLocaleTimeString("en-PH", {
            hour: "numeric", minute: "2-digit"
        }));
        setText("rctDriver", "Test Driver");
        setText("rctDriverId", "TEST-000");
        setText("rctVehicle", "Tricycle");
        setText("rctBody", "0000");
        setText("rctPlate", "TEST-0000");
        setText("rctFee", "₱5.00");
        setText("rctAfter", "₱95.00");
        setText("rctStaff", user ? (user.username || "Staff") : "Staff");
        const area = $("receiptPrintArea");
        if (area) area.style.display = "block";
        setTimeout(() => {
            window.print();
            setTimeout(() => { if (area) area.style.display = "none"; }, 500);
        }, 100);
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
        const roleName = { staff: "Terminal Staff", admin: "Administrator" }[u.role] || u.role;
        setText("stationTitle", roleName + " Dashboard");
        setText("greetingName", u.fullName || u.username || "User");
        setText("sidebarUser", (u.fullName || u.username || "") + " · " + roleName);
        setText("profName", u.fullName || u.username || "");
        setText("profUsername", "@" + (u.username || ""));
        setText("profRole", roleName);
        document.title = "Borongan Transport · " + roleName + " Panel";

        function tickShift() {
            const mins = Math.floor((Date.now() - shiftStart) / 60000);
            setText("shiftDuration",
                mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m"
            );
        }
        tickShift();
        setInterval(tickShift, 30000);

        refreshDashboard();
        loadAttendance();
        setTimeout(() => { const el = $("scannerInput"); if (el) el.focus(); }, 500);
    });

     document.addEventListener("click", (e) => {
        if (currentPage === "scan" && !e.target.closest("input, button, select, textarea, a")) {
            setTimeout(() => { const el = $("scannerInput"); if (el) el.focus(); }, 100);
        }
    });
})();