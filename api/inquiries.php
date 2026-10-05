<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

function inquiryResponse(array $row): array {
    return [
        'id'         => (string)$row['id'],
        'name'       => (string)$row['name'],
        'email'      => (string)$row['email'],
        'subject'    => (string)$row['subject'],
        'topic'      => (string)$row['subject'],
        'message'    => (string)$row['message'],
        'status'     => (string)$row['status'],
        'reply'      => $row['reply'] === null ? '' : (string)$row['reply'],
        'receivedAt' => date(DATE_ATOM, strtotime((string)$row['created_at'])),
        'readAt'     => $row['read_at'] === null ? null : date(DATE_ATOM, strtotime((string)$row['read_at'])),
        'repliedAt'  => $row['replied_at'] === null ? null : date(DATE_ATOM, strtotime((string)$row['replied_at'])),
        'resolvedAt' => $row['resolved_at'] === null ? null : date(DATE_ATOM, strtotime((string)$row['resolved_at'])),
    ];
}

function inquiryById(PDO $pdo, string $id): array {
    $stmt = $pdo->prepare('SELECT id, name, email, subject, message, status, reply,
                                  created_at, read_at, replied_at, resolved_at
                           FROM public.inquiries WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) fail('Inquiry not found.', 404);
    return $row;
}

if (method() === 'POST') {
    $input = body();
    foreach (['name', 'email', 'subject', 'message'] as $field) {
        if (isset($input[$field]) && !is_string($input[$field])) {
            fail('Inquiry details must be submitted as text.', 422);
        }
    }
    $name = trim((string)($input['name'] ?? ''));
    $email = trim((string)($input['email'] ?? ''));
    $subject = trim((string)($input['subject'] ?? ''));
    $message = trim((string)($input['message'] ?? ''));

    if ($name === '' || mb_strlen($name) > 150) fail('Enter your name (up to 150 characters).', 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254) {
        fail('Enter a valid email address.', 422);
    }
    if ($subject === '' || mb_strlen($subject) > 120) fail('Select a topic.', 422);
    if ($message === '' || mb_strlen($message) > 5000) {
        fail('Enter a message (up to 5,000 characters).', 422);
    }

    try {
        $stmt = $pdo->prepare('INSERT INTO public.inquiries (name, email, subject, message)
                               VALUES (?, ?, ?, ?)
                               RETURNING id, name, email, subject, message, status, reply,
                                         created_at, read_at, replied_at, resolved_at');
        $stmt->execute([$name, $email, $subject, $message]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        error_log('Inquiry submission failed: ' . $e->getMessage());
        fail('Your inquiry could not be saved. Please try again later.', 500);
    }
    ok(['inquiry' => inquiryResponse($row)], 'Your inquiry was sent.', 201);
}

if (method() === 'GET') {
    requireRole('admin');
    try {
        $stmt = $pdo->query('SELECT id, name, email, subject, message, status, reply,
                                    created_at, read_at, replied_at, resolved_at
                             FROM public.inquiries ORDER BY created_at DESC');
        $inquiries = array_map('inquiryResponse', $stmt->fetchAll());
    } catch (Throwable $e) {
        error_log('Inquiry listing failed: ' . $e->getMessage());
        fail('Inquiries could not be loaded. Please try again later.', 500);
    }
    ok(['inquiries' => $inquiries]);
}

if (method() === 'PATCH') {
    requireRole('admin');
    $input = body();
    foreach (['id', 'status', 'reply'] as $field) {
        if (isset($input[$field]) && !is_string($input[$field])) {
            fail('Inquiry updates must be submitted as text.', 422);
        }
    }
    $id = trim((string)($input['id'] ?? ''));
    if ($id === '' || !preg_match('/^[0-9a-f-]{36}$/i', $id)) fail('Select a valid inquiry.', 422);

    $replyProvided = array_key_exists('reply', $input);
    $reply = trim((string)($input['reply'] ?? ''));
    $status = strtolower(trim((string)($input['status'] ?? '')));
    if ($replyProvided && ($reply === '' || mb_strlen($reply) > 5000)) {
        fail('Enter a response (up to 5,000 characters).', 422);
    }
    if ($status !== '' && !in_array($status, ['read', 'resolved'], true)) {
        fail('Invalid inquiry status.', 422);
    }
    if (!$replyProvided && $status === '') fail('No inquiry changes were provided.', 422);

    try {
        $pdo->beginTransaction();
        inquiryById($pdo, $id);

        if ($replyProvided) {
            $stmt = $pdo->prepare("UPDATE public.inquiries
                                   SET reply = ?, status = 'replied', replied_at = now()
                                   WHERE id = ?");
            $stmt->execute([$reply, $id]);
        } elseif ($status === 'read') {
            $stmt = $pdo->prepare("UPDATE public.inquiries
                                   SET status = 'read', read_at = COALESCE(read_at, now())
                                   WHERE id = ? AND status = 'new'");
            $stmt->execute([$id]);
        } else {
            $stmt = $pdo->prepare("UPDATE public.inquiries
                                   SET status = 'resolved', resolved_at = now()
                                   WHERE id = ?");
            $stmt->execute([$id]);
        }

        $row = inquiryById($pdo, $id);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Inquiry update failed: ' . $e->getMessage());
        fail('The inquiry could not be updated. Please try again.', 500);
    }

    ok(['inquiry' => inquiryResponse($row)], 'Inquiry saved.');
}

fail('Method not allowed.', 405);
