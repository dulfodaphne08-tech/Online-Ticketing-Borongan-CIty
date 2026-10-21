<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

const MAX_LOAD = 50000;

$user = requireRole('driver', 'admin', 'cashier', 'staff');

$action = trim((string)($_GET['action'] ?? ''));
if ($action === '') {
    $b = body();
    $action = trim((string)($b['action'] ?? ''));
}

function targetDriverId(PDO $pdo, array $user, bool $required = true): string {
    if ($user['role'] === 'driver') return sessionDriverId($pdo, $user);
    $b = body();
    $id = trim((string)($_GET['driverId'] ?? $b['driverId'] ?? ''));
    if ($id === '' && $required) fail('Driver ID is required.', 422);
    return $id;
}

function getMaxWalletBalance(string $vehicleType): float {
    $v = strtolower(trim($vehicleType));
    if ($v === 'bus') return 1000.00;
    if ($v === 'jeepney' || $v === 'multicab') return 500.00;
    return 150.00;  
}

function safeLastTransaction(PDO $pdo, string $driverId): ?array {
    try {
        $stmt = $pdo->prepare(
            TRANSACTION_SELECT . ' WHERE wt.driver_id = ? ORDER BY wt.created_at DESC LIMIT 1'
        );
        $stmt->execute([$driverId]);
        $row = $stmt->fetch();
        return $row ? formatTransaction($row) : null;
    } catch (Throwable $e) {
        error_log('wallet.php: safeLastTransaction failed: ' . $e->getMessage());
        try {
            $stmt = $pdo->prepare(
                'SELECT id, reference_number, type, amount, previous_balance, balance_after,
                        status, created_at, driver_id, processed_by_name
                 FROM wallet_transactions WHERE driver_id = ? ORDER BY created_at DESC LIMIT 1'
            );
            $stmt->execute([$driverId]);
            $row = $stmt->fetch();
            if (!$row) return null;
            return [
                'id'              => (string)$row['id'],
                'referenceNumber' => (string)$row['reference_number'],
                'type'            => strtoupper((string)$row['type']),
                'amount'          => round((float)$row['amount'], 2),
                'previousBalance' => round((float)$row['previous_balance'], 2),
                'balanceAfter'    => round((float)$row['balance_after'], 2),
                'status'          => strtoupper((string)$row['status']),
                'processedBy'     => (string)($row['processed_by_name'] ?? ''),
                'createdAt'       => date(DATE_ATOM, strtotime((string)$row['created_at'])),
                'date'            => date('Y-m-d', strtotime((string)$row['created_at'])),
                'time'            => date('g:i A', strtotime((string)$row['created_at'])),
            ];
        } catch (Throwable $e2) {
            error_log('wallet.php: fallback last txn failed: ' . $e2->getMessage());
            return null;
        }
    }
}

function safeLastLoad(PDO $pdo, string $driverId): ?array {
    try {
        $stmt = $pdo->prepare(
            "SELECT amount, created_at FROM wallet_transactions
             WHERE driver_id = ? AND type = 'LOAD'
             ORDER BY created_at DESC LIMIT 1"
        );
        $stmt->execute([$driverId]);
        $row = $stmt->fetch();
        if (!$row) return null;
        return [
            'amount'    => round((float)$row['amount'], 2),
            'createdAt' => date(DATE_ATOM, strtotime((string)$row['created_at'])),
        ];
    } catch (Throwable $e) {
        error_log('wallet.php: safeLastLoad failed: ' . $e->getMessage());
        return null;
    }
}

