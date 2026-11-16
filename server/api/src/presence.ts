import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { ParticipantInfo_State, type WebhookEvent } from 'livekit-server-sdk';
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

export function channelsSnapshot() {
  const channels = queries.listChannels.all() as unknown as Channel[];
  // Current nickname/avatar come from our DB, so profile edits show up without rejoining.
  const profiles = new Map(
    (queries.userProfiles.all() as { id: string; nickname: string; avatar_version: number | null }[]).map((u) => [
      u.id,
      u,
    ]),
  );
  return channels.map((c) => ({
    id: c.id,
    name: c.name,
    members: (members.get(c.id) ?? []).map((m) => {
      const profile = profiles.get(m.id);
      return profile ? { ...m, nickname: profile.nickname, avatar: profile.avatar_version } : m;
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

/** Tells one user's open connections that they were removed. */
export function broadcastKicked(userId: string) {
  for (const reply of subscribers) {
    if (reply.request.user?.id === userId) {
      send(reply, 'kicked', {});
      reply.raw.end();
    }
  }
}

export function subscribe(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  subscribers.add(reply);
  send(reply, 'channels', channelsSnapshot());
  reply.raw.on('close', () => subscribers.delete(reply));
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
      // Apply immediately instead of trusting a listing that may still include them.
      if (channelId !== null && who) {
        recentlyLeft.set(leftKey(room, who), Date.now() + LEFT_GRACE_MS);
        members.set(channelId, (members.get(channelId) ?? []).filter((m) => m.id !== who));
      }
      scheduleRefresh(room);
      break;

    case 'participant_joined':
      if (who) recentlyLeft.delete(leftKey(room, who));
      await refreshRoom(room);
      scheduleRefresh(room);
      break;

    case 'track_published':
    case 'track_unpublished':
      await refreshRoom(room);
      break;

    default:
      return;
  }
  broadcastChannels();
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
