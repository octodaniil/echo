import { useEffect, useState } from 'preact/hooks';
import type { ScreenSource } from '../../shared/types';
import { CloseIcon } from './icons';
import { useSettings } from './profile';
import { settings } from './settings';
import { STREAM_QUALITIES } from './streamQuality';
import { voice } from './voice';

type Kind = 'window' | 'screen';

export function ScreenPicker({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [kind, setKind] = useState<Kind>('window');
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live thumbnails while the picker is open (cheap: only a few frames every 3 s).
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.echo
        .getScreenSources()
        .then((list) => alive && setSources(list))
        .catch((err: Error) => alive && setError(err.message));
    void load();
    const t = window.setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = (sources ?? []).filter((x) => x.kind === kind);
  const chosen = sources?.find((x) => x.id === selected) ?? null;

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await voice.startScreenShare(chosen, s.streamQuality, s.streamAudio);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal picker">
        <header class="modal-header">
          <h2>Трансляция</h2>
          <button class="icon-btn" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>

        <div class="tabs">
          <button class={`tab${kind === 'window' ? ' active' : ''}`} onClick={() => setKind('window')}>
            Приложения
          </button>
          <button class={`tab${kind === 'screen' ? ' active' : ''}`} onClick={() => setKind('screen')}>
            Экраны
          </button>
        </div>

        <div class="sources">
          {sources === null && <div class="muted center">Ищем окна…</div>}
          {sources !== null && list.length === 0 && <div class="muted center">Ничего не найдено</div>}
          {list.map((src) => (
            <button
              key={src.id}
              class={`source${selected === src.id ? ' selected' : ''}`}
              onClick={() => setSelected(src.id)}
              onDblClick={() => {
                setSelected(src.id);
                void start();
              }}
            >
              <img class="source-thumb" src={src.thumbnail} alt="" draggable={false} />
              <span class="source-name">
                {src.icon && <img src={src.icon} alt="" width={16} height={16} />}
                <span>{src.name}</span>
              </span>
            </button>
          ))}
        </div>

        <footer class="picker-footer">
          <div class="picker-options">
            <label class="field">
              <span class="field-label">Качество</span>
              <div class="chips">
                {STREAM_QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    class={`chip${s.streamQuality === q.id ? ' active' : ''}`}
                    onClick={() => settings.update({ streamQuality: q.id })}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={s.streamAudio}
                onChange={(e) => settings.update({ streamAudio: e.currentTarget.checked })}
              />
              <span>Транслировать звук компьютера</span>
            </label>
          </div>
          {error && <div class="error">{error}</div>}
          <div class="picker-actions">
            <button class="secondary" onClick={onClose}>
              Отмена
            </button>
            <button class="primary small" disabled={!chosen || busy} onClick={() => void start()}>
              {busy ? 'Запуск…' : 'Начать трансляцию'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