if (method() === 'GET' && $action === 'balance') {
    try {
        $driverId = targetDriverId($pdo, $user);
        $driver   = findDriver($pdo, $driverId);
        if (!$driver) {
            fail('Driver profile not found for ID: ' . $driverId, 404);
        }

        $balance = round((float)($driver['balance'] ?? 0), 2);
        $fee     = getFee($pdo, (string)($driver['vehicle_type'] ?? ''));
        $status  = (string)($driver['status'] ?? 'Active');
        
        $maxLimit = getMaxWalletBalance((string)($driver['vehicle_type'] ?? ''));
        $capacity = max(0, $maxLimit - $balance);

        $lastRow  = safeLastTransaction($pdo, (string)$driver['driver_id']);
        $loadRow  = safeLastLoad($pdo, (string)$driver['driver_id']);

        ok([
            'driverId'        => (string)$driver['driver_id'],
            'balance'         => $balance,
            'maxLimit'        => $maxLimit,
            'capacity'        => $capacity,
            'status'          => $status,
            'fee'             => $fee,
            'lastTransaction' => $lastRow,
            'lastLoad'        => $loadRow,
            'checkedAt'       => date(DATE_ATOM),
        ]);
    } catch (Throwable $e) {
        error_log('wallet.php balance fatal: ' . $e->getMessage());
        fail('Could not load wallet balance: ' . $e->getMessage(), 500);
    }
}

if (method() === 'GET' && $action === 'history') {
    try {
        $driverId = targetDriverId($pdo, $user, false);
        $type     = strtoupper((string)($_GET['type'] ?? 'ALL'));
        $limit    = max(1, min(500, (int)($_GET['limit'] ?? 50)));

        $where = [];
        $args  = [];
        if ($driverId !== '') {
            $where[] = 'wt.driver_id = ?';
            $args[]  = $driverId;
        }
        if (in_array($type, ['LOAD', 'FEE'], true)) {
            $where[] = 'wt.type = ?';
            $args[]  = $type;
        }

        $sql = TRANSACTION_SELECT
             . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
             . " ORDER BY wt.created_at DESC LIMIT {$limit}";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($args);
        $rows = $stmt->fetchAll();

        ok(['transactions' => array_map('formatTransaction', $rows)]);
    } catch (Throwable $e) {
        error_log('wallet.php history FULL SELECT failed: ' . $e->getMessage());

        try {
            $driverId = targetDriverId($pdo, $user, false);
            $limit    = max(1, min(500, (int)($_GET['limit'] ?? 50)));
            $type     = strtoupper((string)($_GET['type'] ?? 'ALL'));

            $sql = "SELECT id, reference_number, or_number, type, driver_id, amount,
                           previous_balance, balance_after, processed_by_name, status,
                           created_at, vehicle_type
                    FROM wallet_transactions
                    WHERE driver_id = ?";
            $args = [$driverId];
            if (in_array($type, ['LOAD', 'FEE'], true)) {
                $sql .= ' AND type = ?';
                $args[] = $type;
            }
            $sql .= ' ORDER BY created_at DESC LIMIT ' . $limit;

            $stmt = $pdo->prepare($sql);
            $stmt->execute($args);
            $rows = $stmt->fetchAll();

            $txns = array_map(function ($r) {
                $ts = $r['created_at'] ? strtotime((string)$r['created_at']) : false;
                return [
                    'id'              => (string)($r['id'] ?? ''),
                    'referenceNumber' => (string)($r['reference_number'] ?? ''),
                    'orNumber'        => $r['or_number'] ?? null,
                    'type'            => strtoupper((string)($r['type'] ?? '')),
                    'driverId'        => (string)($r['driver_id'] ?? ''),
                    'amount'          => round((float)($r['amount'] ?? 0), 2),
                    'previousBalance' => round((float)($r['previous_balance'] ?? 0), 2),
                    'balanceAfter'    => round((float)($r['balance_after'] ?? 0), 2),
                    'processedBy'     => (string)($r['processed_by_name'] ?? ''),
                    'status'          => strtoupper((string)($r['status'] ?? 'SUCCESSFUL')),
                    'vehicleType'     => (string)($r['vehicle_type'] ?? ''),
                    'createdAt'       => $ts ? date(DATE_ATOM, $ts) : null,
                    'date'            => $ts ? date('Y-m-d', $ts) : null,
                    'time'            => $ts ? date('g:i A', $ts) : null,
                ];
            }, $rows);

            ok(['transactions' => $txns, 'fallback' => true]);
        } catch (Throwable $e2) {
            error_log('wallet.php history fallback also failed: ' . $e2->getMessage());
            fail('Could not load transaction history: ' . $e2->getMessage(), 500);
        }
    }
}

