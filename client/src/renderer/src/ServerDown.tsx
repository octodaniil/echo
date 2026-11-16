import { useEffect, useState } from 'preact/hooks';
import { Contact } from './Contact';

/** Full-screen notice while the server can't be reached (it isn't always on). */
export function ServerDown({ serverUrl }: { serverUrl: string }) {
  const [checking, setChecking] = useState(false);
  const [since] = useState(() => Date.now());
  const [, tick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const retry = async () => {
    setChecking(true);
    await window.echo.retryConnection().catch(() => {});
    window.setTimeout(() => setChecking(false), 2500);
  };

  const secs = Math.floor((Date.now() - since) / 1000);
  return (
    <div class="server-down">
      <div class="server-down-card">
        <div class="server-down-icon">
          <span />
        </div>
        <h2>Сервер сейчас выключен</h2>
        <p class="muted">
          Echo не может достучаться до <span class="mono">{serverUrl.replace(/^https?:\/\//, '')}</span>. Обычно это
          значит, что сервер просто не включён. Как только он появится, Echo подключится сам.
        </p>
        <div class="server-down-status mono">
          <span class={`pulse-dot${checking ? ' active' : ''}`} />
          {checking ? 'проверяем…' : `ждём сервер · ${secs < 60 ? `${secs} с` : `${Math.floor(secs / 60)} мин`}`}
        </div>
        <button class="primary small" onClick={() => void retry()} disabled={checking}>
          Проверить сейчас
        </button>
        <Contact />
      </div>
    </div>
  );
}
