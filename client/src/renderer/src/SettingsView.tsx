import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Member, Session, UpdateStatus } from '../../shared/types';
import { Avatar } from './Avatar';
import { CloseIcon } from './icons';
import type { MicPipeline } from './mic';
import { bannerUrl, makeAvatar, makeBanner, useSettings } from './profile';
import { settings, type NoiseSuppressionMode } from './settings';
import { play } from './sounds';
import { StyleTab } from './StyleTab';
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

export type Tab = 'voice' | 'hotkeys' | 'games' | 'account' | 'style' | 'pioneers' | 'app';

export function SettingsView({
  session,
  onSession,
  onClose,
  initialTab = 'voice',
}: {
  session: Session;
  onSession: (s: Session) => void;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const admin = session.user.isAdmin;
  const staff = session.user.isAdmin || !!session.user.isModerator;

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
          <i class="nav-num">01</i>
          Голос и звук
        </NavItem>
        <NavItem active={tab === 'account'} onClick={() => setTab('account')}>
          <i class="nav-num">02</i>
          Профиль
        </NavItem>
        <NavItem active={tab === 'style'} onClick={() => setTab('style')}>
          <i class="nav-num">03</i>
          Стиль
        </NavItem>
        <NavItem active={tab === 'hotkeys'} onClick={() => setTab('hotkeys')}>
          <i class="nav-num">04</i>
          Горячие клавиши
        </NavItem>
        <NavItem active={tab === 'games'} onClick={() => setTab('games')}>
          <i class="nav-num">05</i>
          Игры
        </NavItem>
        <NavItem active={tab === 'app'} onClick={() => setTab('app')}>
          <i class="nav-num">06</i>
          Приложение
        </NavItem>
        {staff && (
          <>
            <div class="settings-nav-title admin-title">Администрирование</div>
            <NavItem active={tab === 'pioneers'} onClick={() => setTab('pioneers')}>
              <i class="nav-num">A1</i>
              Первооткрыватели
            </NavItem>
          </>
        )}
      </nav>
      <section class="settings-body">
        {tab === 'voice' && <VoiceTab />}
        {tab === 'account' && <AccountTab session={session} onSession={onSession} />}
        {tab === 'style' && <StyleTab session={session} />}
        {tab === 'pioneers' && staff && <PioneersTab session={session} />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'games' && <GamesTab />}
        {tab === 'app' && <AppTab session={session} />}
      </section>
      <button class="settings-close" title="Закрыть (Esc)" onClick={onClose}>
        <CloseIcon size={18} />
        <span>ESC</span>
      </button>
    </div>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: ComponentChildren }) {
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
        <>
          <LevelMeter pipeline={pipeline} manual={!s.sensitivityAuto} threshold={s.sensitivityDb} />
          {pipeline && pipeline.log.length > 0 && (
            <div class="mic-recovery mono tiny" title={pipeline.log.join('\n')}>
              Echo сам переподключал микрофон {pipeline.log.length} раз · последний: {pipeline.log.at(-1)}
            </div>
          )}
        </>
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

      <h3>Качество голоса</h3>
      <div class="radio-cards three">
        {(
          [
            ['standard', 'Обычное', '48 кбит/с — для слабого интернета'],
            ['high', 'Высокое', '64 кбит/с — как в Discord по умолчанию'],
            ['studio', 'Студийное', '128 кбит/с — максимум деталей голоса'],
          ] as const
        ).map(([id, title, hint]) => (
          <label key={id} class={`radio-card${s.voiceQuality === id ? ' checked' : ''}`}>
            <input type="radio" name="voiceq" checked={s.voiceQuality === id} onChange={() => settings.update({ voiceQuality: id })} />
            <span class="radio-title">{title}</span>
            <span class="radio-hint">{hint}</span>
          </label>
        ))}
      </div>

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
  const bannerFile = useRef<HTMLInputElement>(null);
  const banner = bannerUrl(session.user.id, session.user.banner);

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
    void run(async () => {
      const { data, type } = await makeAvatar(f);
      return window.echo.setAvatar(data, type);
    }, f.type === 'image/gif' ? 'Анимированный аватар обновлён' : 'Аватар обновлён');
  };

  const onBanner = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    void run(async () => {
      const b = await makeBanner(f);
      return window.echo.setBanner(b.data, b.type);
    }, 'Баннер обновлён');
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
          <small class="muted">Картинка обрежется до круга. GIF и анимированный WebP — как есть, до 2 МБ</small>
        </div>
      </div>

      <div class="banner-edit">
        <div class="banner-preview" style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
          {!banner && <span class="muted">Баннера нет — будет фон по рангу</span>}
        </div>
        <div class="profile-actions">
          <input ref={bannerFile} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onBanner} />
          <button class="primary small" disabled={busy} onClick={() => bannerFile.current?.click()}>
            Загрузить баннер
          </button>
          {banner && (
            <button class="secondary" disabled={busy} onClick={() => void run(() => window.echo.removeBanner(), 'Баннер удалён')}>
              Удалить
            </button>
          )}
          <small class="muted">
            Картинка обрежется до полосы 3:1. GIF и анимированный WebP загружаются как есть (до 4 МБ) — анимация будет
            играть в профиле и в карточке при наведении.
          </small>
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
  const { theme, closeToTray } = useSettings();
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

      {session.user.isAdmin && <ChatStorageAdmin />}

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
      <label class="switch-row">
        <span>
          Сворачивать в трей при закрытии
          <small>Крестик прячет окно, Echo остаётся в сети и в голосе. Выйти — через значок в трее</small>
        </span>
        <Toggle checked={closeToTray} onChange={(v) => settings.update({ closeToTray: v })} />
      </label>
      {error && <div class="error">{error}</div>}

      <h3>Обновления</h3>
      <UpdatePanel version={version} />

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

