import { useEffect, useState } from 'preact/hooks';
import { useSettings } from './profile';
import { settings } from './settings';
import { BITRATE_MAX_MBPS, BITRATE_MIN_MBPS, mbps, qualityById, STREAM_QUALITIES } from './streamQuality';

/**
 * Quality, bitrate and priority. Used in the picker and, while streaming, in the
 * stream settings popover — changes there apply to the running stream immediately.
 */
export function StreamOptions() {
  const s = useSettings();
  const q = qualityById(s.streamQuality);
  const auto = s.streamBitrate == null;
  // The slider moves freely; the stream is updated when you let go.
  const [draft, setDraft] = useState(s.streamBitrate ?? q.bitrate / 1_000_000);
  useEffect(() => setDraft(s.streamBitrate ?? q.bitrate / 1_000_000), [s.streamBitrate, q.id]);

  return (
    <div class="stream-options">
      <div class="field">
        <span class="field-label">Качество</span>
        <div class="chips">
          {STREAM_QUALITIES.map((x) => (
            <button
              key={x.id}
              class={`chip${s.streamQuality === x.id ? ' active' : ''}`}
              onClick={() => settings.update({ streamQuality: x.id })}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div class="field">
        <span class="field-label">
          Битрейт — {auto ? `авто (${mbps(q.bitrate)})` : mbps(draft * 1_000_000)}
        </span>
        <div class="bitrate-row">
          <label class="check">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) =>
                settings.update({ streamBitrate: e.currentTarget.checked ? null : q.bitrate / 1_000_000 })
              }
            />
            <span>Авто</span>
          </label>
          <input
            type="range"
            min={BITRATE_MIN_MBPS}
            max={BITRATE_MAX_MBPS}
            step={0.5}
            value={draft}
            disabled={auto}
            onInput={(e) => setDraft(Number(e.currentTarget.value))}
            onChange={(e) => settings.update({ streamBitrate: Number(e.currentTarget.value) })}
          />
        </div>
        <small class="muted">
          Больше — меньше «мыла» в динамике. Нужна такая же скорость отдачи у тебя. Для игр в 1080p60 — 12–15.
        </small>
      </div>

      <div class="field">
        <span class="field-label">Когда не хватает битрейта</span>
        <div class="segmented">
          <button
            class={s.streamPriority === 'smooth' ? 'active' : ''}
            onClick={() => settings.update({ streamPriority: 'smooth' })}
            title="Держим fps, разрешение может ненадолго снижаться"
          >
            Плавность
          </button>
          <button
            class={s.streamPriority === 'sharp' ? 'active' : ''}
            onClick={() => settings.update({ streamPriority: 'sharp' })}
            title="Держим разрешение, могут проседать кадры"
          >
            Чёткость
          </button>
        </div>
        <small class="muted">
          {s.streamPriority === 'smooth'
            ? 'Для игр: fps держится, разрешение может ненадолго снижаться.'
            : 'Для текста и кода: разрешение держится, кадры могут проседать.'}
        </small>
      </div>
    </div>
  );
}
