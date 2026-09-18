<?php

require_once __DIR__ . '/_lib/FirebaseAdmin.php';
require_once __DIR__ . '/_lib/TelegramAuth.php';

use Kreait\Firebase\Factory;
use Google\Cloud\Firestore\FieldValue;

header('Content-Type: application/json');

function jsonResponse(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

function snapshotData($snapshot): array
{
    return $snapshot->exists() ? $snapshot->data() : [];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    jsonResponse(405, ['error' => 'Method not allowed']);
}

$botToken = getenv('TELEGRAM_BOT_TOKEN');
if (!$botToken) {
    error_log('[telegram-auth] Missing TELEGRAM_BOT_TOKEN');
    jsonResponse(500, ['error' => 'Server misconfigured']);
}

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$initData = (string) ($body['initData'] ?? '');

$verified = verifyTelegramInitData($initData, $botToken);
if (!$verified) {
    jsonResponse(401, ['error' => 'Could not verify Telegram identity. Please open this from inside Telegram.']);
}

$tgUser = $verified['user'];
$telegramId = (string) $tgUser['id'];
$uid = 'tg_' . $telegramId;

try {
    $raw = getenv('FIREBASE_SERVICE_ACCOUNT_KEY');
    $serviceAccount = json_decode($raw, true);
    $factory = (new Factory())->withServiceAccount($serviceAccount);
    $auth = $factory->createAuth();
    $db = getAdminFirestore()->database();
} catch (Throwable $e) {
    error_log('[telegram-auth] Firebase init failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Server misconfigured']);
}

$userRef = $db->collection('users')->document($uid);
$existing = snapshotData($userRef->snapshot());
$isNewUser = empty($existing);

if ($isNewUser) {
    // Minimal record -- role defaults to student since Telegram is the
    // student-facing entry point. gradeLevel is collected right after,
    // client-side, as a one-tap follow-up rather than a form.
    $fullName = trim(($tgUser['first_name'] ?? '') . ' ' . ($tgUser['last_name'] ?? ''));
    $userRef->set([
        'fullName' => $fullName !== '' ? $fullName : ($tgUser['username'] ?? 'Student'),
        'role' => 'student',
        'gradeLevel' => '',
        'paymentStatus' => 'unpaid',
        'telegramUserId' => $telegramId,
        'telegramUsername' => $tgUser['username'] ?? null,
        'aiQueryCount' => 0,
        'createdAt' => FieldValue::serverTimestamp(),
    ]);
} else {
    // Keep the Telegram identity fresh (username changes, etc.) without
    // touching role/paymentStatus/gradeLevel.
    $userRef->set([
        'telegramUserId' => $telegramId,
        'telegramUsername' => $tgUser['username'] ?? null,
    ], ['merge' => true]);
}

try {
    $customToken = $auth->createCustomToken($uid)->toString();
} catch (Throwable $e) {
    error_log('[telegram-auth] createCustomToken failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Could not sign in, please try again']);
}

jsonResponse(200, [
    'customToken' => $customToken,
    'isNewUser' => $isNewUser,
    'needsGradeLevel' => $isNewUser || ($existing['gradeLevel'] ?? '') === '',
]);
