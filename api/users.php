<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$admin = requireRole('admin');

function accountRoleLabel(string $role): string {
    switch (normalizeRole($role)) {
        case 'admin': return 'Admin';
        case 'cashier': return 'Cashier';
        case 'staff': return 'Terminal Staff';
        case 'driver': return 'Driver';
        default: return $role;
    }
}

function accountResponse(array $row): array {
    $role = normalizeRole((string)$row['role']);
    return [
        'id'        => (string)$row['id'],
        'username'  => (string)$row['username'],
        'fullName'  => (string)($row['full_name'] ?? ''),
        'email'     => $row['email'] ?? null,
        'contact'   => $row['contact'] ?? null,
        'role'      => $role,
        'roleLabel' => accountRoleLabel($role),
        'status'    => (string)($row['status'] ?? 'Active'),
        'createdAt' => $row['created_at'] ?? null,
    ];
}

function accountText(array $input, string $key, string $default = ''): string {
    if (!array_key_exists($key, $input)) return $default;
    if (!is_string($input[$key])) fail('Account details must be submitted as text.', 422);
    return trim($input[$key]);
}

function validateAccountName(array $input): array {
    $fullName = accountText($input, 'fullName');
    $username = accountText($input, 'username');
    if ($fullName === '' || mb_strlen($fullName) > 150) {
        fail('Enter a full name (up to 150 characters).', 422);
    }
    if (!preg_match('/^[A-Za-z0-9_.]{3,30}$/', $username)) {
        fail('Username must be 3–30 letters, numbers, dots or underscores.', 422);
    }
    return [$fullName, $username];
}

