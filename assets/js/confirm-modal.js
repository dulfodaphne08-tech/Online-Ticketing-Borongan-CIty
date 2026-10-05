/* ============================================================
   assets/js/confirm-modal.js — confirm pop-up built on the native
   HTML5 <dialog> element (replaces the browser's confirm() box).
   Styles: assets/css/confirm-modal.css

   ConfirmModal.show({ title, message, confirmText, cancelText, onConfirm, onCancel })
   Also returns a Promise<boolean> (true = confirmed).
   Esc or clicking outside the box = Cancel.
   ============================================================ */
(function () {
    "use strict";

    function getDialog() {
        let dialog = document.getElementById("nativeConfirmDialog");
        if (dialog) return dialog;

        dialog = document.createElement("dialog");
        dialog.id = "nativeConfirmDialog";
        dialog.className = "confirm-dialog-modal";
        dialog.setAttribute("aria-labelledby", "nativeConfirmTitle");
        dialog.setAttribute("aria-describedby", "nativeConfirmMsg");
        dialog.innerHTML =
            '<form method="dialog" class="confirm-dialog-content">' +
            '  <h3 id="nativeConfirmTitle" class="confirm-dialog-title"></h3>' +
            '  <p id="nativeConfirmMsg" class="confirm-dialog-msg"></p>' +
            '  <div class="confirm-dialog-actions">' +
            '    <button type="submit" value="cancel" class="confirm-dialog-btn confirm-dialog-btn-cancel"></button>' +
            '    <button type="submit" value="confirm" class="confirm-dialog-btn confirm-dialog-btn-confirm"></button>' +
            "  </div>" +
            "</form>";
        document.body.appendChild(dialog);

         dialog.addEventListener("click", function (e) {
            if (e.target === dialog) dialog.close("cancel");
        });
        return dialog;
    }

    function show(opts) {
        const o = opts || {};
        const dialog = getDialog();
        dialog.querySelector("#nativeConfirmTitle").textContent = o.title || "Are you sure?";
        dialog.querySelector("#nativeConfirmMsg").textContent = o.message || "";
        dialog.querySelector(".confirm-dialog-btn-cancel").textContent = o.cancelText || "Cancel";
        dialog.querySelector(".confirm-dialog-btn-confirm").textContent = o.confirmText || "Confirm";
        dialog.returnValue = "";

        return new Promise(function (resolve) {
            dialog.addEventListener("close", function onClose() {
                if (dialog.open) return;   
                dialog.removeEventListener("close", onClose);
                const ok = dialog.returnValue === "confirm";
                if (ok && typeof o.onConfirm === "function") o.onConfirm();
                if (!ok && typeof o.onCancel === "function") o.onCancel();
                resolve(ok);
            });
            if (dialog.open) dialog.close();
            dialog.showModal();
            dialog.querySelector(".confirm-dialog-btn-confirm").focus();
        });
    }

    window.ConfirmModal = { show: show };
})();
