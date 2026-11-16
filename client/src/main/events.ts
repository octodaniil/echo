import type { Channel } from '../shared/types';
import type { ActiveSession } from './session';

export interface EventHandlers {
  onChannels(channels: Channel[]): void;
  /** Token was rejected or the user was removed by an admin. */
  onUnauthorized(reason: 'kicked' | 'invalid'): void;
  onConnectionChange(connected: boolean): void;
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
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
