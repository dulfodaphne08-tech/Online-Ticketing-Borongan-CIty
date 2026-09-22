// Wait for DOM to be fully loaded
        document.addEventListener('DOMContentLoaded', async function() {
            // Get driver data from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            const driverId = urlParams.get('id');
            
            let driver = null;

            try {
                if (driverId) {
                    const res = await fetch("api/drivers.php?id=" + driverId).then(r => r.json());
                    if (res.success && res.driver) {
                        driver = res.driver;
                    }
                }
                
                // If still no driver, try to get from session
                if (!driver) {
                    const session = localStorage.getItem('borongan_driver_session');
                    if (session) {
                        const s = JSON.parse(session);
                        const res = await fetch("api/drivers.php?id=" + s.driverId).then(r => r.json());
                        if (res.success && res.driver) {
                            driver = res.driver;
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load driver from API", e);
            }

            // If still no driver, show placeholder
            if (!driver) {
                document.getElementById('displayRegNumber').textContent = '--';
                document.getElementById('displayIdBadge').textContent = '--';
                document.getElementById('displayName').textContent = 'Driver not found';
                document.getElementById('displayBirthdate').textContent = '--';
                document.getElementById('displayGender').textContent = '--';
                document.getElementById('displayContact').textContent = '--';
                document.getElementById('displayVehicle').textContent = '--';
                document.getElementById('displayPlate').textContent = '--';
                document.getElementById('displayLicense').textContent = '--';
                document.getElementById('photoDisplayLarge').innerHTML = '<i class="fas fa-user"></i>';
                document.getElementById('qrCodeFull').innerHTML = '<p style="font-size:0.7rem;color:#94a3b8;">No QR</p>';
                return;
            }

            // Populate all driver data
            const driverIdDisplay = driver.driverId || '--';
            document.getElementById('displayRegNumber').textContent = driverIdDisplay;
            document.getElementById('displayIdBadge').textContent = driverIdDisplay;
            document.getElementById('displayName').textContent = driver.fullName || 'N/A';
            document.getElementById('displayBirthdate').textContent = driver.birthdate || 'N/A';
            document.getElementById('displayGender').textContent = driver.gender || 'N/A';
            document.getElementById('displayContact').textContent = driver.contact || 'N/A';
            document.getElementById('displayVehicle').textContent = driver.vehicleType || 'N/A';
            document.getElementById('displayPlate').textContent = driver.plateNumber || 'N/A';
            document.getElementById('displayLicense').textContent = driver.licenseNo || 'N/A';

            // Handle photo display
            const photoLarge = document.getElementById('photoDisplayLarge');
            const fullName = driver.fullName || '';
            
            if (driver.photo) {
                // If photo URL exists, show it
                photoLarge.innerHTML = `<img src="${driver.photo}" alt="Driver Photo">`;
            } else if (driver.photoData) {
                // If photo data (base64) exists
                photoLarge.innerHTML = `<img src="${driver.photoData}" alt="Driver Photo">`;
            } else {
                // Show initials
                const initials = fullName.split(' ')
                    .filter(n => n.length > 0)
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                photoLarge.innerHTML = `<span class="photo-initials">${initials || 'DR'}</span>`;
            }

            // Generate QR Code - with proper error handling
            const qrContainer = document.getElementById('qrCodeFull');
            qrContainer.innerHTML = '';
            
            try {
                const qrText = JSON.stringify({ version: 1, driverId: String(driver.driverId || driver.driver_id || ""), plateNumber: String(driver.plateNumber || driver.plate_number || ""), vehicleType: String(driver.vehicleType || driver.vehicle_type || "") });
                
                // Make sure QRCode is available
                if (typeof QRCode !== 'undefined') {
                    new QRCode(qrContainer, {
                        text: qrText,
                        width: 130,
                        height: 130,
                        colorDark: '#b22234',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.H
                    });
                } else {
                    qrContainer.innerHTML = '<p style="font-size:0.8rem;color:#94a3b8;">QR Library Loading...</p>';
                }
            } catch (e) {
                console.error('QR Code generation error:', e);
                qrContainer.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:130px;height:130px;border:2px dashed #b22234;border-radius:8px;color:#94a3b8;font-size:0.7rem;text-align:center;padding:5px;">
                    <div>
                        <i class="fas fa-qrcode" style="font-size:2rem;display:block;margin-bottom:4px;color:#b22234;"></i>
                        <span>QR Code</span>
                    </div>
                </div>`;
            }
        });