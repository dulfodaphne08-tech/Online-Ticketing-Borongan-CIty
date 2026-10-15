<?php
 defined('DB_DRIVER') || define('DB_DRIVER', getenv('DB_DRIVER') ?: 'pgsql');

 defined('SUPABASE_URI')     || define('SUPABASE_URI',     getenv('SUPABASE_URI')     ?: '');
defined('SUPABASE_HOST')    || define('SUPABASE_HOST',    getenv('SUPABASE_HOST')    ?: 'aws-0-ap-southeast-1.pooler.supabase.com');
defined('SUPABASE_PORT')    || define('SUPABASE_PORT',    getenv('SUPABASE_PORT')    ?: '5432');
defined('SUPABASE_DB')      || define('SUPABASE_DB',      getenv('SUPABASE_DB')      ?: 'postgres');
defined('SUPABASE_USER')    || define('SUPABASE_USER',    getenv('SUPABASE_USER')    ?: 'postgres.lmwjnhlegodamitwwvem');
defined('SUPABASE_PASS')    || define('SUPABASE_PASS',    getenv('SUPABASE_PASS')    ?: '');
defined('SUPABASE_SSLMODE') || define('SUPABASE_SSLMODE', getenv('SUPABASE_SSLMODE') ?: 'require');

 defined('MYSQL_HOST') || define('MYSQL_HOST', getenv('MYSQL_HOST') ?: 'localhost');
defined('MYSQL_PORT') || define('MYSQL_PORT', getenv('MYSQL_PORT') ?: '3306');
defined('MYSQL_DB')   || define('MYSQL_DB',   getenv('MYSQL_DB')   ?: 'borongan_db');
defined('MYSQL_USER') || define('MYSQL_USER', getenv('MYSQL_USER') ?: 'root');
defined('MYSQL_PASS') || define('MYSQL_PASS', getenv('MYSQL_PASS') ?: '');
?>
