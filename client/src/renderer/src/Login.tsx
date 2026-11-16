import { useState } from 'preact/hooks';
import type { Session } from '../../shared/types';
import { Contact } from './Contact';

const DEFAULT_SERVER = 'echo-voice.duckdns.org:8443';

export function Login({ onDone, notice }: { onDone: (s: Session) => void; notice: string | null }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [invite, setInvite] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await window.echo.join({ serverUrl: server, invite, nickname }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <form class="login-card" onSubmit={submit}>
        <div class="brand">
          <span class="brand-mark" />
          <h1 class="brand-word">ECHO</h1>
        </div>
        <p class="muted">Заходи по инвайту от друзей</p>

        {notice && <div class="notice">{notice}</div>}

        <label>
          Сервер
          <input value={server} onInput={(e) => setServer(e.currentTarget.value)} required />
        </label>
        <label>
          Инвайт-код
          <input
            value={invite}
            onInput={(e) => setInvite(e.currentTarget.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoFocus
            required
          />
        </label>
        <label>
          Ник
          <input value={nickname} onInput={(e) => setNickname(e.currentTarget.value)} maxLength={32} required />
        </label>

        {error && (
          <div class="error">
            {error}
            {error === 'Сервер недоступен' && (
              <div class="tiny">Скорее всего, сервер сейчас выключен — попробуй позже.</div>
            )}
          </div>
        )}

        <button class="primary" type="submit" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <Contact prefix="Нет инвайта или не получается зайти? Пиши в Telegram" />
      </form>
    </div>
  );
}
