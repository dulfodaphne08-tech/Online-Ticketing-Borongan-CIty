<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

$user = currentUser();
if (!$user) ok(['user' => null, 'redirect' => null], 'Not logged in.');

ok(['user' => $user, 'redirect' => landingPageFor($user['role'])]);
