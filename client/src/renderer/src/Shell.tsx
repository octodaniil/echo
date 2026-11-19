import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AchievementDef, Activity, Channel, Look, Member, ModerationEvent, PresenceUser, Prestige, Session, UserStatus } from '../../shared/types';
import { Badge, LevelChip, PinnedBadges, reloadCatalog, UniqueTitles } from './Achievements';
import { hasFrame } from './Frames';
import { lookVars, rankName } from './look';
import { StatusLine, StatusMenu, useMyStatus } from './Status';
import { canModerate, MembersView, ModTools, RoleTag, type Role } from './Moderation';
import { ChatPanel, type ChatPerson } from './ChatPanel';
import { chat, dmConv, useChat } from './chatStore';
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
  PeopleIcon,
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
  muted?: boolean;
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
  /** We are on our way into this channel (switch in progress). */
  connecting?: boolean;
  /** Voice-muted by a moderator. */
  muted?: boolean;
}

interface VolumeMenu {
  id: string;
  nickname: string;
  role?: Role;
  muted?: boolean;
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
  const myRole: Role = session.user.isAdmin ? 'admin' : session.user.isModerator ? 'moderator' : null;
  const isStaff = myRole !== null;
  const [showMembers, setShowMembers] = useState(false);
  /** Open text conversation ("ch:<id>" or "dm:<a>|<b>"), shown next to the call or alone. */
  const [chatConv, setChatConv] = useState<string | null>(null);
  const store = useChat();
  // Everyone ever registered (for names/avatars of people who are offline, e.g. in private chats).
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const askedFor = useRef(new Set<string>());
  useEffect(() => {
    const load = () => void window.echo.listMembers().then(setAllMembers).catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    void chat.start(session.user.id);
    return () => {
      clearInterval(t);
      chat.stop();
    };
  }, [session.user.id]);
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
          muted: m.muted,
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
        muted: u.muted,
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
  const nameOf = (id: string) => profiles.get(id)?.nickname ?? allMembers.find((m) => m.id === id)?.nickname ?? 'кто-то';
  const chatPerson = (id: string): ChatPerson => {
    const p = profiles.get(id);
    const m = allMembers.find((x) => x.id === id);
    // Someone who registered after we loaded the list: fetch it again (once per id).
    if (!p && !m && !askedFor.current.has(id)) {
      askedFor.current.add(id);
      void window.echo.listMembers().then(setAllMembers).catch(() => {});
    }
    return {
      nickname: p?.nickname ?? m?.nickname ?? 'удалённый пользователь',
      avatar: p?.avatar ?? m?.avatar ?? null,
      style: p?.style,
      prestige: p?.prestige,
      role: p?.role ?? m?.role ?? null,
    };
  };
  chat.nameOf = nameOf;
  chat.dnd = myProfile?.status?.state === 'dnd';
  chat.onOpenRequest = (conv) => setChatConv(conv);
  const openDm = (userId: string) => {
    setProfileId(null);
    setShowMembers(false);
    setChatConv(dmConv(me.id, userId));
  };

  // Current channel in the title bar.
  useEffect(() => {
    const el = document.getElementById('titlebar-info');
    if (!el) return;
    el.textContent = v.status !== 'idle' && currentChannel ? `// КАНАЛ ${currentChannel.name.toUpperCase()}` : '';
  }, [v.status, currentChannel?.name]);

