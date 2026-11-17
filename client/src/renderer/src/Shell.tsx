import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AchievementDef, Activity, Channel, Look, PresenceUser, Prestige, Session, UserStatus } from '../../shared/types';
import { Badge, LevelChip, PinnedBadges, reloadCatalog, UniqueTitles } from './Achievements';
import { lookVars, rankName } from './look';
import { StatusLine, StatusMenu, useMyStatus } from './Status';
import { coverUrl, GameCover } from './GameCover';
import { Avatar, Nick } from './Avatar';
import {
  CloseIcon,
  EyeIcon,
  FullscreenIcon,
  GearIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PopoutIcon,
  PlusIcon,
  ScreenIcon,
  ScreenOffIcon,
  SignalIcon,
  UserPlusIcon,
  VolumeIcon,
} from './icons';
import { installHotkeys } from './hotkeys';
import { openPopout, toggleFullscreen, type Popout } from './popout';
import { bannerUrl, useSettings } from './profile';
import { ProfileView } from './ProfileView';
import { ScreenPicker } from './ScreenPicker';
import { SettingsView } from './SettingsView';
import { play } from './sounds';
import { StreamOptions } from './StreamOptions';
import { voice, type ConnectionStats, type OutboundStats, type VoiceState } from './voice';

function useVoice(): VoiceState {
  const [state, setState] = useState(voice.snapshot);
  useEffect(() => voice.subscribe(setState), []);
  return state;
}

type Toast = { text: string } | { achievement: AchievementDef };

function useToast(): [Toast | null, (t: Toast | string, ms?: number) => void] {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number>();
  const show = (t: Toast | string, ms = 3500) => {
    setToast(typeof t === 'string' ? { text: t } : t);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), ms);
  };
  return [toast, show];
}

interface ProfileLite {
  nickname: string;
  avatar: number | null;
  pinned?: string[];
  prestige?: Prestige;
  activity?: Activity | null;
  uniques?: string[];
  role?: 'admin' | 'moderator' | null;
  banner?: number | null;
  style?: Look;
  status?: UserStatus;
}

