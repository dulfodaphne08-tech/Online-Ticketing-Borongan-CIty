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
                    raw: text
                };
            }
        } catch (e) {   }

        const legacy = text.match(/(?:^|\|)\s*ID\s*:\s*([^|]+)/i);
        if (legacy) {
            return { driverId: legacy[1].trim(), plateNumber: "", vehicleType: "", raw: text };
        }

        if (text.length > 128 || /\s{2,}/.test(text)) return null;
        return { driverId: text, plateNumber: "", vehicleType: "", raw: text };
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

     let videoEl = null;
    let stream = null;
    let rafId = null;
    let detector = null;
    let running = false;
    let locked = false;
    let onScanCb = null;
    let lastText = "";
    let lastTime = 0;
    let fallbackScanner = null;
    let usingNative = false;

    const SAME_CODE_COOLDOWN_MS = 1500;

    function libReady() {
        return typeof window.BarcodeDetector === "function"
            || typeof window.Html5Qrcode === "function";
    }

    function setDebug(text, color) {
        const el = document.getElementById("qrDebugRaw");
        if (!el) return;
        el.textContent = text || "—";
        el.style.color = color || "#a7f3d0";
    }

     async function getNativeDetector() {
        if (typeof window.BarcodeDetector !== "function") return null;
        try {
            if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                if (Array.isArray(supported) && !supported.includes("qr_code")) {
                    console.warn("[QR] BarcodeDetector loaded but qr_code unsupported:", supported);
                    return null;
                }
            }
            return new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch (e) {
            console.warn("[QR] BarcodeDetector init failed:", e);
            return null;
        }
    }

     async function startNativeCamera(container, onScan) {
        const d = await getNativeDetector();
        if (!d) throw new Error("Native BarcodeDetector not available");
        detector = d;

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        container.innerHTML = "";
        videoEl = document.createElement("video");
        videoEl.setAttribute("playsinline", "true");
        videoEl.setAttribute("autoplay", "true");
        videoEl.setAttribute("muted", "true");
        videoEl.style.width = "100%";
        videoEl.style.height = "auto";
        videoEl.style.display = "block";
        videoEl.style.background = "#000";
        videoEl.style.borderRadius = ".75rem";
        videoEl.srcObject = stream;
        container.appendChild(videoEl);

        await new Promise(function (resolve) {
            videoEl.onloadedmetadata = function () {
                videoEl.play().then(resolve).catch(resolve);
            };
        });

        usingNative = true;
        running = true;
        setDebug("Camera live (fast mode) — point at QR", "#a7f3d0");

        let stableCount = 0;
        let stableCode = "";

        const tick = async function () {
            if (!running || !videoEl) return;
            try {
                if (videoEl.readyState >= 2) {
                    const codes = await detector.detect(videoEl);
                    if (codes && codes.length > 0) {
                        const raw = codes[0].rawValue;
                        if (raw) {
                            if (raw === stableCode) {
                                stableCount++;
                            } else {
                                stableCode = raw;
                                stableCount = 1;
                                setDebug("Detecting… " + raw.slice(0, 60), "#fbbf24");
                            }

                            if (stableCount >= 2 && !locked) {
                                const now = Date.now();
                                if (raw === lastText && (now - lastTime) < SAME_CODE_COOLDOWN_MS) {
                                 } else {
                                    lastText = raw;
                                    lastTime = now;
                                    locked = true;
                                    setDebug(raw, "#22c55e");
                                    console.log("[QR NATIVE DECODED]", raw);

                                    const payload = parse(raw);
                                    await stopCamera();
                                    if (typeof onScanCb === "function") {
                                        onScanCb(payload, raw);
                                    }
                                    return;
                                }
                            }
                        }
                    } else {
                        if (stableCount > 0) {
                            stableCount = 0;
                            stableCode = "";
                        }
                    }
                }
            } catch (e) {   }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    async function stopNativeCamera() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (stream) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            stream = null;
        }
        if (videoEl) {
            try { videoEl.pause(); } catch (e) {}
            try { videoEl.srcObject = null; } catch (e) {}
            videoEl = null;
        }
        usingNative = false;
    }

     async function startFallbackCamera(container, onScan) {
        if (typeof window.Html5Qrcode !== "function") {
            throw new Error("Neither BarcodeDetector nor html5-qrcode available");
        }
        container.innerHTML = "";

        fallbackScanner = new window.Html5Qrcode(container.id, {
            verbose: false,
            formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE]
        });

        await fallbackScanner.start(
            { facingMode: "environment" },
            {
                fps: 20,
                qrbox: function (w, h) {
                    const size = Math.floor(Math.min(w, h) * 0.85);
                    return { width: size, height: size };
                },
                aspectRatio: 1.0,
                disableFlip: false,
                experimentalFeatures: { useBarCodeDetectorIfSupported: true }
            },
            function (decodedText) {
                if (locked) return;
                const now = Date.now();
                if (decodedText === lastText && (now - lastTime) < SAME_CODE_COOLDOWN_MS) return;
                lastText = decodedText;
                lastTime = now;
                locked = true;
                setDebug(decodedText, "#22c55e");
                console.log("[QR FALLBACK DECODED]", decodedText);

                const payload = parse(decodedText);
                stopCamera().then(function () {
                    if (typeof onScanCb === "function") onScanCb(payload, decodedText);
                });
            },
            function () {   }
        );

        running = true;
        setDebug("Camera live (fallback mode) — point at QR", "#a7f3d0");
    }

    async function stopFallbackCamera() {
        if (!fallbackScanner) return;
        const s = fallbackScanner;
        fallbackScanner = null;
        try { if (s.isScanning) await s.stop(); } catch (e) {}
        try { s.clear(); } catch (e) {}
    }

     async function startCamera(elementId, onScan) {
        if (!window.isSecureContext) {
            throw new Error("Camera requires https:// or http://localhost");
        }
        const id = elementId || "qrCameraReader";
        const container = document.getElementById(id);
        if (!container) throw new Error("Camera container not found: #" + id);

        await stopCamera();
        locked = false;
        onScanCb = onScan;
        lastText = "";
        lastTime = 0;

         try {
            await startNativeCamera(container, onScan);
            return;
        } catch (e) {
            console.warn("[QR] Native camera failed, using html5-qrcode fallback:", e.message);
            await stopNativeCamera();
        }

         await startFallbackCamera(container, onScan);
    }

    async function stopCamera() {
        running = false;
        await stopNativeCamera();
        await stopFallbackCamera();
    }

    function isCameraOn() {
        if (usingNative && stream && stream.active) return true;
        return !!(fallbackScanner && fallbackScanner.isScanning);
    }

    async function scanImageFile(elementId, file) {
        if (typeof window.Html5Qrcode !== "function") {
            throw new Error("html5-qrcode library did not load.");
        }
        await stopCamera();

        const id = elementId || "qrCameraReader";
        const container = document.getElementById(id);
        if (!container) throw new Error("Container not found.");
        container.innerHTML = "";

        const reader = new window.Html5Qrcode(id, { verbose: false });
        try {
            const text = await reader.scanFile(file, false);
            setDebug(text, "#22c55e");
            return { payload: parse(text), text: text };
        } catch (e) {
            throw new Error("No QR code found in that image.");
        } finally {
            try { reader.clear(); } catch (e) {}
        }
    }

    window.QrScanner = {
        parse: parse,
        attachWedge: attachWedge,
        startCamera: startCamera,
        stopCamera: stopCamera,
        isCameraOn: isCameraOn,
        scanImageFile: scanImageFile,
        libReady: libReady,
        hasNativeDetector: function () { return typeof window.BarcodeDetector === "function"; }
    };
})();