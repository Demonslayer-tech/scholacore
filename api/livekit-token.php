<?php

require_once __DIR__ . '/_lib/FirebaseAdmin.php';
require_once __DIR__ . '/_lib/LiveKitAuth.php';

use Kreait\Firebase\Factory;

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

$apiKey = getenv('LIVEKIT_API_KEY');
$apiSecret = getenv('LIVEKIT_API_SECRET');
$wsUrl = getenv('LIVEKIT_WS_URL');
if (!$apiKey || !$apiSecret || !$wsUrl) {
    error_log('[livekit-token] Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_WS_URL');
    jsonResponse(500, ['error' => 'Live classroom is not configured yet']);
}

// --- Verify the caller's Firebase ID token ---
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(401, ['error' => 'Missing bearer token']);
}
$idToken = $m[1];

try {
    $raw = getenv('FIREBASE_SERVICE_ACCOUNT_KEY');
    $serviceAccount = json_decode($raw, true);
    $auth = (new Factory())->withServiceAccount($serviceAccount)->createAuth();
    $verifiedIdToken = $auth->verifyIdToken($idToken);
    $uid = $verifiedIdToken->claims()->get('sub');
} catch (Throwable $e) {
    error_log('[livekit-token] Invalid ID token: ' . $e->getMessage());
    jsonResponse(401, ['error' => 'Invalid or expired session, please log in again']);
}

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$scheduleId = trim((string) ($body['scheduleId'] ?? ''));
if ($scheduleId === '') {
    jsonResponse(400, ['error' => 'Missing scheduleId']);
}

try {
    $db = getAdminFirestore()->database();
} catch (Throwable $e) {
    error_log('[livekit-token] Firestore init failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Server misconfigured']);
}

$userData = snapshotData($db->collection('users')->document($uid)->snapshot());
if (empty($userData)) {
    jsonResponse(403, ['error' => 'No user record found for this account']);
}

$scheduleData = snapshotData($db->collection('schedules')->document($scheduleId)->snapshot());
if (empty($scheduleData)) {
    jsonResponse(404, ['error' => 'Class not found']);
}

$role = $userData['role'] ?? null;
$isTeacherOwner = $role === 'teacher' && ($scheduleData['teacherId'] ?? null) === $uid;
$isPaidStudent = $role === 'student' && ($userData['paymentStatus'] ?? null) === 'active_paid';
$isAdmin = $role === 'admin';

if (!$isTeacherOwner && !$isPaidStudent && !$isAdmin) {
    jsonResponse(403, [
        'error' => $role === 'student'
            ? 'Your account is not marked as paid yet'
            : 'You are not authorized to join this class',
    ]);
}

// Teacher: full publish/subscribe + recording control.
// Student: can publish (mic/cam, so they can ask questions) and
// subscribe -- classes are shared with the whole paid cohort, not
// targeted per student, matching how the Telegram group invite already
// works.
// Admin: subscribe-only, for oversight -- no mic/cam, no recording.
if ($isTeacherOwner) {
    $participantRole = 'teacher';
    $videoGrant = [
        'roomJoin' => true,
        'room' => $scheduleId,
        'canPublish' => true,
        'canSubscribe' => true,
        'canPublishData' => true,
        'roomRecord' => true,
    ];
} elseif ($isAdmin) {
    $participantRole = 'admin';
    $videoGrant = [
        'roomJoin' => true,
        'room' => $scheduleId,
        'canPublish' => false,
        'canSubscribe' => true,
        'canPublishData' => true,
    ];
} else {
    $participantRole = 'student';
    $videoGrant = [
        'roomJoin' => true,
        'room' => $scheduleId,
        'canPublish' => true,
        'canSubscribe' => true,
        'canPublishData' => true,
    ];
}

$displayName = $userData['fullName'] ?? ($role === 'teacher' ? 'Teacher' : 'Student');
$token = buildLiveKitParticipantToken($apiKey, $apiSecret, $uid, $displayName, $videoGrant);

jsonResponse(200, [
    'token' => $token,
    'url' => $wsUrl,
    'room' => $scheduleId,
    'role' => $participantRole,
    'canRecord' => $isTeacherOwner,
    'subjectName' => $scheduleData['subjectName'] ?? null,
]);
