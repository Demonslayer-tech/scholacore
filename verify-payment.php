<?php
// api/verify-payment.php
// Verifies a Paystack transaction server-side (never trust the client-side
// callback alone) and, once confirmed, marks the caller's Firestore account
// as paid.

require_once __DIR__ . '/_lib.php';

handle_cors();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

$claims = require_auth();
$body = json_body();

$reference = trim($body['reference'] ?? '');
if ($reference === '') {
    send_json(['error' => 'A transaction reference is required'], 400);
}

$secretKey = getenv('PAYSTACK_SECRET_KEY');
if (!$secretKey) {
    send_json(['error' => 'Payments are not configured on the server'], 500);
}

// Must match COURSE_PRICE_KOBO in app.js — the amount actually charged.
if (!defined('COURSE_PRICE_KOBO')) {
    define('COURSE_PRICE_KOBO', 500000);
}

$ch = curl_init('https://api.paystack.co/transaction/verify/' . rawurlencode($reference));
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $secretKey,
    ],
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false || $status !== 200) {
    send_json(['error' => 'Could not reach Paystack to verify this transaction'], 502);
}

$data = json_decode($response, true);
$transaction = $data['data'] ?? null;

$isValid = ($data['status'] ?? false) === true
    && $transaction
    && ($transaction['status'] ?? '') === 'success'
    && (int) ($transaction['amount'] ?? 0) === COURSE_PRICE_KOBO;

if (!$isValid) {
    send_json(['verified' => false, 'error' => 'Payment could not be verified'], 400);
}

try {
    firestore_update_document('users', $claims['sub'], [
        'paid' => true,
        'paidAt' => new DateTime('now', new DateTimeZone('UTC')),
        'paystackReference' => $reference,
    ]);
} catch (Exception $e) {
    // Payment succeeded at Paystack but the Firestore write failed — surface this
    // distinctly so it gets reconciled manually rather than looking like a decline.
    error_log('Firestore update failed after verified payment: ' . $e->getMessage());
    send_json([
        'verified' => true,
        'warning' => 'Payment confirmed but your account update is pending — '
            . 'contact support with reference ' . $reference . ' if access is missing.',
    ]);
}

send_json(['verified' => true]);
