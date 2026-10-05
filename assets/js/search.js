/* ============================================================
   SITE SEARCH
   Makes the existing .gov-search form work as a live search.
   Requires: search-index.js loaded first.
   ============================================================ */
(function () {
    "use strict";

    function init() {
        var index = window.SITE_INDEX || [];
        if (!index.length) return;

         var form = document.querySelector(".gov-search");
        if (!form) return;

        var input = form.querySelector("input[type='search']");
        if (!input) return;

         var dropdown = document.createElement("div");
        dropdown.className = "gov-search-dropdown";
        dropdown.setAttribute("role", "listbox");
        form.style.position = "relative";
        form.appendChild(dropdown);

        function hide() {
            dropdown.classList.remove("show");
            dropdown.innerHTML = "";
        }

        function escapeHtml(str) {
            return String(str || "").replace(/[&<>"']/g, function (c) {
                return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
            });
        }

        function search(query) {
            var q = (query || "").trim().toLowerCase();
            if (q.length < 2) { hide(); return; }

            var words = q.split(/\s+/);
            var results = index.map(function (page) {
                var haystack = (
                    page.title + " " +
                    page.description + " " +
                    (page.keywords || []).join(" ")
                ).toLowerCase();

                var score = 0;
                words.forEach(function (w) {
                    if (haystack.indexOf(w) !== -1) score++;
                });
                return { page: page, score: score };
            })
            .filter(function (r) { return r.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, 8);

            if (!results.length) {
                dropdown.innerHTML =
                    '<div class="gov-search-empty">No results for "' +
                    escapeHtml(query) + '"</div>';
                dropdown.classList.add("show");
                return;
            }

            dropdown.innerHTML = results.map(function (r) {
                return (
                    '<a class="gov-search-result" href="' + escapeHtml(r.page.url) + '">' +
                        '<strong>' + escapeHtml(r.page.title) + '</strong>' +
                        '<span>' + escapeHtml(r.page.description) + '</span>' +
                    '</a>'
                );
            }).join("");
            dropdown.classList.add("show");
        }

        input.addEventListener("input", function () {
            search(input.value);
        });

        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var first = dropdown.querySelector(".gov-search-result");
            if (first) {
                window.location.href = first.getAttribute("href");
            } else {
                search(input.value);
            }
        });

        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                var first = dropdown.querySelector(".gov-search-result");
                if (first) {
                    e.preventDefault();
                    window.location.href = first.getAttribute("href");
                }
            }
            if (e.key === "Escape") hide();
        });

        document.addEventListener("click", function (e) {
            if (!form.contains(e.target)) hide();
        });

        dropdown.addEventListener("mousedown", function (e) {
            e.preventDefault();
        });
    }

    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
})();