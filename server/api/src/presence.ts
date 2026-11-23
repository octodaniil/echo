import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { ParticipantInfo_State, TrackSource, type WebhookEvent } from 'livekit-server-sdk';
import { definition, gameChanged, getPinnedFromRow, prestigeFromPoints, prestigeMap, roomMembers, uniquesMap, setAwardListener, setAfkListener, isAfk, streamStarted, streamStopped, voiceJoined, voiceLeft } from './achievements.ts';
import { parseStatus, styleContext } from './cosmetics.ts';
import * as weekly from './weekly.ts';
import * as fun from './fun.ts';
import { award, checkSeries } from './achievements.ts';
import { queries, type Channel } from './db.ts';
import { channelIdFromRoom, roomNameForChannel, roomService, toMember, type ChannelMember } from './livekit.ts';

/**
 * Who is sitting in which voice channel. Source of truth is LiveKit; we keep a copy
 * that is updated from LiveKit webhooks (plus a periodic resync) and pushed to all
 * connected clients over Server-Sent Events, so nobody has to poll.
 */
const members = new Map<number, ChannelMember[]>();
const subscribers = new Set<FastifyReply>();

let log: FastifyBaseLogger | undefined;

/** Displayed role: admin > moderator > nothing. */
const roleOf = (u: { is_admin: number; is_moderator: number }) =>
  u.is_admin ? 'admin' : u.is_moderator ? 'moderator' : null;

export function channelsSnapshot() {
  const channels = queries.listChannels.all() as unknown as Channel[];
  // Current nickname/avatar come from our DB, so profile edits show up without rejoining.
  const profiles = new Map(
    (
      queries.userProfiles.all() as {
        id: string;
        nickname: string;
        avatar_version: number | null;
        pinned: string;
        is_admin: number;
        is_moderator: number;
        banner_version: number | null;
        style: string;
        status: string;
        muted_until: number | null;
      }[]
    ).map((u) => [u.id, u]),
  );
  const prestige = prestigeMap();
  const uniques = uniquesMap();
  const styles = styleContext();
  const crowns = crownsOf();
  return channels.map((c) => ({
    id: c.id,
    name: c.name,
    members: (members.get(c.id) ?? []).map((m) => {
      const profile = profiles.get(m.id);
      return profile
        ? {
            ...m,
            nickname: profile.nickname,
            avatar: profile.avatar_version,
            pinned: getPinnedFromRow(profile.pinned),
            prestige: prestige.get(m.id) ?? prestigeFromPoints(0),
            uniques: uniques.get(m.id) ?? [],
            role: roleOf(profile),
            banner: profile.banner_version,
            style: styles.resolve(m.id, profile.style),
            status: parseStatus(profile.status),
            muted: !!profile.muted_until && profile.muted_until > Date.now(),
            afk: isAfk(m.id),
            crowns: crowns(m.id),
          }
        : m;
    }),
  }));
}

