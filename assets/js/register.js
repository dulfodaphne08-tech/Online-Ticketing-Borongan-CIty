(function () {
  "use strict";

  const form = document.getElementById("driverForm");
  if (!form) return;

  function showEl(el, display) {
    if (!el) return;
    el.classList.remove("hidden");
    el.style.display = display || "block";
  }
  function hideEl(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.style.display = "none";
  }

  const registerBtn = document.getElementById("registerBtn");
  const msgDiv      = document.getElementById("registerMsg");
  const successMsg  = document.getElementById("successMsg");
  const successText = document.getElementById("successText");

  const takenCache = {};
  async function isTaken(field, value) {
    if (!value) return false;
    const key = field + ":" + value.toUpperCase();
    if (key in takenCache) return takenCache[key];
    try {
      const res = await fetch(
        "api/register.php?check=" + encodeURIComponent(field) +
        "&value=" + encodeURIComponent(value)
      );
      const json = await res.json();
      takenCache[key] = !!(json.success && json.data && json.data.available === false);
    } catch (e) {
      takenCache[key] = false;
    }
    return takenCache[key];
  }

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const regDateInput = document.getElementById("registrationDate");
  if (regDateInput) {
    regDateInput.value = todayStr;
    regDateInput.setAttribute("readonly", true);
  }

  const fullNameInput       = document.getElementById("fullName");
  const genderInput         = document.getElementById("gender");
  const birthdateInput      = document.getElementById("birthdate");
  const contactInput        = document.getElementById("contact");
  const addressInput        = document.getElementById("address");

  const vehicleType         = document.getElementById("vehicleType");
  const bodyInput           = document.getElementById("bodyNumber");
  const bodyNumberWrapper   = document.getElementById("bodyNumberWrapper");
  const plateInput          = document.getElementById("plateNumber");

  const ticketingStation    = document.getElementById("ticketingStation");
  const receivingStation    = document.getElementById("receivingStation");
  const ticketingError      = document.getElementById("ticketingError");
  const receivingError      = document.getElementById("receivingError");

  const licenseInput        = document.getElementById("licenseNo");
  const licenseExpInput     = document.getElementById("licenseExpiration");

  const emergencyNameEl     = document.getElementById("emergencyName");
  const emergencyRelationEl = document.getElementById("emergencyRelation");
  const emergencyNumberEl   = document.getElementById("emergencyNumber");

  const usernameInput       = document.getElementById("username");
  const passInput           = document.getElementById("password");
  const confirmInput        = document.getElementById("confirmPassword");

  const vehicleTypeError    = document.getElementById("vehicleTypeError");
  const bodyNumberError     = document.getElementById("bodyNumberError");
  const plateError          = document.getElementById("plateError");
  const licenseError        = document.getElementById("licenseError");

  const photoDropzone    = document.getElementById("photoDropzone");
  const photoInput       = document.getElementById("photoUpload");
  const photoPreviewImg  = document.getElementById("photoPreviewImg");
  const photoDefaultIcon = document.getElementById("photoDefaultIcon");
  const photoUploadText  = document.getElementById("photoUploadText");
  const photoClearBtn    = document.getElementById("photoClearBtn");

  let attachedPhotoDataUrl = null;

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES   = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  function isAllowedImage(file) {
    if (!file) return false;
    if (file.type && ALLOWED_TYPES.indexOf(file.type.toLowerCase()) !== -1) return true;
    if (!file.type) {
      return /\.(jpe?g|png|webp)$/i.test(file.name || "");
    }
    return false;
  }

  function photoError(message) {
    showErrorMsg(message);
    if (photoUploadText) {
      photoUploadText.innerHTML =
        '<strong style="color:#ef4444;"><i class="fas fa-triangle-exclamation mr-1"></i> Upload failed</strong>' +
        '<span style="color:#ef4444;">' + message + '</span>';
    }
    if (photoDropzone) {
      photoDropzone.classList.add("input-error");
      photoDropzone.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () {
        photoDropzone.classList.remove("input-error");
      }, 2500);
    }
  }

  if (photoDropzone && photoInput) {

    photoInput.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    photoDropzone.addEventListener("click", function (e) {
      if (e.target.closest("#photoClearBtn")) return;
      if (e.target === photoInput) return;
      e.preventDefault();
      photoInput.click();
    });

    photoDropzone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        photoInput.click();
      }
    });

    photoDropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      photoDropzone.classList.add("dragover");
    });

    photoDropzone.addEventListener("dragleave", function () {
      photoDropzone.classList.remove("dragover");
    });

    photoDropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      photoDropzone.classList.remove("dragover");

      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;

      const file = files[0];
      if (!isAllowedImage(file)) {
        photoError("Only image files (JPG, PNG, WEBP) can be uploaded.");
        return;
      }
      handleSelectedPhoto(file);
    });

    photoInput.addEventListener("change", function () {
      const file = this.files && this.files[0];
      if (!file) return;

      if (!isAllowedImage(file)) {
        photoError("Only image files (JPG, PNG, WEBP) can be uploaded.");
        this.value = "";
        return;
      }
      handleSelectedPhoto(file);
    });
  }

  photoClearBtn?.addEventListener("click", function (e) {
    e.stopPropagation();
    e.preventDefault();
    clearAttachedPhoto();
  });

  function clearAttachedPhoto() {
    attachedPhotoDataUrl = null;

    if (photoInput) photoInput.value = "";

    if (photoPreviewImg) {
      photoPreviewImg.src = "";
      photoPreviewImg.removeAttribute("src");
      hideEl(photoPreviewImg);
    }
    if (photoDefaultIcon) showEl(photoDefaultIcon, "inline-block");
    hideEl(photoClearBtn);

    photoDropzone?.classList.remove("has-file");
    photoDropzone?.classList.remove("input-error");

    if (photoUploadText) {
      photoUploadText.innerHTML =
        "<strong>Click to upload photo</strong>" +
        "<span>JPG, PNG or WEBP · Max 5MB</span>";
    }
    updateProgress();
  }

  function compressImage(file, maxWidth, maxHeight, quality) {
    maxWidth  = maxWidth  || 800;
    maxHeight = maxHeight || 800;
    quality   = quality   || 0.82;

    return new Promise(function (resolve, reject) {
      if (!isAllowedImage(file)) {
        return reject(new Error("Only image files (JPG, PNG, WEBP) can be uploaded."));
      }
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read image file.")); };
      reader.onload = function (e) {
        const img = new Image();
        img.onerror = function () { reject(new Error("Invalid or corrupted image.")); };
        img.onload = function () {
          let width  = img.width;
          let height = img.height;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width  = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width  = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleSelectedPhoto(file) {
    if (!isAllowedImage(file)) {
      photoError("Only image files (JPG, PNG, WEBP) can be uploaded.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      photoError("Photo file exceeds 5MB limit. Please choose a smaller photo.");
      return;
    }

    if (photoUploadText) {
      photoUploadText.innerHTML =
        "<strong>Processing photo…</strong>" +
        "<span>Optimizing image resolution</span>";
    }

    try {
      const dataUrl = await compressImage(file);
      attachedPhotoDataUrl = dataUrl;

      if (photoPreviewImg) {
        photoPreviewImg.src = dataUrl;
        showEl(photoPreviewImg, "block");
      }
      hideEl(photoDefaultIcon);
      showEl(photoClearBtn, "inline-flex");

      photoDropzone?.classList.add("has-file");
      photoDropzone?.classList.remove("input-error");

      const approxSizeKb = Math.round((dataUrl.length * 0.75) / 1024);
      if (photoUploadText) {
        photoUploadText.innerHTML =
          '<strong title="' + file.name + '">' + file.name + "</strong>" +
          '<span style="color:#22c55e;font-weight:600;">' +
            '<i class="fas fa-check-circle mr-1"></i> Ready (' + approxSizeKb + " KB)" +
          "</span>";
      }
      if (msgDiv) msgDiv.innerHTML = "";
    } catch (err) {
      console.error("Photo processing failed:", err);
      photoError(err.message || "Could not process photo.");
      clearAttachedPhoto();
    }
  }

  function bindPasswordToggle(btnId, input) {
    const btn = document.getElementById(btnId);
    if (!btn || !input) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const willShow = input.type === "password";
      input.type = willShow ? "text" : "password";

      const icon = btn.querySelector("i");
      if (icon) icon.className = willShow ? "fas fa-eye-slash" : "fas fa-eye";

      btn.setAttribute("aria-label", willShow ? "Hide password" : "Show password");
      btn.setAttribute("title", willShow ? "Hide password" : "Show password");

      try {
        const len = input.value.length;
        input.focus();
        input.setSelectionRange(len, len);
      } catch (_) {}
    });
  }

  bindPasswordToggle("togglePassword", passInput);
  bindPasswordToggle("toggleConfirm", confirmInput);

  const reqLengthEl  = document.getElementById("reqLength");
  const reqUpperEl   = document.getElementById("reqUpper");
  const reqLowerEl   = document.getElementById("reqLower");
  const reqNumberEl  = document.getElementById("reqNumber");
  const reqSpecialEl = document.getElementById("reqSpecial");

  const bar1 = document.getElementById("bar1");
  const bar2 = document.getElementById("bar2");
  const bar3 = document.getElementById("bar3");
  const bar4 = document.getElementById("bar4");
  const pwStrengthText = document.getElementById("pwStrengthText");
  const confirmMatch   = document.getElementById("confirmMatch");

  const GREEN  = "#22c55e";
  const RED    = "#ef4444";
  const AMBER  = "#f59e0b";
  const YELLOW = "#eab308";

  function setReqStatus(iconEl, isMet) {
    if (!iconEl) return;
    const reqSpan = iconEl.closest(".req");

    if (isMet) {
      iconEl.classList.add("valid");
      iconEl.classList.remove("invalid");
      iconEl.innerHTML = '<i class="fas fa-check-circle"></i>';
    } else {
      iconEl.classList.remove("valid");
      iconEl.classList.add("invalid");
      iconEl.innerHTML = '<i class="fas fa-circle"></i>';
    }

    iconEl.style.color = isMet ? GREEN : "";

    if (reqSpan) {
      if (isMet) {
        reqSpan.classList.add("valid");
        reqSpan.style.color = GREEN;
        reqSpan.style.fontWeight = "700";
        reqSpan.style.textShadow = "0 0 8px rgba(34,197,94,.55)";
      } else {
        reqSpan.classList.remove("valid");
        reqSpan.style.color = "";
        reqSpan.style.fontWeight = "";
        reqSpan.style.textShadow = "";
      }
    }
  }

  function updatePasswordStrength() {
    const pwd = (passInput && passInput.value) || "";

    const hasLength  = pwd.length >= 8;
    const hasUpper   = /[A-Z]/.test(pwd);
    const hasLower   = /[a-z]/.test(pwd);
    const hasNumber  = /[0-9]/.test(pwd);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-+=\\/\[\]~`]/.test(pwd);

    setReqStatus(reqLengthEl,  hasLength);
    setReqStatus(reqUpperEl,   hasUpper);
    setReqStatus(reqLowerEl,   hasLower);
    setReqStatus(reqNumberEl,  hasNumber);
    setReqStatus(reqSpecialEl, hasSpecial);

    let score = 0;
    if (hasLength) score++;
    if (hasUpper && hasLower) score++;
    if (hasNumber) score++;
    if (hasSpecial) score++;

    [bar1, bar2, bar3, bar4].forEach(function (b) {
      if (b) b.className = "pw-strength-bar";
    });

    if (pwd.length === 0) {
      if (pwStrengthText) {
        pwStrengthText.textContent = "Enter a password";
        pwStrengthText.style.color = "var(--text-gray, #6B7280)";
      }
    } else if (score <= 1) {
      if (bar1) bar1.className = "pw-strength-bar active weak";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Weak password (add uppercase, number & symbol)";
        pwStrengthText.style.color = RED;
      }
    } else if (score === 2) {
      if (bar1) bar1.className = "pw-strength-bar active medium";
      if (bar2) bar2.className = "pw-strength-bar active medium";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Fair password (add numbers or symbols)";
        pwStrengthText.style.color = AMBER;
      }
    } else if (score === 3) {
      if (bar1) bar1.className = "pw-strength-bar active medium";
      if (bar2) bar2.className = "pw-strength-bar active medium";
      if (bar3) bar3.className = "pw-strength-bar active medium";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Good password";
        pwStrengthText.style.color = YELLOW;
      }
    } else {
      if (bar1) bar1.className = "pw-strength-bar active strong";
      if (bar2) bar2.className = "pw-strength-bar active strong";
      if (bar3) bar3.className = "pw-strength-bar active strong";
      if (bar4) bar4.className = "pw-strength-bar active strong";
      if (pwStrengthText) {
        pwStrengthText.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Strong password! Ready to register.';
        pwStrengthText.style.color = GREEN;
      }
    }

    checkConfirmMatch();
    updateProgress();
  }

  function checkConfirmMatch() {
    if (!confirmMatch || !confirmInput) return;

    const pwd  = (passInput && passInput.value) || "";
    const cpwd = confirmInput.value;

    if (!cpwd) {
      confirmMatch.innerHTML = "";
      return;
    }
    if (pwd === cpwd) {
      confirmMatch.innerHTML = '<span style="color:#22c55e;font-weight:600;"><i class="fas fa-check-circle mr-1"></i> Passwords match</span>';
      confirmInput.classList.remove("input-error");
    } else {
      confirmMatch.innerHTML = '<span style="color:#ef4444;font-weight:600;"><i class="fas fa-times-circle mr-1"></i> Passwords do not match</span>';
    }
  }

  passInput?.addEventListener("input", updatePasswordStrength);
  confirmInput?.addEventListener("input", checkConfirmMatch);

  const TICKETING_OPTIONS = {
    Tricycle: [
      { value: "TS-01", label: "TS-01 · Borongan Public Market (Tricycle)" },
      { value: "TS-02", label: "TS-02 · Borongan Public Market (Short Ride Tricycle)" }
    ],
    Jeepney:  [{ value: "TS-03", label: "TS-03 · Borongan Public Market (Jeep/Bus/Multicab)" }],
    Multicab: [{ value: "TS-03", label: "TS-03 · Borongan Public Market (Jeep/Bus/Multicab)" }],
    Bus:      [{ value: "TS-03", label: "TS-03 · Borongan Public Market (Jeep/Bus/Multicab)" }]
  };

  const RECEIVING_OPTIONS = {
    Tricycle: [
      { value: "RS-01", label: "RS-01 · Brgy. Pepelitan (Bound to Bugas)" },
      { value: "RS-03", label: "RS-03 · Brgy. Can-abong (Bound to Camada)" }
    ],
    Jeepney: [
      { value: "RS-02", label: "RS-02 · Brgy. Bugas (Leaving Borongan)" },
      { value: "RS-04", label: "RS-04 · Brgy. Camada (Leaving Borongan)" }
    ],
    Multicab: [
      { value: "RS-02", label: "RS-02 · Brgy. Bugas (Leaving Borongan)" },
      { value: "RS-04", label: "RS-04 · Brgy. Camada (Leaving Borongan)" }
    ],
    Bus: [
      { value: "RS-02", label: "RS-02 · Brgy. Bugas (Leaving Borongan)" },
      { value: "RS-04", label: "RS-04 · Brgy. Camada (Leaving Borongan)" }
    ]
  };

  function toggleBodyAndTerminalFields() {
    if (!vehicleType || !bodyNumberWrapper || !bodyInput) return;

    const selectedType = vehicleType.value;
    const needsBody = (selectedType === "Tricycle" || selectedType === "Bus");

    if (needsBody) {
      bodyNumberWrapper.style.display = "flex";
      bodyInput.setAttribute("required", "required");
    } else {
      bodyNumberWrapper.style.display = "none";
      bodyInput.removeAttribute("required");
      bodyInput.value = "";
      bodyInput.classList.remove("input-error");
      bodyNumberError?.classList.remove("show");
    }

    ticketingStation.innerHTML = '<option value="">Select Primary Ticketing Station</option>';
    receivingStation.innerHTML = '<option value="">Select Primary Receiving Station</option>';

    if (selectedType) {
      (TICKETING_OPTIONS[selectedType] || []).forEach(function (opt) {
        const el = document.createElement("option");
        el.value = opt.value;
        el.textContent = opt.label;
        ticketingStation.appendChild(el);
      });
      ticketingStation.disabled = false;

      (RECEIVING_OPTIONS[selectedType] || []).forEach(function (opt) {
        const el = document.createElement("option");
        el.value = opt.value;
        el.textContent = opt.label;
        receivingStation.appendChild(el);
      });
      receivingStation.disabled = false;
    } else {
      ticketingStation.innerHTML = '<option value="">Select Vehicle Type first</option>';
      receivingStation.innerHTML = '<option value="">Select Vehicle Type first</option>';
      ticketingStation.disabled = true;
      receivingStation.disabled = true;
    }

    ticketingStation.classList.remove("input-error");
    receivingStation.classList.remove("input-error");
    ticketingError?.classList.remove("show");
    receivingError?.classList.remove("show");

    updateProgress();
    updateReview();
  }

  const getRadioValue = function (name, fallback) {
    const r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : fallback;
  };
  const getSelectedPlateType   = function () { return getRadioValue("plateType", "Temporary"); };
  const getSelectedLicenseType = function () { return getRadioValue("licenseType", "Non-Professional"); };
  const getSelectedDriverClass = function () { return getRadioValue("driverClass", "Regular"); };

  form.querySelectorAll(".input-field").forEach(function (inp) {
    inp.addEventListener("input", function () {
      inp.classList.remove("input-error");
      const err = inp.parentElement && inp.parentElement.querySelector(".error-message");
      if (err) err.classList.remove("show");
      if (msgDiv) msgDiv.innerHTML = "";
    });
    inp.addEventListener("change", function () {
      inp.classList.remove("input-error");
      const err = inp.parentElement && inp.parentElement.querySelector(".error-message");
      if (err) err.classList.remove("show");
    });
  });

  bodyInput?.addEventListener("input", function () {
    let digits = this.value.replace(/\D+/g, "").slice(0, 4);
    if (this.value !== digits) this.value = digits;
    if (digits.length === 4) {
      this.classList.remove("input-error");
      bodyNumberError?.classList.remove("show");
    }
  });

  const progressFill  = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");
  const stepItems     = document.querySelectorAll(".step-item");

  function updateProgress() {
    const s1 = !!(
      fullNameInput?.value.trim() &&
      genderInput?.value &&
      birthdateInput?.value &&
      contactInput?.value.trim() &&
      addressInput?.value.trim()
    );

    let s2 = false;
    if (vehicleType?.value && ticketingStation?.value && receivingStation?.value) {
      if (vehicleType.value === "Tricycle" || vehicleType.value === "Bus") {
        s2 = !!(bodyInput?.value.trim().length === 4 && plateInput?.value.trim());
      } else {
        s2 = !!plateInput?.value.trim();
      }
    }

    const s3 = !!(licenseInput?.value.trim() && licenseExpInput?.value);
    const s4 = !!(emergencyNameEl?.value.trim() && emergencyRelationEl?.value && emergencyNumberEl?.value.trim());
    const s5 = !!(usernameInput?.value.trim() && passInput?.value.length >= 8 && confirmInput?.value === passInput?.value);

    const sections = [s1, s2, s3, s4, s5];
    const completedCount = sections.filter(Boolean).length;

    if (progressFill) progressFill.style.width = ((completedCount / 5) * 100) + "%";
    if (progressLabel) progressLabel.textContent = completedCount + " of 5 sections complete";

    stepItems.forEach(function (stepEl, idx) {
      const isDone = sections[idx];
      const dot = stepEl.querySelector(".step-dot");

      if (isDone) {
        stepEl.classList.add("completed");
        stepEl.classList.remove("active");
        if (dot) dot.innerHTML = '<i class="fas fa-check"></i>';
      } else {
        stepEl.classList.remove("completed");
        if (dot) dot.textContent = String(idx + 1);
        if (idx === sections.findIndex(function (done) { return !done; })) {
          stepEl.classList.add("active");
        } else {
          stepEl.classList.remove("active");
        }
      }
    });
  }

  function updateReview() {
    const box = document.getElementById("reviewBox");
    if (!box) return;

    const v = function (id) {
      const el = document.getElementById(id);
      return (el && el.value && el.value.trim()) || "-";
    };
    const photoStatus = attachedPhotoDataUrl ? "Attached ✓" : "None";

    const showBody = vehicleType?.value === "Tricycle" || vehicleType?.value === "Bus";
    const bodyText = showBody ? ("Body Number:     " + v("bodyNumber") + "\n") : "";

    let tsLabel = "-";
    if (ticketingStation && ticketingStation.value) {
      const opt = ticketingStation.options[ticketingStation.selectedIndex];
      if (opt) tsLabel = (opt.textContent.split("·")[1] || opt.textContent).trim();
    }

    let rsLabel = "-";
    if (receivingStation && receivingStation.value) {
      const opt = receivingStation.options[receivingStation.selectedIndex];
      if (opt) rsLabel = (opt.textContent.split("·")[1] || opt.textContent).trim();
    }

    box.textContent =
      "PERSONAL\n" +
      "Full Name:       " + v("fullName") + "\n" +
      "Gender:          " + v("gender") + "\n" +
      "Birthdate:       " + v("birthdate") + "\n" +
      "Contact:         " + v("contact") + "\n" +
      "Address:         " + v("address") + "\n" +
      "Photo:           " + photoStatus + "\n\n" +
      "VEHICLE\n" +
      "Vehicle Type:    " + v("vehicleType") + "\n" +
      bodyText +
      "Plate Number:    " + v("plateNumber").toUpperCase() + "\n" +
      "Plate Type:      " + getSelectedPlateType() + "\n" +
      "Ticketing Base:  " + tsLabel + "\n" +
      "Receiving Base:  " + rsLabel + "\n\n" +
      "DRIVER\n" +
      "License No:      " + v("licenseNo").toUpperCase() + "\n" +
      "License Type:    " + getSelectedLicenseType() + "\n" +
      "License Exp.:    " + v("licenseExpiration") + "\n" +
      "Classification:  " + getSelectedDriverClass() + "\n\n" +
      "EMERGENCY CONTACT\n" +
      "Name:            " + v("emergencyName") + "\n" +
      "Relationship:    " + v("emergencyRelation") + "\n" +
      "Contact No:      " + v("emergencyNumber") + "\n\n" +
      "ACCOUNT\n" +
      "Username:        " + v("username");

    updateProgress();
  }

  form.addEventListener("input", updateReview);
  form.addEventListener("change", updateReview);
  updateReview();

  function showErrorMsg(m) {
    if (msgDiv) {
      msgDiv.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i> ' + m;
      msgDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function highlightErrorField(inputEl, message) {
    if (!inputEl) {
      showErrorMsg(message);
      return;
    }
    inputEl.classList.add("input-error");
    inputEl.scrollIntoView({ behavior: "smooth", block: "center" });
    inputEl.focus();

    const parent = inputEl.parentElement;
    const customErr = parent && parent.querySelector(".error-message");
    if (customErr) {
      customErr.textContent = message;
      customErr.classList.add("show");
    }

    showErrorMsg(message);
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (msgDiv) msgDiv.innerHTML = "";
    successMsg?.classList.remove("show");

    document.querySelectorAll(".input-error").forEach(function (el) {
      el.classList.remove("input-error");
    });
    document.querySelectorAll(".error-message.show").forEach(function (el) {
      el.classList.remove("show");
    });

    const fullName          = fullNameInput?.value.trim();
    const gender            = genderInput?.value;
    const birthdate         = birthdateInput?.value;
    const contact           = contactInput?.value.trim();
    const address           = addressInput?.value.trim();

    const vehicleTypeVal    = vehicleType?.value;
    const bodyNumberVal     = bodyInput?.value.trim();
    const plateNumberVal    = plateInput?.value.trim();
    const plateType         = getSelectedPlateType();
    const tsVal             = ticketingStation?.value;
    const rsVal             = receivingStation?.value;

    const licenseNoVal      = licenseInput?.value.trim();
    const licenseExpiration = licenseExpInput?.value;
    const licenseType       = getSelectedLicenseType();
    const driverClass       = getSelectedDriverClass();
    const registrationDate  = regDateInput?.value || todayStr;

    const emergencyName     = emergencyNameEl?.value.trim();
    const emergencyRelation = emergencyRelationEl?.value;
    const emergencyNumber   = emergencyNumberEl?.value.trim();

    const username          = usernameInput?.value.trim();
    const password          = passInput?.value;
    const confirmPassword   = confirmInput?.value;

    if (!fullName)          return highlightErrorField(fullNameInput, "Full Name is required.");
    if (!gender)            return highlightErrorField(genderInput, "Please select gender.");
    if (!birthdate)         return highlightErrorField(birthdateInput, "Birthdate is required.");
    if (!contact)           return highlightErrorField(contactInput, "Contact number is required.");
    if (!address)           return highlightErrorField(addressInput, "Address is required.");

    if (!vehicleTypeVal)    return highlightErrorField(vehicleType, "Vehicle type is required.");

    if (vehicleTypeVal === "Tricycle" || vehicleTypeVal === "Bus") {
      if (!bodyNumberVal || !/^\d{4}$/.test(bodyNumberVal)) {
        return highlightErrorField(bodyInput, "Body number must be exactly 4 digits (e.g., 0123).");
      }
    }

    if (!plateNumberVal)    return highlightErrorField(plateInput, "Plate number is required.");
    if (!tsVal)             return highlightErrorField(ticketingStation, "Please select your designated Ticketing Station.");
    if (!rsVal)             return highlightErrorField(receivingStation, "Please select your designated Receiving Station.");

    if (!licenseNoVal)      return highlightErrorField(licenseInput, "Driver's license number is required.");
    if (!licenseExpiration) return highlightErrorField(licenseExpInput, "License expiration date is required.");
    if (licenseExpiration <= registrationDate) {
      return highlightErrorField(licenseExpInput, "License expiration must be a future date.");
    }

    if (!emergencyName)     return highlightErrorField(emergencyNameEl, "Emergency contact name is required.");
    if (!emergencyRelation) return highlightErrorField(emergencyRelationEl, "Select relationship to emergency contact.");
    if (!emergencyNumber)   return highlightErrorField(emergencyNumberEl, "Emergency contact number is required.");

    if (!username)          return highlightErrorField(usernameInput, "Username is required.");
    if (!/^[A-Za-z0-9_.]{3,30}$/.test(username)) {
      return highlightErrorField(usernameInput, "Username must be 3-30 letters, numbers, dots or underscores.");
    }

    if (!password)          return highlightErrorField(passInput, "Password is required.");
    if (password.length < 8) {
      return highlightErrorField(passInput, "Password must be at least 8 characters.");
    }
    if (password !== confirmPassword) {
      return highlightErrorField(confirmInput, "Passwords do not match.");
    }

    registerBtn.disabled = true;
    registerBtn.innerHTML = '<span class="spinner"></span> Checking details...';

    const userTaken = await isTaken("username", username);
    if (userTaken) {
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
      return highlightErrorField(usernameInput, "Username is already taken. Please choose another.");
    }

    const plateTaken = await isTaken("plateNumber", plateNumberVal);
    if (plateTaken) {
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
      return highlightErrorField(plateInput, "This Plate Number is already registered.");
    }

    const licenseTaken = await isTaken("licenseNo", licenseNoVal);
    if (licenseTaken) {
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
      return highlightErrorField(licenseInput, "This Driver's License is already registered.");
    }

    registerBtn.innerHTML = '<span class="spinner"></span> Creating account...';

    const finalBodyNumber = (vehicleTypeVal === "Tricycle" || vehicleTypeVal === "Bus")
      ? bodyNumberVal
      : null;

    const driverPayload = {
      fullName: fullName,
      address: address,
      contact: contact,
      birthdate: birthdate,
      gender: gender,
      vehicleType: vehicleTypeVal,
      bodyNumber: finalBodyNumber,
      plateType: plateType,
      plateNumber: plateNumberVal.toUpperCase(),
      ticketingBase: tsVal,
      receivingBase: rsVal,
      licenseType: licenseType,
      licenseNo: licenseNoVal.toUpperCase(),
      registrationDate: registrationDate,
      licenseExpiration: licenseExpiration,
      driverClass: driverClass,
      emergencyName: emergencyName,
      emergencyRelation: emergencyRelation,
      emergencyNumber: emergencyNumber,
      username: username,
      password: password,
      photo: attachedPhotoDataUrl || null
    };

    try {
      const response = await fetch("api/register.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(driverPayload)
      });

      const rawText = await response.text();
      let resJson;
      try {
        resJson = JSON.parse(rawText);
      } catch (err) {
        showErrorMsg("Server returned an invalid response. Please contact support.");
        registerBtn.disabled = false;
        registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
        return;
      }

      if (resJson.success) {
        if (successText) {
          successText.textContent = "Account created successfully for " + fullName + "! Awaiting admin verification.";
        }
        successMsg?.classList.add("show");

        form.reset();
        clearAttachedPhoto();
        updatePasswordStrength();
        toggleBodyAndTerminalFields();
        updateReview();

        registerBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Registered!';
        successMsg?.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(function () {
          window.location.href = "login.html?registered=true";
        }, 2500);

      } else {
        const errorText = resJson.error || resJson.message || "Registration failed.";
        showErrorMsg("Registration failed: " + errorText);

        const lower = errorText.toLowerCase();
        if (lower.indexOf("plate") !== -1)          highlightErrorField(plateInput, errorText);
        else if (lower.indexOf("license") !== -1)   highlightErrorField(licenseInput, errorText);
        else if (lower.indexOf("username") !== -1)  highlightErrorField(usernameInput, errorText);
        else if (lower.indexOf("body") !== -1)      highlightErrorField(bodyInput, errorText);
        else if (lower.indexOf("ticketing") !== -1) highlightErrorField(ticketingStation, errorText);
        else if (lower.indexOf("receiving") !== -1) highlightErrorField(receivingStation, errorText);

        registerBtn.disabled = false;
        registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
      }
    } catch (err) {
      showErrorMsg("Network error connecting to the server. Please check your connection.");
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
    }
  });

   vehicleType?.addEventListener("change", toggleBodyAndTerminalFields);
  toggleBodyAndTerminalFields();

})();