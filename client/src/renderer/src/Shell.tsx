import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Channel, Session } from '../../shared/types';
import { Avatar } from './Avatar';
import { ScreenPicker } from './ScreenPicker';
import {
  CloseIcon,
  FullscreenIcon,
  GearIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  ScreenIcon,
  UserPlusIcon,
  VolumeIcon,
} from './icons';
import { useSettings } from './profile';
import { SettingsView } from './SettingsView';
import { voice, type VoiceState } from './voice';

function useVoice(): VoiceState {
  const [state, setState] = useState(voice.snapshot);
  useEffect(() => voice.subscribe(setState), []);
  return state;
}

function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = (m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3500);
  };
  return [msg, show];
}

interface Profile {
  nickname: string;
  avatar: number | null;
}

/** A person shown in the UI: server profile merged with live voice data when we share a channel. */
interface Person {
  id: string;
  nickname: string;
  avatar: number | null;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  streaming: boolean;
}

interface VolumeMenu {
  id: string;
  nickname: string;
  x: number;
  y: number;
}

export function Main({
  session,
  channels,
  online,
  onSession,
}: {
  session: Session;
  channels: Channel[];
  online: boolean;
  onSession: (s: Session) => void;
}) {
  const v = useVoice();
  const [toast, showToast] = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [volumeMenu, setVolumeMenu] = useState<VolumeMenu | null>(null);
  const isAdmin = session.user.isAdmin;
  const me = session.user;
  const currentChannel = channels.find((c) => c.id === v.channelId) ?? null;

  // Latest nickname/avatar for everyone we know about.
  const profiles = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const c of channels) for (const m of c.members) map.set(m.id, { nickname: m.nickname, avatar: m.avatar ?? null });
    map.set(me.id, { nickname: me.nickname, avatar: me.avatar ?? null });
    return map;
  }, [channels, me]);

  useEffect(() => {
    if (v.error) {
      showToast(v.error);
      voice.clearError();
    }
  }, [v.error]);

  const invite = async () => {
    try {
      const inv = await window.echo.createInvite();
      showToast(`Инвайт ${inv.code} скопирован, действует 3 дня`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const openVolume = (e: MouseEvent, p: Person) => {
    if (p.isLocal) return;
    e.preventDefault();
    setVolumeMenu({ id: p.id, nickname: p.nickname, x: e.clientX, y: e.clientY });
  };

  const peopleIn = (c: Channel): Person[] => {
    const live = v.channelId === c.id && v.status === 'connected';
    if (live) {
      return v.participants.map((p) => {
        const prof = profiles.get(p.id);
        const server = c.members.find((m) => m.id === p.id);
        return {
          ...p,
          nickname: prof?.nickname ?? p.nickname,
          avatar: prof?.avatar ?? null,
          streaming: p.streaming || (server?.streaming ?? false),
        };
      });
    }
    return c.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      avatar: m.avatar ?? null,
      isLocal: m.id === me.id,
      speaking: false,
      micMuted: false,
      streaming: m.streaming,
    }));
  };

  return (
    <div class="layout">
      <aside class="sidebar">
        <header class="sidebar-header">
          <div class="brand small">
            <span class="brand-mark" />
            <span>Echo</span>
          </div>
          {isAdmin && (
            <button class="icon-btn" title="Пригласить друга" onClick={() => void invite()}>
              <UserPlusIcon size={18} />
            </button>
          )}
        </header>

        {!online && <div class="offline">Нет связи с сервером…</div>}
        <UpdateBanner inCall={v.status !== 'idle'} />

        <ChannelList
          channels={channels}
          voiceState={v}
          isAdmin={isAdmin}
          peopleIn={peopleIn}
          onJoin={(id) => void voice.join(id)}
          onPersonMenu={openVolume}
          onError={showToast}
        />

        {v.status !== 'idle' && (
          <div class="voice-status">
            <div>
              <div class={`voice-status-title ${v.status}`}>
                {v.status === 'connected' ? 'Голос подключён' : v.status === 'connecting' ? 'Подключение…' : 'Переподключение…'}
              </div>
              <div class="voice-status-channel">{currentChannel?.name ?? ''}</div>
            </div>
            <button class="icon-btn danger" title="Отключиться" onClick={() => void voice.leave()}>
              <HangUpIcon size={20} />
            </button>
          </div>
        )}

        <footer class="userbar">
          <Avatar id={me.id} name={me.nickname} avatar={me.avatar} size={32} />
          <div class="userbar-name">
            <div class="nick">{me.nickname}</div>
            <div class="muted tiny">{isAdmin ? 'админ' : 'в сети'}</div>
          </div>
          <button
            class={`icon-btn${v.micMuted ? ' off' : ''}`}
            title={v.micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            onClick={() => void voice.toggleMic()}
          >
            {v.micMuted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
          </button>
          <button
            class={`icon-btn${v.deafened ? ' off' : ''}`}
            title={v.deafened ? 'Включить звук' : 'Выключить звук'}
            onClick={() => void voice.toggleDeafen()}
          >
            {v.deafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
          </button>
          <button class="icon-btn" title="Настройки" onClick={() => setShowSettings(true)}>
            <GearIcon size={18} />
          </button>
        </footer>
      </aside>

      <main class="stage">
        {currentChannel && v.status !== 'idle' ? (
          <VoiceStage channel={currentChannel} state={v} people={peopleIn(currentChannel)} onPersonMenu={openVolume} />
        ) : (
          <div class="empty">
            <VolumeIcon size={40} />
            <p>Выбери голосовой канал слева, чтобы зайти</p>
          </div>
        )}
      </main>

      {volumeMenu && <VolumePopover menu={volumeMenu} onClose={() => setVolumeMenu(null)} />}
      {showSettings && <SettingsView session={session} onSession={onSession} onClose={() => setShowSettings(false)} />}
      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

function UpdateBanner({ inCall }: { inCall: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void window.echo.getAppInfo().then((i) => i.update && setVersion(i.update.version));
    return window.echo.onUpdateReady((i) => setVersion(i.version));
  }, []);
  if (!version) return null;
  return (
    <div class="update">
      <span>Обновление {version} готово</span>
      <button
        onClick={() => {
          if (!inCall || confirm('Перезапуск отключит тебя от голосового канала. Обновить сейчас?')) {
            void voice.leave().then(() => window.echo.installUpdate());
          }
        }}
      >
        Перезапустить
      </button>
    </div>
  );
}

function ChannelList({
  channels,
  voiceState,
  isAdmin,
  peopleIn,
  onJoin,
  onPersonMenu,
  onError,
}: {
  channels: Channel[];
  voiceState: VoiceState;
  isAdmin: boolean;
  peopleIn: (c: Channel) => Person[];
  onJoin: (id: number) => void;
  onPersonMenu: (e: MouseEvent, p: Person) => void;
  onError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const create = async (e: Event) => {
    e.preventDefault();
    try {
      await window.echo.createChannel(name);
      setName('');
      setAdding(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (c: Channel) => {
    if (!confirm(`Удалить канал «${c.name}»? Все, кто в нём сидит, будут отключены.`)) return;
    try {
      await window.echo.deleteChannel(c.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <nav class="channels">
      <div class="section-title">
        <span>Голосовые каналы</span>
        {isAdmin && (
          <button class="icon-btn tiny" title="Создать канал" onClick={() => setAdding(!adding)}>
            <PlusIcon size={14} />
          </button>
        )}
      </div>

      {adding && (
        <form class="add-channel" onSubmit={create}>
          <input
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Название канала"
            maxLength={48}
            autoFocus
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          />
        </form>
      )}

      {channels.map((c) => {
        const active = voiceState.channelId === c.id && voiceState.status !== 'idle';
        const people = peopleIn(c);
        return (
          <div key={c.id} class="channel-block">
            <div class={`channel${active ? ' active' : ''}`} onClick={() => onJoin(c.id)} title="Зайти в канал">
              <VolumeIcon size={18} />
              <span class="channel-name">{c.name}</span>
              {isAdmin && (
                <button
                  class="channel-delete"
                  title="Удалить канал"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(c);
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {people.length > 0 && (
              <ul class="members">
                {people.map((p) => (
                  <li key={p.id} class="member" onContextMenu={(e) => onPersonMenu(e, p)}>
                    <Avatar id={p.id} name={p.nickname} avatar={p.avatar} size={22} speaking={p.speaking} />
                    <span class="member-name">{p.nickname}</span>
                    {p.streaming && <span class="live-badge">LIVE</span>}
                    {p.micMuted && <MicOffIcon size={14} class="member-muted" />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function VoiceStage({
  channel,
  state,
  people,
  onPersonMenu,
}: {
  channel: Channel;
  state: VoiceState;
  people: Person[];
  onPersonMenu: (e: MouseEvent, p: Person) => void;
}) {
  const [picker, setPicker] = useState(false);
  const watched = state.watching ? people.find((p) => p.id === state.watching) : undefined;
  const connected = state.status === 'connected';

  return (
    <div class="voice-stage">
      <header class="stage-header">
        <VolumeIcon size={20} />
        <h2>{channel.name}</h2>
      </header>

      {state.sharing && (
        <div class="sharing-bar">
          <span class="live-dot" />
          <span>
            Ты транслируешь <b>{state.sharing.sourceName}</b> · {state.sharing.quality}
            {state.sharing.withAudio ? ' · со звуком' : ''}
          </span>
          <button class="secondary small" onClick={() => void voice.stopScreenShare()}>
            Остановить
          </button>
        </div>
      )}

      {watched ? <StreamView person={watched} /> : null}

      <div class={`tiles${watched ? ' strip' : ''}`}>
        {people.map((p) => {
          const canWatch = p.streaming && !p.isLocal;
          return (
            <div
              key={p.id}
              class={`tile${p.speaking ? ' speaking' : ''}${canWatch ? ' streaming' : ''}${state.watching === p.id ? ' watched' : ''}`}
              onContextMenu={(e) => onPersonMenu(e, p)}
              onClick={() => canWatch && (state.watching === p.id ? voice.unwatch() : voice.watch(p.id))}
              title={canWatch ? 'Смотреть трансляцию' : p.isLocal ? undefined : 'ПКМ — громкость'}
            >
              <Avatar id={p.id} name={p.nickname} avatar={p.avatar} size={watched ? 40 : 72} speaking={p.speaking} />
              <div class="tile-name">
                {p.nickname}
                {p.isLocal && <span class="muted"> (ты)</span>}
                {p.micMuted && <MicOffIcon size={14} class="member-muted" />}
              </div>
              {p.streaming && <span class="live-badge tile-live">LIVE</span>}
              {canWatch && !watched && <span class="watch-hint">Смотреть</span>}
            </div>
          );
        })}
      </div>

      <div class="stage-controls">
        <button
          class={`round-btn${state.micMuted ? ' off' : ''}`}
          title="Микрофон"
          onClick={() => void voice.toggleMic()}
        >
          {state.micMuted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          class={`round-btn${state.sharing ? ' live' : ''}`}
          title={state.sharing ? 'Остановить трансляцию' : 'Транслировать экран или окно'}
          disabled={!connected}
          onClick={() => (state.sharing ? void voice.stopScreenShare() : setPicker(true))}
        >
          <ScreenIcon />
        </button>
        <button class="round-btn danger" title="Отключиться" onClick={() => void voice.leave()}>
          <HangUpIcon />
        </button>
      </div>

      {picker && <ScreenPicker onClose={() => setPicker(false)} />}
    </div>
  );
}

function StreamView({ person }: { person: Person }) {
  const s = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [res, setRes] = useState('');
  const volume = s.streamVolumes[person.id] ?? 1;

  useEffect(() => {
    setReady(false);
    const el = video.current!;
    const onSize = () => el.videoWidth && setRes(`${el.videoWidth}×${el.videoHeight}`);
    el.addEventListener('resize', onSize);
    el.addEventListener('playing', () => setReady(true), { once: true });
    const detach = voice.attachStream(person.id, el, () => {});
    return () => {
      el.removeEventListener('resize', onSize);
      detach();
    };
  }, [person.id]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  };

  return (
    <div class="stream" ref={box} onDblClick={fullscreen}>
      <video ref={video} autoPlay playsInline muted />
      {!ready && <div class="stream-loading">Подключаемся к трансляции…</div>}
      <div class="stream-bar">
        <span class="live-badge">LIVE</span>
        <span class="stream-title">{person.nickname}</span>
        {res && <span class="muted tiny">{res}</span>}
        <span class="spacer" />
        <label class="stream-volume" title="Громкость трансляции">
          <VolumeIcon size={16} />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onInput={(e) => voice.setStreamVolume(person.id, Number(e.currentTarget.value))}
          />
        </label>
        <button class="icon-btn" title="Во весь экран (двойной клик)" onClick={fullscreen}>
          <FullscreenIcon size={18} />
        </button>
        <button class="icon-btn" title="Перестать смотреть" onClick={() => voice.unwatch()}>
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  );
}

function VolumePopover({ menu, onClose }: { menu: VolumeMenu; onClose: () => void }) {
  const s = useSettings();
  const volume = s.userVolumes[menu.id] ?? 1;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the popover inside the window.
  const left = Math.min(menu.x, window.innerWidth - 240);
  const top = Math.min(menu.y, window.innerHeight - 110);

  return (
    <div class="popover" ref={ref} style={{ left, top }}>
      <div class="popover-title">{menu.nickname}</div>
      <label class="field">
        <span class="field-label">Громкость — {Math.round(volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={volume}
          onInput={(e) => voice.setUserVolume(menu.id, Number(e.currentTarget.value))}
        />
      </label>
      {volume !== 1 && (
        <button class="link-btn" onClick={() => voice.setUserVolume(menu.id, 1)}>
          Сбросить до 100%
        </button>
      )}
    </div>
  );
}
