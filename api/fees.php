<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$method = method();
$me     = currentUser();

 if ($method === 'GET') {
    $stmt = $pdo->query("SELECT vehicle_type, amount, effective_date, is_active, updated_by, updated_at
                         FROM fees
                         WHERE coalesce(is_active, true) = true
                         ORDER BY vehicle_type");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $fees = [];
    foreach ($rows as $r) {
        $fees[$r['vehicle_type']] = (float)$r['amount'];
    }

    if (empty($fees)) {
        $fees = ['Tricycle' => 5.0, 'Jeepney' => 60.0, 'Multicab' => 60.0, 'Bus' => 100.0];
    }

     if (isset($_GET['history'])) {
        requireRole('admin');
        $h = $pdo->query("SELECT id, vehicle_type, old_fee, new_fee, changed_by_name, reason, created_at
                          FROM fee_history
                          ORDER BY created_at DESC
                          LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);
        ok(['fees' => $fees, 'history' => array_map(fn($r) => [
            'id'             => (int)$r['id'],
            'vehicleType'    => (string)$r['vehicle_type'],
            'oldFee'         => $r['old_fee'] !== null ? (float)$r['old_fee'] : null,
            'newFee'         => (float)$r['new_fee'],
            'changedBy'      => (string)($r['changed_by_name'] ?? 'System'),
            'reason'         => (string)($r['reason'] ?? ''),
            'createdAt'      => (string)$r['created_at'],
        ], $h)]);
    }

    ok(['fees' => $fees]);
}

 if ($method === 'POST') {
    requireRole('admin');

    $body  = body();
    $reason = trim((string)($body['reason'] ?? ''));
    unset($body['reason']);

    if (!is_array($body) || empty($body)) fail('No fees provided.', 422);

     $clean = [];
    foreach ($body as $vehicleType => $amount) {
        $v = trim((string)$vehicleType);
        $a = (float)$amount;
        if ($v === '') continue;
        if ($a <= 0) fail("Fee for {$v} must be greater than zero.", 422);
        if ($a > 100000) fail("Fee for {$v} is unreasonably high.", 422);
        $clean[$v] = round($a, 2);
    }
    if (empty($clean)) fail('No valid fees provided.', 422);

    try {
        $pdo->beginTransaction();

         $currentRows = $pdo->query("SELECT vehicle_type, amount FROM fees WHERE coalesce(is_active,true)=true")
                           ->fetchAll(PDO::FETCH_ASSOC);
        $current = [];
        foreach ($currentRows as $r) $current[$r['vehicle_type']] = (float)$r['amount'];

        $historyStmt = $pdo->prepare("INSERT INTO fee_history
            (vehicle_type, old_fee, new_fee, changed_by_id, changed_by_name, reason)
            VALUES (?, ?, ?, ?, ?, ?)");

        $upsert = $pdo->prepare("INSERT INTO fees
            (vehicle_type, amount, effective_date, is_active, updated_by, updated_at)
            VALUES (?, ?, CURRENT_DATE, true, ?, now())
            ON CONFLICT (vehicle_type) DO UPDATE
              SET amount         = EXCLUDED.amount,
                  effective_date = CURRENT_DATE,
                  is_active      = true,
                  updated_by     = EXCLUDED.updated_by,
                  updated_at     = now()");

        foreach ($clean as $vehicleType => $newFee) {
            $oldFee = $current[$vehicleType] ?? null;

             if ($oldFee === null || abs($oldFee - $newFee) > 0.001) {
                $historyStmt->execute([
                    $vehicleType,
                    $oldFee,
                    $newFee,
                    $me['id']       ?? null,
                    $me['fullName'] ?? $me['username'] ?? 'Admin',
                    $reason ?: null,
                ]);
            }

            $upsert->execute([$vehicleType, $newFee, $me['fullName'] ?? 'Admin']);
        }

        $pdo->commit();

        auditLog('Updated Fee Configuration', 'FEE', null,
                 'Updated: ' . implode(', ', array_keys($clean)) .
                 ($reason ? " · Reason: {$reason}" : ''));

        ok(['fees' => $clean, 'updated' => array_keys($clean)], 'Fee rates saved with history.');
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Fee update failed: ' . $e->getMessage());
        fail('Fee update could not be saved.', 500);
    }
}

fail('Method not allowed.', 405);