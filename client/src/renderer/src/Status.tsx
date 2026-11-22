import { useEffect, useRef, useState } from 'preact/hooks';
import type { StatusState, UserStatus } from '../../shared/types';
import { setQuiet } from './sounds';

export const STATE_LABEL: Record<StatusState, string> = {
  online: 'В сети',
  away: 'Отошёл',
  dnd: 'Не беспокоить',
};

const EMOJIS = ['🎮', '🎧', '💻', '🍕', '😴', '📚', '🔥', '🚗', '🎬', '🏋️', '☕', '🤫'];

/** "🎮 катаю ранкед" / "Не беспокоить" / fallback text. */
export function StatusLine({
  status,
  fallback,
  class: cls = 'muted tiny',
}: {
  status: UserStatus | undefined;
  fallback?: string;
  class?: string;
}) {
  const state = status?.state ?? 'online';
  const text = status?.text ? `${status.emoji ? `${status.emoji} ` : ''}${status.text}` : state !== 'online' ? STATE_LABEL[state] : fallback;
  if (!text) return null;
  return <span class={`status-line st-${state} ${cls}`.trim()}>{text}</span>;
}

// ---------- my status: menu, auto-away, sounds ----------

let mine: UserStatus = { state: 'online', text: '', emoji: '' };
/** Set when we switched to "away" ourselves because of inactivity. */
let autoAway = false;

async function save(next: UserStatus) {
  mine = next;
  setQuiet(next.state === 'dnd');
  await window.echo.setStatus(next);
}

/** Keeps the local copy in sync with what the server says and handles auto-away. */
export function useMyStatus(current: UserStatus | undefined, inCall: boolean) {
  useEffect(() => {
    if (current) {
      mine = current;
      setQuiet(current.state === 'dnd');
    }
  }, [current?.state, current?.text, current?.emoji]);

  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  useEffect(() => {
    const t = window.setInterval(async () => {
      const idle = await window.echo.idleSeconds().catch(() => 0);
      if (mine.state === 'online' && !inCallRef.current && idle >= 10 * 60) {
        autoAway = true;
        await save({ ...mine, state: 'away' }).catch(() => {});
      } else if (autoAway && mine.state === 'away' && idle < 60) {
        autoAway = false;
        await save({ ...mine, state: 'online' }).catch(() => {});
      }
    }, 30_000);
    return () => clearInterval(t);
  }, []);
}

export function StatusMenu({
  current,
  onProfile,
  onAchievements,
  onRecap,
  onFun,
  onClose,
  onError,
}: {
  current: UserStatus | undefined;
  onProfile: () => void;
  onAchievements: () => void;
  onRecap: () => void;
  onFun: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const now = current ?? mine;
  const [text, setText] = useState(now.text);
  const [emoji, setEmoji] = useState(now.emoji);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.userbar-me')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const apply = async (next: UserStatus) => {
    autoAway = false;
    try {
      await save(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div class="status-menu pop-in" ref={ref}>
      <button class="status-menu-item" onClick={onAchievements}>
        Мои ачивки
      </button>
      <button class="status-menu-item" onClick={onFun}>
        Споры, прогнозы, капсулы
      </button>
      <button class="status-menu-item" onClick={onRecap}>
        Итоги недели
      </button>
      <button class="status-menu-item" onClick={onProfile}>
        Мой профиль
      </button>
      <div class="status-menu-sep" />
      {(['online', 'away', 'dnd'] as const).map((st) => (
        <button
          key={st}
          class={`status-menu-item${now.state === st ? ' active' : ''}`}
          onClick={() => void apply({ ...now, text, emoji, state: st }).then(onClose)}
        >
          <span class={`status-dot inline st-${st}`} />
          <span>{STATE_LABEL[st]}</span>
          {st === 'dnd' && <span class="muted tiny">без звуков</span>}
        </button>
      ))}
      <div class="status-menu-sep" />
      <form
        class="status-custom"
        onSubmit={(e) => {
          e.preventDefault();
          void apply({ ...now, text: text.trim(), emoji }).then(onClose);
        }}
      >
        <div class="status-emojis">
          {EMOJIS.map((em) => (
            <button
              type="button"
              key={em}
              class={`emoji-btn${emoji === em ? ' active' : ''}`}
              onClick={() => setEmoji(emoji === em ? '' : em)}
            >
              {em}
            </button>
          ))}
        </div>
        <input
          value={text}
          maxLength={64}
          placeholder="Свой статус, например «катаю ранкед»"
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="status-custom-actions">
          {(now.text || now.emoji) && (
            <button type="button" class="link-btn" onClick={() => void apply({ ...now, text: '', emoji: '' }).then(onClose)}>
              Очистить
            </button>
          )}
          <button type="submit" class="small">
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}
