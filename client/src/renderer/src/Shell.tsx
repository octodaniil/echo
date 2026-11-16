import { useEffect, useRef, useState } from 'preact/hooks';
import type { Channel, ChannelMember, Session } from '../../shared/types';
import {
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  ScreenIcon,
  UserPlusIcon,
  VolumeIcon,
} from './icons';
import { voice, type VoiceParticipant, type VoiceState } from './voice';

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

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

// Stable pleasant hue per user so avatars are distinguishable.
function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ id, name, size = 32, speaking = false }: { id: string; name: string; size?: number; speaking?: boolean }) {
  return (
    <span
      class={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(id)} 45% 42%)` }}
    >
      {initial(name)}
    </span>
  );
}

export function Main({ session, channels, online }: { session: Session; channels: Channel[]; online: boolean }) {
  const v = useVoice();
  const [toast, showToast] = useToast();
  const isAdmin = session.user.isAdmin;
  const currentChannel = channels.find((c) => c.id === v.channelId) ?? null;

  useEffect(() => {
    if (v.error) {
      showToast(v.error);
      voice.clearError();
    }
  }, [v.error]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const invite = () =>
    run(async () => {
      const inv = await window.echo.createInvite();
      showToast(`Инвайт ${inv.code} скопирован, действует 3 дня`);
    });

  return (
    <div class="layout">
      <aside class="sidebar">
        <header class="sidebar-header">
          <div class="brand small">
            <span class="brand-mark" />
            <span>Echo</span>
          </div>
          {isAdmin && (
            <button class="icon-btn" title="Пригласить друга" onClick={invite}>
              <UserPlusIcon size={18} />
            </button>
          )}
        </header>

        {!online && <div class="offline">Нет связи с сервером…</div>}

        <ChannelList
          channels={channels}
          voiceState={v}
          isAdmin={isAdmin}
          onJoin={(id) => void voice.join(id)}
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
          <Avatar id={session.user.id} name={session.user.nickname} size={32} />
          <div class="userbar-name">
            <div class="nick">{session.user.nickname}</div>
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
          <button
            class="icon-btn"
            title="Выйти из аккаунта"
            onClick={() => {
              if (confirm('Выйти из аккаунта? Чтобы зайти снова, понадобится новый инвайт.')) {
                void voice.leave().then(() => window.echo.logout());
              }
            }}
          >
            <LogOutIcon size={18} />
          </button>
        </footer>
      </aside>

      <main class="stage">
        {currentChannel && v.status !== 'idle' ? (
          <VoiceStage channel={currentChannel} state={v} />
        ) : (
          <div class="empty">
            <VolumeIcon size={40} />
            <p>Выбери голосовой канал слева, чтобы зайти</p>
          </div>
        )}
      </main>

      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

function ChannelList({
  channels,
  voiceState,
  isAdmin,
  onJoin,
  onError,
}: {
  channels: Channel[];
  voiceState: VoiceState;
  isAdmin: boolean;
  onJoin: (id: number) => void;
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
        // In our own channel we have live data (speaking, mute); elsewhere use the server's list.
        const members: (ChannelMember | VoiceParticipant)[] =
          active && voiceState.status === 'connected' ? voiceState.participants : c.members;
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
            {members.length > 0 && (
              <ul class="members">
                {members.map((m) => {
                  const live = 'speaking' in m ? m : null;
                  return (
                    <li key={m.id} class="member">
                      <Avatar id={m.id} name={m.nickname} size={22} speaking={live?.speaking} />
                      <span class="member-name">{m.nickname}</span>
                      {'streaming' in m && m.streaming && <span class="live-badge">LIVE</span>}
                      {live?.micMuted && <MicOffIcon size={14} class="member-muted" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function VoiceStage({ channel, state }: { channel: Channel; state: VoiceState }) {
  return (
    <div class="voice-stage">
      <header class="stage-header">
        <VolumeIcon size={20} />
        <h2>{channel.name}</h2>
      </header>
      <div class="tiles">
        {state.participants.map((p) => (
          <div key={p.id} class={`tile${p.speaking ? ' speaking' : ''}`}>
            <Avatar id={p.id} name={p.nickname} size={72} speaking={p.speaking} />
            <div class="tile-name">
              {p.nickname}
              {p.isLocal && <span class="muted"> (ты)</span>}
              {p.micMuted && <MicOffIcon size={14} class="member-muted" />}
            </div>
          </div>
        ))}
      </div>
      <div class="stage-controls">
        <button
          class={`round-btn${state.micMuted ? ' off' : ''}`}
          title="Микрофон"
          onClick={() => void voice.toggleMic()}
        >
          {state.micMuted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button class="round-btn" title="Трансляция экрана — скоро" disabled>
          <ScreenIcon />
        </button>
        <button class="round-btn danger" title="Отключиться" onClick={() => void voice.leave()}>
          <HangUpIcon />
        </button>
      </div>
    </div>
  );
}
