import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { WebhookEvent } from 'livekit-server-sdk';
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
    members.set(channelId, participants.map(toMember).sort((a, b) => a.joinedAt - b.joinedAt));
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

export async function handleWebhook(event: WebhookEvent) {
  const room = event.room?.name;
  if (!room) return;
  switch (event.event) {
    case 'room_finished': {
      const id = channelIdFromRoom(room);
      if (id !== null) members.delete(id);
      break;
    }
    case 'participant_joined':
    case 'participant_left':
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