function send(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcastChannels() {
  const snapshot = channelsSnapshot();
  for (const reply of subscribers) send(reply, 'channels', snapshot);
}

/** Tells one user's open connections about a new achievement. */
setAwardListener((userId, code) => {
  // Full definition included: hidden achievements aren't in the client's catalog yet.
  const def = definition(code);
  for (const reply of subscribers) if (reply.request.user?.id === userId) send(reply, 'achievement', { code, def });
  // Ranks depend on achievements: let everyone see the new glow.
  queueMicrotask(() => {
    broadcastChannels();
    broadcastPresence();
  });
});

/**
 * AFK after an hour of silence: everyone sees the tag, the user gets a notice, and if the
 * server has a channel called "AFK" they are moved there.
 */
setAfkListener((userId, on) => {
  for (const reply of subscribers) if (reply.request.user?.id === userId) send(reply, 'afk', { on });
  if (on) {
    const afkChannel = (queries.listChannels.all() as unknown as Channel[]).find((c) => c.name.trim().toLowerCase() === 'afk');
    const inIt = afkChannel && (members.get(afkChannel.id) ?? []).some((m) => m.id === userId);
    if (afkChannel && !inIt) sendMove(userId, afkChannel.id, 'Echo');
  }
  queueMicrotask(() => {
    broadcastChannels();
    broadcastPresence();
  });
});

/** Crowns of the evening as a lookup: user id -> ['talk' | 'stream']. */
function crownsOf() {
  const c = weekly.crowns();
  return (id: string) => [c.talk === id ? 'talk' : null, c.stream === id ? 'stream' : null].filter(Boolean) as string[];
}

/**
 * Weekly challenges and duo quests are checked whenever their counters move; finishing one
 * pops a notice for the user (and the friend, for quests) and feeds the achievement ladders.
 */
let lastCrowns = '';
weekly.setWeeklyListener((userId) => {
  for (const code of weekly.checkChallenges(userId)) {
    const c = weekly.challengesFor().find((x) => x.code === code);
    for (const reply of subscribers) if (reply.request.user?.id === userId) send(reply, 'weekly', { type: 'challenge', title: c?.title ?? '' });
    checkSeries(userId, ['challenges']);
  }
  for (const [a, b] of weekly.checkQuests(userId)) {
    for (const id of [a, b]) {
      for (const reply of subscribers) if (reply.request.user?.id === id) send(reply, 'weekly', { type: 'quest', with: id === a ? b : a });
      checkSeries(id, ['quests']);
    }
  }
  // Crowns change hands: let everyone see it.
  const c = weekly.crowns();
  const key = `${c.talk}|${c.stream}`;
  if (key !== lastCrowns) {
    lastCrowns = key;
    queueMicrotask(() => {
      broadcastChannels();
      broadcastPresence();
    });
  }
});
void award;

// Evening games: refresh everyone's panel; personal wins go to the winner (+ ladders).
fun.setFunCounterListener((userId, kind) => checkSeries(userId, [kind]));
fun.setFunListener((e) => {
  if (e.type === 'changed') sendToUsers(null, 'fun', { type: 'changed' });
  else if (e.type === 'results') sendToUsers(null, 'fun', { type: 'results' });
  else if (e.type === 'bet-won') sendTo(e.userId, 'fun', { type: 'bet-won', amount: e.amount, question: e.question });
  else if (e.type === 'predicted') sendTo(e.userId, 'fun', { type: 'predicted', kind: e.kind, amount: e.amount });
  else funCapsule(e.capsule);
});
let funCapsule: (c: Parameters<typeof fun.capsuleText>[0]) => void = () => {};
/** Routes deliver capsules (they own chat delivery). */
export function setCapsuleDelivery(fn: typeof funCapsule) {
  funCapsule = fn;
}

/** Asks one user's client to switch to another voice channel (admin drag & drop). */
export function sendMove(userId: string, channelId: number, by: string) {
  let delivered = false;
  for (const reply of subscribers) {
    if (reply.request.user?.id === userId) {
      send(reply, 'move', { channelId, by });
      delivered = true;
    }
  }
  return delivered;
}

/** Tells one user's open connections that they were removed. */
export function broadcastKicked(userId: string) {
  for (const reply of subscribers) {
    if (reply.request.user?.id === userId) {
      send(reply, 'kicked', {});
      reply.raw.end();
    }
  }
}

// ---------- who is online and what they play ----------

export interface Activity {
  game: string;
  since: number;
}

/** In memory only: it's "right now" information. */
const activities = new Map<string, Activity>();

const onlineIds = () => new Set([...subscribers].map((r) => r.request.user?.id).filter((id): id is string => !!id));

export function presenceSnapshot() {
  const online = onlineIds();
  const prestige = prestigeMap();
  const uniques = uniquesMap();
  const styles = styleContext();
  const crowns = crownsOf();
  const rows = queries.userProfiles.all() as {
    id: string;
    nickname: string;
    avatar_version: number | null;
    pinned: string;
    is_admin: number;
    is_moderator: number;
    banner_version: number | null;
    style: string;
    status: string;
    muted_until: number | null;
  }[];
  return rows
    .filter((u) => online.has(u.id))
    .map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatar: u.avatar_version,
      pinned: getPinnedFromRow(u.pinned),
      activity: activities.get(u.id) ?? null,
      prestige: prestige.get(u.id) ?? prestigeFromPoints(0),
      uniques: uniques.get(u.id) ?? [],
      role: roleOf(u),
      banner: u.banner_version,
      style: styles.resolve(u.id, u.style),
      status: parseStatus(u.status),
      muted: !!u.muted_until && u.muted_until > Date.now(),
      crowns: crowns(u.id),
    }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
}

export function broadcastPresence() {
  const snapshot = presenceSnapshot();
  for (const reply of subscribers) send(reply, 'presence', snapshot);
}

/** The client reports the game it detected (null = not playing). */
export function setActivity(userId: string, game: string | null) {
  const prev = activities.get(userId);
  if (!game) {
    if (!prev) return;
    activities.delete(userId);
  } else {
    if (prev?.game === game) return;
    activities.set(userId, { game, since: Date.now() });
  }
  gameChanged(userId, game);
  broadcastPresence();
}

export function subscribe(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const wasOnline = onlineIds().has(reply.request.user.id);
  subscribers.add(reply);
  send(reply, 'channels', channelsSnapshot());
  if (wasOnline) send(reply, 'presence', presenceSnapshot());
  else broadcastPresence();
  reply.raw.on('close', () => {
    subscribers.delete(reply);
    const id = reply.request.user?.id;
    // Last connection gone: offline, and no longer playing anything.
    if (id && !onlineIds().has(id)) {
      if (activities.delete(id)) gameChanged(id, null);
      broadcastPresence();
    }
  });
}

async function refreshRoom(room: string) {
  const channelId = channelIdFromRoom(room);
  if (channelId === null) return;
  try {
    const participants = await roomService.listParticipants(room);
    members.set(
      channelId,
      participants
        .filter((p) => p.state !== ParticipantInfo_State.DISCONNECTED && !justLeft(room, p.identity))
        .map(toMember)
        .sort((a, b) => a.joinedAt - b.joinedAt),
    );
    roomMembers(room, (members.get(channelId) ?? []).map((m) => m.id));
  } catch {
    // Room does not exist (anymore).
    members.delete(channelId);
  }
}

