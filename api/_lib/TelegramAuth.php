<?php

/**
 * Verifies the initData string Telegram's Mini App client provides via
 * window.Telegram.WebApp.initData. This is what makes silent login
 * possible -- Telegram already knows who the user is, so instead of
 * asking them to type an email and password, we cryptographically prove
 * the identity Telegram handed us wasn't forged or replayed, then treat
 * that as a login.
 *
 * Algorithm (Telegram's spec, not invented here):
 *   1. Split initData into key=value pairs, remove "hash", sort the rest
 *      alphabetically by key, join with "\n" -> data_check_string
 *   2. secret_key = HMAC_SHA256(key: "WebAppData", data: bot_token)
 *   3. expected_hash = hex(HMAC_SHA256(key: secret_key, data: data_check_string))
 *   4. Compare expected_hash to the "hash" field, constant-time
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * @return array{user: array, authDate: int, raw: array}|null null if the
 *   signature is invalid, malformed, or older than $maxAgeSeconds.
 */
function verifyTelegramInitData(string $initData, string $botToken, int $maxAgeSeconds = 86400): ?array
{
    if ($initData === '' || $botToken === '') {
        return null;
    }

    $pairs = [];
    foreach (explode('&', $initData) as $chunk) {
        if ($chunk === '') {
            continue;
        }
        $eq = strpos($chunk, '=');
        if ($eq === false) {
            continue;
        }
        $key = substr($chunk, 0, $eq);
        // rawurldecode, not urldecode: Telegram encodes with
        // encodeURIComponent on the client, whose counterpart is
        // rawurldecode (urldecode also turns "+" into a space, which
        // would corrupt the JSON in the "user" field).
        $value = rawurldecode(substr($chunk, $eq + 1));
        $pairs[$key] = $value;
    }

    if (!isset($pairs['hash'])) {
        return null;
    }
    $theirHash = $pairs['hash'];
    unset($pairs['hash']);

    ksort($pairs, SORT_STRING);
    $dataCheckParts = [];
    foreach ($pairs as $key => $value) {
        $dataCheckParts[] = $key . '=' . $value;
    }
    $dataCheckString = implode("\n", $dataCheckParts);

    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
    $expectedHash = hash_hmac('sha256', $dataCheckString, $secretKey);

    if (!hash_equals($expectedHash, $theirHash)) {
        return null;
    }

    $authDate = isset($pairs['auth_date']) ? (int) $pairs['auth_date'] : 0;
    if ($authDate === 0 || (time() - $authDate) > $maxAgeSeconds) {
        return null;
    }

    $user = null;
    if (isset($pairs['user'])) {
        $decoded = json_decode($pairs['user'], true);
        if (is_array($decoded) && isset($decoded['id'])) {
            $user = $decoded;
        }
    }

    if (!$user) {
        return null;
    }

    return [
        'user' => $user,
        'authDate' => $authDate,
        'raw' => $pairs,
    ];
}
