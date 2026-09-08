const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN environment variable');
  return token;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram API ${method} failed: ${data.description ?? 'unknown error'}`);
  }
  return data.result as T;
}

/**
 * Creates a single-use invite link for the class group chat.
 *
 * Note: the original brief named `exportChatInviteLink`, but that method
 * only re-exports a chat's one shared primary link and cannot be limited
 * to a single use. `createChatInviteLink` with `member_limit: 1` is the
 * correct Telegram Bot API call for a genuinely single-use invite.
 */
export async function createSingleUseInviteLink(chatId: string): Promise<string> {
  const result = await callTelegramApi<{ invite_link: string }>('createChatInviteLink', {
    chat_id: chatId,
    member_limit: 1,
    name: `student-${Date.now()}`
  });
  return result.invite_link;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  });
}