if (method() === 'GET') {
    if (isset($_GET['me'])) {
        $stmt = $pdo->prepare('SELECT id, username, email, contact, full_name, role, status, created_at FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$admin['id']]);
        $row = $stmt->fetch();
        if (!$row) fail('Account not found.', 404);
        ok(['user' => accountResponse($row)]);
    }

    $stmt = $pdo->query('SELECT id, username, email, contact, full_name, role, status, created_at
                         FROM users ORDER BY created_at DESC NULLS LAST, username');
    ok(['users' => array_map('accountResponse', $stmt->fetchAll())]);
}

if (method() === 'POST') {
    $input = body();
    [$fullName, $username] = validateAccountName($input);
    if (isset($input['password']) && !is_string($input['password'])) fail('Password must be submitted as text.', 422);

    $password        = (string)($input['password'] ?? '');
    $confirmPassword = (string)($input['confirmPassword'] ?? '');
    $role            = normalizeRole(accountText($input, 'role'));
    $email           = accountText($input, 'email');
    $contact         = accountText($input, 'contact');
    $status          = accountText($input, 'status', 'Active');
    $stationId       = trim((string)($input['stationId'] ?? ''));

    if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254)) {
        fail('Enter a valid email address.', 422);
    }
    if ($contact !== '' && mb_strlen($contact) > 40) {
        fail('Enter a valid contact number (up to 40 characters).', 422);
    }
    if (strlen($password) < 8) {
        fail('Password must be at least 8 characters.', 422);
    }
    if ($confirmPassword !== '' && $password !== $confirmPassword) {
        fail('Password and Confirm Password do not match.', 422);
    }
    if (!in_array($status, ['Active', 'Inactive'], true)) {
        fail('Select a valid account status.', 422);
    }
    if (!in_array($role, ['admin', 'cashier', 'staff'], true)) {
        fail('Create driver accounts through Driver Management so a driver profile is linked.', 422);
    }

    if ($role === 'staff' && $stationId === '') {
        fail('Terminal Staff must be assigned to an active station.', 422);
    }
    if ($role === 'admin') {
        $stationId = '';
    }

    if ($stationId !== '') {
        try {
            $st = $pdo->prepare("
                SELECT id FROM public.terminals
                WHERE id = ? AND lower(coalesce(status,'active')) = 'active'
                LIMIT 1
            ");
            $st->execute([$stationId]);
            if (!$st->fetchColumn()) {
                fail('The selected station does not exist or is inactive.', 422);
            }
        } catch (Throwable $e) {
            error_log('users POST station check: ' . $e->getMessage());
            fail('Could not validate the selected station.', 500);
        }
    }

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS public.staff_stations (
                id          serial PRIMARY KEY,
                staff_id    text NOT NULL,
                station_id  text NOT NULL,
                assigned_at timestamptz DEFAULT now(),
                UNIQUE (staff_id, station_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_staff_stations_staff ON public.staff_stations(staff_id)");
    } catch (Throwable $e) {
        error_log('users POST staff_stations init: ' . $e->getMessage());
    }

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare("INSERT INTO users (username, password, full_name, email, contact, role, status)
                               VALUES (?, ?, ?, ?, ?, ?, ?)
                               RETURNING id, username, email, contact, full_name, role, status, created_at");
        $stmt->execute([
            $username,
            password_hash($password, PASSWORD_DEFAULT),
            $fullName,
            $email !== '' ? $email : null,
            $contact !== '' ? $contact : null,
            $role,
            $status
        ]);
        $row = $stmt->fetch();
        if (!$row) throw new RuntimeException('User insert returned no row.');

        if ($stationId !== '') {
            $pdo->prepare("
                INSERT INTO public.staff_stations (staff_id, station_id)
                VALUES (?, ?)
                ON CONFLICT (staff_id, station_id) DO NOTHING
            ")->execute([(string)$row['id'], $stationId]);
        }

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($e->getCode() === '23505') {
            if (stripos($e->getMessage(), 'email') !== false) fail('This email address is already in use.', 409);
            fail('This username is already taken.', 409);
        }
        error_log('Account creation failed: ' . $e->getMessage());
        fail('The account could not be created.', 500);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Account creation failed (non-PDO): ' . $e->getMessage());
        fail('The account could not be created.', 500);
    }

    $detail = $username;
    if ($stationId !== '') $detail .= " — assigned to station $stationId";
    auditLog('Created User Account', 'USER', (string)$row['id'], $detail);

    ok([
        'user'      => accountResponse($row),
        'stationId' => $stationId ?: null,
    ], 'Account created.', 201);
}

if (method() === 'PATCH') {
    $input = body();

    if (isset($_GET['me'])) {
        foreach (['currentPassword', 'newPassword'] as $field) {
            if (isset($input[$field]) && !is_string($input[$field])) fail('Passwords must be submitted as text.', 422);
        }
        $currentPassword = (string)($input['currentPassword'] ?? '');
        $newPassword     = (string)($input['newPassword'] ?? '');
        $email           = accountText($input, 'email');
        $fullName        = accountText($input, 'fullName');

        if ($fullName === '' || mb_strlen($fullName) > 150) fail('Enter a full name (up to 150 characters).', 422);
        if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254)) {
            fail('Enter a valid email address.', 422);
        }
        if ($newPassword !== '' && strlen($newPassword) < 8) {
            fail('New password must be at least 8 characters.', 422);
        }

        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$admin['id']]);
        $row = $stmt->fetch();
        if (!$row) fail('Account not found.', 404);

        if ($newPassword !== '' && !verifyPasswordAndUpgrade($pdo, $row, $currentPassword)) {
            fail('Your current password is incorrect.', 422);
        }

        try {
            $pdo->beginTransaction();
            $duplicate = $pdo->prepare('SELECT 1 FROM users WHERE lower(email) = lower(?) AND id <> ? LIMIT 1');
            $duplicate->execute([$email, $admin['id']]);
            if ($email !== '' && $duplicate->fetchColumn()) {
                $pdo->rollBack();
                fail('This email address is already in use.', 409);
            }

            $sql = 'UPDATE users SET full_name = ?, email = ?';
            $values = [$fullName, $email !== '' ? $email : null];
            if ($newPassword !== '') {
                $sql .= ', password = ?';
                $values[] = password_hash($newPassword, PASSWORD_DEFAULT);
            }
            $sql .= ' WHERE id = ? RETURNING id, username, email, full_name, role, status, created_at';
            $values[] = $admin['id'];
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
            $updated = $stmt->fetch();
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e->getCode() === '23505') fail('This email address is already in use.', 409);
            error_log('Admin profile update failed: ' . $e->getMessage());
            fail('The profile could not be updated.', 500);
        }

        $_SESSION['full_name'] = $fullName;
        auditLog('Updated Admin Profile', 'USER', (string)$updated['id'], 'Updated profile information');
        ok(['user' => accountResponse($updated)], 'Profile updated.');
    }

    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') fail('Select an account to update.', 422);

    $stmt = $pdo->prepare('SELECT id, username, email, contact, full_name, role, status
                           FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $existing = $stmt->fetch();
    if (!$existing) fail('Account not found.', 404);

    if ($id === $admin['id'] && (array_key_exists('role', $input) || array_key_exists('status', $input))) {
        fail('Your own role and status cannot be changed here.', 422);
    }

    $onlyStatus = (count($input) === 1 && array_key_exists('status', $input));
    if ($onlyStatus) {
        $raw = trim((string)$input['status']);

        $normalized = [
            'active'   => 'Active',
            'inactive' => 'Inactive',
        ];
        $key = strtolower($raw);
        $status = $normalized[$key] ?? $raw;

        if (!in_array($status, ['Active', 'Inactive'], true)) {
            fail('Invalid status "' . $raw . '". Must be Active or Inactive.', 422);
        }

        try {
            $pdo->prepare('UPDATE users SET status = ? WHERE id = ?')
                ->execute([$status, $id]);
        } catch (Throwable $e) {
            error_log('users status update failed: ' . $e->getMessage());
            fail('Could not update account status: ' . $e->getMessage(), 500);
        }

        auditLog('Updated User Status', 'USER', $id, "Set to $status");

        $msg = 'Account status updated to ' . $status . '.';
        ok(['userId' => $id, 'status' => $status], $msg);
    }

    $updates = [];
    $values = [];
    $fullName = (string)$existing['full_name'];
    $username = (string)$existing['username'];
    $role = normalizeRole((string)$existing['role']);
    $status = (string)$existing['status'];

    if (array_key_exists('fullName', $input) || array_key_exists('username', $input)) {
        [$fullName, $username] = validateAccountName($input);
        $updates['full_name'] = $fullName;
        $updates['username'] = $username;
    }
    if (array_key_exists('email', $input)) {
        $email = accountText($input, 'email');
        if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254)) {
            fail('Enter a valid email address.', 422);
        }
        $updates['email'] = $email !== '' ? $email : null;
    }
    if (array_key_exists('contact', $input)) {
        $contact = accountText($input, 'contact');
        if ($contact !== '' && mb_strlen($contact) > 40) {
            fail('Enter a valid contact number (up to 40 characters).', 422);
        }
        $updates['contact'] = $contact !== '' ? $contact : null;
    }
    if (array_key_exists('role', $input)) {
        $requestedRole = normalizeRole(accountText($input, 'role'));
        if (!in_array($requestedRole, ['admin', 'cashier', 'staff', 'driver'], true)) {
            fail('Select a valid account role.', 422);
        }
        if ($requestedRole === 'driver' && $role !== 'driver') {
            fail('Create driver accounts through Driver Management so a driver profile is linked.', 422);
        }
        if ($role === 'driver' && $requestedRole !== 'driver') {
            fail('Change driver roles through Driver Management.', 422);
        }
        $role = $requestedRole;
        $updates['role'] = $role;
    }
    if (array_key_exists('status', $input)) {
        $status = accountText($input, 'status');
        if (!in_array($status, ['Active', 'Inactive'], true)) fail('Select a valid account status.', 422);
        $updates['status'] = $status;
    }
    if (isset($input['password']) && !is_string($input['password'])) fail('Password must be submitted as text.', 422);
    if (isset($input['password']) && $input['password'] !== '') {
        $password = $input['password'];
        if (strlen($password) < 8) fail('Password must be at least 8 characters.', 422);
        $updates['password'] = password_hash($password, PASSWORD_DEFAULT);
    }

    $stationChanged = false;
    $stationId = null;
    if (array_key_exists('stationId', $input)) {
        $stationId = trim((string)$input['stationId']);
        $stationChanged = true;

        $effectiveRole = array_key_exists('role', $input)
            ? normalizeRole(accountText($input, 'role'))
            : normalizeRole((string)$existing['role']);

        if ($effectiveRole === 'staff' && $stationId === '') {
            fail('Terminal Staff must be assigned to an active station.', 422);
        }
        if ($effectiveRole === 'admin') {
            $stationId = '';
        }

        if ($stationId !== '') {
            $st = $pdo->prepare("SELECT id FROM public.terminals WHERE id = ? AND lower(coalesce(status,'active'))='active' LIMIT 1");
            $st->execute([$stationId]);
            if (!$st->fetchColumn()) fail('The selected station does not exist or is inactive.', 422);
        }
    } else {
        $effectiveRole = array_key_exists('role', $input)
            ? normalizeRole(accountText($input, 'role'))
            : normalizeRole((string)$existing['role']);

        if ($effectiveRole === 'staff' && $role !== 'staff') {
            try {
                $chk = $pdo->prepare("SELECT station_id FROM public.staff_stations WHERE staff_id = ? LIMIT 1");
                $chk->execute([(string)$id]);
                $hasStation = (bool)$chk->fetchColumn();
                if (!$hasStation) {
                    fail('Terminal Staff must be assigned to an active station.', 422);
                }
            } catch (Throwable $e) {
                fail('Terminal Staff must be assigned to an active station.', 422);
            }
        }
    }

    if (!$updates && !$stationChanged) fail('No account changes were provided.', 422);

    try {
        $pdo->beginTransaction();

        if ($updates) {
            $setSql = [];
            $updateValues = [];
            foreach ($updates as $column => $value) {
                $setSql[] = $column . ' = ?';
                $updateValues[] = $value;
            }
            $updateValues[] = $id;
            $pdo->prepare('UPDATE users SET ' . implode(', ', $setSql) . ' WHERE id = ?')
                ->execute($updateValues);
        }

        if ($role === 'driver') {
            $driverUpdates = [];
            $driverValues = [];
            if (isset($updates['full_name'])) {
                $driverUpdates[] = 'full_name = ?';
                $driverValues[] = $fullName;
            }
            if (isset($updates['username'])) {
                $driverUpdates[] = 'username = ?';
                $driverValues[] = $username;
            }
            if (isset($updates['status'])) {
                $driverUpdates[] = 'status = ?';
                $driverValues[] = $status;
            }
            if ($driverUpdates) {
                $driverValues[] = $id;
                $pdo->prepare('UPDATE drivers SET ' . implode(', ', $driverUpdates) . ' WHERE user_id = ?')
                    ->execute($driverValues);
            }
        }

        if ($stationChanged) {
            try {
                $pdo->exec("
                    CREATE TABLE IF NOT EXISTS public.staff_stations (
                        id          serial PRIMARY KEY,
                        staff_id    text NOT NULL,
                        station_id  text NOT NULL,
                        assigned_at timestamptz DEFAULT now(),
                        UNIQUE (staff_id, station_id)
                    )
                ");
                $pdo->exec("CREATE INDEX IF NOT EXISTS idx_staff_stations_staff ON public.staff_stations(staff_id)");

                $pdo->prepare("DELETE FROM public.staff_stations WHERE staff_id = ?")
                    ->execute([(string)$id]);

                if ($stationId !== null && $stationId !== '') {
                    $pdo->prepare("
                        INSERT INTO public.staff_stations (staff_id, station_id)
                        VALUES (?, ?)
                        ON CONFLICT (staff_id, station_id) DO NOTHING
                    ")->execute([(string)$id, $stationId]);
                }
            } catch (Throwable $e) {
                error_log('users PATCH station update: ' . $e->getMessage());
                throw $e;
            }
        }

        $stmt = $pdo->prepare('SELECT id, username, email, contact, full_name, role, status, created_at FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $updated = $stmt->fetch();

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($e->getCode() === '23505') {
            if (stripos($e->getMessage(), 'email') !== false) {
                fail('This email address is already in use.', 409);
            }
            fail('This username is already taken.', 409);
        }
        error_log('Account update failed: ' . $e->getMessage());
        fail('The account could not be updated: ' . $e->getMessage(), 500);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Account update failed (non-PDO): ' . $e->getMessage());
        fail('The account could not be updated.', 500);
    }

    if ($id === $admin['id']) {
        $_SESSION['username'] = $username;
        $_SESSION['full_name'] = $fullName;
    }

    $detail = $username;
    if ($stationChanged) {
        $detail .= $stationId ? " — station set to $stationId" : " — station cleared";
    }
    auditLog('Updated User Account', 'USER', $id, $detail);

    ok([
        'user'      => accountResponse($updated),
        'stationId' => $stationChanged ? ($stationId ?: null) : null,
    ], 'Account updated.');
}

if (method() === 'DELETE') {
    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') {
        $input = body();
        $id = trim((string)($input['id'] ?? ''));
    }
    if ($id === '') fail('Select an account to delete.', 422);

    if ($id === (string)$admin['id']) {
        fail('You cannot delete your own account.', 422);
    }

    $stmt = $pdo->prepare('SELECT id, username, full_name, role, status FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $existing = $stmt->fetch();
    if (!$existing) fail('Account not found.', 404);

    if (normalizeRole((string)$existing['role']) === 'admin') {
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE lower(role) = 'admin' AND id <> ?");
        $countStmt->execute([$id]);
        if ((int)$countStmt->fetchColumn() < 1) {
            fail('Cannot delete the last remaining administrator account.', 422);
        }
    }

    try {
        $pdo->beginTransaction();

        try {
            $pdo->prepare('UPDATE drivers SET user_id = NULL WHERE user_id = ?')->execute([$id]);
        } catch (Throwable $e) {
            error_log('delete user: drivers unlink skipped: ' . $e->getMessage());
        }

        try {
            $pdo->prepare('UPDATE wallet_transactions SET processed_by_id = NULL WHERE processed_by_id = ?')->execute([$id]);
        } catch (Throwable $e) {
            error_log('delete user: wallet processed_by_id cleanup skipped: ' . $e->getMessage());
        }

        try {
            $username = (string)$existing['username'];
            $pdo->prepare('UPDATE wallet_transactions SET processed_by_name = NULL WHERE processed_by_name = ?')->execute([$username]);
        } catch (Throwable $e) {
            error_log('delete user: wallet processed_by_name cleanup skipped: ' . $e->getMessage());
        }

        try {
            $pdo->prepare('DELETE FROM attendance WHERE user_id = ?')->execute([$id]);
        } catch (Throwable $e) {
            error_log('delete user: attendance cleanup skipped: ' . $e->getMessage());
        }

        try {
            $pdo->prepare('DELETE FROM public.staff_stations WHERE staff_id = ?')->execute([(string)$id]);
        } catch (Throwable $e) {
            error_log('delete user: staff_stations cleanup skipped: ' . $e->getMessage());
        }

        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);

        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Account deletion failed: ' . $e->getMessage());
        fail('The account could not be deleted: ' . $e->getMessage(), 500);
    }

    $username = (string)$existing['username'];
    $role = (string)$existing['role'];
    auditLog('Deleted User Account', 'USER', $id, "Deleted account $username ($role)");
    ok(null, 'Account deleted successfully.');
}

fail('Method not allowed.', 405);