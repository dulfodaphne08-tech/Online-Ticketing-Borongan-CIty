<?php
 declare(strict_types=1);

function loadEnvFile(string $path): void {
    if (!is_readable($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = trim(rtrim($value, "; \t"), "\"'");    
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

loadEnvFile(dirname(__DIR__) . '/.env');

 if (is_file(__DIR__ . '/db_config.php')) {
    require_once __DIR__ . '/db_config.php';
}

function env(string $key, string $default = ''): string {
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : $value;
}

function constValue(string $name): string {
    return defined($name) ? trim((string)constant($name)) : '';
}

function isPlaceholder(string $host, string $pass): bool {
    return $host === '' || $pass === ''
        || stripos($host, 'your-project') !== false
        || stripos($pass, 'YOUR-PASSWORD') !== false
        || stripos($pass, 'YOUR_SUPABASE') !== false;
}

 function settingsFromUri(string $uri, string $defaultSsl): array {
    $p = parse_url($uri);
    if ($p === false || empty($p['host'])) {
        throw new RuntimeException('The database connection string is not a valid postgresql:// URI.');
    }
    parse_str($p['query'] ?? '', $query);
    return [
        'host' => $p['host'],
        'port' => (int)($p['port'] ?? 5432),
        'name' => isset($p['path']) && $p['path'] !== '/' ? ltrim($p['path'], '/') : 'postgres',
        'user' => isset($p['user']) ? urldecode($p['user']) : 'postgres',
        'pass' => isset($p['pass']) ? urldecode($p['pass']) : '',
        'ssl'  => (string)($query['sslmode'] ?? $defaultSsl),
    ];
}

 function databaseSettings(): array {
    $candidates = [];

     if (env('DATABASE_URL') !== '') {
        $candidates[] = settingsFromUri(env('DATABASE_URL'), env('DB_SSLMODE', 'require'));
    } elseif (env('DB_HOST') !== '') {
        $candidates[] = [
            'host' => env('DB_HOST'), 'port' => (int)env('DB_PORT', '5432'), 'name' => env('DB_NAME', 'postgres'),
            'user' => env('DB_USER', 'postgres'), 'pass' => env('DB_PASS'), 'ssl' => env('DB_SSLMODE', 'require'),
        ];
    }

     $ssl = constValue('SUPABASE_SSLMODE') ?: 'require';
    if (constValue('SUPABASE_URI') !== '') {
        $candidates[] = settingsFromUri(constValue('SUPABASE_URI'), $ssl);
    } elseif (constValue('SUPABASE_HOST') !== '') {
        $candidates[] = [
            'host' => constValue('SUPABASE_HOST'), 'port' => (int)(constValue('SUPABASE_PORT') ?: 5432),
            'name' => constValue('SUPABASE_DB') ?: 'postgres', 'user' => constValue('SUPABASE_USER') ?: 'postgres',
            'pass' => constValue('SUPABASE_PASS'), 'ssl' => $ssl,
        ];
    }

    foreach ($candidates as $c) {
        if (isPlaceholder($c['host'], $c['pass'])) continue;
        return ["pgsql:host={$c['host']};port={$c['port']};dbname={$c['name']};sslmode={$c['ssl']}", $c['user'], $c['pass']];
    }

    throw new RuntimeException('Database is not configured. Fill in api/db_config.php (SUPABASE_HOST, SUPABASE_USER, SUPABASE_PASS) or set DATABASE_URL in .env.');
}
