 declare(strict_types=1);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/driver_account.php';

if (method() === 'GET' && isset($_GET['check'])) {
    $value = trim((string)($_GET['value'] ?? ''));
    $sql = [
        'username'    => 'SELECT 1 FROM users WHERE lower(username) = lower(?) LIMIT 1',
        'plateNumber' => 'SELECT 1 FROM drivers WHERE upper(plate_number) = upper(?) LIMIT 1',
        'licenseNo'   => 'SELECT 1 FROM drivers WHERE upper(license_no) = upper(?) LIMIT 1',
    ][(string)$_GET['check']] ?? null;
    if ($sql === null || $value === '') fail('Invalid check.', 422);
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$value]);
    ok(['available' => !$stmt->fetchColumn()]);
}

if (method() !== 'POST') fail('Method not allowed.', 405);

$data     = validateDriverInput($pdo, body(), true);
$driverId = createDriverAccount($pdo, $data);

ok(['driverId' => $driverId, 'username' => $data['_username']], 'Account created! You can now log in.', 201);
