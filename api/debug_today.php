<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Manila');

if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
    session_start();
}

require_once __DIR__ . '/env.php';

$role = strtolower((string)($_SESSION['role'] ?? ''));
if (empty($_SESSION['user_id']) || $role !== 'admin') {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Not authorized. Log in as admin first.']);
    exit;
}

try {
    [$dsn, $dbUser, $dbPass] = databaseSettings();
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => true,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
    exit;
}

$manila = new DateTimeZone('Asia/Manila');
$utc    = new DateTimeZone('UTC');
$nowManila = new DateTimeImmutable('now', $manila);
$nowUtc    = $nowManila->setTimezone($utc);

$todayStartManila    = new DateTimeImmutable('today', $manila);
$tomorrowStartManila = new DateTimeImmutable('tomorrow', $manila);

$todayStartUtc = $todayStartManila->setTimezone($utc)->format('Y-m-d H:i:s');
$tomorrowStartUtc = $tomorrowStartManila->setTimezone($utc)->format('Y-m-d H:i:s');

 $dbNow = $pdo->query("SELECT NOW() AS n")->fetch();

 $latest = $pdo->query("
    SELECT id, reference_number, type, status, amount, driver_id, vehicle_type,
           created_at,
           created_at::text AS created_at_text
    FROM wallet_transactions
    ORDER BY created_at DESC
    LIMIT 10
")->fetchAll();

 $stmt = $pdo->prepare("
    SELECT id, reference_number, type, status, amount, created_at
    FROM wallet_transactions
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at DESC
");
$stmt->execute([$todayStartUtc, $tomorrowStartUtc]);
$todayRows = $stmt->fetchAll();

 $manilaToday = $todayStartManila->format('Y-m-d');
$stmt = $pdo->prepare("
    SELECT id, reference_number, type, status, amount, created_at
    FROM wallet_transactions
    WHERE DATE(created_at + interval '8 hours') = ?
    ORDER BY created_at DESC
");
$stmt->execute([$manilaToday]);
$todayRowsManila = $stmt->fetchAll();
 $counts = $pdo->query("
    SELECT UPPER(type) AS t, UPPER(status) AS s, COUNT(*) AS c, SUM(amount) AS total
    FROM wallet_transactions
    GROUP BY UPPER(type), UPPER(status)
")->fetchAll();

 $drivers = $pdo->query("
    SELECT driver_id, full_name, status, balance, plate_number, created_at
    FROM drivers ORDER BY created_at DESC LIMIT 5
")->fetchAll();

 $response = [
    'success' => true,
    'debug' => [
        'server_time_manila' => $nowManila->format('Y-m-d H:i:s'),
        'server_time_utc' => $nowUtc->format('Y-m-d H:i:s'),
        'db_time_now' => $dbNow['n'] ?? null,
        'today_boundary_manila' => $todayStartManila->format('Y-m-d H:i:s'),
        'tomorrow_boundary_manila' => $tomorrowStartManila->format('Y-m-d H:i:s'),
        'today_start_utc_sent_to_db' => $todayStartUtc,
        'tomorrow_start_utc_sent_to_db' => $tomorrowStartUtc,
        'manila_today_date' => $manilaToday,
    ],
    'latest_10_transactions' => $latest,
    'today_query_result_count' => count($todayRows),
    'today_query_result' => $todayRows,
    'today_query_by_manila_date_count' => count($todayRowsManila),
    'today_query_by_manila_date' => $todayRowsManila,
    'totals_by_type_status' => $counts,
    'latest_5_drivers' => $drivers,
];

echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
exit;