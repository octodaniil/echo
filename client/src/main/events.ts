import type { Channel } from '../shared/types';
import type { ActiveSession } from './session';

export interface EventHandlers {
  onChannels(channels: Channel[]): void;
  /** Token was rejected or the user was removed by an admin. */
  onUnauthorized(reason: 'kicked' | 'invalid'): void;
  onConnectionChange(connected: boolean): void;
  /** We just earned an achievement (def included: hidden ones aren't in the catalog yet). */
  onAchievement(payload: { code: string; def?: unknown }): void;
  /** An admin moved us to another channel. */
  onMove(channelId: number, by: string): void;
  /** Who is online and what they play. */
  onPresence(users: unknown[]): void;
  /** We are banned (message) or no longer banned (null). */
  onBanned(message: string | null): void;
  /** A moderator did something to us (mute, disconnect, rename…). */
  onModeration(payload: unknown): void;
  /** Evening games changed (bets, predictions, capsules). */
  onFun(payload: unknown): void;
  /** A weekly challenge or duo quest was completed. */
  onWeekly(payload: unknown): void;
  /** We went AFK (an hour of silence) or came back. */
  onAfk(on: boolean): void;
  /** Chat: new / edited / deleted message, or someone typing. */
  onChat(event: string, payload: unknown): void;
}

/**
 * Keeps a Server-Sent Events connection to /api/events open and reconnects
 * with backoff. Returns a function that stops it.
 */
export function startEvents(session: ActiveSession, handlers: EventHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;

  const run = async () => {
    let backoff = 1000;
    while (!stopped) {
      try {
        const res = await fetch(`${session.serverUrl}/api/events`, {
          headers: { authorization: `Bearer ${session.token}`, accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401) {
          handlers.onUnauthorized('invalid');
          return;
        }
        if (res.status === 403) {
          // Banned: keep the session, show the ban screen and check again now and then.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          handlers.onBanned(body.error ?? 'Ты заблокирован на сервере');
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        handlers.onBanned(null);
        handlers.onConnectionChange(true);
        backoff = 1000;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7);
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if (event === 'channels') handlers.onChannels(JSON.parse(data) as Channel[]);
            else if (event === 'achievement') handlers.onAchievement(JSON.parse(data) as { code: string; def?: unknown });
            else if (event === 'presence') handlers.onPresence(JSON.parse(data) as unknown[]);
            else if (event === 'move') {
              const m = JSON.parse(data) as { channelId: number; by: string };
              handlers.onMove(m.channelId, m.by);
            }
            else if (event === 'moderation') handlers.onModeration(JSON.parse(data));
            else if (event === 'weekly') handlers.onWeekly(JSON.parse(data));
            else if (event === 'fun') handlers.onFun(JSON.parse(data));
            else if (event === 'afk') handlers.onAfk((JSON.parse(data) as { on: boolean }).on);
            else if (event === 'chat' || event === 'typing') handlers.onChat(event, JSON.parse(data));
            else if (event === 'banned') {
              handlers.onBanned((JSON.parse(data) as { message: string }).message);
              break;
            }
            else if (event === 'kicked') {
              handlers.onUnauthorized('kicked');
              return;
            }
          }
        }
      } catch {
        // Network error or aborted; fall through to retry.
      }
      if (stopped) return;
      handlers.onConnectionChange(false);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15_000);
    }
  };

  void run();
  return () => {
    stopped = true;
    controller.abort();
  };
}
