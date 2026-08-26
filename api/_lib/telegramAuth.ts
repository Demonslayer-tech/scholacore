import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  query_id?: string;
  auth_date: number;
  hash: string;
}

/**
 * Verifies Telegram initData using HMAC-SHA256.
 * Follows Telegram Bot API security guidelines:
 * https://core.telegram.org/bots/webapps#validating-data-received-from-the-web-app
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string
): TelegramUser {
  if (!initData || typeof initData !== 'string') {
    throw new Error('initData must be a non-empty string');
  }

  if (!botToken || typeof botToken !== 'string') {
    throw new Error('botToken must be a non-empty string');
  }

  // Parse the init data string (URL-encoded format: key1=value1&key2=value2&...)
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('initData missing required "hash" field');
  }

  // Remove hash from params for verification
  params.delete('hash');

  // Sort remaining params alphabetically and reconstruct data string
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');

  // Compute secret key: HMAC-SHA256(botToken, "WebAppData")
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Verify the signature
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    throw new Error(
      `Telegram signature verification failed. Expected ${hash}, got ${computedHash}`
    );
  }

  // Parse user object (stored as JSON in the user field)
  const userJson = params.get('user');
  if (!userJson) {
    throw new Error('initData missing required "user" field');
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
  } catch (err) {
    throw new Error(`Failed to parse user JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate required user fields
  if (!user.id || typeof user.id !== 'number') {
    throw new Error('user.id must be a number');
  }
  if (!user.first_name || typeof user.first_name !== 'string') {
    throw new Error('user.first_name must be a non-empty string');
  }
  if (!user.auth_date || typeof user.auth_date !== 'number') {
    throw new Error('user.auth_date must be a number');
  }

  // Verify auth_date is recent (within last 24 hours) to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 24 * 60 * 60; // 24 hours
  if (now - user.auth_date > maxAge) {
    throw new Error(
      `initData expired: auth_date ${user.auth_date} is older than ${maxAge} seconds`
    );
  }

  return user;
}
