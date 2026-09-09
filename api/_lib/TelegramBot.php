<?php

/**
 * Calls a Telegram Bot API method via cURL and returns the decoded
 * "result" field. Throws RuntimeException with Telegram's own error
 * description on failure.
 */
function callTelegramApi(string $method, array $body): array
{
    $botToken = getenv('TELEGRAM_BOT_TOKEN');
    if (!$botToken) {
        throw new RuntimeException('Missing TELEGRAM_BOT_TOKEN environment variable');
    }

    $url = 'https://api.telegram.org/bot' . $botToken . '/' . $method;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        throw new RuntimeException('Telegram API request failed: ' . $curlError);
    }

    $data = json_decode($response, true);
    if (!is_array($data) || empty($data['ok'])) {
        $description = $data['description'] ?? 'unknown error';
        throw new RuntimeException('Telegram API ' . $method . ' failed: ' . $description);
    }

    return $data['result'];
}

/**
 * Creates a single-use invite link for the class group chat.
 *
 * Note: the original brief named exportChatInviteLink, but that method
 * only re-exports a chat's one shared primary link and cannot be limited
 * to a single use. createChatInviteLink with member_limit: 1 is the
 * correct Telegram Bot API call for a genuinely single-use invite.
 */
function createSingleUseInviteLink(string $chatId): string
{
    $result = callTelegramApi('createChatInviteLink', [
        'chat_id' => $chatId,
        'member_limit' => 1,
        'name' => 'student-' . time(),
    ]);
    return $result['invite_link'];
}

function sendTelegramMessage(string $chatId, string $text): void
{
    callTelegramApi('sendMessage', [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
    ]);
}