function UpdatePanel({ version }: { version: string }) {
  const [st, setSt] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    void window.echo.getUpdateStatus().then(setSt);
    return window.echo.onUpdateStatus(setSt);
  }, []);

  const busy = st.state === 'checking' || st.state === 'downloading';
  return (
    <div class="update-panel">
      <div class="update-panel-text">
        {st.state === 'idle' && <span>Установлена версия {version}</span>}
        {st.state === 'checking' && <span>Проверяем…</span>}
        {st.state === 'none' && <span class="ok">У тебя последняя версия ({version})</span>}
        {st.state === 'downloading' && (
          <>
            <span>
              Скачиваем {st.version} — {st.percent}%
            </span>
            <div class="rank-bar">
              <span style={{ width: `${st.percent}%` }} />
            </div>
          </>
        )}
        {st.state === 'ready' && <span class="ok">Версия {st.version} скачана и готова</span>}
        {st.state === 'error' && <span class="err">{st.message}</span>}
      </div>
      {st.state === 'ready' ? (
        <button class="primary small" onClick={() => void voice.leave().then(() => window.echo.installUpdate())}>
          Перезапустить и обновить
        </button>
      ) : (
        <button class="secondary" disabled={busy} onClick={() => void window.echo.checkForUpdates().then(setSt)}>
          {busy ? 'Подождите…' : 'Проверить обновления'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- games

/** Collapsible, searchable list of every game Echo recognizes out of the box. */
function KnownGamesList() {
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<{ name: string; exes: string[] }[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open && games.length === 0) void window.echo.listKnownGames().then(setGames);
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? games.filter((g) => g.name.toLowerCase().includes(q) || g.exes.some((e) => e.includes(q))) : games;

  return (
    <div class="known-games">
      <button class="link-btn" onClick={() => setOpen(!open)}>
        {open ? 'Скрыть список поддерживаемых игр' : 'Какие игры Echo узнаёт сам?'}
      </button>
      {open && (
        <>
          <input
            value={query}
            placeholder={`Поиск среди ${games.length} игр или по имени .exe`}
            onInput={(e) => setQuery(e.currentTarget.value)}
            autoFocus
          />
          <div class="known-games-list">
            {shown.map((g) => (
              <div key={g.name} class="known-game">
                <span>{g.name}</span>
                <span class="muted mono tiny">{g.exes.join(', ')}</span>
              </div>
            ))}
            {shown.length === 0 && (
              <small class="muted">Нет такой — добавь её кнопкой «Добавить игру из запущенных», пока она открыта.</small>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GamesTab() {
  const s = useSettings();
  const [current, setCurrent] = useState<string | null>(null);
  const [apps, setApps] = useState<{ exe: string; title: string }[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [naming, setNaming] = useState<{ exe: string; name: string } | null>(null);

  useEffect(() => {
    void window.echo.getCurrentGame().then(setCurrent);
    return window.echo.onGame(setCurrent);
  }, []);

  const loadApps = async () => {
    setLoadingApps(true);
    setApps(await window.echo.listWindowedApps().catch(() => []));
    setLoadingApps(false);
  };

  const custom = Object.entries(s.customGames);
  return (
    <div class="settings-page">
      <h2>Игры</h2>
      <label class="switch-row">
        <span>
          Показывать, во что я играю
          <small>Друзья увидят «🎮 играет в …» у тебя в профиле и в списке. Время в играх идёт в ачивки</small>
        </span>
        <Toggle checked={s.showGame} onChange={(v) => settings.update({ showGame: v })} />
      </label>

      <div class="now-playing settings-now">
        <span class={`now-playing-dot${current ? '' : ' off'}`} />
        {!s.showGame ? 'Определение игр выключено' : current ? <>Сейчас: <b>{current}</b></> : 'Сейчас игра не запущена'}
      </div>
      <small class="muted">
        Echo раз в 15 секунд смотрит запущенные программы и сравнивает со списком из ~170 популярных игр. Нет твоей —
        добавь ниже.
      </small>

      <h3>Свои игры</h3>
      {custom.length === 0 && <small class="muted">Пока пусто.</small>}
      <div class="custom-games">
        {custom.map(([exe, name]) => (
          <div key={exe} class="custom-game">
            <span class="custom-game-name">{name}</span>
            <span class="muted mono tiny">{exe}</span>
            <button
              class="icon-btn"
              title="Убрать"
              onClick={() => {
                const next = { ...s.customGames };
                delete next[exe];
                settings.update({ customGames: next });
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
      </div>

      {naming ? (
        <form
          class="row nick-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!naming.name.trim()) return;
            settings.update({ customGames: { ...s.customGames, [naming.exe]: naming.name.trim() } });
            setNaming(null);
            setApps(null);
          }}
        >
          <label class="field">
            <span class="field-label">Как назвать игру ({naming.exe})</span>
            <input
              value={naming.name}
              maxLength={64}
              autoFocus
              onInput={(e) => setNaming({ ...naming, name: e.currentTarget.value })}
            />
          </label>
          <button class="primary small" type="submit">
            Добавить
          </button>
          <button class="secondary" type="button" onClick={() => setNaming(null)}>
            Отмена
          </button>
        </form>
      ) : (
        <button class="secondary" style={{ alignSelf: 'flex-start' }} disabled={loadingApps} onClick={() => void loadApps()}>
          {loadingApps ? 'Ищем окна…' : 'Добавить игру из запущенных'}
        </button>
      )}

      <KnownGamesList />

      {apps && !naming && (
        <div class="app-picker">
          {apps.length === 0 && <small class="muted">Не нашли открытых окон. Запусти игру и нажми ещё раз.</small>}
          {apps.map((a) => (
            <button key={a.exe + a.title} class="app-pick" onClick={() => setNaming({ exe: a.exe, name: a.title })}>
              <span class="app-pick-title">{a.title}</span>
              <span class="muted mono tiny">{a.exe}</span>
            </button>
          ))}
        </div>
      )}
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

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      disabled={disabled}
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

/** Admin: how much space chat pictures take on the server, and cleaning up old ones. */
function ChatStorageAdmin() {
  const [st, setSt] = useState<{ bytes: number; attachments: number; cap: number; messages: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void window.echo.chatStorage().then(setSt).catch(() => {});
  }, []);
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(b > 1024 ** 3 ? 1 : 2)} ГБ`;
  const clean = async (days: number) => {
    if (!confirm(`Удалить картинки из чатов старше ${days} дней? Сами сообщения останутся.`)) return;
    try {
      const r = await window.echo.chatCleanup(days);
      setSt(r);
      setMsg(`Удалено вложений: ${r.removed}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <h3>Чат на сервере</h3>
      {st ? (
        <div class="storage-card">
          <div class="storage-bar">
            <i style={{ width: `${Math.min(100, (st.bytes / st.cap) * 100)}%` }} />
          </div>
          <div class="muted tiny mono">
            КАРТИНКИ {gb(st.bytes)} ИЗ {gb(st.cap)} · {st.attachments} ФАЙЛОВ · {st.messages} СООБЩЕНИЙ
          </div>
          <p class="muted tiny">
            Текст хранится всегда. Когда картинки займут весь лимит, самые старые удалятся сами — в чате останется пометка.
          </p>
          <div class="storage-actions">
            <button class="secondary small" onClick={() => void clean(180)}>Удалить картинки старше 180 дней</button>
            <button class="secondary small" onClick={() => void clean(30)}>старше 30 дней</button>
          </div>
          {msg && <div class="success">{msg}</div>}
        </div>
      ) : (
        <p class="muted">Загружаем…</p>
      )}
    </>
  );
}

/** Admin: who gets the friends-only «Первооткрыватели» section (staff always have it). */
function PioneersTab({ session }: { session: Session }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const load = () => void window.echo.listMembers().then(setList).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  useEffect(load, []);
  const toggle = async (m: Member) => {
    setBusy(m.id);
    try {
      await window.echo.moderate(m.id, 'pioneer', { on: !m.pioneer });
      setList((l) => l?.map((x) => (x.id === m.id ? { ...x, pioneer: !m.pioneer } : x)) ?? l);
      setMsg({ ok: true, text: m.pioneer ? `${m.nickname}: доступ закрыт` : `${m.nickname} теперь первооткрыватель` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const q = query.trim().toLowerCase();
  const people = (list ?? []).filter((m) => m.id !== session.user.id && !m.banned && (!q || m.nickname.toLowerCase().includes(q)));
  return (
    <div class="settings-page">
      <h2>Первооткрыватели</h2>
      <p class="muted">
        Кому открыт раздел для своих: вкладка ачивок «Первооткрыватели» и стили для друзей. Ты и модераторы видите его
        всегда. При открытии человек сразу получает ачивку «Привет, Echo».
      </p>
      <input class="members-search" placeholder="Поиск по нику" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      {!list && <p class="muted">Загружаем…</p>}
      <div class="pioneer-list">
        {people.map((m) => {
          const staff = !!m.role;
          return (
            <div key={m.id} class="pioneer-row">
              <Avatar id={m.id} name={m.nickname} avatar={m.avatar} size={30} />
              <span class="pioneer-who">
                <b>{m.nickname}</b>
                <span class="muted tiny">{staff ? 'администрация — доступ всегда' : m.online ? 'в сети' : 'не в сети'}</span>
              </span>
              <Toggle checked={staff || m.pioneer} disabled={staff || busy === m.id} onChange={() => void toggle(m)} />
            </div>
          );
        })}
      </div>
      {msg && <div class={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
    </div>
  );
}
