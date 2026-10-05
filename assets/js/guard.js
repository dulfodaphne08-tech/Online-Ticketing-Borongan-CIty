/* ============================================================
   assets/js/guard.js — bulletproof session guard + API helper.
   Loaded on every dashboard. Handles:
     1. window.api(path, {method, body, query})
     2. Role-based redirect before the page renders
     3. window.authReady promise (fires ONCE per page load)
   ============================================================ */
(function () {
    "use strict";

     if (window.__guardLoaded === true) {
        console.warn("[Guard] Already loaded — skipping duplicate.");
        return;
    }
    window.__guardLoaded = true;

    const script = document.currentScript;
    const roles = ((script && script.dataset.role) || "").split(/[\s,]+/).filter(Boolean);

    const LANDING = {
        admin:   "admin-dashboard.html",
        cashier: "cashier-dashboard.html",
        staff:   "staff-dashboard.html",
        driver:  "driver-dashboard.html",
    };

    function landingPageFor(role) {
        return LANDING[role] || "login.html";
    }

     async function api(path, opts) {
        const o = opts || {};
        const url = new URL("api/" + path, window.location.href);
        if (o.query) {
            Object.keys(o.query).forEach(function (k) {
                const v = o.query[k];
                if (v !== undefined && v !== null && v !== "") {
                    url.searchParams.set(k, v);
                }
            });
        }

        const init = {
            method: o.method || "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: {},
        };
        if (o.body !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(o.body);
        }

        let res;
        try {
            res = await fetch(url, init);
        } catch (e) {
            return {
                success: false,
                status: 0,
                network: true,
                data: null,
                message: "Cannot reach the server. Please check your connection.",
            };
        }

        let json = null;
        try { json = await res.json(); } catch (e) { /* not JSON */ }
        if (!json || typeof json !== "object") {
            return {
                success: false,
                status: res.status,
                data: null,
                message: "Unexpected server response (" + res.status + ").",
            };
        }

        if (res.status === 401 && roles.length && !o.allow401) {
            window.location.replace("login.html?expired=1");
        }

        json.status = res.status;
        json.message = json.message || json.error || "";
        return json;
    }

    async function logoutAndRedirect() {
        try { await api("logout.php", { method: "POST", allow401: true }); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}
        window.location.replace("login.html");
    }

     window.api = api;
    window.landingPageFor = landingPageFor;
    window.logoutAndRedirect = logoutAndRedirect;

     if (!roles.length) {
        window.authReady = Promise.resolve(null);
        window.CURRENT_USER = null;
        return;
    }

     document.documentElement.style.visibility = "hidden";

     const revealTimeout = setTimeout(function () {
        document.documentElement.style.visibility = "";
    }, 4000);

     window.authReady = (async function () {
        const res = await api("session.php", { allow401: true });

        if (!res.success || !res.data || !res.data.user) {
            clearTimeout(revealTimeout);
            window.location.replace("login.html");
            return null;
        }

        const user = res.data.user;

        if (roles.indexOf(user.role) === -1) {
            clearTimeout(revealTimeout);
            window.location.replace(landingPageFor(user.role));
            return null;
        }

        window.CURRENT_USER = user;
        document.documentElement.style.visibility = "";
        clearTimeout(revealTimeout);

        try {
            document.dispatchEvent(new CustomEvent("auth:ready", { detail: user }));
        } catch (e) {}

        return user;
    })();
})();