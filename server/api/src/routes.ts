import type { FastifyInstance } from 'fastify';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
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
  kickFromAllRooms,
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
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  // ---------- avatars ----------

  // Clients send a ready 128x128 WebP; we only check it really is one.
  app.addContentTypeParser('image/webp', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.put('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    const data = req.body as Buffer;
    const isWebp =
      Buffer.isBuffer(data) &&
      data.length > 12 &&
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP';
    if (!isWebp) throw new HttpError(400, 'Нужна картинка в формате WebP');
    await writeFile(avatarPath(req.user.id), data);
    queries.setAvatarVersion.run(Date.now(), req.user.id);
    broadcastChannels();
    return { user: publicUser(queries.userById.get(req.user.id) as unknown as User) };
  });

  app.delete('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    await rm(avatarPath(req.user.id), { force: true });
    queries.setAvatarVersion.run(null, req.user.id);
    broadcastChannels();
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
