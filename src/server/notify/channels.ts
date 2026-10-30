/**
 * Delivery channels. Each channel only knows how to send a plain-text message.
 * To add WhatsApp later: implement NotificationChannel (e.g. with the WhatsApp Cloud API),
 * add it to `activeChannels`, and store recipient numbers in business settings.
 */
import type { ResolvedSettings } from "../settings";

export interface NotificationChannel {
  name: string;
  isConfigured(settings: ResolvedSettings): boolean;
  send(text: string, settings: ResolvedSettings): Promise<void>;
}

export const telegramChannel: NotificationChannel = {
  name: "telegram",
  isConfigured: (s) => Boolean(process.env.TELEGRAM_BOT_TOKEN) && s.telegramChatIds.length > 0,
  async send(text, s) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    for (const chatId of s.telegramChatIds) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
      }
    }
  },
};

export const activeChannels: NotificationChannel[] = [telegramChannel];

/** Helps the owner find their chat ID: lists chats that recently messaged the bot. */
export async function telegramRecentChats(): Promise<{ id: string; name: string }[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in the server environment.");
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Telegram returned ${res.status}. Check the bot token.`);
  const json = (await res.json()) as { result?: { message?: { chat?: { id: number; first_name?: string; title?: string; username?: string } } }[] };
  const seen = new Map<string, string>();
  for (const u of json.result ?? []) {
    const c = u.message?.chat;
    if (c) seen.set(String(c.id), c.title ?? c.first_name ?? c.username ?? String(c.id));
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}