/** A person shown in the UI: server profile merged with live voice data when we share a channel. */
interface Person {
  id: string;
  nickname: string;
  avatar: number | null;
  pinned?: string[];
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  streaming: boolean;
  joinedAt: number;
  viewers: string[];
  ns?: string | null;
  quality?: VoiceState['quality'];
  prestige?: Prestige;
  activity?: Activity | null;
  uniques?: string[];
  role?: 'admin' | 'moderator' | null;
  banner?: number | null;
  style?: Look;
  status?: UserStatus;
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
  presence,
  online,
  onSession,
}: {
  session: Session;
  channels: Channel[];
  presence: PresenceUser[];
  online: boolean;
  onSession: (s: Session) => void;
}) {
  const v = useVoice();
  const [toast, showToast] = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [volumeMenu, setVolumeMenu] = useState<VolumeMenu | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const isAdmin = session.user.isAdmin;
  const me = session.user;
  const currentChannel = channels.find((c) => c.id === v.channelId) ?? null;

  // Latest nickname/avatar/badges for everyone we know about.
  const profiles = useMemo(() => {
    const map = new Map<string, ProfileLite>();
    for (const c of channels)
      for (const m of c.members)
        map.set(m.id, {
          nickname: m.nickname,
          avatar: m.avatar ?? null,
          pinned: m.pinned,
          prestige: m.prestige,
          uniques: m.uniques,
          role: m.role,
          banner: m.banner,
          style: m.style,
          status: m.status,
        });
    // Presence is the freshest source (also covers people who are online but not in voice).
    for (const u of presence)
      map.set(u.id, {
        nickname: u.nickname,
        avatar: u.avatar,
        pinned: u.pinned,
        prestige: u.prestige,
        activity: u.activity,
        uniques: u.uniques,
        role: u.role,
        banner: u.banner,
        style: u.style,
        status: u.status,
      });
    map.set(me.id, { ...map.get(me.id), nickname: me.nickname, avatar: me.avatar ?? null });
    return map;
  }, [channels, presence, me]);
  const myProfile = profiles.get(me.id);
  const myPrestige = myProfile?.prestige;
  const [statusMenu, setStatusMenu] = useState(false);
  useMyStatus(myProfile?.status, v.status !== 'idle');

  // Keep the tray menu in sync (mute / deafen labels, current channel).
  useEffect(() => {
    void window.echo
      .setTrayState({
        micMuted: v.micMuted,
        deafened: v.deafened,
        channel: v.status !== 'idle' ? (currentChannel?.name ?? null) : null,
      })
      .catch(() => {});
  }, [v.micMuted, v.deafened, v.status, currentChannel?.name]);
  const nameOf = (id: string) => profiles.get(id)?.nickname ?? 'кто-то';

  // Current channel in the title bar.
  useEffect(() => {
    const el = document.getElementById('titlebar-info');
    if (!el) return;
    el.textContent = v.status !== 'idle' && currentChannel ? `· ${currentChannel.name}` : '';
  }, [v.status, currentChannel?.name]);

  useEffect(() => {
    if (v.error) {
      showToast(v.error);
      voice.clearError();
    }
  }, [v.error]);

  useEffect(() => installHotkeys(), []);

  // An admin dragged us into another channel.
  useEffect(
    () =>
      window.echo.onMove(({ channelId, by }) => {
        const target = channels.find((c) => c.id === channelId);
        void voice.join(channelId);
        showToast(`${by} перенёс тебя в «${target?.name ?? 'другой канал'}»`);
      }),
    [channels],
  );

  // New achievement: special toast + sound.
  useEffect(
    () =>
      window.echo.onAchievement(({ code, def: sent }) => {
        // Re-fetch: a hidden achievement is only revealed in the catalog once earned.
        void reloadCatalog().then((all) => {
          const def = sent ?? all.find((a) => a.code === code);
          if (!def) return;
          void play('achievement');
          showToast({ achievement: def }, def.hidden || def.unique ? 8000 : 6000);
        });
      }),
    [],
  );

  const invite = async () => {
    try {
      const inv = await window.echo.createInvite();
      showToast(`Инвайт ${inv.code} скопирован, действует 3 дня`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const openVolume = (e: MouseEvent, p: Person) => {
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
          pinned: prof?.pinned,
          prestige: prof?.prestige ?? server?.prestige,
          activity: prof?.activity ?? null,
          uniques: prof?.uniques ?? server?.uniques,
          role: prof?.role ?? server?.role,
          banner: prof?.banner ?? server?.banner,
          style: prof?.style ?? server?.style,
          status: prof?.status ?? server?.status,
          streaming: p.streaming || (server?.streaming ?? false),
          joinedAt: server?.joinedAt || p.joinedAt,
        };
      });
    }
    // While we're connected somewhere, a stale server list must not show us in a second channel.
    const inCallElsewhere = v.status !== 'idle' && v.channelId !== c.id;
    return c.members
      .filter((m) => !(inCallElsewhere && m.id === me.id))
      .map((m) => ({
        id: m.id,
        nickname: m.nickname,
        avatar: m.avatar ?? null,
        pinned: m.pinned,
        isLocal: m.id === me.id,
        speaking: false,
        micMuted: false,
        streaming: m.streaming,
        joinedAt: m.joinedAt,
        viewers: [],
        ns: null,
        prestige: profiles.get(m.id)?.prestige ?? m.prestige,
        activity: profiles.get(m.id)?.activity ?? null,
        uniques: profiles.get(m.id)?.uniques ?? m.uniques,
        role: profiles.get(m.id)?.role ?? m.role,
        banner: profiles.get(m.id)?.banner ?? m.banner,
        style: profiles.get(m.id)?.style ?? m.style,
        status: profiles.get(m.id)?.status ?? m.status,
      }));
  };

  // Count what the lists show (a stale server entry for ourselves is filtered out there).
  const totalOnline = channels.reduce((n, c) => n + peopleIn(c).length, 0);

  return (
    <div class="layout">
      <aside class="sidebar">
        <header class="sidebar-header">
          <div class="brand small">
            <span class="brand-mark" />
            <span class="brand-word">ECHO</span>
          </div>
          <span class="mono muted tiny" title="Сейчас в голосе">
            {totalOnline > 0 ? `${totalOnline} в сети` : ''}
          </span>
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
          onWatch={(channelId, userId) => void voice.watchUser(channelId, userId)}
          onProfile={setProfileId}
          onHover={setHover}
          onMove={async (channelId, userId) => {
            try {
              await window.echo.moveUser(channelId, userId);
            } catch (err) {
              showToast(err instanceof Error ? err.message : String(err));
            }
          }}
          onError={(m) => showToast(m)}
        >
          <OnlineList
            users={presence.filter((u) => !channels.some((c) => peopleIn(c).some((p) => p.id === u.id)))}
            onProfile={setProfileId}
            onHover={setHover}
          />
        </ChannelList>

        {v.status !== 'idle' && (
          <div class="voice-status">
            <div class="voice-status-info">
              <div class={`voice-status-title ${v.status}`}>
                {v.status === 'connected' ? 'Голос подключён' : v.status === 'connecting' ? 'Подключение…' : 'Переподключение…'}
              </div>
              <div class="voice-status-channel">{currentChannel?.name ?? ''}</div>
            </div>
            <div class="voice-status-actions">
              <ConnectionIndicator quality={v.quality} />
              {v.watching && (
                <button class="icon-btn" title="Перестать смотреть трансляцию" onClick={() => voice.unwatch()}>
                  <ScreenOffIcon size={18} />
                </button>
              )}
              <button class="icon-btn danger" title="Отключиться" onClick={() => void voice.leave()}>
                <HangUpIcon size={20} />
              </button>
            </div>
          </div>
        )}

        <footer class="userbar">
          <button class="userbar-me" title="Статус и профиль" onClick={() => setStatusMenu(!statusMenu)}>
            <Avatar
              id={me.id}
              name={me.nickname}
              avatar={me.avatar}
              size={34}
              prestige={myPrestige}
              look={myProfile?.style}
              status={myProfile?.status?.state}
              uniques={myProfile?.uniques}
            />
            <span class="userbar-name">
              <span class="nick">
                <Nick name={me.nickname} look={myProfile?.style} />
              </span>
              <StatusLine
                status={myProfile?.status}
                fallback={isAdmin ? 'админ' : myProfile?.role === 'moderator' ? 'модератор' : 'в сети'}
              />
            </span>
          </button>
          {statusMenu && (
            <StatusMenu
              current={myProfile?.status}
              onProfile={() => {
                setStatusMenu(false);
                setProfileId(me.id);
              }}
              onClose={() => setStatusMenu(false)}
              onError={(m) => showToast(m)}
            />
          )}
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
          <VoiceStage
            channel={currentChannel}
            state={v}
            people={peopleIn(currentChannel)}
            nameOf={nameOf}
            onPersonMenu={openVolume}
            onProfile={setProfileId}
          />
        ) : (
          <div class="empty">
            <div class="empty-ring">
              <VolumeIcon size={34} />
            </div>
            <p>Выбери голосовой канал слева, чтобы зайти</p>
          </div>
        )}
      </main>

      {hover && <HoverCard info={hover} />}
      {volumeMenu && (
        <VolumePopover
          menu={volumeMenu}
          isLocal={volumeMenu.id === me.id}
          onProfile={() => {
            setProfileId(volumeMenu.id);
            setVolumeMenu(null);
          }}
          onClose={() => setVolumeMenu(null)}
        />
      )}
      {profileId && (
        <ProfileView
          userId={profileId}
          meId={me.id}
          amAdmin={isAdmin}
          activity={profiles.get(profileId)?.activity ?? null}
          onClose={() => setProfileId(null)}
        />
      )}
      {showSettings && <SettingsView session={session} onSession={onSession} onClose={() => setShowSettings(false)} />}
      {toast &&
        ('achievement' in toast ? (
          <div class={`toast achievement-toast r-${toast.achievement.rarity}`}>
            <Badge def={toast.achievement} size={44} />
            <div>
              <div class="achievement-toast-label">
                {toast.achievement.hidden ? 'Секретная ачивка открыта' : toast.achievement.unique ? 'Уникальная ачивка' : 'Новая ачивка'}
              </div>
              <div class="achievement-toast-title">{toast.achievement.title}</div>
              <div class="muted tiny">{toast.achievement.description}</div>
            </div>
          </div>
        ) : (
          <div class="toast">{toast.text}</div>
        ))}
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
  onWatch,
  onProfile,
  onHover,
  onMove,
  onError,
  children,
}: {
  children?: ComponentChildren;
  channels: Channel[];
  voiceState: VoiceState;
  isAdmin: boolean;
  peopleIn: (c: Channel) => Person[];
  onJoin: (id: number) => void;
  onPersonMenu: (e: MouseEvent, p: Person) => void;
  onWatch: (channelId: number, userId: string) => void;
  onProfile: (userId: string) => void;
  onHover: (info: HoverInfo | null) => void;
  onMove: (channelId: number, userId: string) => void;
  onError: (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  // Admin drag & drop: which channel the dragged person hovers over.
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [name, setName] = useState('');
  // Single click opens the profile, double click on a streamer opens the stream.
  const clickTimer = useRef<number>();

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
            <div
              class={`channel${active ? ' active' : ''}${dropTarget === c.id ? ' drop' : ''}`}
              onClick={() => onJoin(c.id)}
              title="Зайти в канал"
              onDragOver={(e) => {
                if (!isAdmin || !e.dataTransfer?.types.includes('text/echo-user')) return;
                e.preventDefault();
                setDropTarget(c.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
              onDrop={(e) => {
                const userId = e.dataTransfer?.getData('text/echo-user');
                setDropTarget(null);
                if (isAdmin && userId) onMove(c.id, userId);
              }}
            >
              <VolumeIcon size={17} />
              <span class="channel-name">{c.name}</span>
              {people.length > 0 && <span class="channel-count mono">{people.length}</span>}
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
                  <li
                    key={p.id}
                    class={`member plate-${p.style?.plate ?? 'none'}${p.streaming && !p.isLocal ? ' can-watch' : ''}${p.speaking ? ' speaking' : ''}`}
                    style={lookVars(p.style)}
                    draggable={isAdmin}
                    onDragStart={(e) => {
                      onHover(null);
                      e.dataTransfer?.setData('text/echo-user', p.id);
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDropTarget(null)}
                    onClick={() => {
                      clearTimeout(clickTimer.current);
                      clickTimer.current = window.setTimeout(() => onProfile(p.id), p.streaming && !p.isLocal ? 230 : 0);
                    }}
                    onDblClick={() => {
                      clearTimeout(clickTimer.current);
                      if (p.streaming && !p.isLocal) onWatch(c.id, p.id);
                    }}
                    onContextMenu={(e) => onPersonMenu(e, p)}
                    onMouseEnter={(e) =>
                      onHover({ person: p, channel: c.name, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
                    }
                    onMouseLeave={() => onHover(null)}
                  >
                    <Avatar
                      id={p.id}
                      name={p.nickname}
                      avatar={p.avatar}
                      size={22}
                      speaking={p.speaking}
                      prestige={p.prestige}
                      look={p.style}
                      status={p.status?.state}
                      uniques={p.uniques}
                    />
                    <span class="member-main">
                      <span class="member-name">
                        <Nick name={p.nickname} look={p.style} />
                        <LevelChip prestige={p.prestige} look={p.style} />
                      </span>
                      {p.activity ? (
                        <span class="member-game">🎮 {p.activity.game}</span>
                      ) : (
                        p.status?.text && <StatusLine status={p.status} class="member-game idle" />
                      )}
                    </span>
                    {p.streaming && <span class="live-badge">LIVE</span>}
                    {p.micMuted && <MicOffIcon size={14} class="member-muted" />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {children}
    </nav>
  );
}

/** People who are online but not in a voice channel (with what they play). */
function OnlineList({
  users,
  onProfile,
  onHover,
}: {
  users: PresenceUser[];
  onProfile: (id: string) => void;
  onHover: (info: HoverInfo | null) => void;
}) {
  if (users.length === 0) return null;
  return (
    <div class="online-list">
      <div class="section-title">
        <span>В сети — {users.length}</span>
      </div>
      <ul class="members flat">
        {users.map((u) => {
          const person: Person = {
            id: u.id,
            nickname: u.nickname,
            avatar: u.avatar,
            pinned: u.pinned,
            isLocal: false,
            speaking: false,
            micMuted: false,
            streaming: false,
            joinedAt: 0,
            viewers: [],
            prestige: u.prestige,
            activity: u.activity,
            uniques: u.uniques,
            role: u.role,
            banner: u.banner,
            style: u.style,
            status: u.status,
          };
          return (
            <li
              key={u.id}
              class={`member plate-${u.style?.plate ?? 'none'}`}
              style={lookVars(u.style)}
              onClick={() => onProfile(u.id)}
              onMouseEnter={(e) =>
                onHover({ person, channel: '', rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
              }
              onMouseLeave={() => onHover(null)}
            >
              <Avatar
                id={u.id}
                name={u.nickname}
                avatar={u.avatar}
                size={24}
                prestige={u.prestige}
                look={u.style}
                status={u.status?.state}
                uniques={u.uniques}
              />
              <span class="member-main">
                <span class="member-name">
                  <Nick name={u.nickname} look={u.style} />
                  <LevelChip prestige={u.prestige} look={u.style} />
                </span>
                {u.activity ? (
                  <span class="member-game">🎮 {u.activity.game}</span>
                ) : (
                  <StatusLine status={u.status} fallback="в сети" class="member-game idle" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Tile size class by how many people are in the channel. */
type GridSize = 'xl' | 'l' | 'm' | 's';
const gridSize = (n: number): GridSize => (n <= 2 ? 'xl' : n <= 4 ? 'l' : n <= 8 ? 'm' : 's');
const TILE_AVATAR: Record<GridSize, number> = { xl: 112, l: 92, m: 76, s: 52 };

function VoiceStage({
  channel,
  state,
  people,
  nameOf,
  onPersonMenu,
  onProfile,
}: {
  channel: Channel;
  state: VoiceState;
  people: Person[];
  nameOf: (id: string) => string;
  onPersonMenu: (e: MouseEvent, p: Person) => void;
  onProfile: (id: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const watched = state.watching ? people.find((p) => p.id === state.watching) : undefined;
  // Stream shown in a separate OS window instead of the stage.
  const [popped, setPopped] = useState<{ id: string; popout: Popout } | null>(null);
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

  // Close the pop-out when we stop watching that person (or switch to someone else).
  useEffect(() => {
    if (popped && popped.id !== state.watching) {
      popped.popout.close();
      setPopped(null);
    }
  }, [state.watching]);
  useEffect(() => () => popped?.popout.close(), [popped]);

  const popOutStream = () => {
    if (!watched) return;
    const id = watched.id;
    const popout = openPopout(
      `stream-${id}`,
      `Echo — трансляция ${watched.nickname}`,
      () => <PopoutStream participantId={id} nameOf={nameOf} getPerson={() => watchedRef.current} />,
      () => setPopped((cur) => (cur?.popout === popout ? null : cur)),
    );
    if (popout) setPopped({ id, popout });
  };
  const connected = state.status === 'connected';
  const myViewers = people.find((p) => p.isLocal)?.viewers ?? [];

  return (
    <div class="voice-stage">
      <header class="stage-header">
        <VolumeIcon size={18} />
        <h2>{channel.name}</h2>
        <span class="stage-meta mono">{people.length} в канале</span>
      </header>

      {state.sharing && (
        <div class="sharing-bar">
          <span class="live-dot" />
          <span class="sharing-text">
            Ты транслируешь <b>{state.sharing.sourceName}</b>
            <span class="mono muted"> · {state.sharing.quality}</span>
            {state.sharing.withAudio ? <span class="muted"> · со звуком</span> : ''}
          </span>
          <ViewerChip ids={myViewers} nameOf={nameOf} />
          <StreamSettingsButton />
          <button class="secondary small" onClick={() => void voice.stopScreenShare()}>
            Остановить
          </button>
        </div>
      )}

      {watched && popped?.id === watched.id ? (
        <div class="stream popped-placeholder">
          <div>
            <PopoutIcon size={28} />
            <p>Трансляция {watched.nickname} открыта в отдельном окне</p>
            <button
              class="secondary small"
              onClick={() => {
                popped.popout.close();
                setPopped(null);
              }}
            >
              Вернуть сюда
            </button>
          </div>
        </div>
      ) : watched ? (
        <StreamView person={watched} nameOf={nameOf} onPopout={popOutStream} />
      ) : null}

      <div class={`tiles ${watched ? 'strip' : `grid-${gridSize(people.length)}`}`}>
        {people.map((p) => {
          const canWatch = p.streaming && !p.isLocal;
          return (
            <div
              key={p.id}
              class={`tile rank-${p.prestige?.tier ?? 0}${p.speaking ? ' speaking' : ''}${canWatch ? ' streaming' : ''}${state.watching === p.id ? ' watched' : ''}`}
              style={{
                ...lookVars(p.style),
                ...(!watched && p.activity && coverUrl(p.activity.game)
                  ? { '--cover': `url("${coverUrl(p.activity.game)}")` }
                  : {}),
              }}
              data-cover={!watched && p.activity && coverUrl(p.activity.game) ? '' : undefined}
              onContextMenu={(e) => onPersonMenu(e, p)}
              onClick={() =>
                canWatch ? (state.watching === p.id ? voice.unwatch() : voice.watch(p.id)) : onProfile(p.id)
              }
              title={canWatch ? 'Смотреть трансляцию' : 'Профиль · ПКМ — громкость'}
            >
              <Avatar
                id={p.id}
                name={p.nickname}
                avatar={p.avatar}
                size={watched ? 40 : TILE_AVATAR[gridSize(people.length)]}
                speaking={p.speaking}
                prestige={p.prestige}
                look={p.style}
                status={p.status?.state}
                uniques={p.uniques}
                animated={!watched && people.length <= 8}
              />
              <div class="tile-name">
                <Nick name={p.nickname} look={p.style} />
                {p.isLocal && <span class="muted"> (ты)</span>}
                {p.micMuted ? (
                  <MicOffIcon size={14} class="member-muted" />
                ) : (
                  <span class={`eq${p.speaking ? ' on' : ''}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              {!watched && p.activity && <div class="tile-game">🎮 {p.activity.game}</div>}
              {!watched && !p.activity && p.status?.text && <StatusLine status={p.status} class="tile-game idle" />}
              {!watched && <PinnedBadges codes={p.pinned} size={20} />}
              {p.streaming && (
                <span class="live-badge tile-live">
                  LIVE
                  {p.viewers.length > 0 && (
                    <span class="live-viewers">
                      <EyeIcon size={11} /> {p.viewers.length}
                    </span>
                  )}
                </span>
              )}
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

      {state.sharing && <SelfPreview viewers={myViewers.length} />}
      {picker && <ScreenPicker onClose={() => setPicker(false)} />}
    </div>
  );
}

function ViewerChip({ ids, nameOf }: { ids: string[]; nameOf: (id: string) => string }) {
  return (
    <span
      class={`viewer-chip${ids.length ? ' has' : ''}`}
      title={ids.length ? `Смотрят: ${ids.map(nameOf).join(', ')}` : 'Пока никто не смотрит'}
    >
      <EyeIcon size={14} />
      <span class="mono">{ids.length}</span>
    </span>
  );
}

/** Change quality / bitrate / priority of the running stream. */
function StreamSettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div class="stream-settings" ref={ref}>
      <button class={`icon-btn${open ? ' active' : ''}`} title="Настройки трансляции" onClick={() => setOpen(!open)}>
        <GearIcon size={18} />
      </button>
      {open && (
        <div class="stream-settings-popover">
          <div class="popover-title">Настройки трансляции</div>
          <StreamOptions />
          <small class="muted">Применяется сразу, без перезапуска трансляции.</small>
        </div>
      )}
    </div>
  );
}

/** Streamer's own picture-in-picture: drag it by the top bar, resize from the corner,
 *  or open it as a separate window (snap, maximize, another monitor). */
function SelfPreview({ viewers }: { viewers: number }) {
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [popout, setPopout] = useState<Popout | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => () => popout?.close(), [popout]);

  const onPointerDown = (e: PointerEvent) => {
    const el = box.current;
    if (!el || (e.target as HTMLElement).closest('button')) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const el = box.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!drag.current || !el || !parent) return;
    const pr = parent.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - pr.left - drag.current.dx), pr.width - el.offsetWidth);
    const y = Math.min(Math.max(0, e.clientY - pr.top - drag.current.dy), pr.height - el.offsetHeight);
    setPos({ x, y });
  };
  const onPointerUp = () => (drag.current = null);

  const popOut = () => {
    const p = openPopout('self-preview', 'Echo — твой эфир', () => <SelfPreviewBody viewers={viewers} popout />, () =>
      setPopout(null),
    );
    if (p) setPopout(p);
  };

  if (popout) {
    return (
      <button class="self-preview-collapsed" onClick={() => popout.close()} title="Вернуть превью в приложение">
        <PopoutIcon size={16} /> Превью в отдельном окне
      </button>
    );
  }
  if (hidden) {
    return (
      <button class="self-preview-collapsed" onClick={() => setHidden(false)} title="Показать превью трансляции">
        <ScreenIcon size={16} /> Превью
      </button>
    );
  }
  return (
    <div
      class="self-preview"
      ref={box}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      <SelfPreviewBody
        viewers={viewers}
        bar={
          <div
            class="self-preview-top"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title="Перетащи, чтобы подвинуть"
          >
            <span class="live-badge">LIVE</span>
            <span class="tiny">Твой эфир</span>
            <span class="spacer" />
            <button class="icon-btn tiny" title="В отдельное окно" onClick={popOut}>
              <PopoutIcon size={14} />
            </button>
            <button class="icon-btn tiny" title="Скрыть превью" onClick={() => setHidden(true)}>
              <CloseIcon size={14} />
            </button>
          </div>
        }
      />
    </div>
  );
}

/** Video + live outbound stats; used in the in-app box and in the pop-out window. */
function SelfPreviewBody({ viewers, bar, popout }: { viewers: number; bar?: VNode; popout?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<OutboundStats | null>(null);
  const [liveViewers, setLiveViewers] = useState(viewers);

  useEffect(() => {
    const el = video.current;
    const track = voice.localScreenTrack;
    // Local frames only: no decoding, the compositor just draws them.
    if (el && track) el.srcObject = new MediaStream([track]);
    const t = window.setInterval(() => void voice.outboundStats().then(setStats), 1000);
    const off = voice.subscribe((st) => setLiveViewers(st.participants.find((p) => p.isLocal)?.viewers.length ?? 0));
    return () => {
      clearInterval(t);
      off();
      if (el) el.srcObject = null;
    };
  }, []);

  const limited = stats?.limitation && stats.limitation !== 'none';
  return (
    <div
      class={`self-preview-body${popout ? ' popout' : ''}`}
      ref={wrap}
      onDblClick={() => popout && toggleFullscreen(wrap.current)}
    >
      <video ref={video} autoPlay playsInline muted />
      {bar}
      {popout && (
        <div class="self-preview-top">
          <span class="live-badge">LIVE</span>
          <span class="tiny">Твой эфир · двойной клик — во весь экран</span>
        </div>
      )}
      <div class="self-preview-stats mono">
        <span class="sp-viewers">
          <EyeIcon size={11} /> {liveViewers}
        </span>
        {stats?.paused || liveViewers === 0 ? (
          <span>Никто не смотрит — кодирование на паузе</span>
        ) : stats ? (
          <>
            <span>
              {stats.width ?? '—'}×{stats.height ?? '—'}
            </span>
            <span>{stats.fps ?? '—'} fps</span>
            <span>{stats.mbps ?? '—'} Мбит/с</span>
            {limited && (
              <span class="warn">
                упор: {stats.limitation === 'bandwidth' ? 'сеть' : stats.limitation === 'cpu' ? 'CPU' : stats.limitation}
              </span>
            )}
          </>
        ) : (
          <span>…</span>
        )}
      </div>
    </div>
  );
}

function StreamView({
  person,
  nameOf,
  onPopout,
}: {
  person: Person;
  nameOf: (id: string) => string;
  onPopout: () => void;
}) {
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
        {res && <span class="muted tiny mono">{res}</span>}
        <ViewerChip ids={person.viewers} nameOf={nameOf} />
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
        <button class="icon-btn" title="В отдельное окно" onClick={onPopout}>
          <PopoutIcon size={18} />
        </button>
        <button class="icon-btn" title="Во весь экран (двойной клик)" onClick={fullscreen}>
          <FullscreenIcon size={18} />
        </button>
      </div>
    </div>
  );
}

/** A friend's stream in its own window: same track, no extra decoding. */
function PopoutStream({
  participantId,
  nameOf,
  getPerson,
}: {
  participantId: string;
  nameOf: (id: string) => string;
  getPerson: () => Person | undefined;
}) {
  const s = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [res, setRes] = useState('');
  const [, rerender] = useState(0);
  const person = getPerson();
  const volume = s.streamVolumes[participantId] ?? 1;

  // Viewer count etc. change over time; refresh a couple of times a second.
  useEffect(() => voice.subscribe(() => rerender((n) => n + 1)), []);
  useEffect(
    () =>
      voice.watchStreamTrack(participantId, (track) => {
        const el = video.current;
        if (!el) return;
        el.srcObject = track ? new MediaStream([track]) : null;
        void el.play().catch(() => {});
      }),
    [participantId],
  );

  return (
    <div class="stream popout" ref={box} onDblClick={() => toggleFullscreen(box.current)}>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        onResize={(e) => {
          const el = e.currentTarget;
          if (el.videoWidth) setRes(`${el.videoWidth}×${el.videoHeight}`);
        }}
      />
      <div class="stream-bar">
        <span class="live-badge">LIVE</span>
        <span class="stream-title">{person?.nickname ?? ''}</span>
        {res && <span class="muted tiny mono">{res}</span>}
        <ViewerChip ids={person?.viewers ?? []} nameOf={nameOf} />
        <span class="spacer" />
        <label class="stream-volume" title="Громкость трансляции">
          <VolumeIcon size={16} />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onInput={(e) => voice.setStreamVolume(participantId, Number(e.currentTarget.value))}
          />
        </label>
        <button class="icon-btn" title="Во весь экран (двойной клик)" onClick={() => toggleFullscreen(box.current)}>
          <FullscreenIcon size={18} />
        </button>
      </div>
    </div>
  );
}

function VolumePopover({
  menu,
  isLocal,
  onProfile,
  onClose,
}: {
  menu: VolumeMenu;
  isLocal: boolean;
  onProfile: () => void;
  onClose: () => void;
}) {
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
  const top = Math.min(menu.y, window.innerHeight - 140);

  return (
    <div class="popover" ref={ref} style={{ left, top }}>
      <div class="popover-title">{menu.nickname}</div>
      {!isLocal && (
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
      )}
      <div class="popover-actions">
        <button class="link-btn" onClick={onProfile}>
          Открыть профиль
        </button>
        {!isLocal && volume !== 1 && (
          <button class="link-btn" onClick={() => voice.setUserVolume(menu.id, 1)}>
            Сбросить до 100%
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hover card

interface HoverInfo {
  person: Person;
  channel: string;
  rect: DOMRect;
}

const QUALITY_SHORT: Record<string, string> = { excellent: 'отличная', good: 'хорошая', poor: 'плохая', lost: 'потеряна' };

const NS_LABEL: Record<string, string> = { max: 'максимальный', ai: 'ИИ', standard: 'стандартный', off: 'выключен' };

function durationText(since: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - since) / 60_000));
  return mins < 1 ? 'только что' : mins < 60 ? `${mins} мин` : `${Math.floor(mins / 60)} ч ${mins % 60} мин`;
}

function sinceText(joinedAt: number): string {
  const time = new Date(joinedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.max(0, Math.floor((Date.now() - joinedAt) / 60_000));
  const dur = mins < 1 ? 'только что' : mins < 60 ? `${mins} мин` : `${Math.floor(mins / 60)} ч ${mins % 60} мин`;
  return `в канале с ${time} · ${dur}`;
}

function HoverCard({ info }: { info: HoverInfo }) {
  const { person: p, rect } = info;
  const banner = bannerUrl(p.id, p.banner);
  // To the right of the sidebar row, kept inside the window.
  const top = Math.min(rect.top - 6, window.innerHeight - (banner ? 230 : 140));
  return (
    <div class={`hovercard${banner ? ' with-banner' : ''}`} style={{ left: rect.right + 10, top, ...lookVars(p.style) }}>
      {banner && <div class="hovercard-banner" style={{ backgroundImage: `url("${banner}")` }} />}
      <Avatar
        id={p.id}
        name={p.nickname}
        avatar={p.avatar}
        size={44}
        speaking={p.speaking}
        prestige={p.prestige}
        look={p.style}
        status={p.status?.state}
        uniques={p.uniques}
      />
      <div class="hovercard-body">
        <div class="hovercard-name">
          <Nick name={p.nickname} look={p.style} />
          {p.isLocal && <span class="muted"> (ты)</span>}
        </div>
        <UniqueTitles uniques={p.uniques} />
        {p.role && <span class={`role-chip ${p.role}`}>{p.role === 'admin' ? 'Админ' : 'Модератор'}</span>}
        {p.prestige && (
          <div class="hovercard-rank">
            {rankName(p.prestige)} · уровень {p.prestige.level}
          </div>
        )}
        {p.status && (p.status.text || p.status.state !== 'online') && <StatusLine status={p.status} class="hovercard-status" />}
        {p.joinedAt > 0 && <div class="muted tiny">{sinceText(p.joinedAt)}</div>}
        {p.activity && (
          <div class="hovercard-game">
            <GameCover game={p.activity.game} width={60} />
            <span>
              играет в <b>{p.activity.game}</b>
              <span class="muted"> · {durationText(p.activity.since)}</span>
            </span>
          </div>
        )}
        <PinnedBadges codes={p.pinned} size={18} />
        <div class="hovercard-tags">
          {p.streaming && <span class="live-badge">LIVE</span>}
          {p.micMuted && <span class="tag">микрофон выключен</span>}
          {p.ns && <span class={`tag ns ns-${p.ns}`}>шумодав: {NS_LABEL[p.ns] ?? p.ns}</span>}
          {!p.isLocal && p.quality && p.quality !== 'unknown' && (
            <span class={`tag q q-${p.quality}`}>связь: {QUALITY_SHORT[p.quality]}</span>
          )}
          <span class="muted tiny">
            {p.streaming && !p.isLocal ? 'клик — профиль · двойной — смотреть' : 'клик — профиль'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- connection

const QUALITY_TEXT: Record<VoiceState['quality'], string> = {
  excellent: 'Отличное соединение',
  good: 'Хорошее соединение',
  poor: 'Плохое соединение',
  lost: 'Связь потеряна',
  unknown: 'Проверяем соединение…',
};

function ConnectionIndicator({ quality }: { quality: VoiceState['quality'] }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Poll stats only while the popover is open.
  useEffect(() => {
    if (!open) return;
    const load = () => void voice.connectionStats().then(setStats);
    load();
    const t = window.setInterval(load, 1000);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      clearInterval(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const bars = quality === 'good' ? 2 : quality === 'poor' || quality === 'lost' ? 1 : 3;
  return (
    <div class="conn" ref={ref}>
      <button class={`icon-btn conn-btn q-${quality}`} title={QUALITY_TEXT[quality]} onClick={() => setOpen(!open)}>
        <SignalIcon size={18} bars={bars} />
      </button>
      {open && (
        <div class="conn-popover">
          <div class={`conn-title q-${quality}`}>{QUALITY_TEXT[quality]}</div>
          <dl class="mono">
            <dt>Пинг</dt>
            <dd>{stats?.rttMs != null ? `${stats.rttMs} мс` : '—'}</dd>
            <dt>Потери</dt>
            <dd>{stats?.lossPct != null ? `${stats.lossPct}%` : '—'}</dd>
            <dt>Протокол</dt>
            <dd>{stats?.transport ?? '—'}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
