(function () {
  const form        = document.getElementById("driverForm");
  const registerBtn = document.getElementById("registerBtn");
  const msgDiv      = document.getElementById("registerMsg");
  const successMsg  = document.getElementById("successMsg");
  const successText = document.getElementById("successText");

  const takenCache = {};
  async function isTaken(field, value) {
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

  function showFieldError(input, errorEl, text) {
    input.classList.add("input-error");
    errorEl.textContent = text;
    errorEl.classList.add("show");
  }

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const regDateInput = document.getElementById("registrationDate");
  if (regDateInput) {
    regDateInput.value = todayStr;
    regDateInput.setAttribute("readonly", true);
  }

  const vehicleType = document.getElementById("vehicleType");
  const bodyInput   = document.getElementById("bodyNumber");
  const plateInput  = document.getElementById("plateNumber");
  const licenseInput = document.getElementById("licenseNo");

  const vehicleTypeError = document.getElementById("vehicleTypeError");
  const bodyNumberError  = document.getElementById("bodyNumberError");
  const plateError       = document.getElementById("plateError");
  const licenseError     = document.getElementById("licenseError");

  const emergencyNameEl     = document.getElementById("emergencyName");
  const emergencyRelationEl = document.getElementById("emergencyRelation");
  const emergencyNumberEl   = document.getElementById("emergencyNumber");

  function getRadioValue(name, fallback) {
    const r = document.querySelector(`input[name="${name}"]:checked`);
    return r ? r.value : fallback;
  }
  const getSelectedPlateType   = () => getRadioValue("plateType",   "Temporary");
  const getSelectedLicenseType = () => getRadioValue("licenseType", "Non-Professional");
  const getSelectedDriverClass = () => getRadioValue("driverClass", "Regular");

  function validateVehicleType() {
    if (!vehicleType.value) {
      vehicleType.classList.add("input-error");
      vehicleTypeError.classList.add("show");
      return false;
    }
    vehicleType.classList.remove("input-error");
    vehicleTypeError.classList.remove("show");
    return true;
  }

  function validateBodyNumber() {
    const value = bodyInput.value.trim();
    if (!value) {
      bodyInput.classList.add("input-error");
      bodyNumberError.textContent = "Body number is required.";
      bodyNumberError.classList.add("show");
      return false;
    }
    if (!/^\d{4}$/.test(value)) {
      bodyInput.classList.add("input-error");
      bodyNumberError.textContent = "Body number must be exactly 4 digits (0–9).";
      bodyNumberError.classList.add("show");
      return false;
    }
    bodyInput.classList.remove("input-error");
    bodyNumberError.classList.remove("show");
    return true;
  }

  function validatePlateNumber() {
    const plate = plateInput.value.trim();
    if (!plate) {
      plateInput.classList.add("input-error");
      plateError.textContent = "Please enter your plate number.";
      plateError.classList.add("show");
      return false;
    }
    if (plate.length < 3 || plate.length > 15) {
      plateInput.classList.add("input-error");
      plateError.textContent = "Plate number must be between 3 and 15 characters.";
      plateError.classList.add("show");
      return false;
    }
    if (!/^[A-Za-z0-9\s-]+$/.test(plate)) {
      plateInput.classList.add("input-error");
      plateError.textContent = "Use letters, numbers, and hyphens only.";
      plateError.classList.add("show");
      return false;
    }
    plateInput.classList.remove("input-error");
    plateError.classList.remove("show");
    return true;
  }

  function validateLicenseNumber() {
    const license = licenseInput.value.trim();
    if (!license) {
      licenseInput.classList.add("input-error");
      licenseError.textContent = "Please enter your driver's license number.";
      licenseError.classList.add("show");
      return false;
    }
    if (license.length < 5 || license.length > 20) {
      licenseInput.classList.add("input-error");
      licenseError.textContent = "License number must be between 5 and 20 characters.";
      licenseError.classList.add("show");
      return false;
    }
    if (!/^[A-Za-z0-9-]+$/.test(license)) {
      licenseInput.classList.add("input-error");
      licenseError.textContent = "Use letters, numbers, and hyphens only.";
      licenseError.classList.add("show");
      return false;
    }
    licenseInput.classList.remove("input-error");
    licenseError.classList.remove("show");
    return true;
  }

  function validateEmergency() {
    let ok = true;
    if (!emergencyNameEl.value.trim())   { emergencyNameEl.classList.add("input-error");     ok = false; } else { emergencyNameEl.classList.remove("input-error"); }
    if (!emergencyRelationEl.value)      { emergencyRelationEl.classList.add("input-error"); ok = false; } else { emergencyRelationEl.classList.remove("input-error"); }
    if (!emergencyNumberEl.value.trim()) { emergencyNumberEl.classList.add("input-error");   ok = false; } else { emergencyNumberEl.classList.remove("input-error"); }
    return ok;
  }

  vehicleType.addEventListener("change", validateVehicleType);

  bodyInput.addEventListener("input", function () {
    let digits = this.value.replace(/\D+/g, "");
    if (digits.length > 4) digits = digits.slice(0, 4);
    if (this.value !== digits) this.value = digits;
    if (digits.length === 4) {
      this.classList.remove("input-error");
      bodyNumberError.classList.remove("show");
    }
  });
  bodyInput.addEventListener("keydown", function (e) {
    const allowed = ["Backspace","Delete","Tab","ArrowLeft","ArrowRight","Home","End"];
    if (allowed.includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && ["a","c","v","x"].includes(e.key.toLowerCase())) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
  bodyInput.addEventListener("paste", function (e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text") || "";
    let digits = text.replace(/\D+/g, "").slice(0, 4);
    this.value = digits;
    this.dispatchEvent(new Event("input", { bubbles: true }));
  });
  bodyInput.addEventListener("blur", validateBodyNumber);

  plateInput.addEventListener("input", function () {
    if (plateInput.classList.contains("input-error")) {
      plateInput.classList.remove("input-error");
      plateError.classList.remove("show");
    }
  });
  plateInput.addEventListener("blur", async function () {
    if (validatePlateNumber() && (await isTaken("plateNumber", plateInput.value.trim()))) {
      showFieldError(plateInput, plateError, "Plate number already registered.");
    }
  });

  licenseInput.addEventListener("input", function () {
    if (licenseInput.classList.contains("input-error")) {
      licenseInput.classList.remove("input-error");
      licenseError.classList.remove("show");
    }
  });
  licenseInput.addEventListener("blur", async function () {
    if (validateLicenseNumber() && (await isTaken("licenseNo", licenseInput.value.trim()))) {
      showFieldError(licenseInput, licenseError, "Driver's license number already registered.");
    }
  });

  document.querySelectorAll('input[name="plateType"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      const hint = document.getElementById("plateHint");
      const type = getSelectedPlateType();
      let example = "";
      if (type === "Temporary") example = "e.g., TEMP-12345";
      else if (type === "Old")  example = "e.g., ABC-1234";
      else                      example = "e.g., NEW-1234-AB";
      hint.innerHTML = `<i class="fas fa-info-circle mr-1"></i> ${type}: Letters, numbers, hyphens (${example})`;
    });
  });

  [emergencyNameEl, emergencyRelationEl, emergencyNumberEl].forEach((el) => {
    el.addEventListener("input",  () => { if (el.value.trim()) el.classList.remove("input-error"); });
    el.addEventListener("change", () => { if (el.value.trim()) el.classList.remove("input-error"); });
  });

  const togglePass    = document.getElementById("togglePassword");
  const toggleConfirm = document.getElementById("toggleConfirm");
  const passInput     = document.getElementById("password");
  const confirmInput  = document.getElementById("confirmPassword");

  togglePass.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation();
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    this.querySelector("i").className = show ? "fas fa-eye-slash" : "fas fa-eye";
    passInput.focus();
  });
  toggleConfirm.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation();
    const show = confirmInput.type === "password";
    confirmInput.type = show ? "text" : "password";
    this.querySelector("i").className = show ? "fas fa-eye-slash" : "fas fa-eye";
    confirmInput.focus();
  });

  const bars = ["bar1","bar2","bar3","bar4"].map(id => document.getElementById(id));
  const strengthText = document.getElementById("pwStrengthText");

  function checkPasswordStrength(password) {
    let score = 0;
    const checks = {
      length:  password.length >= 8,
      upper:   /[A-Z]/.test(password),
      lower:   /[a-z]/.test(password),
      number:  /\d/.test(password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };

    document.getElementById("reqLength").innerHTML  = checks.length  ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>';
    document.getElementById("reqUpper").innerHTML   = checks.upper   ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>';
    document.getElementById("reqLower").innerHTML   = checks.lower   ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>';
    document.getElementById("reqNumber").innerHTML  = checks.number  ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>';
    document.getElementById("reqSpecial").innerHTML = checks.special ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>';

    document.querySelectorAll(".req .icon").forEach((el) => {
      el.className = "icon " + (el.innerHTML.includes("check-circle") ? "valid" : "invalid");
    });

    if (checks.length)  score++;
    if (checks.upper)   score++;
    if (checks.lower)   score++;
    if (checks.number)  score++;
    if (checks.special) score++;

    bars.forEach((bar, i) => {
      bar.className = "pw-strength-bar";
      if (i < score) {
        bar.classList.add("active");
        if (score <= 2) bar.classList.add("weak");
        else if (score <= 3) bar.classList.add("medium");
        else bar.classList.add("strong");
      }
    });

    if (password.length === 0) {
      strengthText.textContent = "Enter a password";
      strengthText.style.color = "#6b7280";
    } else if (score <= 2) {
      strengthText.textContent = "Weak password";
      strengthText.style.color = "#ef4444";
    } else if (score <= 3) {
      strengthText.textContent = "Medium password";
      strengthText.style.color = "#f59e0b";
    } else {
      strengthText.textContent = "Strong password!";
      strengthText.style.color = "#22c55e";
    }
    return checks;
  }

  passInput.addEventListener("input", function () {
    checkPasswordStrength(this.value);
    checkConfirmMatch();
  });

  function checkConfirmMatch() {
    const pass    = passInput.value;
    const confirm = confirmInput.value;
    const matchDiv = document.getElementById("confirmMatch");
    if (confirm.length === 0) { matchDiv.textContent = ""; return; }
    matchDiv.textContent = pass === confirm ? "Passwords match" : "Passwords do not match";
    matchDiv.style.color = pass === confirm ? "#22c55e" : "#ef4444";
  }
  confirmInput.addEventListener("input", checkConfirmMatch);

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateReview() {
    const box = document.getElementById("reviewBox");
    if (!box) return;
    const v = (id) => {
      const el = document.getElementById(id);
      return el && el.value ? el.value : "—";
    };
    box.textContent =
      `PERSONAL\n` +
      `Full Name:       ${v("fullName")}\n` +
      `Gender:          ${v("gender")}\n` +
      `Birthdate:       ${v("birthdate")}\n` +
      `Contact:         ${v("contact")}\n` +
      `Address:         ${v("address")}\n\n` +
      `VEHICLE\n` +
      `Vehicle Type:    ${v("vehicleType")}\n` +
      `Body Number:     ${v("bodyNumber")}\n` +
      `Plate Number:    ${v("plateNumber")}\n` +
      `Plate Type:      ${getSelectedPlateType()}\n` +
      `Terminal Base:   ${v("driverTerminalBase")}\n\n` +
      `DRIVER\n` +
      `License No:      ${v("licenseNo")}\n` +
      `License Type:    ${getSelectedLicenseType()}\n` +
      `License Exp.:    ${v("licenseExpiration")}\n` +
      `Classification:  ${getSelectedDriverClass()}\n\n` +
      `EMERGENCY CONTACT\n` +
      `Name:            ${v("emergencyName")}\n` +
      `Relationship:    ${v("emergencyRelation")}\n` +
      `Contact No:      ${v("emergencyNumber")}\n\n` +
      `ACCOUNT\n` +
      `Username:        ${v("username")}`;
  }

  form.addEventListener("input",  updateReview);
  form.addEventListener("change", updateReview);
  updateReview();

  (function progress() {
    const fill     = document.getElementById("progressFill");
    const label    = document.getElementById("progressLabel");
    const sections = document.querySelectorAll('.form-section[data-section]:not([data-section="6"])');
    if (!fill || !sections.length) return;

    function update() {
      let complete = 0;
      sections.forEach((sec) => {
        const required = sec.querySelectorAll("[required]");
        let filled = 0;
        required.forEach((el) => {
          if (el.type === "radio") return;
          if (el.value && el.value.trim()) filled++;
        });
        const radioNames = new Set();
        sec.querySelectorAll('input[type="radio"][required]').forEach(r => radioNames.add(r.name));
        const total = required.length - sec.querySelectorAll('input[type="radio"][required]').length + radioNames.size;
        const done  = filled + radioNames.size;
        if (total > 0 && done >= total) complete++;
      });
      const pct = (complete / sections.length) * 100;
      fill.style.width = pct + "%";
      label.textContent = `${complete} of ${sections.length} sections complete`;
    }
    form.addEventListener("input",  update);
    form.addEventListener("change", update);
    update();
  })();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    msgDiv.innerHTML = "";
    successMsg.classList.remove("show");

    const isVehicleTypeValid = validateVehicleType();
    const isBodyNumberValid  = validateBodyNumber();
    const isPlateValid       = validatePlateNumber();
    const isLicenseValid     = validateLicenseNumber();
    const isEmergencyValid   = validateEmergency();

    const fullName          = document.getElementById("fullName").value.trim();
    const address           = document.getElementById("address").value.trim();
    const contact           = document.getElementById("contact").value.trim();
    const birthdate         = document.getElementById("birthdate").value;
    const gender            = document.getElementById("gender").value;
    const registrationDate  = document.getElementById("registrationDate").value;
    const licenseExpiration = document.getElementById("licenseExpiration").value;
    const username          = document.getElementById("username").value.trim();
    const password          = document.getElementById("password").value;
    const confirmPassword   = document.getElementById("confirmPassword").value;
    const photoFile         = document.getElementById("photoUpload").files[0];
    const plateType         = getSelectedPlateType();
    const licenseType       = getSelectedLicenseType();
    const driverClass       = getSelectedDriverClass();
    const terminalBase      = document.getElementById("driverTerminalBase").value;
    const emergencyName     = emergencyNameEl.value.trim();
    const emergencyRelation = emergencyRelationEl.value;
    const emergencyNumber   = emergencyNumberEl.value.trim();

    const requireFail = (msg) => {
      msgDiv.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i> ' + msg;
    };

    if (!fullName)          return requireFail("Full Name is required.");
    if (!address)           return requireFail("Address is required.");
    if (!contact)           return requireFail("Contact Number is required.");
    if (!birthdate)         return requireFail("Birthdate is required.");
    if (!gender)            return requireFail("Gender is required.");
    if (!registrationDate)  return requireFail("Registration Date is required.");
    if (!licenseExpiration) return requireFail("License Expiration is required.");
    if (!username)          return requireFail("Username is required.");
    if (!password)          return requireFail("Password is required.");

    if (!isVehicleTypeValid || !isBodyNumberValid || !isPlateValid || !isLicenseValid || !isEmergencyValid) {
      return requireFail("Please fix all errors before continuing.");
    }

    if (licenseExpiration <= registrationDate) {
      return requireFail("License expiration must be after registration date.");
    }

    const pwChecks = checkPasswordStrength(password);
    const isStrong = pwChecks.length && pwChecks.upper && pwChecks.lower && pwChecks.number && pwChecks.special;
    if (!isStrong) return requireFail("Password must be at least 8 characters with uppercase, lowercase, number, and special character.");
    if (password !== confirmPassword) return requireFail("Passwords do not match.");
    if (await isTaken("username", username)) return requireFail("Username already taken.");

    registerBtn.disabled = true;
    registerBtn.innerHTML = '<span class="spinner"></span> Registering...';

    const driverData = {
      fullName,
      address,
      contact,
      birthdate,
      gender,
      vehicleType:       vehicleType.value,
      bodyNumber:        bodyInput.value.trim(),
      plateType:         plateType,
      plateNumber:       plateInput.value.trim().toUpperCase(),
      terminalBase:      terminalBase,
      licenseType:       licenseType,
      licenseNo:         licenseInput.value.trim().toUpperCase(),
      registrationDate:  registrationDate,
      licenseExpiration: licenseExpiration,
      driverClass:       driverClass,
      emergencyName:     emergencyName,
      emergencyRelation: emergencyRelation,
      emergencyNumber:   emergencyNumber,
      username,
      password,
      photo: null,
    };

    if (photoFile) {
      try {
        driverData.photo = await readFileAsDataURL(photoFile);
      } catch (err) {
        requireFail("Failed to read photo.");
        registerBtn.disabled = false;
        registerBtn.innerHTML = "Register Driver";
        return;
      }
    }

    fetch("api/register.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(driverData),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          successText.textContent = `Account created successfully for ${fullName}! Please wait for admin verification.`;
          successMsg.classList.add("show");

          form.reset();
          document.getElementById("registrationDate").value = todayStr;
          registerBtn.innerHTML = "Registered!";

          setTimeout(function () {
            window.location.href = "login.html?registered=true";
          }, 3000);
        } else {
          requireFail("Registration failed: " + (data.error || data.message || "Unknown error"));
          registerBtn.disabled = false;
          registerBtn.innerHTML = "Register Driver";
        }
      })
      .catch((err) => {
        console.error(err);
        requireFail("Server error during registration.");
        registerBtn.disabled = false;
        registerBtn.innerHTML = "Register Driver";
      });
  });

  document.querySelectorAll("#driverForm input, #driverForm select").forEach((el) => {
    el.addEventListener("focus", () => {
      const t = msgDiv.textContent;
      if (t.includes("required") || t.includes("match") || t.includes("characters")
        || t.includes("already") || t.includes("format") || t.includes("Invalid")
        || t.includes("fix all errors")) {
        msgDiv.innerHTML = "";
      }
    });
  });
})();