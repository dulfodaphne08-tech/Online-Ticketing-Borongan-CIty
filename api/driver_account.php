<?php
 declare(strict_types=1);

const MAX_PHOTO_BYTES = 2_000_000;   
function validateDriverInput(PDO $pdo, array $in, bool $creating, ?string $existingDriverId = null): array {
    $s = fn(string $k) => trim((string)($in[$k] ?? ''));

    $data = [
        'full_name'          => $s('fullName'),
        'address'            => $s('address'),
        'contact'            => $s('contact'),
        'birthdate'          => $s('birthdate') ?: null,
        'gender'             => $s('gender'),
        'vehicle_type'       => $s('vehicleType'),
        'body_number'        => strtoupper($s('bodyNumber')) ?: null,
        'plate_type'         => $s('plateType') ?: 'Temporary',
        'plate_number'       => strtoupper($s('plateNumber')),
        'license_type'       => $s('licenseType') ?: 'Non-Professional',
        'license_no'         => strtoupper($s('licenseNo')),
        'license_expiration' => $s('licenseExpiration') ?: null,
    ];

    if ($data['full_name'] === '')    fail('Full name is required.', 422);
    if ($data['vehicle_type'] === '') fail('Vehicle type is required.', 422);
    if ($data['plate_number'] === '') fail('Plate number is required.', 422);
    if ($data['license_no'] === '')   fail('License number is required.', 422);
    foreach (['birthdate', 'license_expiration'] as $k) {
        if ($data[$k] !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $data[$k])) {
            fail('Dates must be in YYYY-MM-DD format.', 422);
        }
    }

     $dup = $pdo->prepare('SELECT 1 FROM drivers WHERE (upper(plate_number) = ? OR upper(license_no) = ?) AND driver_id <> ? LIMIT 1');
    $dup->execute([$data['plate_number'], $data['license_no'], (string)$existingDriverId]);
    if ($dup->fetchColumn()) {
        $which = $pdo->prepare('SELECT 1 FROM drivers WHERE upper(plate_number) = ? AND driver_id <> ? LIMIT 1');
        $which->execute([$data['plate_number'], (string)$existingDriverId]);
        fail($which->fetchColumn() ? 'This plate number is already registered.' : 'This license number is already registered.', 409);
    }

    $photo = (string)($in['photo'] ?? '');
    if ($photo !== '') {
        if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#', $photo)) fail('Photo must be a PNG, JPG or WEBP image.', 422);
        if (strlen($photo) > MAX_PHOTO_BYTES) fail('Photo is too large. Please use an image under 1.5 MB.', 422);
        $data['photo'] = $photo;
    }

    if ($creating) {
        $username = $s('username');
        $password = (string)($in['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_.]{3,30}$/', $username)) {
            fail('Username must be 3–30 letters, numbers, dots or underscores.', 422);
        }
        if (strlen($password) < 8) fail('Password must be at least 8 characters.', 422);
        $taken = $pdo->prepare('SELECT 1 FROM users WHERE lower(username) = lower(?) LIMIT 1');
        $taken->execute([$username]);
        if ($taken->fetchColumn()) fail('This username is already taken.', 409);

        $email = $s('email');
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email address.', 422);

        $data['_username'] = $username;
        $data['_password'] = $password;
        $data['_email']    = $email !== '' ? $email : null;
    }

    return $data;
}

 function createDriverAccount(PDO $pdo, array $data): string {
    try {
        $pdo->beginTransaction();

        $u = $pdo->prepare("INSERT INTO users (username, email, password, full_name, role, status)
                            VALUES (?, ?, ?, ?, 'driver', 'Active') RETURNING id");
        $u->execute([$data['_username'], $data['_email'], password_hash($data['_password'], PASSWORD_DEFAULT), $data['full_name']]);
        $userId = $u->fetchColumn();

        $driverId = 'DRV-' . strtoupper(bin2hex(random_bytes(4)));
        $cols = ['driver_id', 'user_id', 'username', 'balance', 'status', 'registration_date'];
        $vals = [$driverId, $userId, $data['_username'], 0, 'Active', date('Y-m-d')];
        foreach ($data as $k => $v) {
            if ($k[0] === '_') continue;
            $cols[] = $k;
            $vals[] = $v;
        }
        $pdo->prepare('INSERT INTO drivers (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')')
            ->execute($vals);

        $pdo->commit();
        return $driverId;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('createDriverAccount: ' . $e->getMessage());
        if ($e instanceof PDOException && $e->getCode() === '23505') {
            fail('Some of these details are already registered (username, plate or license number).', 409);
        }
        fail('Registration could not be completed. Please try again.', 500);
    }
}
