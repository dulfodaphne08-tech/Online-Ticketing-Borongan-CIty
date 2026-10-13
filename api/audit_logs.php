<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

requireRole('admin');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

 if ($method === 'POST') {
    $body = body();
    $action    = trim((string)($body['action']     ?? ''));
    $recordRef = trim((string)($body['recordRef']  ?? ''));
    $recordT   = trim((string)($body['recordType'] ?? ''));
    $details   = trim((string)($body['details']    ?? ''));

    if ($action === '') fail('Action is required.', 422);

    $me = currentUser();
    $stmt = $pdo->prepare("INSERT INTO audit_logs
        (user_id, user_name, role, action, record_type, record_ref, details, ip_address)
        VALUES (:uid, :uname, :role, :action, :rtype, :rref, :details, :ip)");
    $stmt->execute([
        ':uid'     => $me['id']       ?? null,
        ':uname'   => $me['fullName'] ?? $me['username'] ?? 'Unknown',
        ':role'    => $me['role']     ?? 'System',
        ':action'  => $action,
        ':rtype'   => $recordT ?: null,
        ':rref'    => $recordRef ?: null,
        ':details' => $details ?: null,
        ':ip'      => $_SERVER['REMOTE_ADDR'] ?? null,
    ]);
    ok(['audit_id' => (int)$pdo->lastInsertId()]);
}

if ($method !== 'GET') fail('Method not allowed.', 405);

 $search   = trim((string)($_GET['q']    ?? ''));
$dateFrom = trim((string)($_GET['from'] ?? ''));
$dateTo   = trim((string)($_GET['to']   ?? ''));
$role     = trim((string)($_GET['role'] ?? ''));
$limit    = max(1, min(1000, (int)($_GET['limit'] ?? 500)));

$where  = [];
$params = [];

if ($search !== '') {
    $where[] = "(user_name ILIKE :q OR action ILIKE :q OR details ILIKE :q OR record_ref ILIKE :q)";
    $params[':q'] = '%' . $search . '%';
}
if ($dateFrom !== '') {
    $where[] = "created_at >= :from";
    $params[':from'] = $dateFrom . ' 00:00:00';
}
if ($dateTo !== '') {
    $where[] = "created_at <= :to";
    $params[':to'] = $dateTo . ' 23:59:59';
}
if ($role !== '' && strtolower($role) !== 'all') {
    $where[] = "LOWER(role) = :role";
    $params[':role'] = strtolower($role);
}

$sql = "SELECT audit_id, created_at, user_id, user_name, role,
               action, record_type, record_ref, details, ip_address
        FROM audit_logs";
if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
$sql .= ' ORDER BY created_at DESC LIMIT ' . $limit;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$logs = array_map(static function (array $r): array {
    $when = $r['created_at'];
    try { $when = (new DateTimeImmutable($r['created_at']))->format('M j, Y g:i A'); }
    catch (Throwable $_) {}
    return [
        'id'         => (int)$r['audit_id'],
        'timestamp'  => $when,
        'createdAt'  => $r['created_at'],
        'user'       => $r['user_name'] ?: 'System',
        'userId'     => $r['user_id'],
        'role'       => $r['role'] ?: 'System',
        'action'     => $r['action'],
        'recordType' => $r['record_type'],
        'recordRef'  => $r['record_ref'],
        'details'    => $r['details'],
        'ipAddress'  => $r['ip_address'],
    ];
}, $rows);

ok(['logs' => $logs, 'count' => count($logs)]);