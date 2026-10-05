<?php
 
declare(strict_types=1);
require_once __DIR__ . '/config.php';

const MAX_LOAD = 50000;

$user   = requireRole('driver', ...STAFF_ROLES);
$action = (string)($_GET['action'] ?? body()['action'] ?? '');

 function targetDriverId(PDO $pdo, array $user, bool $required = true): string {
    if ($user['role'] === 'driver') return sessionDriverId($pdo, $user);
    $id = trim((string)($_GET['driverId'] ?? body()['driverId'] ?? ''));
    if ($id === '' && $required) fail('Driver ID is required.', 422);
    return $id;
}

 if (method() === 'GET' && $action === 'balance') {
    $driver = findDriver($pdo, targetDriverId($pdo, $user));
    if (!$driver) fail('Driver not found.', 404);

    $last = $pdo->prepare(TRANSACTION_SELECT . ' WHERE wt.driver_id = ? ORDER BY wt.created_at DESC LIMIT 1');
    $last->execute([$driver['driver_id']]);
    $lastRow = $last->fetch();

    $lastLoad = $pdo->prepare("SELECT amount, created_at FROM wallet_transactions WHERE driver_id = ? AND type = 'LOAD' ORDER BY created_at DESC LIMIT 1");
    $lastLoad->execute([$driver['driver_id']]);
    $loadRow = $lastLoad->fetch();

    ok([
        'driverId'        => (string)$driver['driver_id'],
        'balance'         => round((float)$driver['balance'], 2),
        'status'          => (string)($driver['status'] ?? 'Active'),
        'fee'             => getFee($pdo, (string)$driver['vehicle_type']),
        'lastTransaction' => $lastRow ? formatTransaction($lastRow) : null,
        'lastLoad'        => $loadRow ? ['amount' => round((float)$loadRow['amount'], 2), 'createdAt' => date(DATE_ATOM, strtotime((string)$loadRow['created_at']))] : null,
        'checkedAt'       => date(DATE_ATOM),
    ]);
}

 if (method() === 'GET' && $action === 'history') {
    $driverId = targetDriverId($pdo, $user, false);
    $type     = strtoupper((string)($_GET['type'] ?? 'ALL'));
    $limit    = max(1, min(500, (int)($_GET['limit'] ?? 50)));

    $where = [];
    $args  = [];
    if ($driverId !== '') { $where[] = 'wt.driver_id = ?'; $args[] = $driverId; }
    if (in_array($type, ['LOAD', 'FEE'], true)) { $where[] = 'wt.type = ?'; $args[] = $type; }

    $sql = TRANSACTION_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
         . " ORDER BY wt.created_at DESC LIMIT {$limit}";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($args);

    ok(['transactions' => array_map('formatTransaction', $stmt->fetchAll())]);
}

 if (method() === 'GET' && $action === 'search') {
    requireRole(...STAFF_ROLES);
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '') fail('Type a name, Driver ID or plate number to search.', 422);

    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
    $stmt = $pdo->prepare('SELECT ' . DRIVER_COLUMNS . '
        FROM drivers d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.full_name ILIKE :q OR d.driver_id ILIKE :q OR d.plate_number ILIKE :q OR d.body_number ILIKE :q
        ORDER BY d.full_name ASC
        LIMIT 15');
    $stmt->execute([':q' => $like]);

    $drivers = array_map(fn($d) => formatDriver($d, getFee($pdo, (string)$d['vehicle_type'])), $stmt->fetchAll());
    ok(['drivers' => $drivers]);
}

 if (method() === 'POST' && $action === 'load') {
    $actor = requireRole(...STAFF_ROLES);
    $b     = body();

    $driverId  = trim((string)($b['driverId'] ?? ''));
    $amountRaw = $b['amount'] ?? null;
    $method    = strtoupper(trim((string)($b['paymentMethod'] ?? 'CASH'))) ?: 'CASH';
    $confirmed = !empty($b['confirmDuplicate']);
    $orNumber  = trim((string)($b['orNumber'] ?? $b['referenceNumber'] ?? ''));

    if ($driverId === '') fail('Please select a driver first.', 422);
    if (!is_numeric($amountRaw)) fail('Please enter a valid amount.', 422);
    $amount = round((float)$amountRaw, 2);
    if ($amount <= 0) fail('Amount must be greater than ₱0.', 422);
    if ($amount > MAX_LOAD) fail('The maximum load per transaction is ' . peso(MAX_LOAD) . '.', 422);
    if (!in_array($method, ['CASH', 'GCASH', 'MAYA', 'BANK'], true)) $method = 'CASH';

    try {
        $pdo->beginTransaction();

        $driver = findDriver($pdo, $driverId, true);    
        if (!$driver) { $pdo->rollBack(); fail('Driver not found. Please check the Driver ID.', 404); }
        if (!isActive($driver['status'])) { $pdo->rollBack(); fail('This driver account is inactive. Loading is not allowed.', 403); }

         if (!$confirmed) {
            $dup = $pdo->prepare("SELECT reference_number FROM wallet_transactions
                WHERE driver_id = ? AND type = 'LOAD' AND amount = ? AND processed_by_name = ?
                  AND created_at >= now() - interval '30 seconds' LIMIT 1");
            $dup->execute([$driver['driver_id'], $amount, $actor['fullName'] ?: $actor['username']]);
            if ($ref = $dup->fetchColumn()) {
                $pdo->rollBack();
                fail('The same amount was just loaded for this driver (' . $ref . '). Load again anyway?', 409, ['reference' => $ref], 'DUPLICATE_LOAD');
            }
        }

         if ($orNumber !== '') {
            $dupOr = $pdo->prepare("SELECT reference_number FROM wallet_transactions
                WHERE or_number = ? AND type = 'LOAD' LIMIT 1");
            $dupOr->execute([$orNumber]);
            if ($prevRef = $dupOr->fetchColumn()) {
                $pdo->rollBack();
                fail('Duplicate reference number. ' . $orNumber . ' has already been recorded (as ' . $prevRef . '). Please verify the reference number before continuing.', 409, ['reference' => $prevRef, 'orNumber' => $orNumber], 'DUPLICATE_OR');
            }
        }

        $upd = $pdo->prepare('UPDATE drivers SET balance = COALESCE(balance, 0) + ? WHERE driver_id = ? RETURNING balance');
        $upd->execute([$amount, $driver['driver_id']]);
        $newBalance  = round((float)$upd->fetchColumn(), 2);
        $prevBalance = round($newBalance - $amount, 2);

        $ref = newReference('LD');
        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, or_number, driver_id, type, fee_type, vehicle_type, amount, previous_balance, balance_after,
             payment_method, processed_by, processed_by_name, status)
            VALUES (?, ?, ?, 'LOAD', 'Wallet Load', ?, ?, ?, ?, ?, ?, ?, 'SUCCESSFUL')
            RETURNING id, created_at");
        $ins->execute([$ref, $orNumber !== '' ? $orNumber : null,
                       $driver['driver_id'], $driver['vehicle_type'], $amount, $prevBalance, $newBalance,
                       $method, $actor['id'], $actor['fullName'] ?: $actor['username']]);
        $row = $ins->fetch();

        addNotification($pdo, (string)$driver['driver_id'], 'Wallet Loaded',
            peso($amount) . ' was loaded to your wallet. New balance: ' . peso($newBalance) . '. Ref: ' . $ref,
            'WALLET_LOAD');

         auditLog('Loaded Driver Wallet', 'WALLET_LOAD', $ref,
            'Added ' . peso($amount) . ' to ' . $driver['full_name']
            . ($orNumber !== '' ? ' (OR: ' . $orNumber . ')' : ''));

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('wallet load: ' . $e->getMessage());
        fail('The load could not be completed. No money was added. Please try again.', 500);
    }

    $receipt = formatTransaction([
        'id' => $row['id'], 'reference_number' => $ref, 'or_number' => $orNumber !== '' ? $orNumber : null,
        'type' => 'LOAD', 'fee_type' => 'Wallet Load',
        'driver_id' => $driver['driver_id'], 'driver_name' => $driver['full_name'],
        'plate_number' => $driver['plate_number'], 'vehicle_type' => $driver['vehicle_type'],
        'amount' => $amount, 'previous_balance' => $prevBalance, 'balance_after' => $newBalance,
        'payment_method' => $method, 'processed_by_name' => $actor['fullName'] ?: $actor['username'],
        'status' => 'SUCCESSFUL', 'created_at' => $row['created_at'],
    ]);
    $receipt['bodyNumber'] = (string)($driver['body_number'] ?? '');

    ok(['receipt' => $receipt], peso($amount) . ' loaded to ' . $driver['full_name'] . '.');
}

fail('Unknown request.', 400);