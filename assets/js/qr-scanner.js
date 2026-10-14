(function () {
    "use strict";

     function parse(raw) {
        const text = String(raw || "").trim();
        if (!text) return null;
        try {
            const json = JSON.parse(text);
            if (json && typeof json === "object" && json.driverId) {
                return {
                    driverId: String(json.driverId).trim(),
                    plateNumber: String(json.plateNumber || "").trim(),
                    vehicleType: String(json.vehicleType || "").trim(),
                    raw: text,
                };
            }
        } catch (e) {  }
        const legacy = text.match(/(?:^|\|)\s*ID\s*:\s*([^|]+)/i);
        if (legacy) return { driverId: legacy[1].trim(), plateNumber: "", vehicleType: "", raw: text };
        if (text.length > 64 || /\s{2,}/.test(text)) return null;    
        return { driverId: text, plateNumber: "", vehicleType: "", raw: text };
    }

     function debounced(onScan, ms) {
        let last = "", lastAt = 0;
        return function (text) {
            const now = Date.now();
            if (text === last && now - lastAt < ms) return;
            last = text; lastAt = now;
            const payload = parse(text);
            onScan(payload, text);
        };
    }

     function attachWedge(input, onScan) {
        if (!input) return;
        input.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const text = input.value;
            input.value = "";
            if (text.trim()) onScan(parse(text), text);
        });
    }

    let camera = null;       
    let cameraBusy = false;

    function libraryReady() {
        return typeof window.Html5Qrcode === "function";
    }

    async function startCamera(elementId, onScan) {
        if (!libraryReady()) throw new Error("QR camera library did not load. Check the internet connection and reload.");
        if (!window.isSecureContext) {
            throw new Error("The camera only works on https:// or http://localhost. Use the scanner input or upload a photo instead.");
        }
        if (cameraBusy) return;
        cameraBusy = true;
        try {
            await stopCamera();
            camera = new window.Html5Qrcode(elementId, { verbose: false });
            const handler = debounced(onScan, 2500);
            await camera.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: function (w, h) { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
                function (text) { handler(text); },
                function () {   }
            );
        } catch (e) {
            camera = null;
            const msg = String((e && e.message) || e || "");
            if (/NotAllowed|Permission/i.test(msg)) throw new Error("Camera permission was denied. Allow camera access in the browser and try again.");
            if (/NotFound|Requested device not found/i.test(msg)) throw new Error("No camera was found on this device.");
            throw new Error("Could not start the camera: " + msg);
        } finally {
            cameraBusy = false;
        }
    }

    async function stopCamera() {
        if (!camera) return;
        const c = camera;
        camera = null;
        try { if (c.isScanning) await c.stop(); } catch (e) {  }
        try { c.clear(); } catch (e) {  }
    }

    function isCameraOn() {
        return !!(camera && camera.isScanning);
    }

     async function scanImageFile(elementId, file) {
        if (!libraryReady()) throw new Error("QR library did not load. Check the internet connection and reload.");
        await stopCamera();
        const reader = new window.Html5Qrcode(elementId, { verbose: false });
        try {
            const text = await reader.scanFile(file, false);
            return { payload: parse(text), text: text };
        } catch (e) {
            throw new Error("No QR code was found in that image. Try a clearer photo.");
        } finally {
            try { reader.clear(); } catch (e) {   }
        }
    }

    window.QrScanner = {
        parse: parse,
        attachWedge: attachWedge,
        startCamera: startCamera,
        stopCamera: stopCamera,
        isCameraOn: isCameraOn,
        scanImageFile: scanImageFile,
    };
})();
