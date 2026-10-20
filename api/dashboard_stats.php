<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('Asia/Manila');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { exit(0); }

if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
    session_start();
}

require_once __DIR__ . '/env.php';

$role = strtolower((string)($_SESSION['role'] ?? ''));
if (empty($_SESSION['user_id']) || $role !== 'admin') {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Not authorized']);
    exit;
}

try {
    [$dsn, $dbUser, $dbPass] = databaseSettings();
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => true,
        PDO::ATTR_TIMEOUT            => 10,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
    exit;
}

$fresh = isset($_GET['fresh']) && $_GET['fresh'] === '1';
$cacheFile = sys_get_temp_dir() . '/bctt_ds.json';
if (!$fresh && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < 15) {
    $cached = @file_get_contents($cacheFile);
    if ($cached && strpos($cached, '"success":true') !== false) {
        echo $cached;
        exit;
    }
}

 $last24h = gmdate('Y-m-d H:i:s', time() - 86400);

 $manila    = new DateTimeZone('Asia/Manila');
$utcTz     = new DateTimeZone('UTC');
$monthStart = (new DateTimeImmutable('first day of this month', $manila))
    ->setTimezone($utcTz)->format('Y-m-d H:i:s');

 $trendStart = (new DateTimeImmutable('-29 days', $manila))
    ->setTimezone($utcTz)->format('Y-m-d H:i:s');

 $stmt = $pdo->prepare("
    SELECT
        COALESCE(SUM(CASE WHEN UPPER(type)='FEE'  THEN amount ELSE 0 END), 0) AS fees,
        COUNT(CASE WHEN UPPER(type)='FEE' THEN 1 END)                         AS fees_count,
        COALESCE(SUM(CASE WHEN UPPER(type)='LOAD' THEN amount ELSE 0 END), 0) AS loads,
        COUNT(CASE WHEN UPPER(type)='LOAD' THEN 1 END)                        AS loads_count
    FROM wallet_transactions
    WHERE created_at >= ?
      AND UPPER(status) IN ('SUCCESSFUL','COMPLETED','SUCCESS')
");
$stmt->execute([$last24h]);
$today = $stmt->fetch() ?: ['fees'=>0,'fees_count'=>0,'loads'=>0,'loads_count'=>0];

 $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
    FROM wallet_transactions
    WHERE UPPER(type)='FEE'
      AND UPPER(status) IN ('SUCCESSFUL','COMPLETED','SUCCESS')
      AND created_at >= ?
");
$stmt->execute([$monthStart]);
$month = $stmt->fetch() ?: ['total'=>0,'cnt'=>0];

 $stmt = $pdo->query("SELECT COUNT(*) FROM wallet_transactions WHERE UPPER(type)='FEE' AND UPPER(status) IN ('SUCCESSFUL','COMPLETED','SUCCESS')");
$completedFees = (int)$stmt->fetchColumn();

 $stmt = $pdo->query("
    SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN LOWER(status)='active' THEN 1 END) AS active,
        COUNT(CASE WHEN COALESCE(balance, 0) < 50 THEN 1 END) AS low_balance,
        COUNT(CASE WHEN plate_number IS NOT NULL AND plate_number <> '' THEN 1 END) AS total_vehicles,
        COUNT(CASE WHEN plate_number IS NOT NULL AND plate_number <> '' AND LOWER(status)='active' THEN 1 END) AS active_vehicles
    FROM drivers
");
$drivers = $stmt->fetch() ?: [];

 $stmt = $pdo->prepare("
    SELECT COALESCE(NULLIF(vehicle_type, ''), 'Unknown') AS vt,
           COALESCE(SUM(amount), 0) AS revenue,
           COUNT(*) AS cnt
    FROM wallet_transactions
    WHERE UPPER(type)='FEE'
      AND UPPER(status) IN ('SUCCESSFUL','COMPLETED','SUCCESS')
      AND created_at >= ?
    GROUP BY COALESCE(NULLIF(vehicle_type, ''), 'Unknown')
");
$stmt->execute([$monthStart]);
$byVehicle = [];
while ($row = $stmt->fetch()) {
    $byVehicle[$row['vt']] = ['revenue'=>(float)$row['revenue'],'count'=>(int)$row['cnt']];
}

 $stmt = $pdo->prepare("
    SELECT (created_at + interval '8 hours')::date AS d,
           COALESCE(SUM(amount), 0) AS total,
           COUNT(*) AS cnt
    FROM wallet_transactions
    WHERE UPPER(type)='FEE'
      AND UPPER(status) IN ('SUCCESSFUL','COMPLETED','SUCCESS')
      AND created_at >= ?
    GROUP BY (created_at + interval '8 hours')::date
    ORDER BY d ASC
");
$stmt->execute([$trendStart]);
$dailyTrend = [];
while ($row = $stmt->fetch()) {
    $dailyTrend[$row['d']] = ['fees'=>(float)$row['total'],'count'=>(int)$row['cnt']];
}

 $totalStations = 0; $activeStations = 0;
try {
    $row = $pdo->query("SELECT COUNT(*) AS total, COUNT(CASE WHEN LOWER(status)='active' THEN 1 END) AS active FROM terminals")->fetch() ?: [];
    $totalStations  = (int)($row['total']  ?? 0);
    $activeStations = (int)($row['active'] ?? 0);
} catch (Throwable $e) {}

$response = [
    'success' => true,
    'data' => [
        'today' => [
            'fees'       => round((float)$today['fees'], 2),
            'feesCount'  => (int)$today['fees_count'],
            'loads'      => round((float)$today['loads'], 2),
            'loadsCount' => (int)$today['loads_count'],
        ],
        'month' => [
            'fees'      => round((float)$month['total'], 2),
            'feesCount' => (int)$month['cnt'],
        ],
        'completedFees' => $completedFees,
        'drivers' => [
            'total'      => (int)($drivers['total']       ?? 0),
            'active'     => (int)($drivers['active']      ?? 0),
            'lowBalance' => (int)($drivers['low_balance'] ?? 0),
        ],
        'vehicles' => [
            'total'  => (int)($drivers['total_vehicles']  ?? 0),
            'active' => (int)($drivers['active_vehicles'] ?? 0),
        ],
        'stations' => [
            'total'  => $totalStations,
            'active' => $activeStations,
        ],
        'byVehicle'   => $byVehicle,
        'dailyTrend'  => $dailyTrend,
        'generatedAt' => date('c'),
    ],
];

$json = json_encode($response, JSON_UNESCAPED_UNICODE);
@file_put_contents($cacheFile, $json);
echo $json;
exit;