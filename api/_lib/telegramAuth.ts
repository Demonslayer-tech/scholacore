import crypto from 'crypto';

export interface TelegramInitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedTelegramInitData {
  user: TelegramInitDataUser;
  authDate: number;
}

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies Telegram Mini App `initData` per Telegram's documented algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   1. secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   2. data_check_string = all fields except `hash`, sorted alphabetically,
 *      joined as "key=value" with "\n"
 *   3. computed_hash = HMAC_SHA256(key=secret_key, data=data_check_string)
 *   4. computed_hash must equal the `hash` field (constant-time compare)
 *
 * This MUST run server-side with the real bot token — it's the only thing
 * standing between "anyone can claim to be any Telegram user" and a real
 * identity check. Never trust a parsed `user` object from the client without
 * having verified the raw initData string it came from.
 */
export function verifyTelegramInitData(initData: string, botToken: string): VerifiedTelegramInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData is missing the hash field');
  }
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(hash, 'utf8');
  const computedBuffer = Buffer.from(computedHash, 'utf8');
  const isValid =
    hashBuffer.length === computedBuffer.length && crypto.timingSafeEqual(hashBuffer, computedBuffer);

  if (!isValid) {
    throw new Error('initData signature verification failed');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    throw new Error('initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData is missing the user field');
  }

  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error('initData user field is not valid JSON');
  }

  return { user, authDate };
}
