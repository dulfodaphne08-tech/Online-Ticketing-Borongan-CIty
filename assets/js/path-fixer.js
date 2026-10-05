/* ============================================================
   PATH FIXER
   ------------------------------------------------------------
   Automatically fixes asset paths for every HTML page inside
   the bctt/index/ folder (including highlights/ and notices/).

   ============================================================ */
(function () {
    "use strict";

    
    const path = window.location.pathname.replace(/\\/g, "/");

     const idx = path.indexOf("/index/");
    const afterIndex = idx >= 0 ? path.slice(idx + "/index/".length) : "";

     const depth = (afterIndex.match(/\//g) || []).length;

     const toRoot = "../".repeat(depth + 1);

     const prefix = toRoot;

     function fixPath(value) {
        if (!value) return null;

         if (/^(https?:)?\/\//i.test(value)) return null;
        if (value.startsWith("data:")) return null;
        if (value.startsWith("mailto:")) return null;
        if (value.startsWith("tel:")) return null;
        if (value.startsWith("#")) return null;

         if (value.startsWith("../")) return null;

         if (value.startsWith("assets/") || value.startsWith("images/")) {
            return prefix + value;
        }
        return null;
    }

    function process(selector, attr) {
        document.querySelectorAll(selector).forEach(function (el) {
            const v = el.getAttribute(attr);
            const fixed = fixPath(v);
            if (fixed) el.setAttribute(attr, fixed);
        });
    }

     process("link[href]", "href");
    process("script[src]", "src");
    process("img[src]", "src");
    process("source[src]", "src");
    process("video[poster]", "poster");

     document.addEventListener("DOMContentLoaded", function () {
        process("link[href]", "href");
        process("script[src]", "src");
        process("img[src]", "src");
        process("source[src]", "src");
        process("video[poster]", "poster");
    });

     window.__ASSET_PREFIX__ = prefix;
})();