export async function resyncAll() {
  try {
    const rooms = await roomService.listRooms();
    const alive = new Set<number>();
    await Promise.all(
      rooms.map(async (r) => {
        const id = channelIdFromRoom(r.name);
        if (id !== null) alive.add(id);
        await refreshRoom(r.name);
      }),
    );
    for (const id of members.keys()) if (!alive.has(id)) members.delete(id);
    broadcastChannels();
  } catch (err) {
    log?.warn({ err }, 'LiveKit resync failed');
  }
}

/**
 * People who just left a room. LiveKit can still list them for a moment after the
 * participant_left webhook, so refreshes ignore them for a few seconds — otherwise someone
 * switching channels shows up in both until the next resync.
 */
const recentlyLeft = new Map<string, number>();
const LEFT_GRACE_MS = 5_000;
const leftKey = (room: string, identity: string) => `${room}\n${identity}`;

function justLeft(room: string, identity: string): boolean {
  const until = recentlyLeft.get(leftKey(room, identity));
  if (until === undefined) return false;
  if (until < Date.now()) {
    recentlyLeft.delete(leftKey(room, identity));
    return false;
  }
  return true;
}

const pendingRefresh = new Map<string, NodeJS.Timeout>();

/** Re-reads a room shortly after the event, to settle whatever LiveKit was still updating. */
function scheduleRefresh(room: string) {
  clearTimeout(pendingRefresh.get(room));
  pendingRefresh.set(
    room,
    setTimeout(() => {
      pendingRefresh.delete(room);
      void refreshRoom(room).then(broadcastChannels);
    }, 1_500),
  );
}

export async function handleWebhook(event: WebhookEvent) {
  const room = event.room?.name;
  if (!room) return;
  const channelId = channelIdFromRoom(room);
  const who = event.participant?.identity;

  switch (event.event) {
    case 'room_finished':
      if (channelId !== null) members.delete(channelId);
      break;

    case 'participant_left':
      if (who) {
        voiceLeft(who, room);
        streamStopped(who);
      }
      // Apply immediately instead of trusting a listing that may still include them.
      if (channelId !== null && who) {
        recentlyLeft.set(leftKey(room, who), Date.now() + LEFT_GRACE_MS);
        members.set(channelId, (members.get(channelId) ?? []).filter((m) => m.id !== who));
      }
      scheduleRefresh(room);
      break;

    case 'participant_joined':
      if (who) {
        recentlyLeft.delete(leftKey(room, who));
        voiceJoined(who, room);
      }
      await refreshRoom(room);
      scheduleRefresh(room);
      break;

    case 'track_published':
      if (who && event.track?.source === TrackSource.SCREEN_SHARE) streamStarted(who);
      await refreshRoom(room);
      break;

    case 'track_unpublished':
      if (who && event.track?.source === TrackSource.SCREEN_SHARE) streamStopped(who);
      await refreshRoom(room);
      break;

    default:
      return;
  }
  broadcastChannels();
}

/** LiveKit rooms a user is in right now. */
export function roomsOf(userId: string): string[] {
  return [...members].filter(([, list]) => list.some((m) => m.id === userId)).map(([id]) => roomNameForChannel(id));
}

/** Sends an event to everyone (null) or only to the given users. */
export function sendToUsers(userIds: string[] | null, event: string, data: unknown) {
  const only = userIds ? new Set(userIds) : null;
  for (const reply of subscribers) {
    const id = reply.request.user?.id;
    if (id && (!only || only.has(id))) send(reply, event, data);
  }
}

/** Sends an event to every open connection of one user. */
export function sendTo(userId: string, event: string, data: unknown) {
  for (const reply of subscribers) if (reply.request.user?.id === userId) send(reply, event, data);
}

/** Ends a banned user's live connections (their client then shows the ban screen). */
export function dropConnections(userId: string, message: string) {
  for (const reply of subscribers) {
    if (reply.request.user?.id === userId) {
      send(reply, 'banned', { message });
      reply.raw.end();
    }
  }
}

export function isOnline(userId: string) {
  return onlineIds().has(userId);
}

export async function kickFromAllRooms(userId: string) {
  for (const [channelId, list] of members) {
    if (list.some((m) => m.id === userId)) {
      await roomService.removeParticipant(roomNameForChannel(channelId), userId).catch(() => {});
    }
  }
}

export async function closeChannelRoom(channelId: number) {
  await roomService.deleteRoom(roomNameForChannel(channelId)).catch(() => {});
  members.delete(channelId);
}

export function startPresence(logger: FastifyBaseLogger) {
  log = logger;
  void resyncAll();
  // Self-heal in case a webhook was missed.
  setInterval(() => void resyncAll(), 60_000).unref();
  // Keep SSE connections alive through proxies/NAT.
  setInterval(() => {
    for (const reply of subscribers) reply.raw.write(': ping\n\n');
  }, 25_000).unref();
}
