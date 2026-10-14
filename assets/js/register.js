(function () {
  "use strict";

  const form = document.getElementById("driverForm");
  if (!form) return;

  const registerBtn = document.getElementById("registerBtn");
  const msgDiv      = document.getElementById("registerMsg");
  const successMsg  = document.getElementById("successMsg");
  const successText = document.getElementById("successText");

  const takenCache = {};
  async function isTaken(field, value) {
    const key = field + ":" + value.toUpperCase();
    if (key in takenCache) return takenCache[key];
    try {
      const res = await fetch("api/register.php?check=" + encodeURIComponent(field) + "&value=" + encodeURIComponent(value));
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
  const plateInput          = document.getElementById("plateNumber");
  const terminalBaseSelect  = document.getElementById("driverTerminalBase");

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

   const photoDropzone       = document.getElementById("photoDropzone");
  const photoInput          = document.getElementById("photoUpload");
  const photoPreviewImg     = document.getElementById("photoPreviewImg");
  const photoDefaultIcon    = document.getElementById("photoDefaultIcon");
  const photoUploadText     = document.getElementById("photoUploadText");
  const photoClearBtn       = document.getElementById("photoClearBtn");

  let attachedPhotoDataUrl = null;

  const getRadioValue = (name, fallback) => {
    const r = document.querySelector(`input[name="${name}"]:checked`);
    return r ? r.value : fallback;
  };
  const getSelectedPlateType   = () => getRadioValue("plateType", "Temporary");
  const getSelectedLicenseType = () => getRadioValue("licenseType", "Non-Professional");
  const getSelectedDriverClass = () => getRadioValue("driverClass", "Regular");

   const allInputs = form.querySelectorAll(".input-field");
  allInputs.forEach((inp) => {
    inp.addEventListener("input", () => {
      inp.classList.remove("input-error");
      const err = inp.parentElement?.querySelector(".error-message");
      if (err) err.classList.remove("show");
      if (msgDiv) msgDiv.innerHTML = "";
    });
    inp.addEventListener("change", () => {
      inp.classList.remove("input-error");
      const err = inp.parentElement?.querySelector(".error-message");
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

   
  photoDropzone?.addEventListener("click", function (e) {
    if (e.target.closest("#photoClearBtn")) return;
    photoInput?.click();
  });

   photoDropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    photoDropzone.classList.add("dragover");
  });
  photoDropzone?.addEventListener("dragleave", () => {
    photoDropzone.classList.remove("dragover");
  });
  photoDropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    photoDropzone.classList.remove("dragover");
    if (e.dataTransfer?.files?.[0]) {
      handleSelectedPhoto(e.dataTransfer.files[0]);
    }
  });

  photoInput?.addEventListener("change", function () {
    const file = this.files && this.files[0];
    if (file) handleSelectedPhoto(file);
  });

  photoClearBtn?.addEventListener("click", function (e) {
    e.stopPropagation();
    clearAttachedPhoto();
  });

  function clearAttachedPhoto() {
    attachedPhotoDataUrl = null;
    if (photoInput) photoInput.value = "";
    if (photoPreviewImg) {
      photoPreviewImg.src = "";
      photoPreviewImg.classList.add("hidden");
    }
    photoDefaultIcon?.classList.remove("hidden");
    photoClearBtn?.classList.add("hidden");
    photoDropzone?.classList.remove("has-file");
    if (photoUploadText) {
      photoUploadText.innerHTML = `
        <strong>Click to upload photo</strong>
        <span>JPG, PNG or WEBP · Max 5MB</span>
      `;
    }
    updateProgress();
  }

   function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        return reject(new Error("Please select an image file (JPG, PNG, or WEBP)."));
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid or corrupted image."));
        img.onload = () => {
          let { width, height } = img;
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

          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleSelectedPhoto(file) {
    if (!file.type.startsWith("image/")) {
      showErrorMsg("Please select a valid image (JPG, PNG, or WEBP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showErrorMsg("Photo file exceeds 10MB limit. Please choose a smaller photo.");
      return;
    }

    if (photoUploadText) {
      photoUploadText.innerHTML = `
        <strong>Processing photo...</strong>
        <span>Optimizing image resolution</span>
      `;
    }

    try {
      const dataUrl = await compressImage(file);
      attachedPhotoDataUrl = dataUrl;

       if (photoPreviewImg) {
        photoPreviewImg.src = dataUrl;
        photoPreviewImg.classList.remove("hidden");
      }
      photoDefaultIcon?.classList.add("hidden");
      photoClearBtn?.classList.remove("hidden");
      photoDropzone?.classList.add("has-file");

      const approxSizeKb = Math.round(dataUrl.length * 0.75 / 1024);
      if (photoUploadText) {
        photoUploadText.innerHTML = `
          <strong title="${file.name}">${file.name}</strong>
          <span style="color:#22c55e;font-weight:600;">
            <i class="fas fa-check-circle mr-1"></i> Ready (${approxSizeKb} KB)
          </span>
        `;
      }
      if (msgDiv) msgDiv.innerHTML = "";
    } catch (err) {
      console.error("Photo processing failed:", err);
      showErrorMsg(err.message || "Could not process photo.");
      clearAttachedPhoto();
    }
  }

 
  document.getElementById("togglePassword")?.addEventListener("click", function (e) {
    e.preventDefault();
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    this.querySelector("i").className = show ? "fas fa-eye-slash" : "fas fa-eye";
  });

  document.getElementById("toggleConfirm")?.addEventListener("click", function (e) {
    e.preventDefault();
    const show = confirmInput.type === "password";
    confirmInput.type = show ? "text" : "password";
    this.querySelector("i").className = show ? "fas fa-eye-slash" : "fas fa-eye";
  });

 
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

  function setReqStatus(iconContainer, isMet) {
    if (!iconContainer) return;
    const parentReq = iconContainer.closest(".req");
    if (isMet) {
      iconContainer.classList.add("valid");
      iconContainer.classList.remove("invalid");
      iconContainer.innerHTML = '<i class="fas fa-check-circle"></i>';
      if (parentReq) parentReq.classList.add("valid");
    } else {
      iconContainer.classList.remove("valid");
      iconContainer.classList.add("invalid");
      iconContainer.innerHTML = '<i class="fas fa-circle"></i>';
      if (parentReq) parentReq.classList.remove("valid");
    }
  }

  function updatePasswordStrength() {
    const pwd = passInput?.value || "";

    const hasLength  = pwd.length >= 8;
    const hasUpper   = /[A-Z]/.test(pwd);
    const hasLower   = /[a-z]/.test(pwd);
    const hasNumber  = /[0-9]/.test(pwd);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-+=\\/\[\]~`]/.test(pwd);

     setReqStatus(reqLengthEl, hasLength);
    setReqStatus(reqUpperEl, hasUpper);
    setReqStatus(reqLowerEl, hasLower);
    setReqStatus(reqNumberEl, hasNumber);
    setReqStatus(reqSpecialEl, hasSpecial);

     let score = 0;
    if (hasLength) score++;
    if (hasUpper && hasLower) score++;
    if (hasNumber) score++;
    if (hasSpecial) score++;

     
    [bar1, bar2, bar3, bar4].forEach((b) => {
      if (b) b.className = "pw-strength-bar";
    });

    if (pwd.length === 0) {
      if (pwStrengthText) {
        pwStrengthText.textContent = "Enter a password";
        pwStrengthText.style.color = "var(--text-gray)";
      }
    } else if (score <= 1) {
      if (bar1) bar1.className = "pw-strength-bar active weak";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Weak password (add uppercase, number & symbol)";
        pwStrengthText.style.color = "#ef4444";
      }
    } else if (score === 2) {
      if (bar1) bar1.className = "pw-strength-bar active medium";
      if (bar2) bar2.className = "pw-strength-bar active medium";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Fair password (add numbers or symbols)";
        pwStrengthText.style.color = "#f59e0b";
      }
    } else if (score === 3) {
      if (bar1) bar1.className = "pw-strength-bar active medium";
      if (bar2) bar2.className = "pw-strength-bar active medium";
      if (bar3) bar3.className = "pw-strength-bar active medium";
      if (pwStrengthText) {
        pwStrengthText.textContent = "Good password";
        pwStrengthText.style.color = "#eab308";
      }
    } else {
      if (bar1) bar1.className = "pw-strength-bar active strong";
      if (bar2) bar2.className = "pw-strength-bar active strong";
      if (bar3) bar3.className = "pw-strength-bar active strong";
      if (bar4) bar4.className = "pw-strength-bar active strong";
      if (pwStrengthText) {
        pwStrengthText.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Strong password! Ready to register.';
        pwStrengthText.style.color = "#22c55e";
      }
    }

    checkConfirmMatch();
    updateProgress();
  }

  function checkConfirmMatch() {
    if (!confirmMatch || !confirmInput) return;
    const pwd = passInput?.value || "";
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

   const progressFill  = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");
  const stepItems     = document.querySelectorAll(".step-item");

  function updateProgress() {
    const s1 = !!(fullNameInput?.value.trim() && genderInput?.value && birthdateInput?.value && contactInput?.value.trim() && addressInput?.value.trim());
    const s2 = !!(vehicleType?.value && bodyInput?.value.trim().length === 4 && plateInput?.value.trim());
    const s3 = !!(licenseInput?.value.trim() && licenseExpInput?.value);
    const s4 = !!(emergencyNameEl?.value.trim() && emergencyRelationEl?.value && emergencyNumberEl?.value.trim());
    const s5 = !!(usernameInput?.value.trim() && passInput?.value.length >= 8 && confirmInput?.value === passInput?.value);

    const sections = [s1, s2, s3, s4, s5];
    const completedCount = sections.filter(Boolean).length;

    if (progressFill) {
      progressFill.style.width = (completedCount / 5 * 100) + "%";
    }
    if (progressLabel) {
      progressLabel.textContent = `${completedCount} of 5 sections complete`;
    }

    stepItems.forEach((stepEl, idx) => {
      const isDone = sections[idx];
      const dot = stepEl.querySelector(".step-dot");
      if (isDone) {
        stepEl.classList.add("completed");
        stepEl.classList.remove("active");
        if (dot) dot.innerHTML = '<i class="fas fa-check"></i>';
      } else {
        stepEl.classList.remove("completed");
        if (dot) dot.textContent = String(idx + 1);
        if (idx === sections.findIndex((done) => !done)) {
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
    const v = (id) => document.getElementById(id)?.value?.trim() || "-";
    const photoStatus = attachedPhotoDataUrl ? "Attached ✓" : "None";

    box.textContent =
      `PERSONAL\n` +
      `Full Name:       ${v("fullName")}\n` +
      `Gender:          ${v("gender")}\n` +
      `Birthdate:       ${v("birthdate")}\n` +
      `Contact:         ${v("contact")}\n` +
      `Address:         ${v("address")}\n` +
      `Photo:           ${photoStatus}\n\n` +
      `VEHICLE\n` +
      `Vehicle Type:    ${v("vehicleType")}\n` +
      `Body Number:     ${v("bodyNumber")}\n` +
      `Plate Number:    ${v("plateNumber").toUpperCase()}\n` +
      `Plate Type:      ${getSelectedPlateType()}\n` +
      `Terminal Base:   ${v("driverTerminalBase") || "None (General)"}\n\n` +
      `DRIVER\n` +
      `License No:      ${v("licenseNo").toUpperCase()}\n` +
      `License Type:    ${getSelectedLicenseType()}\n` +
      `License Exp.:    ${v("licenseExpiration")}\n` +
      `Classification:  ${getSelectedDriverClass()}\n\n` +
      `EMERGENCY CONTACT\n` +
      `Name:            ${v("emergencyName")}\n` +
      `Relationship:    ${v("emergencyRelation")}\n` +
      `Contact No:      ${v("emergencyNumber")}\n\n` +
      `ACCOUNT\n` +
      `Username:        ${v("username")}`;

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
    const customErr = parent?.querySelector(".error-message");
    if (customErr) {
      customErr.textContent = message;
      customErr.classList.add("show");
    }

    showErrorMsg(message);
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (msgDiv) msgDiv.innerHTML = "";
    if (successMsg) successMsg.classList.remove("show");

     document.querySelectorAll(".input-error").forEach((el) => el.classList.remove("input-error"));
    document.querySelectorAll(".error-message.show").forEach((el) => el.classList.remove("show"));

    const fullName          = fullNameInput?.value.trim();
    const gender            = genderInput?.value;
    const birthdate         = birthdateInput?.value;
    const contact           = contactInput?.value.trim();
    const address           = addressInput?.value.trim();

    const vehicleTypeVal    = vehicleType?.value;
    const bodyNumberVal     = bodyInput?.value.trim();
    const plateNumberVal    = plateInput?.value.trim();
    const plateType         = getSelectedPlateType();
    const terminalBase      = terminalBaseSelect?.value || null;

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

     
    if (!fullName) return highlightErrorField(fullNameInput, "Full Name is required.");
    if (!gender)   return highlightErrorField(genderInput, "Please select gender.");
    if (!birthdate) return highlightErrorField(birthdateInput, "Birthdate is required.");
    if (!contact)  return highlightErrorField(contactInput, "Contact number is required.");
    if (!address)  return highlightErrorField(addressInput, "Address is required.");

    if (!vehicleTypeVal) return highlightErrorField(vehicleType, "Vehicle type is required.");
    if (!bodyNumberVal || !/^\d{4}$/.test(bodyNumberVal)) {
      return highlightErrorField(bodyInput, "Body number must be exactly 4 digits (e.g., 0123).");
    }
    if (!plateNumberVal) return highlightErrorField(plateInput, "Plate number is required.");

    if (!licenseNoVal) return highlightErrorField(licenseInput, "Driver's license number is required.");
    if (!licenseExpiration) return highlightErrorField(licenseExpInput, "License expiration date is required.");
    if (licenseExpiration <= registrationDate) {
      return highlightErrorField(licenseExpInput, "License expiration must be a future date.");
    }

    if (!emergencyName)     return highlightErrorField(emergencyNameEl, "Emergency contact name is required.");
    if (!emergencyRelation) return highlightErrorField(emergencyRelationEl, "Select relationship to emergency contact.");
    if (!emergencyNumber)   return highlightErrorField(emergencyNumberEl, "Emergency contact number is required.");

    if (!username) return highlightErrorField(usernameInput, "Username is required.");
    if (!/^[A-Za-z0-9_.]{3,30}$/.test(username)) {
      return highlightErrorField(usernameInput, "Username must be 3-30 letters, numbers, dots or underscores.");
    }

    if (!password) return highlightErrorField(passInput, "Password is required.");
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

    registerBtn.innerHTML = '<span class="spinner"></span> Creating account...';

    const driverPayload = {
      fullName,
      address,
      contact,
      birthdate,
      gender,
      vehicleType: vehicleTypeVal,
      bodyNumber: bodyNumberVal,
      plateType,
      plateNumber: plateNumberVal.toUpperCase(),
      terminalBase,
      licenseType,
      licenseNo: licenseNoVal.toUpperCase(),
      registrationDate,
      licenseExpiration,
      driverClass,
      emergencyName,
      emergencyRelation,
      emergencyNumber,
      username,
      password,
      photo: attachedPhotoDataUrl || null,
    };

    console.log("Submitting driver registration payload...");

    try {
      const response = await fetch("api/register.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(driverPayload),
      });

      const rawText = await response.text();
      let resJson;
      try {
        resJson = JSON.parse(rawText);
      } catch (e) {
        console.error("Non-JSON API response:", rawText);
        showErrorMsg("Server returned an invalid response. Please contact support.");
        registerBtn.disabled = false;
        registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
        return;
      }

      if (resJson.success) {
        if (successText) {
          successText.textContent = `Account created successfully for ${fullName}! Awaiting admin verification.`;
        }
        if (successMsg) successMsg.classList.add("show");
        form.reset();
        clearAttachedPhoto();
        updatePasswordStrength();
        updateReview();

        registerBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Registered!';

         
        successMsg?.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
          window.location.href = "login.html?registered=true";
        }, 2500);

      } else {
        const errorText = resJson.error || resJson.message || "Registration failed.";
        showErrorMsg("Registration failed: " + errorText);

        if (errorText.toLowerCase().includes("plate")) {
          highlightErrorField(plateInput, errorText);
        } else if (errorText.toLowerCase().includes("license")) {
          highlightErrorField(licenseInput, errorText);
        } else if (errorText.toLowerCase().includes("username")) {
          highlightErrorField(usernameInput, errorText);
        } else if (errorText.toLowerCase().includes("photo")) {
          showErrorMsg(errorText);
        }

        registerBtn.disabled = false;
        registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
      }
    } catch (err) {
      console.error("Network or script error:", err);
      showErrorMsg("Network error connecting to the server. Please check your connection.");
      registerBtn.disabled = false;
      registerBtn.innerHTML = '<span>Create account</span><i class="fas fa-arrow-right btn-arrow"></i>';
    }
  });

})();