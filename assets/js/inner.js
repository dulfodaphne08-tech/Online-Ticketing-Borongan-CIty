/* ============================================================
   Inner pages — shared script
   - Mobile nav toggle
   - Auto-highlight the active nav item
   ============================================================ */
(function () {
    "use strict";

     const toggle = document.getElementById("mobileToggle");
    const menu = document.getElementById("mainNav");
    if (toggle && menu) {
        toggle.addEventListener("click", function () {
            menu.classList.toggle("open");
        });
        menu.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= 1023) menu.classList.remove("open");
            });
        });
    }

     const path = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".gov-nav-item").forEach((item) => {
        const href = item.getAttribute("href");
        if (href === path) item.classList.add("active");
        else item.classList.remove("active");
    });
})();