  // Ping and loss in the title bar while connected (one getStats every 5 s).
  useEffect(() => {
    const el = document.getElementById('titlebar-telemetry');
    if (!el) return;
    if (v.status !== 'connected') {
      el.textContent = '';
      return;
    }
    const tick = () =>
      void voice.connectionStats().then((st) => {
        el.innerHTML =
          `<span>PING <b>${st.rttMs ?? '—'}${st.rttMs != null ? 'ms' : ''}</b></span>` +
          `<span>ПОТЕРИ <b>${st.lossPct ?? 0}%</b></span>` +
          (st.transport ? `<span>${st.transport.toUpperCase()}</span>` : '');
      });
    tick();
    const t = window.setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [v.status]);

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

  // Something a moderator did to us.
  useEffect(
    () =>
      window.echo.onModeration((m: ModerationEvent) => {
        const by = m.by ? ` (${m.by})` : '';
        if (m.action === 'mute') {
          const until = m.until && m.until < 32_503_680_000_000 ? ` до ${new Date(m.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ' навсегда';
          showToast(`Тебя замутили${until}${by}: говорить и стримить нельзя`, 7000);
        } else if (m.action === 'unmute') {
          showToast(`Мут снят${by} — можно говорить`);
          void voice.republishMic();
        } else if (m.action === 'disconnect') {
          showToast(`Тебя отключили от голоса${by}`, 6000);
        } else if (m.action === 'rename' && m.nickname) {
          showToast(`Тебе сменили ник на «${m.nickname}»${by}`, 6000);
          onSession({ ...session, user: { ...session.user, nickname: m.nickname } });
        } else if (m.action === 'pioneer') {
          void reloadCatalog();
          showToast(m.on ? 'Тебе открыт раздел «Первооткрыватели» — загляни в ачивки и «Стиль»' : 'Доступ к «Первооткрывателям» закрыт', 7000);
        } else if (m.action === 'role') {
          const mod = m.role === 'moderator';
          showToast(mod ? `Ты теперь модератор${by}` : `Роль модератора снята${by}`, 6000);
          onSession({ ...session, user: { ...session.user, isModerator: mod } });
        }
      }),
    [session],
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
    setVolumeMenu({ id: p.id, nickname: p.nickname, role: p.role, muted: p.muted, x: e.clientX, y: e.clientY });
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
          muted: prof?.muted ?? server?.muted,
          streaming: p.streaming || (server?.streaming ?? false),
          joinedAt: server?.joinedAt || p.joinedAt,
        };
      });
    }
    // While we're connected somewhere, a stale server list must not show us in a second channel.
    const inCallElsewhere = v.status !== 'idle' && v.channelId !== c.id;
    // Switching here: show ourselves in this channel at once, marked as connecting.
    const arriving = v.channelId === c.id && v.status !== 'idle' && !c.members.some((m) => m.id === me.id);
    const mine = profiles.get(me.id);
    const self: Person[] = arriving
      ? [
          {
            id: me.id,
            nickname: me.nickname,
            avatar: me.avatar ?? null,
            pinned: mine?.pinned,
            isLocal: true,
            speaking: false,
            micMuted: v.micMuted,
            streaming: false,
            joinedAt: Date.now(),
            viewers: [],
            ns: null,
            prestige: mine?.prestige,
            activity: mine?.activity ?? null,
            uniques: mine?.uniques,
            role: mine?.role,
            banner: mine?.banner,
            style: mine?.style,
            status: mine?.status,
            connecting: true,
          },
        ]
      : [];
    return [
      ...c.members
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
        muted: profiles.get(m.id)?.muted ?? m.muted,
        connecting: m.id === me.id && v.status !== 'connected' && v.channelId === c.id,
      })),
      ...self,
    ];
  };

  // Count what the lists show (a stale server entry for ourselves is filtered out there).
  const totalOnline = channels.reduce((n, c) => n + peopleIn(c).length, 0);
  const liveCount = channels.reduce((n, c) => n + peopleIn(c).filter((p) => p.streaming).length, 0);

  return (
    <div class="layout">
      <aside class="sidebar">
        <header class="sidebar-header server-card">
          <div class="server-card-main">
            <div class="server-card-name">ECHO</div>
            <div class="server-card-meta mono">
              <span>
                <span class="ok-dot" />
                <b>{presence.length}</b> В СЕТИ
              </span>
              <span>{totalOnline} В ГОЛОСЕ</span>
              {liveCount > 0 && <span class="hot">{liveCount} LIVE</span>}
            </div>
          </div>
          <button class="icon-btn" title="Все участники" onClick={() => setShowMembers(true)}>
            <PeopleIcon size={18} />
          </button>
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
          isAdmin={isStaff}
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
          unreadOf={(conv) => store.unreadOf(conv)}
          activeChat={chatConv}
          onChat={(channelId) => setChatConv(chatConv === `ch:${channelId}` ? null : `ch:${channelId}`)}
        >
          <DmList
            me={me.id}
            dms={store.dms}
            active={chatConv}
            person={chatPerson}
            online={(id) => presence.some((u) => u.id === id)}
            onOpen={(conv) => setChatConv(conv)}
          />
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

      <main class={`stage${chatConv ? ' with-chat' : ''}${chatConv && !(currentChannel && v.status !== 'idle') ? ' chat-only' : ''}`}>
        <div class="stage-main">
          {currentChannel && v.status !== 'idle' ? (
            <VoiceStage
              channel={currentChannel}
              state={v}
              people={peopleIn(currentChannel)}
              nameOf={nameOf}
              onPersonMenu={openVolume}
              onProfile={setProfileId}
              chatOpen={chatConv === `ch:${currentChannel.id}`}
              chatUnread={store.unreadOf(`ch:${currentChannel.id}`).unread}
              onToggleChat={() => setChatConv(chatConv === `ch:${currentChannel.id}` ? null : `ch:${currentChannel.id}`)}
            />
          ) : (
            <div class="empty">
              <div class="empty-ring">
                <VolumeIcon size={34} />
              </div>
              <p>Выбери голосовой канал слева, чтобы зайти</p>
            </div>
          )}
        </div>
        {chatConv && (
          <ChatPanel
            conv={chatConv}
            me={me.id}
            canModerate={isStaff && chatConv.startsWith('ch:')}
            person={chatPerson}
            people={allMembers.filter((m) => !m.banned).map((m) => ({ id: m.id, person: chatPerson(m.id) }))}
            canSeeDeleted={isStaff}
            onClose={() => setChatConv(null)}
            onProfile={setProfileId}
            title={
              chatConv.startsWith('ch:') ? (
                <span class="chat-title-text">
                  <span class="chat-hash mono">#</span>
                  {channels.find((c) => `ch:${c.id}` === chatConv)?.name ?? 'канал'}
                </span>
              ) : (
                (() => {
                  const other = chatConv.slice(3).split('|').find((x) => x !== me.id) ?? me.id;
                  const op = chatPerson(other);
                  return (
                    <span class="chat-title-text">
                      <Avatar id={other} name={op.nickname} avatar={op.avatar} size={24} look={op.style} animated={false} />
                      <Nick name={op.nickname} look={op.style} />
                      <RoleTag role={op.role} />
                      <span class="muted tiny mono">ЛИЧНО</span>
                    </span>
                  );
                })()
              )
            }
          />
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
          myRole={myRole}
          onToast={(m) => showToast(m)}
        />
      )}
      {showMembers && (
        <MembersView
          me={me.id}
          myRole={myRole}
          extra={(id) => ({ prestige: profiles.get(id)?.prestige, style: profiles.get(id)?.style })}
          onProfile={(id) => setProfileId(id)}
          onMessage={(id) => openDm(id)}
          onClose={() => setShowMembers(false)}
          onToast={(m) => showToast(m)}
        />
      )}
      {profileId && (
        <ProfileView
          userId={profileId}
          meId={me.id}
          amAdmin={isAdmin}
          amModerator={myRole === 'moderator'}
          activity={profiles.get(profileId)?.activity ?? null}
          onClose={() => setProfileId(null)}
          onMessage={profileId !== me.id ? () => openDm(profileId) : undefined}
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
  unreadOf,
  activeChat,
  onChat,
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
  unreadOf: (conv: string) => { unread: number; mentions: number };
  activeChat: string | null;
  onChat: (channelId: number) => void;
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
        <span>
          КАНАЛЫ <b>{String(channels.length).padStart(2, '0')}</b>
        </span>
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

      {channels.map((c, idx) => {
        const active = voiceState.channelId === c.id && voiceState.status !== 'idle';
        const people = peopleIn(c);
        const talking = people.some((p) => p.speaking);
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
              <span class="channel-freq mono">{String(idx + 1).padStart(2, '0')}</span>
              <span class="channel-name">{c.name}</span>
              {talking && (
                <span class="wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              )}
              <span class="channel-count mono">{people.length > 0 ? people.length : '—'}</span>
              {(() => {
                const u = unreadOf(`ch:${c.id}`);
                return (
                  <button
                    class={`channel-chat${activeChat === `ch:${c.id}` ? ' active' : ''}${u.unread ? ' has-unread' : ''}`}
                    title="Текстовый чат канала"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChat(c.id);
                    }}
                  >
                    <ChatIcon />
                    {u.mentions > 0 ? <span class="badge-count hot">@{u.mentions}</span> : u.unread > 0 && <span class="badge-dot" />}
                  </button>
                );
              })()}
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
                    class={`member plate-${p.style?.plate ?? 'none'}${p.streaming && !p.isLocal ? ' can-watch' : ''}${p.speaking ? ' speaking' : ''}${p.connecting ? ' connecting' : ''}`}
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
                        <RoleTag role={p.role} />
                        <LevelChip prestige={p.prestige} look={p.style} />
                      </span>
                      {p.connecting ? (
                        <span class="member-game connecting-text">подключение…</span>
                      ) : p.activity ? (
                        <span class="member-game">🎮 {p.activity.game}</span>
                      ) : (
                        p.status?.text && <StatusLine status={p.status} class="member-game idle" />
                      )}
                    </span>
                    {p.streaming && <span class="live-badge">LIVE</span>}
                    {(p.micMuted || p.muted) && <MicOffIcon size={14} class={`member-muted${p.muted ? ' by-mod' : ''}`} />}
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

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

/** Private conversations in the sidebar. */
function DmList({
  me,
  dms,
  active,
  person,
  online,
  onOpen,
}: {
  me: string;
  dms: { conv: string; with: string; unread: number; last: { text: string; author: string; attachment: unknown } | null }[];
  active: string | null;
  person: (id: string) => ChatPerson;
  online: (id: string) => boolean;
  onOpen: (conv: string) => void;
}) {
  if (dms.length === 0) return null;
  return (
    <div class="dm-list">
      <div class="section-title">
        <span>
          ЛИЧНЫЕ <b>{String(dms.length).padStart(2, '0')}</b>
        </span>
      </div>
      <ul class="members flat">
        {dms.slice(0, 8).map((d) => {
          const p = person(d.with);
          const preview = d.last ? `${d.last.author === me ? 'Ты: ' : ''}${d.last.text || (d.last.attachment ? '🖼 картинка' : '')}` : '';
          return (
            <li
              key={d.conv}
              class={`member plate-none dm-row${active === d.conv ? ' active' : ''}${online(d.with) ? '' : ' offline'}`}
              onClick={() => onOpen(d.conv)}
            >
              <Avatar id={d.with} name={p.nickname} avatar={p.avatar} size={24} look={p.style} animated={false} />
              <span class="member-main">
                <span class="member-name">
                  <Nick name={p.nickname} look={p.style} />
                </span>
                <span class="member-game idle">{preview}</span>
              </span>
              {d.unread > 0 && <span class="badge-count hot">{d.unread}</span>}
            </li>
          );
        })}
      </ul>
    </div>
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
  // Staff get their own group on top, like in Discord.
  const groups = [
    { title: 'АДМИНИСТРАЦИЯ', list: users.filter((u) => u.role) },
    { title: 'В СЕТИ', list: users.filter((u) => !u.role) },
  ].filter((g) => g.list.length > 0);
  return (
    <div class="online-list">
      {groups.map((g) => (
      <div key={g.title}>
      <div class="section-title">
        <span>
          {g.title} <b>{String(g.list.length).padStart(2, '0')}</b>
        </span>
      </div>
      <ul class="members flat">
        {g.list.map((u) => {
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
                  <RoleTag role={u.role} />
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
      ))}
    </div>
  );
}


/** Time since we entered this channel (remounts per channel). */
function CallTimer() {
  const [since] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((Date.now() - since) / 1000);
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return <span>{`${hh}:${mm}:${ss}`}</span>;
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
  chatOpen,
  chatUnread,
  onToggleChat,
}: {
  channel: Channel;
  state: VoiceState;
  people: Person[];
  nameOf: (id: string) => string;
  onPersonMenu: (e: MouseEvent, p: Person) => void;
  onProfile: (id: string) => void;
  chatOpen: boolean;
  chatUnread: number;
  onToggleChat: () => void;
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
        <div class="stage-title-block">
          <div class="stage-sub mono">
            <span class={`rec${connected ? '' : ' wait'}`}>{connected ? 'ЭФИР' : 'СВЯЗЬ…'}</span>
            <CallTimer key={channel.id} />
          </div>
          <h2>{channel.name}</h2>
        </div>
        <div class="stage-sub mono stage-meta">
          <span>
            <b>{people.length}</b> В КАНАЛЕ
          </span>
        </div>
        <button class={`chat-toggle${chatOpen ? ' active' : ''}`} onClick={onToggleChat} title="Текстовый чат канала">
          <ChatIcon />
          <span class="mono">ЧАТ</span>
          {chatUnread > 0 && !chatOpen && <span class="badge-count">{chatUnread}</span>}
        </button>
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
              <span class="br tl" aria-hidden="true" />
              <span class="br brr" aria-hidden="true" />
              <Avatar
                id={p.id}
                name={p.nickname}
                avatar={p.avatar}
                size={watched ? 40 : Math.round(TILE_AVATAR[gridSize(people.length)] * (hasFrame(p.style?.frame) ? 0.62 : 1))}
                speaking={p.speaking}
                prestige={p.prestige}
                look={p.style}
                status={p.status?.state}
                uniques={p.uniques}
                animated={!watched && people.length <= 8}
              />
              <div class="tile-name">
                <Nick name={p.nickname} look={p.style} />
                <RoleTag role={p.role} />
                {p.isLocal && <span class="muted"> (ты)</span>}
                {p.micMuted && <MicOffIcon size={14} class="member-muted" />}
              </div>
              {!watched && p.activity && <div class="tile-game">🎮 {p.activity.game}</div>}
              {!watched && !p.activity && p.status?.text && <StatusLine status={p.status} class="tile-game idle" />}
              {!watched && (
                <div class="tile-data mono">
                  <span>{rankName(p.prestige).toUpperCase()}</span>
                  {p.quality && p.quality !== 'unknown' && (
                    <span class={`q-${p.quality}`}>● {QUALITY_SHORT[p.quality]?.toUpperCase()}</span>
                  )}
                </div>
              )}
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
          class={`round-btn${state.micMuted ? ' off' : ' on'}`}
          title="Микрофон"
          onClick={() => void voice.toggleMic()}
        >
          {state.micMuted ? <MicOffIcon /> : <MicIcon />}
          <span class="rb-label">{state.micMuted ? 'ВЫКЛ' : 'МИКРО'}</span>
        </button>
        <button
          class={`round-btn${state.deafened ? ' off' : ''}`}
          title="Звук"
          onClick={() => void voice.toggleDeafen()}
        >
          {state.deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
          <span class="rb-label">ЗВУК</span>
        </button>
        <span class="dock-sep" />
        <button
          class={`round-btn${state.sharing ? ' live' : ''}`}
          title={state.sharing ? 'Остановить трансляцию' : 'Транслировать экран или окно'}
          disabled={!connected}
          onClick={() => (state.sharing ? void voice.stopScreenShare() : setPicker(true))}
        >
          <ScreenIcon />
          <span class="rb-label">{state.sharing ? 'СТОП' : 'ЭФИР'}</span>
        </button>
        {state.watching && (
          <button class="round-btn watching" title="Перестать смотреть трансляцию" onClick={() => voice.unwatch()}>
            <ScreenOffIcon />
            <span class="rb-label">ЗАКРЫТЬ ЭФИР</span>
          </button>
        )}
        <span class="dock-sep" />
        <button class="round-btn danger" title="Отключиться" onClick={() => void voice.leave()}>
          <HangUpIcon />
          <span class="rb-label">ВЫЙТИ</span>
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
  myRole,
  onToast,
}: {
  menu: VolumeMenu;
  isLocal: boolean;
  onProfile: () => void;
  onClose: () => void;
  myRole: Role;
  onToast: (m: string) => void;
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
  const withMod = !isLocal && canModerate(myRole, menu.role);
  const left = Math.min(menu.x, window.innerWidth - 260);
  const top = Math.min(menu.y, window.innerHeight - (withMod ? 330 : 140));

  return (
    <div class="popover" ref={ref} style={{ left, top }}>
      <div class="popover-title">
        {menu.nickname} <RoleTag role={menu.role} />
        {menu.muted && <span class="mod-flag">МУТ</span>}
      </div>
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
      {withMod && (
        <ModTools
          target={{ id: menu.id, nickname: menu.nickname, role: menu.role, muted: menu.muted }}
          me={myRole}
          onDone={(m) => {
            onToast(m);
            onClose();
          }}
          onError={onToast}
        />
      )}
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
          <RoleTag role={p.role} />
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
