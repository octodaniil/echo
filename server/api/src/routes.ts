import type { FastifyInstance } from 'fastify';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  award,
  catalogFor,
  CATEGORIES,
  definition,
  holderOf,
  getPinned,
  getStats,
  isAchievement,
  listAchievements,
  MAX_PINNED,
  prestigeOf,
  uniquesMap,
  revoke,
  setPinned,
} from './achievements.ts';
import { equip, parseStatus, setStatus, SLOTS, styleContext, styleOf } from './cosmetics.ts';
import { createInvite, HttpError, publicUser, redeemInvite, requireAdmin, requireUser } from './auth.ts';
import { config } from './config.ts';
import { avatarDir, queries, type Channel, type User } from './db.ts';
import { createJoinToken, roomNameForChannel, webhookReceiver } from './livekit.ts';
import {
  broadcastChannels,
  broadcastKicked,
  channelsSnapshot,
  closeChannelRoom,
  handleWebhook,
  broadcastPresence,
  kickFromAllRooms,
  presenceSnapshot,
  sendMove,
  setActivity,
  subscribe,
} from './presence.ts';

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? 'Некорректный запрос');
  return result.data;
}

const nickname = z
  .string()
  .trim()
  .min(2, 'Ник: минимум 2 символа')
  .max(32, 'Ник: максимум 32 символа')
  .regex(/^[\p{L}\p{N} _.\-]+$/u, 'Ник: только буквы, цифры, пробел, _ . -');

const channelName = z.string().trim().min(1, 'Пустое название').max(48, 'Название слишком длинное');
const idParam = z.object({ id: z.coerce.number().int().positive() });

const avatarPath = (userId: string) => join(avatarDir, `${userId}.webp`);
const bannerPath = (userId: string) => join(avatarDir, `${userId}.banner`);
const BANNER_MAX = 4 * 1024 * 1024;

/** Real image type from magic bytes (never trust the declared content-type). */
function imageType(data: unknown): string | null {
  if (!Buffer.isBuffer(data) || data.length < 12) return null;
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 6) === 'GIF87a' || data.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

