<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

 if ($method === 'GET') {
    requireRole('staff', 'admin');
} else {
    requireRole('admin');
}

 if ($method === 'GET') {
    $stmt = $pdo->query("SELECT setting_key, setting_value, updated_at FROM system_settings ORDER BY setting_key");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $settings = [];
    foreach ($rows as $r) $settings[$r['setting_key']] = $r['setting_value'];
    ok(['settings' => $settings]);
}

 if ($method === 'POST') {
    $body = body();
    if (!is_array($body) || empty($body)) fail('No settings provided.', 422);

    $me   = currentUser();
    $stmt = $pdo->prepare("
        INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
        VALUES (:k, :v, :by, NOW())
        ON CONFLICT (setting_key) DO UPDATE
          SET setting_value = EXCLUDED.setting_value,
              updated_by    = EXCLUDED.updated_by,
              updated_at    = NOW()");

    foreach ($body as $key => $value) {
        if (!is_string($key) || $key === '') continue;
        $stmt->execute([
            ':k'  => $key,
            ':v'  => is_scalar($value) ? (string)$value : json_encode($value),
            ':by' => $me['fullName'] ?? $me['username'] ?? 'Admin',
        ]);
    }

    try {
        $pdo->prepare("INSERT INTO audit_logs (user_id, user_name, role, action, record_type, details, ip_address)
                       VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([
                $me['id'] ?? null,
                $me['fullName'] ?? $me['username'] ?? 'Admin',
                $me['role'] ?? 'Admin',
                'Updated System Settings', 'SETTINGS',
                'Keys: ' . implode(', ', array_keys($body)),
                $_SERVER['REMOTE_ADDR'] ?? null,
            ]);
    } catch (Throwable $_) {}

    ok(['updated' => array_keys($body)]);
}

fail('Method not allowed.', 405);