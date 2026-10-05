<?php
 declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Manila');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { exit(0); }

if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
    $isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_set_cookie_params([
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => $isHttps,
    ]);
    session_start();
}

require_once __DIR__ . '/env.php';   
function ok($data = null, string $message = 'OK', int $status = 200): void {
    http_response_code($status);
    echo json_encode(['success' => true, 'message' => $message, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400, $data = null, ?string $code = null): void {
    http_response_code($status);
    $out = ['success' => false, 'message' => $message, 'error' => $message, 'data' => $data];
    if ($code !== null) $out['code'] = $code;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

 function respond($data, $code = 200): void {
    http_response_code((int)$code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    static $parsed = null;
    if ($parsed === null) {
        $raw = file_get_contents('php://input');
        $parsed = json_decode($raw ?: '{}', true);
        if (!is_array($parsed)) $parsed = [];
    }
    return $parsed;
}

function method(): string {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

 try {
    [$dsn, $dbUser, $dbPass] = databaseSettings();
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => true,   
        PDO::ATTR_TIMEOUT            => 10,
    ]);
} catch (PDOException $e) {             
    $why = $e->getMessage();
    error_log('DB connection failed: ' . $why);
    if (stripos($why, 'could not find driver') !== false) {
        fail('PHP cannot talk to PostgreSQL: the pdo_pgsql extension is off. In php.ini remove the ";" before "extension=pdo_pgsql" and "extension=pgsql", then restart Apache.', 500);
    }
    if (stripos($why, 'password authentication failed') !== false) {
        fail('The database password is wrong. Check SUPABASE_PASS in .env (it is the database password, not the anon key).', 500);
    }
    fail('Unable to connect to the database. Check the internet connection and the database settings in .env / api/db_config.php.', 500);
} catch (RuntimeException $e) {         
    fail($e->getMessage(), 500);
}

 const STAFF_ROLES = ['admin', 'cashier', 'staff'];

function normalizeRole(string $role): string {
    $r = strtolower(trim($role));
    return in_array($r, ['terminal_staff', 'terminal'], true) ? 'staff' : $r;
}

function landingPageFor(string $role): string {
    switch ($role) {
        case 'admin':   return 'admin-dashboard.html';
        case 'cashier': return 'cashier-dashboard.html';
        case 'staff':   return 'staff-dashboard.html';
        case 'driver':  return 'driver-dashboard.html';
        default:        return 'login.html';
    }
}

function currentUser(): ?array {
    if (empty($_SESSION['user_id']) || empty($_SESSION['role'])) return null;
    return [
        'id'       => (string)$_SESSION['user_id'],
        'username' => (string)($_SESSION['username'] ?? ''),
        'fullName' => (string)($_SESSION['full_name'] ?? ''),
        'role'     => (string)$_SESSION['role'],
        'driverId' => (string)($_SESSION['driver_id'] ?? ''),
    ];
}

function requireRole(string ...$roles): array {
    $user = currentUser();
    if (!$user) fail('Your session has expired. Please log in again.', 401);
    if ($roles && !in_array($user['role'], $roles, true)) {
        fail('You do not have access to this feature.', 403);
    }
    return $user;
}

function startAuthenticatedSession(array $user, ?string $driverId): void {
    session_regenerate_id(true);
    $_SESSION['user_id']   = (string)$user['id'];
    $_SESSION['username']  = (string)$user['username'];
    $_SESSION['full_name'] = (string)($user['full_name'] ?: $user['username']);
    $_SESSION['role']      = normalizeRole((string)$user['role']);
    if ($driverId) $_SESSION['driver_id'] = $driverId;
    else unset($_SESSION['driver_id']);
}

function endAuthenticatedSession(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

 function verifyPasswordAndUpgrade(PDO $pdo, array $user, string $password): bool {
    $stored = (string)($user['password'] ?? '');
    if ($stored === '') $stored = (string)($user['password_hash'] ?? '');
    if ($stored === '') return false;

    $info = password_get_info($stored);
    if (($info['algo'] ?? null) !== null && $info['algo'] !== 0) {
        if (!password_verify($password, $stored)) return false;
        if (password_needs_rehash($stored, PASSWORD_DEFAULT)) {
            $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        return true;
    }

    $legacyOk = (strlen($stored) === 64 && ctype_xdigit($stored))
        ? hash_equals(strtolower($stored), hash('sha256', $password))
        : hash_equals($stored, $password);

    if ($legacyOk) {
        $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }
    return $legacyOk;
}

 function sessionDriverId(PDO $pdo, array $user): string {
    if ($user['driverId'] !== '') return $user['driverId'];
    $stmt = $pdo->prepare('SELECT driver_id FROM drivers WHERE user_id = ? LIMIT 1');
    $stmt->execute([$user['id']]);
    $id = (string)($stmt->fetchColumn() ?: '');
    if ($id === '') fail('No driver profile is linked to this account. Please contact the office.', 404);
    $_SESSION['driver_id'] = $id;
    return $id;
}

 const DRIVER_COLUMNS = 'd.driver_id, d.user_id, d.full_name, d.address, d.contact, d.birthdate, d.gender,
    d.vehicle_type, d.body_number, d.plate_type, d.plate_number, d.license_type, d.license_no,
    d.license_expiration, d.registration_date, d.photo, d.status, COALESCE(d.balance, 0) AS balance,
    d.created_at, COALESCE(u.username, d.username) AS username, u.email';

 function findDriver(PDO $pdo, string $identifier, bool $lock = false): ?array {
    $id = trim($identifier);
    if ($id === '') return null;
    $sql = 'SELECT ' . DRIVER_COLUMNS . '
            FROM drivers d LEFT JOIN users u ON u.id = d.user_id
            WHERE upper(d.driver_id) = upper(:id)
               OR upper(d.plate_number) = upper(:id)
               OR upper(d.body_number) = upper(:id)
            ORDER BY (upper(d.driver_id) = upper(:id)) DESC
            LIMIT 1';
    if ($lock) $sql .= ' FOR UPDATE OF d';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function formatDriver(array $d, ?float $fee = null): array {
    $out = [
        'driverId'          => (string)$d['driver_id'],
        'fullName'          => (string)($d['full_name'] ?? ''),
        'username'          => (string)($d['username'] ?? ''),
        'email'             => $d['email'] ?? null,
        'address'           => (string)($d['address'] ?? ''),
        'contact'           => (string)($d['contact'] ?? ''),
        'birthdate'         => $d['birthdate'] ?? null,
        'gender'            => (string)($d['gender'] ?? ''),
        'vehicleType'       => (string)($d['vehicle_type'] ?? ''),
        'bodyNumber'        => (string)($d['body_number'] ?? ''),
        'plateType'         => (string)($d['plate_type'] ?? ''),
        'plateNumber'       => (string)($d['plate_number'] ?? ''),
        'licenseType'       => (string)($d['license_type'] ?? ''),
        'licenseNo'         => (string)($d['license_no'] ?? ''),
        'licenseExpiration' => $d['license_expiration'] ?? null,
        'registrationDate'  => $d['registration_date'] ?? null,
        'photo'             => $d['photo'] ?? null,
        'status'            => (string)($d['status'] ?? 'Active'),
        'balance'           => round((float)($d['balance'] ?? 0), 2),
        'createdAt'         => $d['created_at'] ?? null,
    ];
    if ($fee !== null) $out['fee'] = $fee;
    return $out;
}

function isActive(?string $status): bool {
    return strtoupper(trim((string)$status)) === 'ACTIVE' || trim((string)$status) === '';
}

const DEFAULT_FEES = ['tricycle' => 5.0, 'jeepney' => 60.0, 'multicab' => 60.0, 'bus' => 100.0];

 function getFee(PDO $pdo, string $vehicleType): float {
    try {
        $stmt = $pdo->prepare('SELECT amount FROM fees WHERE lower(vehicle_type) = lower(?) LIMIT 1');
        $stmt->execute([trim($vehicleType)]);
        $amount = $stmt->fetchColumn();
        if ($amount !== false) return round((float)$amount, 2);
    } catch (Throwable $e) {
        error_log('getFee: ' . $e->getMessage());
    }
    return DEFAULT_FEES[strtolower(trim($vehicleType))] ?? 0.0;
}

 function newReference(string $prefix): string {
    return $prefix . '-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
}

 function todayStart(): string {
    return (new DateTimeImmutable('today'))->format(DATE_ATOM);
}

function formatTransaction(array $r): array {
    $created = $r['created_at'] ?? null;
    $ts = $created ? strtotime((string)$created) : false;
    return [
        'id'              => (string)($r['id'] ?? ''),
        'referenceNumber' => (string)($r['reference_number'] ?? ''),
        'orNumber'        => $r['or_number'] ?? null,          
        'type'            => strtoupper((string)($r['type'] ?? '')),
        'feeType'         => $r['fee_type'] ?? null,
        'driverId'        => (string)($r['driver_id'] ?? ''),
        'driverName'      => (string)($r['driver_name'] ?? ''),
        'plateNumber'     => (string)($r['plate_number'] ?? ''),
        'vehicleType'     => (string)($r['vehicle_type'] ?? ''),
        'amount'          => round((float)($r['amount'] ?? 0), 2),
        'previousBalance' => round((float)($r['previous_balance'] ?? 0), 2),
        'balanceAfter'    => round((float)($r['balance_after'] ?? 0), 2),
        'paymentMethod'   => $r['payment_method'] ?? null,
        'processedBy'     => (string)($r['processed_by_name'] ?? ''),
        'status'          => strtoupper((string)($r['status'] ?? 'SUCCESSFUL')),
        'createdAt'       => $ts ? date(DATE_ATOM, $ts) : null,
        'date'            => $ts ? date('Y-m-d', $ts) : null,
        'time'            => $ts ? date('g:i A', $ts) : null,
    ];
}

const TRANSACTION_SELECT = 'SELECT wt.id, wt.reference_number, wt.or_number, wt.type, wt.fee_type, wt.driver_id,
        d.full_name AS driver_name, d.plate_number, COALESCE(wt.vehicle_type, d.vehicle_type) AS vehicle_type,
        wt.amount, wt.previous_balance, wt.balance_after, wt.payment_method,
        wt.processed_by_name, wt.status, wt.created_at
    FROM wallet_transactions wt
    LEFT JOIN drivers d ON d.driver_id = wt.driver_id';

 function addNotification(PDO $pdo, string $driverId, string $title, string $message, string $type): void {
    try {
        $pdo->exec('SAVEPOINT notify');
        $pdo->prepare('INSERT INTO notifications (driver_id, title, message, type, is_read) VALUES (?, ?, ?, ?, false)')
            ->execute([$driverId, $title, $message, $type]);
        $pdo->exec('RELEASE SAVEPOINT notify');
    } catch (Throwable $e) {
        try { $pdo->exec('ROLLBACK TO SAVEPOINT notify'); } catch (Throwable $ignored) {}
        error_log('addNotification: ' . $e->getMessage());
    }
}

function peso(float $amount): string {
    return '₱' . number_format($amount, 2);
}

 function auditLog(
    string $action,
    ?string $recordType = null,
    ?string $recordRef = null,
    ?string $details = null
): void {
    global $pdo;
    if (!isset($pdo) || !($pdo instanceof PDO)) return;

    try {
        $me = function_exists('currentUser') ? currentUser() : null;

        $stmt = $pdo->prepare(
            "INSERT INTO audit_logs
                (user_id, user_name, role, action, record_type, record_ref, details, ip_address)
             VALUES
                (:uid, :uname, :role, :action, :rtype, :rref, :details, :ip)"
        );

        $stmt->execute([
            ':uid'     => $me['id']       ?? null,
            ':uname'   => $me['fullName'] ?? $me['username'] ?? 'System',
            ':role'    => $me['role']     ?? 'System',
            ':action'  => $action,
            ':rtype'   => $recordType,
            ':rref'    => $recordRef,
            ':details' => $details,
            ':ip'      => $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    } catch (Throwable $e) {
         error_log('auditLog: ' . $e->getMessage());
    }
}