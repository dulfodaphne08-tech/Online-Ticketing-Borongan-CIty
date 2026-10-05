/* ============================================================
   BORONGAN TRANSPORT — Unified Login (admin · cashier · staff · driver)
   The server decides the role; we just follow data.redirect.
   Needs assets/js/guard.js (for window.api) loaded first.
   ============================================================ */
(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const usernameField = $("username");
    const passwordField = $("password");
    const loginBtn = $("loginBtn");
    const msgDiv = $("formMsg");
    const successDiv = $("successMsg");
    const successText = $("successText");
    const rememberMe = $("rememberMe");

    const REMEMBER_KEY = "bctt_remember_username";

     function store(key, value) {
        try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) {   }
    }
    function read(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

     ["borongan_driver_session", "current_driver", "cashier_logged_in", "cashier_name", "cashier_username",
     "staff_logged_in", "staff_name", "staff_username", "admin_logged_in", "admin_name", "admin_username"]
        .forEach((k) => store(k, null));
    try { sessionStorage.removeItem("borongan_session"); } catch (e) {  }

     window.api("session.php").then((res) => {
        if (res.success && res.data && res.data.redirect) window.location.replace(res.data.redirect);
    });

     const params = new URLSearchParams(window.location.search);
    if (params.has("registered")) showBanner("Account created! You can now log in.");
    if (params.has("expired")) showError("Your session expired. Please log in again.");

    function showBanner(text) {
        if (!successDiv) return;
        successText.textContent = text;
        successDiv.classList.add("show");
        setTimeout(() => successDiv.classList.remove("show"), 6000);
    }

    const remembered = read(REMEMBER_KEY);
    if (remembered) {
        usernameField.value = remembered;
        if (rememberMe) rememberMe.checked = true;
        passwordField.focus();
    } else {
        usernameField.focus();
    }

     function escapeHtml(str) {
        return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    function showError(msg) {
        msgDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + escapeHtml(msg);
        msgDiv.className = "form-msg is-error";
    }
    function showInfo(msg) {
        msgDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + escapeHtml(msg);
        msgDiv.className = "form-msg is-ok";
    }
    function clearMessage() {
        msgDiv.innerHTML = "";
        msgDiv.className = "form-msg";
    }

     function setupToggle(btn, input) {
        if (!btn || !input) return;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
            const icon = btn.querySelector("i");
            if (icon) icon.className = show ? "fas fa-eye-slash" : "fas fa-eye";
        });
    }
    setupToggle($("togglePass"), passwordField);
    setupToggle($("toggleResetPass"), $("resetNewPass"));
    setupToggle($("toggleResetConfirm"), $("resetConfirmPass"));

     let busy = false;

    async function handleLogin(e) {
        if (e) e.preventDefault();
        if (busy) return;
        clearMessage();

        const username = usernameField.value.trim();
        const password = passwordField.value;
        if (!username) { showError("Please enter your username or email."); usernameField.focus(); return; }
        if (!password) { showError("Please enter your password."); passwordField.focus(); return; }

        busy = true;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<span class="spinner"></span> Signing in…';

        const res = await window.api("login.php", { method: "POST", body: { username, password } });

        if (!res.success) {
            showError(res.message || "Login failed. Please try again.");
            if (res.status === 401) { passwordField.value = ""; passwordField.focus(); }
            busy = false;
            loginBtn.disabled = false;
            loginBtn.textContent = "LOGIN";
            return;
        }

        store(REMEMBER_KEY, rememberMe && rememberMe.checked ? username : null);
        showInfo(res.message || "Welcome!");
        window.location.replace(res.data.redirect);
    }

    $("loginForm").addEventListener("submit", handleLogin);

    [usernameField, passwordField].forEach((input) => input.addEventListener("input", () => {
        if (msgDiv.classList.contains("is-error")) clearMessage();
    }));

     const forgotModal = $("forgotModal");
    const resetUser = $("resetUser");
    const resetLicense = $("resetLicense");
    const resetNewPass = $("resetNewPass");
    const resetConfirmPass = $("resetConfirmPass");
    const modalMsg = $("modalMsg");
    const modalSend = $("modalSend");
    const resetConfirmMatch = $("resetConfirmMatch");

    function setModalMsg(text, ok) {
        modalMsg.innerHTML = text ? '<i class="fas ' + (ok ? "fa-check-circle" : "fa-exclamation-circle") + '"></i> ' + escapeHtml(text) : "";
        modalMsg.className = "modal-message" + (text ? (ok ? " is-ok" : " is-error") : "");
    }

    function openForgotModal() {
        forgotModal.classList.add("active");
        resetUser.value = usernameField.value.trim();
        [resetLicense, resetNewPass, resetConfirmPass].forEach((i) => { i.value = ""; });
        resetConfirmMatch.textContent = "";
        setModalMsg("");
        setTimeout(() => (resetUser.value ? resetLicense : resetUser).focus(), 50);
    }
    function closeForgotModal() {
        forgotModal.classList.remove("active");
        modalSend.disabled = false;
        modalSend.textContent = "Reset Password";
    }

    $("forgotBtn").addEventListener("click", (e) => { e.preventDefault(); openForgotModal(); });
    $("modalCancel").addEventListener("click", (e) => { e.preventDefault(); closeForgotModal(); });
    forgotModal.addEventListener("click", (e) => { if (e.target === forgotModal) closeForgotModal(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && forgotModal.classList.contains("active")) closeForgotModal();
    });

    function checkMatch() {
        const a = resetNewPass.value, b = resetConfirmPass.value;
        if (!b) { resetConfirmMatch.textContent = ""; return; }
        const same = a === b;
        resetConfirmMatch.textContent = same ? "Passwords match" : "Passwords do not match yet";
        resetConfirmMatch.style.color = same ? "#15803d" : "#b91c1c";
    }
    resetNewPass.addEventListener("input", checkMatch);
    resetConfirmPass.addEventListener("input", checkMatch);

    async function handleReset(e) {
        if (e) e.preventDefault();
        const username = resetUser.value.trim();
        const licenseNo = resetLicense.value.trim();
        const newPassword = resetNewPass.value;
        const confirmPassword = resetConfirmPass.value;

        if (!username) { setModalMsg("Please enter your username."); resetUser.focus(); return; }
        if (!licenseNo) { setModalMsg("Please enter your driver's license number."); resetLicense.focus(); return; }
        if (newPassword.length < 8) { setModalMsg("Password must be at least 8 characters."); resetNewPass.focus(); return; }
        if (newPassword !== confirmPassword) { setModalMsg("Passwords do not match."); resetConfirmPass.focus(); return; }

        modalSend.disabled = true;
        modalSend.innerHTML = '<span class="spinner"></span> Resetting…';
        const res = await window.api("reset_password.php", {
            method: "POST", body: { username, licenseNo, newPassword, confirmPassword },
        });
        modalSend.disabled = false;
        modalSend.textContent = "Reset Password";

        if (res.success) {
            setModalMsg(res.message || "Password reset successfully.", true);
            usernameField.value = username;
            passwordField.value = "";
            setTimeout(() => { closeForgotModal(); passwordField.focus(); }, 1500);
        } else {
            setModalMsg(res.message || "Failed to reset password.");
        }
    }

    modalSend.addEventListener("click", handleReset);
    [resetUser, resetLicense, resetNewPass, resetConfirmPass].forEach((input) =>
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleReset(e); }));
})();