function getChannel(id: number): Channel {
  const channel = queries.channelById.get(id) as Channel | undefined;
  if (!channel) throw new HttpError(404, 'Канал не найден');
  return channel;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  // ---------- auth ----------

  app.post('/api/auth/join', async (req) => {
    const body = parse(z.object({ invite: z.string().min(1, 'Нужен инвайт-код'), nickname }), req.body);
    const { user, token } = redeemInvite(body.invite, body.nickname);
    req.log.info({ user: user.nickname }, 'user joined via invite');
    return { token, user: publicUser(user) };
  });

  app.get('/api/me', { preHandler: requireUser }, async (req) => ({ user: publicUser(req.user) }));

  app.patch('/api/me', { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ nickname }), req.body);
    const taken = queries.userByNickname.get(body.nickname) as User | undefined;
    if (taken && taken.id !== req.user.id) throw new HttpError(409, 'Этот ник уже занят');
    queries.renameUser.run(body.nickname, req.user.id);
    broadcastChannels();
    broadcastPresence();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  // ---------- online & activity ----------

  app.get('/api/presence', { preHandler: requireUser }, async () => ({ users: presenceSnapshot() }));

  app.put('/api/me/activity', { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ game: z.string().trim().min(1).max(64).nullable() }), req.body);
    setActivity(req.user.id, body.game);
    return { ok: true };
  });

  // ---------- profiles & achievements ----------

  app.get('/api/achievements', { preHandler: requireUser }, async (req) => ({
    catalog: catalogFor(new Set(listAchievements(req.user.id).map((a) => a.code))),
    categories: CATEGORIES,
  }));

  app.get('/api/users/:id/profile', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const user = queries.userById.get(id) as User | undefined;
    if (!user) throw new HttpError(404, 'Пользователь не найден');
    return {
      profile: {
        ...publicUser(user),
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
        ...getStats(id),
        achievements: listAchievements(id),
        // Hidden achievements this person has earned are shown in full on their profile.
        revealed: listAchievements(id)
          .map((a) => definition(a.code))
          .filter((d) => d?.hidden),
        pinned: getPinned(id),
        prestige: prestigeOf(id),
        uniques: uniquesMap().get(id) ?? [],
        style: styleOf(id),
        status: parseStatus((queries.styleStatus.get(id) as { status: string } | undefined)?.status),
      },
    };
  });

  // ---------- cosmetics & status ----------

  app.get('/api/cosmetics', { preHandler: requireUser }, async (req) => ({
    slots: SLOTS,
    items: styleContext().catalog(req.user.id),
    style: styleOf(req.user.id),
  }));

  app.patch('/api/me/style', { preHandler: requireUser }, async (req) => {
    const body = parse(
      z.object({ ring: z.string(), frame: z.string(), name: z.string(), plate: z.string() }).partial(),
      req.body,
    );
    let style;
    try {
      style = equip(req.user.id, body);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    broadcastChannels();
    broadcastPresence();
    return { style };
  });

  app.put('/api/me/status', { preHandler: requireUser }, async (req) => {
    const body = parse(
      z.object({
        state: z.enum(['online', 'away', 'dnd']),
        text: z.string().trim().max(64, 'Статус: максимум 64 символа').default(''),
        emoji: z.string().max(16).default(''),
      }),
      req.body,
    );
    const status = parseStatus(JSON.stringify(body));
    setStatus(req.user.id, status);
    broadcastChannels();
    broadcastPresence();
    return { status };
  });

  app.put('/api/me/pinned', { preHandler: requireUser }, async (req) => {
    const body = parse(z.object({ codes: z.array(z.string()).max(MAX_PINNED) }), req.body);
    const pinned = setPinned(req.user.id, body.codes);
    broadcastChannels();
    broadcastPresence();
    return { pinned };
  });

  app.post('/api/users/:id/achievements', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ code: z.string() }), req.body);
    if (!queries.userById.get(id)) throw new HttpError(404, 'Пользователь не найден');
    if (!isAchievement(body.code)) throw new HttpError(400, 'Нет такой ачивки');
    const holder = definition(body.code)?.unique ? holderOf(body.code) : null;
    if (holder && holder !== id) {
      const name = (queries.userById.get(holder) as User | undefined)?.nickname ?? 'кого-то другого';
      throw new HttpError(409, `Это уникальная ачивка, она уже у ${name}`);
    }
    award(id, body.code);
    return { achievements: listAchievements(id) };
  });

  app.delete('/api/users/:id/achievements/:code', { preHandler: requireAdmin }, async (req) => {
    const { id, code } = parse(z.object({ id: z.string(), code: z.string() }), req.params);
    revoke(id, code);
    broadcastChannels();
    return { achievements: listAchievements(id) };
  });

  // ---------- avatars ----------

  // Raw image uploads (avatars, banners). Each route checks the real format and size.
  for (const type of ['image/webp', 'image/gif', 'image/png', 'image/jpeg']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: BANNER_MAX }, (_req, body, done) => done(null, body));
  }

  // Clients send a ready 128x128 WebP; we only check it really is one.
  app.put('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    const data = req.body as Buffer;
    if (imageType(data) !== 'image/webp') throw new HttpError(400, 'Нужна картинка в формате WebP');
    if (data.length > 512 * 1024) throw new HttpError(413, 'Аватар слишком большой');
    await writeFile(avatarPath(req.user.id), data);
    queries.setAvatarVersion.run(Date.now(), req.user.id);
    broadcastChannels();
    broadcastPresence();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  app.delete('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    await rm(avatarPath(req.user.id), { force: true });
    queries.setAvatarVersion.run(null, req.user.id);
    broadcastChannels();
    broadcastPresence();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  // Public on purpose: <img> tags can't send auth headers, ids are random UUIDs,
  // and URLs carry ?v=<version> so they can be cached forever.
  app.get('/api/avatars/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    try {
      const data = await readFile(avatarPath(id));
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(data);
    } catch {
      throw new HttpError(404, 'Нет аватара');
    }
  });

  // ---------- profile banners (static or animated) ----------

  app.put('/api/me/banner', { preHandler: requireUser }, async (req) => {
    const data = req.body as Buffer;
    const type = imageType(data);
    if (!type) throw new HttpError(400, 'Нужна картинка: GIF, WebP, PNG или JPEG');
    if (data.length > BANNER_MAX) throw new HttpError(413, 'Баннер больше 4 МБ');
    await writeFile(bannerPath(req.user.id), data);
    queries.setBanner.run(Date.now(), type, req.user.id);
    broadcastChannels();
    broadcastPresence();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  app.delete('/api/me/banner', { preHandler: requireUser }, async (req) => {
    await rm(bannerPath(req.user.id), { force: true });
    queries.setBanner.run(null, null, req.user.id);
    broadcastChannels();
    broadcastPresence();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  app.get('/api/banners/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const row = queries.userById.get(id) as User | undefined;
    if (!row?.banner_version) throw new HttpError(404, 'Нет баннера');
    try {
      const data = await readFile(bannerPath(id));
      return reply
        .header('content-type', row.banner_type ?? 'application/octet-stream')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(data);
    } catch {
      throw new HttpError(404, 'Нет баннера');
    }
  });

  // ---------- channels / voice ----------

  app.get('/api/channels', { preHandler: requireUser }, async () => ({ channels: channelsSnapshot() }));

  app.get('/api/events', { preHandler: requireUser }, async (_req, reply) => subscribe(reply));

  app.post('/api/channels/:id/connect', { preHandler: requireUser }, async (req) => {
    const { id } = parse(idParam, req.params);
    getChannel(id);
    return {
      url: config.livekitPublicUrl,
      room: roomNameForChannel(id),
      token: await createJoinToken(req.user, id),
    };
  });

  // ---------- admin: channels ----------

  app.post('/api/channels', { preHandler: requireAdmin }, async (req) => {
    const body = parse(z.object({ name: channelName }), req.body);
    const result = queries.insertChannel.run(body.name, Date.now());
    broadcastChannels();
    return { channel: getChannel(Number(result.lastInsertRowid)) };
  });

  app.patch('/api/channels/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: channelName }), req.body);
    getChannel(id);
    queries.renameChannel.run(body.name, id);
    broadcastChannels();
    return { channel: getChannel(id) };
  });

  // Move someone to another voice channel. Their client does the switch itself, so it
  // works with any LiveKit setup and they keep their mic pipeline and settings.
  app.post('/api/channels/:id/move', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ userId: z.string() }), req.body);
    getChannel(id);
    if (!sendMove(body.userId, id, req.user.nickname)) throw new HttpError(409, 'Пользователь сейчас не в сети');
    return { ok: true };
  });

  app.delete('/api/channels/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParam, req.params);
    getChannel(id);
    queries.deleteChannel.run(id);
    await closeChannelRoom(id);
    broadcastChannels();
    return { ok: true };
  });

  // ---------- admin: invites ----------

  app.get('/api/invites', { preHandler: requireAdmin }, async () => ({ invites: queries.listInvites.all() }));

  app.post('/api/invites', { preHandler: requireAdmin }, async (req) => {
    const body = parse(
      z.object({
        maxUses: z.number().int().positive().nullish(),
        expiresInHours: z.number().positive().nullish(),
        admin: z.boolean().optional(),
      }),
      req.body ?? {},
    );
    return { invite: createInvite({ ...body, createdBy: req.user.id }) };
  });

  app.delete('/api/invites/:code', { preHandler: requireAdmin }, async (req) => {
    const { code } = parse(z.object({ code: z.string() }), req.params);
    queries.deleteInvite.run(code.toUpperCase());
    return { ok: true };
  });

  // ---------- admin: users ----------

  app.get('/api/users', { preHandler: requireAdmin }, async () => ({
    users: (queries.listUsers.all() as unknown as User[]).map((u) => ({
      ...publicUser(u),
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
    })),
  }));

  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    if (id === req.user.id) throw new HttpError(400, 'Нельзя удалить самого себя');
    queries.deleteUser.run(id);
    await rm(avatarPath(id), { force: true });
    await rm(bannerPath(id), { force: true });
    await kickFromAllRooms(id);
    broadcastKicked(id);
    return { ok: true };
  });

  // ---------- LiveKit webhooks (localhost only, blocked in Caddy) ----------

  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/api/livekit/webhook', async (req, reply) => {
    try {
      const event = await webhookReceiver.receive(req.body as string, req.headers.authorization);
      await handleWebhook(event);
    } catch (err) {
      req.log.warn({ err }, 'rejected LiveKit webhook');
      return reply.code(401).send({ error: 'invalid webhook' });
    }
    return { ok: true };
  });
}
