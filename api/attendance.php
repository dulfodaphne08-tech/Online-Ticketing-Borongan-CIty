<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

$me      = currentUser();
$method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$isAdmin = strtolower($me['role'] ?? '') === 'admin';

if ($method === 'POST') {
    $body   = body();
    $action = strtolower(trim((string)($body['action'] ?? '')));

    if (!in_array($action, ['time-in', 'time-out'], true)) fail('Unknown action.', 422);
    if ($isAdmin) fail('Admins do not clock in.', 403);

    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');

    if ($action === 'time-in') {
        $schedule = '08:00';
        try {
            $s = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'attendance_schedule_in'");
            $s->execute();
            $row = $s->fetch();
            if ($row) $schedule = $row['setting_value'];
        } catch (Throwable $_) {}

        $now       = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
        $schedTime = DateTimeImmutable::createFromFormat('Y-m-d H:i', $today . ' ' . $schedule, new DateTimeZone('Asia/Manila'));
        $status    = ($schedTime && $now > $schedTime) ? 'LATE' : 'ON TIME';

        $stmt = $pdo->prepare("
            INSERT INTO attendance (user_id, user_name, role, work_date, time_in, status)
            VALUES (:uid, :uname, :role, :work_date, NOW(), :status)
            ON CONFLICT (user_id, work_date) DO UPDATE
              SET time_in = EXCLUDED.time_in, status = EXCLUDED.status
            RETURNING attendance_id, status, time_in");
        $stmt->execute([
            ':uid'       => $me['id'],
            ':uname'     => $me['fullName'] ?? $me['username'] ?? 'Unknown',
            ':role'      => $me['role'],
            ':work_date' => $today,
            ':status'    => $status,
        ]);
        ok(['attendance' => $stmt->fetch(PDO::FETCH_ASSOC)]);
    }

    $stmt = $pdo->prepare("
        UPDATE attendance SET time_out = NOW()
         WHERE user_id = :uid AND work_date = :work_date
         RETURNING attendance_id, time_in, time_out, status");
    $stmt->execute([':uid' => $me['id'], ':work_date' => $today]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) fail('No time-in record found for today.', 404);
    ok(['attendance' => $row]);
}

if ($method !== 'GET') fail('Method not allowed.', 405);

$action = strtolower(trim((string)($_GET['action'] ?? 'list')));
$date   = trim((string)($_GET['date']   ?? '')) ?: (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');

if ($action === 'alerts') {
    if (!$isAdmin) fail('Only administrators can view attendance alerts.', 403);
    $stmt = $pdo->prepare("SELECT user_name, role, time_in, status FROM attendance WHERE work_date = :d AND status = 'LATE' ORDER BY time_in ASC");
    $stmt->execute([':d' => $date]);
    $late = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $alerts = array_map(static function (array $r): array {
        $mins = 0;
        if ($r['time_in']) {
            try {
                $t = new DateTimeImmutable($r['time_in'], new DateTimeZone('Asia/Manila'));
                $sched = $t->setTime(8, 0, 0);
                $mins = max(0, (int)(($t->getTimestamp() - $sched->getTimestamp()) / 60));
            } catch (Throwable $_) {}
        }
        return ['name' => $r['user_name'], 'role' => $r['role'], 'timeIn' => $r['time_in'], 'minutesLate' => $mins];
    }, $late);
    ok(['date' => $date, 'alerts' => $alerts, 'count' => count($alerts)]);
}

if ($action !== 'list') fail('Unknown action.', 422);

$sql = "SELECT attendance_id, user_id, user_name, role, work_date, time_in, time_out, status, notes
        FROM attendance WHERE work_date = :d";
$params = [':d' => $date];
if (!$isAdmin) {
    $sql .= ' AND user_id = :uid';
    $params[':uid'] = $me['id'];
}
$sql .= ' ORDER BY time_in ASC NULLS LAST';
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$records = array_map(static function (array $r): array {
    $fmt = static function ($ts): string {
        if (!$ts) return '—';
        try { return (new DateTimeImmutable($ts, new DateTimeZone('Asia/Manila')))->format('g:i A'); }
        catch (Throwable $_) { return $ts; }
    };
    return [
        'id' => (int)$r['attendance_id'], 'userId' => $r['user_id'],
        'name' => $r['user_name'], 'role' => $r['role'], 'date' => $r['work_date'],
        'timeIn' => $fmt($r['time_in']), 'timeOut' => $fmt($r['time_out']),
        'status' => $r['status'], 'notes' => $r['notes'],
    ];
}, $rows);

ok(['date' => $date, 'records' => $records, 'count' => count($records)]);