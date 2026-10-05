/* ============================================================
   DRIVER LOAD PAGE — JS
   ============================================================ */

let driverSession = null;

document.addEventListener("DOMContentLoaded", async function () {

     let session = null;
    try {
        session = JSON.parse(localStorage.getItem("current_driver") || "null");
    } catch {}

    if (!session) {
        window.location.href = "login.html";
        return;
    }
    driverSession = session;

     document.getElementById("walletDriver").textContent = driverSession.fullName || driverSession.fullname || "—";
    document.getElementById("walletPlate").textContent = driverSession.plateNumber || driverSession.platenumber || "—";

    await loadBalance();
    await loadTransactions();

     document.querySelectorAll(".quick-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.getElementById("requestAmount").value = btn.dataset.amount;
        });
    });
});

 async function loadBalance() {
    try {
        const res = await fetch("api/driver_balance.php", { credentials: "include" });
        const data = await res.json();

        if (data.success) {
            document.getElementById("walletBalance").textContent =
                "₱" + Number(data.balance || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
    } catch (e) { console.error("Balance error:", e); }
}
 async function loadTransactions() {
    const tbody = document.getElementById("txnTableBody");
    try {
        const driverId = driverSession.driverId || driverSession.driverid || "";
        const res = await fetch("api/driver_transactions.php?driverId=" + encodeURIComponent(driverId), { credentials: "include" });
        const data = await res.json();

        if (!data.success || !data.transactions || !data.transactions.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="txn-empty">No transactions yet</td></tr>';
            return;
        }

        tbody.innerHTML = data.transactions.map(function (t) {
            const dt = new Date(t.createdat);
            const date = dt.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
            const amount = "₱" + Number(t.amount).toFixed(2);
            const balance = "₱" + Number(t.balanceafter).toFixed(2);
            const isLoad = t.type === "LOAD";
            const badge = isLoad
                ? '<span class="txn-badge txn-badge-load">+ LOAD</span>'
                : '<span class="txn-badge txn-badge-fee">− FEE</span>';
            const amountColor = isLoad ? "#16a34a" : "#b22234";
            const amountPrefix = isLoad ? "+" : "−";

            return '<tr>' +
                '<td>' + date + '</td>' +
                '<td>' + badge + '</td>' +
                '<td style="font-weight:700;color:' + amountColor + ';font-family:Courier New,monospace;">' + amountPrefix + amount + '</td>' +
                '<td style="font-family:Courier New,monospace;">' + balance + '</td>' +
                '<td style="font-family:Courier New,monospace;font-size:0.78rem;">' + (t.referencenumber || "—") + '</td>' +
                '</tr>';
        }).join("");
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="txn-empty">Failed to load</td></tr>';
    }
}

window.refreshTransactions = async function () {
    await loadBalance();
    await loadTransactions();
};

 window.openLoadRequest = function () {
    document.getElementById("requestAmount").value = "";
    document.getElementById("requestNote").value = "";
    document.getElementById("requestMsg").textContent = "";
    document.getElementById("loadRequestModal").classList.add("active");
};

window.closeLoadRequest = function () {
    document.getElementById("loadRequestModal").classList.remove("active");
};

window.submitLoadRequest = function () {
    const amount = parseFloat(document.getElementById("requestAmount").value);
    const note = document.getElementById("requestNote").value.trim();
    const msg = document.getElementById("requestMsg");

    if (!amount || amount <= 0) {
        msg.textContent = "Please enter a valid amount.";
        msg.style.color = "#b22234";
        return;
    }
    if (amount > 50000) {
        msg.textContent = "Maximum load is ₱50,000.";
        msg.style.color = "#b22234";
        return;
    }

     closeLoadRequest();

     document.getElementById("slipDriver").textContent = driverSession.fullName || driverSession.fullname || "—";
    document.getElementById("slipDriverId").textContent = driverSession.driverId || driverSession.driverid || "—";
    document.getElementById("slipVehicle").textContent = driverSession.vehicleType || driverSession.vehicletype || "—";
    document.getElementById("slipPlate").textContent = driverSession.plateNumber || driverSession.platenumber || "—";
    document.getElementById("slipAmount").textContent = "₱" + amount.toFixed(2);
    document.getElementById("slipDate").textContent = new Date().toLocaleDateString();
    document.getElementById("slipTime").textContent = new Date().toLocaleTimeString();

     document.getElementById("slipModal").classList.add("active");
};

window.closeSlipModal = function () {
    document.getElementById("slipModal").classList.remove("active");
};

window.printSlip = function () {
    const content = document.getElementById("slipContent").innerHTML;
    const win = window.open("", "_blank", "width=400,height=600");
    win.document.write(
        '<html><head><title>Load Request Slip</title>' +
        '<style>body{font-family:"Courier New",monospace;padding:20px;max-width:340px;margin:0 auto;}' +
        '.slip{border:2px dashed #333;border-radius:8px;padding:16px;}' +
        '.slip-header{text-align:center;border-bottom:2px dashed #333;padding-bottom:10px;margin-bottom:10px;}' +
        '.slip-title{font-weight:800;font-size:1.1rem;letter-spacing:1px;}' +
        '.slip-subtitle{font-size:0.7rem;letter-spacing:2px;color:#555;margin-top:2px;}' +
        '.slip-body{font-size:0.85rem;}' +
        '.slip-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ccc;}' +
        '.slip-row span:first-child{color:#555;}' +
        '.slip-row span:last-child{font-weight:bold;text-align:right;}' +
        '.slip-row-total{border-top:2px solid #222;border-bottom:2px solid #222;margin:8px 0;padding:8px 0;font-size:1rem;}' +
        '.slip-row-total span:last-child{color:#b22234;font-size:1.15rem;}' +
        '.slip-footer{text-align:center;margin-top:14px;padding-top:10px;border-top:2px dashed #333;font-size:0.78rem;color:#555;}' +
        '</style></head><body>' + content +
        '<script>window.onload=function(){setTimeout(function(){window.print();setTimeout(function(){window.close();},300);},200);};<\/script></body></html>'
    );
    win.document.close();
};