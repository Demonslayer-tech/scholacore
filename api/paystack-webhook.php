<?php

require_once __DIR__ . '/_lib/FirebaseAdmin.php';
require_once __DIR__ . '/_lib/TelegramBot.php';

use Google\Cloud\Firestore\FieldValue;

header('Content-Type: application/json');

function jsonResponse(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

/**
 * Returns a snapshot's data as a plain array, or an empty array if the
 * document doesn't exist. Deliberately avoids Firestore's ArrayAccess
 * (e.g. $snapshot['field']) since its offsetGet() behavior on a missing
 * field isn't something we can verify without a PHP runtime to test
 * against -- ->data() plus plain PHP array access with ?? is unambiguous.
 */
function snapshotData($snapshot): array
{
    return $snapshot->exists() ? $snapshot->data() : [];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    jsonResponse(405, ['error' => 'Method not allowed']);
}

$secret = getenv('PAYSTACK_SECRET_KEY');
if (!$secret) {
    error_log('[paystack-webhook] Missing PAYSTACK_SECRET_KEY');
    jsonResponse(500, ['error' => 'Webhook misconfigured']);
}

// Raw body, exactly as Paystack sent it; needed for HMAC verification.
// PHP's php://input already gives us the untouched request body, no
// equivalent of Vercel's body-parser to disable.
$rawBody = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_PAYSTACK_SIGNATURE'] ?? null;

function verifySignature(string $rawBody, ?string $signature, string $secret): bool
{
    if (!$signature) {
        return false;
    }
    $expected = hash_hmac('sha512', $rawBody, $secret);
    // hash_equals() is PHP's constant-time comparison, avoiding timing
    // side-channels the same way crypto.timingSafeEqual does in Node.
    return hash_equals($expected, $signature);
}

if (!verifySignature($rawBody, $signature, $secret)) {
    error_log('[paystack-webhook] Invalid signature');
    jsonResponse(401, ['error' => 'Invalid signature']);
}

$event = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE || !is_array($event)) {
    jsonResponse(400, ['error' => 'Invalid JSON payload']);
}

try {
    $db = getAdminFirestore()->database();
} catch (Throwable $e) {
    error_log('[paystack-webhook] Firestore init failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Webhook misconfigured']);
}

$eventId = $event['data']['reference'] ?? ('unknown-' . time());
$webhookEventRef = $db->collection('webhook_events')->document($eventId);

// Acknowledge and ignore event types we don't act on, but still 200 so
// Paystack doesn't keep retrying an event we'll never process.
if (($event['event'] ?? null) !== 'charge.success') {
    jsonResponse(200, ['received' => true, 'ignored' => $event['event'] ?? null]);
}

$data = $event['data'] ?? [];
$reference = $data['reference'] ?? null;
$amount = $data['amount'] ?? null;
$studentUid = $data['metadata']['studentUid'] ?? null;

if (!$reference || !$studentUid) {
    error_log('[paystack-webhook] Missing reference or studentUid in metadata');
    $existingEventData = snapshotData($webhookEventRef->snapshot());
    $attempts = ($existingEventData['attempts'] ?? 0) + 1;
    $webhookEventRef->set([
        'source' => 'paystack',
        'payload' => $event,
        'processed' => false,
        'attempts' => $attempts,
        'lastAttemptAt' => FieldValue::serverTimestamp(),
        'error' => 'Missing reference or studentUid in charge metadata',
    ], ['merge' => true]);
    // 200, not 500: this is a data problem on our initialization side, not
    // a transient failure; retrying will never fix it.
    jsonResponse(200, ['received' => true, 'error' => 'missing reference or studentUid']);
}

// Idempotency: if we've already recorded a successful transaction for
// this reference, don't re-process (Paystack may deliver the same event
// more than once).
$transactionRef = $db->collection('transactions')->document($reference);
$existingTransactionData = snapshotData($transactionRef->snapshot());
if (($existingTransactionData['status'] ?? null) === 'success') {
    jsonResponse(200, ['received' => true, 'alreadyProcessed' => true]);
}

try {
    $transactionRef->set([
        'paystackReference' => $reference,
        'studentId' => $studentUid,
        'amount' => $amount,
        'status' => 'success',
        'retryCount' => ($existingTransactionData['retryCount'] ?? 0) + (empty($existingTransactionData) ? 0 : 1),
        'lastError' => null,
        'createdAt' => $existingTransactionData['createdAt'] ?? FieldValue::serverTimestamp(),
    ]);

    // Payment is confirmed at this point. Everything below (Telegram
    // delivery) is best-effort; a Telegram failure must NOT undo or
    // block the student's paid status.
    $db->collection('users')->document($studentUid)->set(
        ['paymentStatus' => 'active_paid'],
        ['merge' => true]
    );
} catch (Throwable $e) {
    error_log('[paystack-webhook] Failed to record payment: ' . $e->getMessage());
    $attempts = ($existingTransactionData['retryCount'] ?? 0) + 1;
    $webhookEventRef->set([
        'source' => 'paystack',
        'payload' => $event,
        'processed' => false,
        'attempts' => $attempts,
        'lastAttemptAt' => FieldValue::serverTimestamp(),
        'error' => $e->getMessage(),
    ], ['merge' => true]);
    // 500 here IS a transient/infra failure; let Paystack retry.
    jsonResponse(500, ['error' => 'Failed to record payment']);
}

$telegramError = null;
try {
    $groupChatId = getenv('TELEGRAM_CLASS_GROUP_CHAT_ID');
    if (!$groupChatId) {
        throw new RuntimeException('Missing TELEGRAM_CLASS_GROUP_CHAT_ID environment variable');
    }

    $userData = snapshotData($db->collection('users')->document($studentUid)->snapshot());
    $telegramUserId = $userData['telegramUserId'] ?? null;

    $inviteLink = createSingleUseInviteLink($groupChatId);

    if ($telegramUserId) {
        sendTelegramMessage(
            (string) $telegramUserId,
            'Payment confirmed! Join your class group here: ' . $inviteLink
        );
    } else {
        error_log(
            "[paystack-webhook] Student $studentUid paid but has no telegramUserId, " .
            "invite link generated but not delivered: $inviteLink"
        );
    }
} catch (Throwable $e) {
    $telegramError = $e->getMessage();
    error_log('[paystack-webhook] Telegram invite delivery failed: ' . $telegramError);
}

$webhookEventRef->set([
    'source' => 'paystack',
    'payload' => $event,
    'processed' => $telegramError === null,
    'attempts' => 1,
    'lastAttemptAt' => FieldValue::serverTimestamp(),
    'error' => $telegramError,
], ['merge' => true]);

// Always 200 once payment is recorded; the student is paid regardless of
// whether the Telegram invite made it out. A logged, unresolved Telegram
// failure can be replayed manually from webhook_events without ever
// touching paymentStatus again.
jsonResponse(200, ['received' => true, 'telegramDelivered' => $telegramError === null]);
