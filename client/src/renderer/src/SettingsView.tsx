import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Session } from '../../shared/types';
import { Avatar } from './Avatar';
import { CloseIcon } from './icons';
import type { MicPipeline } from './mic';
import { makeAvatar, useSettings } from './profile';
import { settings, type NoiseSuppressionMode } from './settings';
import { play } from './sounds';
import { THEMES } from './themes';
import {
  acceleratorFrom,
  HOTKEY_ACTIONS,
  hotkeyErrors,
  hotkeyLabel,
  isRisky,
  onHotkeyErrors,
  type HotkeyAction,
} from './hotkeys';
import { voice } from './voice';

type Tab = 'voice' | 'hotkeys' | 'account' | 'app';

export function SettingsView({
  session,
  onSession,
  onClose,
}: {
  session: Session;
  onSession: (s: Session) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('voice');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="settings">
      <nav class="settings-nav">
        <div class="settings-nav-title">Настройки</div>
        <NavItem active={tab === 'voice'} onClick={() => setTab('voice')}>
          Голос и звук
        </NavItem>
        <NavItem active={tab === 'account'} onClick={() => setTab('account')}>
          Профиль
        </NavItem>
        <NavItem active={tab === 'hotkeys'} onClick={() => setTab('hotkeys')}>
          Горячие клавиши
        </NavItem>
        <NavItem active={tab === 'app'} onClick={() => setTab('app')}>
          Приложение
        </NavItem>
      </nav>
      <section class="settings-body">
        {tab === 'voice' && <VoiceTab />}
        {tab === 'account' && <AccountTab session={session} onSession={onSession} />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'app' && <AppTab session={session} />}
      </section>
      <button class="settings-close" title="Закрыть (Esc)" onClick={onClose}>
        <CloseIcon size={18} />
        <span>ESC</span>
      </button>
    </div>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button class={`settings-nav-item${active ? ' active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- voice

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () => void navigator.mediaDevices.enumerateDevices().then(setDevices);
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  // Windows lists "default" and "communications" pseudo-devices; keep only "default".
  const list = (kind: MediaDeviceKind) =>
    devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
  return { inputs: list('audioinput'), outputs: list('audiooutput'), reload: () => navigator.mediaDevices.enumerateDevices().then(setDevices) };
}

const deviceLabel = (d: MediaDeviceInfo) =>
  d.deviceId === 'default' ? `По умолчанию (${d.label.replace(/^Default - |^По умолчанию - /, '')})` : d.label || 'Устройство';

const NS_OPTIONS: { value: NoiseSuppressionMode; title: string; hint: string }[] = [
  { value: 'max', title: 'Максимальный', hint: 'ИИ-шумодав + шумодав WebRTC вместе. Если друзья слышат фон, клавиатуру или вентилятор — включи этот.' },
  { value: 'ai', title: 'ИИ-шумодав', hint: 'Нейросеть RNNoise убирает клавиатуру, вентиляторы и фон. Чуть больше нагрузка на CPU.' },
  { value: 'standard', title: 'Стандартный', hint: 'Встроенное шумоподавление WebRTC. Легче, но хуже с резкими звуками.' },
  { value: 'off', title: 'Выключен', hint: 'Без обработки — для хорошего микрофона в тихой комнате.' },
];

function VoiceTab() {
  const s = useSettings();
  const { inputs, outputs, reload } = useDevices();
  const [pipeline, setPipeline] = useState<MicPipeline | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Keep the mic open while this tab is visible, for the meter.
  useEffect(() => {
    let release: (() => void) | undefined;
    let cancelled = false;
    voice
      .acquirePreview()
      .then((r) => {
        if (cancelled) return r.release();
        release = r.release;
        setPipeline(r.pipeline);
        void reload(); // device labels become available once the mic is allowed
      })
      .catch((err) => setMicError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      release?.();
    };
  }, []);

  useEffect(() => {
    if (!testing || !pipeline) return;
    // While you listen to yourself, the channel doesn't hear the test.
    void voice.setMicTest(true);
    const stop = pipeline.monitor(s.outputDeviceId);
    return () => {
      stop();
      void voice.setMicTest(false);
    };
  }, [testing, pipeline, s.outputDeviceId]);

  return (
    <div class="settings-page">
      <h2>Голос и звук</h2>

      <div class="row two">
        <Field label="Микрофон">
          <select value={s.inputDeviceId} onChange={(e) => settings.update({ inputDeviceId: e.currentTarget.value })}>
            {inputs.length === 0 && <option value="default">По умолчанию</option>}
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Устройство вывода">
          <select value={s.outputDeviceId} onChange={(e) => settings.update({ outputDeviceId: e.currentTarget.value })}>
            {outputs.length === 0 && <option value="default">По умолчанию</option>}
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div class="row two">
        <Field label={`Громкость микрофона — ${Math.round(s.inputVolume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={s.inputVolume}
            onInput={(e) => settings.update({ inputVolume: Number(e.currentTarget.value) })}
          />
        </Field>
        <Field label={`Громкость звука — ${Math.round(s.outputVolume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={s.outputVolume}
            onInput={(e) => settings.update({ outputVolume: Number(e.currentTarget.value) })}
          />
        </Field>
      </div>

      <h3>Чувствительность ввода</h3>
      <label class="switch-row">
        <span>
          Определять автоматически
          <small>Echo сам подстраивает порог под шум в комнате</small>
        </span>
        <Toggle checked={s.sensitivityAuto} onChange={(v) => settings.update({ sensitivityAuto: v })} />
      </label>
      {micError ? (
        <div class="error">Микрофон недоступен: {micError}</div>
      ) : (
        <LevelMeter pipeline={pipeline} manual={!s.sensitivityAuto} threshold={s.sensitivityDb} />
      )}
      <div class="meter-actions">
        <button class={`secondary${testing ? ' active' : ''}`} onClick={() => setTesting(!testing)} disabled={!pipeline}>
          {testing ? 'Остановить проверку' : 'Проверить микрофон'}
        </button>
        <small class="muted">
          {testing
            ? 'Ты слышишь себя так, как тебя слышат друзья. В канале тебя сейчас не слышно.'
            : 'Полоска зелёная — голос передаётся.'}
        </small>
      </div>

      <h3>Шумоподавление</h3>
      <div class="radio-cards">
        {NS_OPTIONS.map((o) => (
          <label key={o.value} class={`radio-card${s.noiseSuppression === o.value ? ' checked' : ''}`}>
            <input
              type="radio"
              name="ns"
              checked={s.noiseSuppression === o.value}
              onChange={() => settings.update({ noiseSuppression: o.value })}
            />
            <span class="radio-title">{o.title}</span>
            <span class="radio-hint">{o.hint}</span>
          </label>
        ))}
      </div>

      <h3>Звуки интерфейса</h3>
      <label class="switch-row">
        <span>
          Звуки входа, выхода, мута и трансляций
          <small>Короткие сигналы, как в Discord</small>
        </span>
        <Toggle checked={s.uiSounds} onChange={(v) => settings.update({ uiSounds: v })} />
      </label>
      {s.uiSounds && (
        <div class="row sound-row">
          <Field label={`Громкость звуков — ${Math.round(s.uiSoundsVolume * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={s.uiSoundsVolume}
              onInput={(e) => settings.update({ uiSoundsVolume: Number(e.currentTarget.value) })}
              onChange={() => void play('join')}
            />
          </Field>
        </div>
      )}

      <h3>Обработка голоса</h3>
      <label class="switch-row">
        <span>
          Эхоподавление
          <small>Убирает звук из колонок, попавший обратно в микрофон</small>
        </span>
        <Toggle checked={s.echoCancellation} onChange={(v) => settings.update({ echoCancellation: v })} />
      </label>
      <label class="switch-row">
        <span>
          Автоусиление
          <small>Выравнивает громкость: тихо — громче, громко — тише</small>
        </span>
        <Toggle checked={s.autoGain} onChange={(v) => settings.update({ autoGain: v })} />
      </label>
    </div>
  );
}

const MIN_DB = -100;
const pct = (db: number) => Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));

function LevelMeter({ pipeline, manual, threshold }: { pipeline: MicPipeline | null; manual: boolean; threshold: number }) {
  const fill = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);

  // Updated straight in the DOM, 50x a second, without re-rendering the page.
  useEffect(() => {
    if (!pipeline) return;
    return pipeline.onLevel(() => {
      if (fill.current) {
        fill.current.style.width = `${pct(pipeline.level)}%`;
        fill.current.classList.toggle('open', pipeline.gateOpen);
      }
      if (mark.current && !manual) mark.current.style.left = `${pct(pipeline.threshold)}%`;
    });
  }, [pipeline, manual]);

  return (
    <div class={`meter${manual ? ' manual' : ''}`}>
      <div class="meter-track">
        <div class="meter-fill" ref={fill} />
        <div class="meter-mark" ref={mark} style={manual ? { left: `${pct(threshold)}%` } : undefined} />
      </div>
      {manual && (
        <input
          class="meter-slider"
          type="range"
          min={MIN_DB}
          max={0}
          step={1}
          value={threshold}
          title={`${threshold} дБ`}
          onInput={(e) => settings.update({ sensitivityDb: Number(e.currentTarget.value) })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- account

function AccountTab({ session, onSession }: { session: Session; onSession: (s: Session) => void }) {
  const [nickname, setNickname] = useState(session.user.nickname);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<Session>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      onSession(await fn());
      setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    void run(async () => window.echo.setAvatar(await makeAvatar(f)), 'Аватар обновлён');
  };

  return (
    <div class="settings-page">
      <h2>Профиль</h2>

      <div class="profile-card">
        <Avatar id={session.user.id} name={session.user.nickname} avatar={session.user.avatar} size={88} />
        <div class="profile-actions">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onFile} />
          <button class="primary small" disabled={busy} onClick={() => file.current?.click()}>
            Загрузить аватар
          </button>
          {session.user.avatar && (
            <button
              class="secondary"
              disabled={busy}
              onClick={() => void run(() => window.echo.removeAvatar(), 'Аватар удалён')}
            >
              Удалить
            </button>
          )}
          <small class="muted">Картинка обрежется до квадрата</small>
        </div>
      </div>

      <form
        class="row nick-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => window.echo.updateProfile({ nickname }), 'Ник изменён');
        }}
      >
        <Field label="Ник">
          <input value={nickname} maxLength={32} onInput={(e) => setNickname(e.currentTarget.value)} />
        </Field>
        <button class="primary small" type="submit" disabled={busy || nickname.trim() === session.user.nickname}>
          Сохранить
        </button>
      </form>

      {msg && <div class={msg.ok ? 'success' : 'error'}>{msg.text}</div>}

      <h3>Аккаунт</h3>
      <p class="muted">
        {session.user.isAdmin ? 'Ты админ сервера: можешь приглашать друзей и управлять каналами.' : 'Обычный участник.'}
      </p>
      <button
        class="danger-btn"
        onClick={() => {
          if (confirm('Выйти из аккаунта? Чтобы зайти снова, понадобится новый инвайт.')) {
            void voice.leave().then(() => window.echo.logout());
          }
        }}
      >
        Выйти из аккаунта
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- app

function AppTab({ session }: { session: Session }) {
  const { theme } = useSettings();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.echo.getAutostart().then(setAutostart);
    void window.echo.getAppInfo().then((i) => setVersion(i.version));
  }, []);

  return (
    <div class="settings-page">
      <h2>Приложение</h2>

      <h3>Цветовая тема</h3>
      <div class="themes">
        {THEMES.map((t) => (
          <button
            key={t.id}
            class={`theme-swatch${theme === t.id ? ' active' : ''}`}
            onClick={() => settings.update({ theme: t.id })}
          >
            <span
              class="theme-preview"
              style={{
                background: `radial-gradient(90px 46px at 20% 0%, ${t.accent}55, transparent 70%), radial-gradient(90px 46px at 100% 100%, ${t.accent2}55, transparent 70%), #080b11`,
                boxShadow: `inset 0 -3px 0 ${t.accent}`,
              }}
            />
            <span class="theme-name">{t.name}</span>
          </button>
        ))}
      </div>

      <h3>Запуск</h3>
      <label class="switch-row">
        <span>
          Запускать вместе с Windows
          <small>Echo будет сразу в сети после включения компьютера</small>
        </span>
        <Toggle
          checked={autostart ?? false}
          onChange={(v) =>
            void window.echo
              .setAutostart(v)
              .then(setAutostart)
              .catch((err: Error) => setError(err.message))
          }
        />
      </label>
      {error && <div class="error">{error}</div>}

      <h3>О программе</h3>
      <dl class="about">
        <dt>Версия</dt>
        <dd>{version}</dd>
        <dt>Сервер</dt>
        <dd>{session.serverUrl.replace(/^https:\/\//, '')}</dd>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- bits

function Field({ label, children }: { label: string; children: JSX.Element }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      class={`toggle${checked ? ' on' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

// ---------------------------------------------------------------- hotkeys

function HotkeysTab() {
  const s = useSettings();
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [errors, setErrors] = useState(hotkeyErrors);
  useEffect(() => onHotkeyErrors(() => setErrors({ ...hotkeyErrors })), []);

  // Capture the next key combination while "recording".
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setRecording(null);
      if (e.code === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        settings.update({ hotkeys: { ...settings.get().hotkeys, [recording]: null } });
        return setRecording(null);
      }
      const accel = acceleratorFrom(e);
      if (!accel) return; // only modifiers so far
      // The same combo can't do two things.
      const next = { ...settings.get().hotkeys };
      for (const k of Object.keys(next)) if (next[k] === accel) next[k] = null;
      next[recording] = accel;
      settings.update({ hotkeys: next });
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  return (
    <div class="settings-page">
      <h2>Горячие клавиши</h2>
      <p class="muted">
        Работают везде, даже когда ты в игре. Лучше брать сочетания с Ctrl / Alt / Shift или F13–F24 —
        одиночная клавиша перестанет печататься в других программах.
      </p>

      <div class="hotkeys">
        {HOTKEY_ACTIONS.map(({ action, title, hint }) => {
          const accel = s.hotkeys[action] ?? null;
          const isRec = recording === action;
          return (
            <div key={action} class="hotkey-row">
              <div class="hotkey-text">
                <span class="hotkey-title">{title}</span>
                <small class="muted">{hint}</small>
                {accel && errors[action] && <small class="hotkey-error">{errors[action]}</small>}
                {accel && !errors[action] && isRisky(accel) && (
                  <small class="hotkey-warn">Одиночная клавиша — она не будет печататься в других программах</small>
                )}
              </div>
              <button class={`keycap-btn${isRec ? ' recording' : ''}`} onClick={() => setRecording(isRec ? null : action)}>
                {isRec ? 'Нажми сочетание…' : accel ? hotkeyLabel(accel) : 'Не назначено'}
              </button>
              {accel && !isRec && (
                <button
                  class="icon-btn"
                  title="Убрать"
                  onClick={() => settings.update({ hotkeys: { ...s.hotkeys, [action]: null } })}
                >
                  <CloseIcon size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <small class="muted">Esc — отменить запись, Backspace — убрать сочетание.</small>
    </div>
  );
}