if (method() === 'GET' && $action === 'search') {
    requireRole('admin', 'cashier', 'staff');
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '') fail('Type a name, Driver ID or plate number to search.', 422);

    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';

    $stmt = $pdo->prepare('SELECT ' . DRIVER_COLUMNS . '
        FROM drivers d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.full_name ILIKE ?
           OR d.driver_id ILIKE ?
           OR d.plate_number ILIKE ?
           OR d.body_number ILIKE ?
        ORDER BY d.full_name ASC
        LIMIT 15');
    $stmt->execute([$like, $like, $like, $like]);

    $drivers = array_map(
        fn($d) => formatDriver($d, getFee($pdo, (string)$d['vehicle_type'])),
        $stmt->fetchAll()
    );
    ok(['drivers' => $drivers]);
}

if (method() === 'POST' && $action === 'load') {
    $actor = requireRole('admin', 'cashier', 'staff');
    $b     = body();

    $driverId  = trim((string)($b['driverId'] ?? ''));
    $amountRaw = $b['amount'] ?? null;
    $method    = strtoupper(trim((string)($b['paymentMethod'] ?? 'CASH'))) ?: 'CASH';
    $confirmed = !empty($b['confirmDuplicate']);
    $orNumber  = trim((string)($b['orNumber'] ?? ''));

    if ($driverId === '') fail('Please select a driver first.', 422);
    if (!is_numeric($amountRaw)) fail('Please enter a valid amount.', 422);
    $amount = round((float)$amountRaw, 2);
    if ($amount <= 0) fail('Amount must be greater than ₱0.', 422);
    if ($amount > MAX_LOAD) fail('The maximum load per transaction is ' . peso(MAX_LOAD) . '.', 422);
    if (!in_array($method, ['CASH', 'GCASH', 'MAYA', 'BANK'], true)) $method = 'CASH';

    try {
        $pdo->beginTransaction();
        $lockStmt = $pdo->prepare("SELECT * FROM drivers WHERE driver_id = ? FOR UPDATE");
        $lockStmt->execute([$driverId]);
        $driver = $lockStmt->fetch(PDO::FETCH_ASSOC);

        if (!$driver) { $pdo->rollBack(); fail('Driver not found.', 404); }
        if (!isActive($driver['status'])) {
            $pdo->rollBack();
            fail('This driver account is inactive.', 403);
        }

        $currentBalance = round((float)($driver['balance'] ?? 0), 2);
        $vehicleType    = (string)($driver['vehicle_type'] ?? '');
        $maxLimit       = getMaxWalletBalance($vehicleType);
        
        if (($currentBalance + $amount) > $maxLimit) {
            $pdo->rollBack();
            fail(
                'Load amount exceeds the maximum wallet balance limit for a ' . $vehicleType . ' (Max: ' . peso($maxLimit) . '). Available capacity: ' . peso(max(0, $maxLimit - $currentBalance)),
                422,
                [
                    'maxLimit' => $maxLimit,
                    'currentBalance' => $currentBalance,
                    'availableCapacity' => max(0, $maxLimit - $currentBalance)
                ],
                'MAX_BALANCE_EXCEEDED'
            );
        }
 
        if (!$confirmed) {
            $dup = $pdo->prepare("SELECT reference_number FROM wallet_transactions
                WHERE driver_id = ? AND type = 'LOAD' AND amount = ? AND processed_by_name = ?
                  AND created_at >= now() - interval '30 seconds' LIMIT 1");
            $dup->execute([$driver['driver_id'], $amount, $actor['fullName'] ?: $actor['username']]);
            if ($ref = $dup->fetchColumn()) {
                $pdo->rollBack();
                fail('Duplicate load detected (' . $ref . '). Load again anyway?', 409,
                     ['reference' => $ref], 'DUPLICATE_LOAD');
            }
        }

        if ($orNumber !== '') {
            $dupOr = $pdo->prepare("SELECT reference_number FROM wallet_transactions
                WHERE or_number = ? AND type = 'LOAD' LIMIT 1");
            $dupOr->execute([$orNumber]);
            if ($prevRef = $dupOr->fetchColumn()) {
                $pdo->rollBack();
                fail('Duplicate reference number ' . $orNumber . ' (previously ' . $prevRef . ').',
                     409, ['reference' => $prevRef], 'DUPLICATE_OR');
            }
        }

        $upd = $pdo->prepare('UPDATE drivers SET balance = COALESCE(balance, 0) + ? WHERE driver_id = ? RETURNING balance');
        $upd->execute([$amount, $driver['driver_id']]);
        $newBalance  = round((float)$upd->fetchColumn(), 2);
        $prevBalance = round($newBalance - $amount, 2);

        $ref = newReference('LD');
        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, or_number, driver_id, type, fee_type, vehicle_type, amount,
             previous_balance, balance_after, payment_method, processed_by, processed_by_name, status)
            VALUES (?, ?, ?, 'LOAD', 'Wallet Load', ?, ?, ?, ?, ?, ?, ?, 'SUCCESSFUL')
            RETURNING id, created_at");
        $ins->execute([
            $ref, $orNumber !== '' ? $orNumber : null,
            $driver['driver_id'], $driver['vehicle_type'], $amount,
            $prevBalance, $newBalance, $method,
            $actor['id'], $actor['fullName'] ?: $actor['username']
        ]);
        $row = $ins->fetch();

        addNotification(
            $pdo,
            (string)$driver['driver_id'],
            'Wallet Loaded',
            peso($amount) . ' was loaded to your wallet. New balance: ' . peso($newBalance) . '. Ref: ' . $ref,
            'WALLET_LOAD'
        );

        try {
            $me = currentUser();
            $pdo->prepare("INSERT INTO audit_logs
                (user_id, user_name, role, action, record_type, record_ref, details, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                ->execute([
                    $me['id'] ?? null,
                    $me['fullName'] ?? $me['username'] ?? 'System',
                    $me['role'] ?? 'System',
                    'Loaded Driver Wallet',
                    'WALLET_LOAD',
                    $ref,
                    'Added ' . peso($amount) . ' to ' . $driver['full_name'],
                    $_SERVER['REMOTE_ADDR'] ?? null,
                ]);
        } catch (Throwable $e) {
            error_log('auditLog: ' . $e->getMessage());
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('wallet load failed: ' . $e->getMessage());
        fail('The load could not be completed: ' . $e->getMessage(), 500);
    }

    ok([
        'receipt' => [
            'referenceNumber' => $ref,
            'orNumber'        => $orNumber !== '' ? $orNumber : '—',
            'type'            => 'LOAD',
            'driverId'        => (string)$driver['driver_id'],
            'driverName'      => (string)$driver['full_name'],
            'vehicleType'     => (string)($driver['vehicle_type'] ?? '—'),
            'bodyNumber'      => (string)($driver['body_number'] ?? '—'),
            'plateNumber'     => (string)($driver['plate_number'] ?? '—'),
            'amount'          => $amount,
            'previousBalance' => $prevBalance,
            'balanceAfter'    => $newBalance,
            'paymentMethod'   => $method,
            'processedBy'     => $actor['fullName'] ?: $actor['username'],
            'status'          => 'SUCCESSFUL',
            'date'            => date('Y-m-d', strtotime((string)$row['created_at'])),
            'time'            => date('g:i A', strtotime((string)$row['created_at'])),
        ],
    ], peso($amount) . ' loaded to ' . $driver['full_name'] . '.');
}

fail('Unknown request: action=' . $action, 400);