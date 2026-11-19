import type { FastifyInstance } from 'fastify';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  award,
  awardFriend,
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
  progressOf,
  uniquesMap,
  revoke,
  setPinned,
} from './achievements.ts';
import * as chat from './chat.ts';
import { equip, GRANTABLE, parseGrants, parseStatus, setGrant, setStatus, SLOTS, styleContext, styleOf } from './cosmetics.ts';
import { createInvite, HttpError, publicUser, redeemInvite, requireAdmin, requireStaff, requireUser } from './auth.ts';
import {
  applyVoicePermission,
  banMessage,
  isBanned,
  isMuted,
  MOD_MAX_MUTE_MIN,
  PERMANENT,
  rank,
  scheduleUnmute,
  targetFor,
} from './moderation.ts';
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
  dropConnections,
  isOnline,
  roomsOf,
  sendMove,
  sendTo,
  sendToUsers,
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
const AVATAR_MAX = 2 * 1024 * 1024;

/** Real image type from magic bytes (never trust the declared content-type). */
function imageType(data: unknown): string | null {
  if (!Buffer.isBuffer(data) || data.length < 12) return null;
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 6) === 'GIF87a' || data.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Admin and moderators always see the friends-only section; others need access. */
const pioneerAccess = (u: User) => !!(u.is_admin || u.is_moderator || u.is_pioneer);

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
    // Launchers and chat apps are not games (older clients could report them as custom games).
    const notGame = body.game && /^(steam|epic games( launcher)?|battle\.?net|ea( app)?|ubisoft connect|discord|telegram|google chrome|chrome|yandex|opera( gx)?)$/i.test(body.game);
    setActivity(req.user.id, notGame ? null : body.game);
    return { ok: true };
  });

  // ---------- profiles & achievements ----------

  app.get('/api/achievements', { preHandler: requireUser }, async (req) => ({
    catalog: catalogFor(new Set(listAchievements(req.user.id).map((a) => a.code)), pioneerAccess(req.user)),
    categories: CATEGORIES.filter((c) => c.id !== 'pioneers' || pioneerAccess(req.user)),
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
        // Friends-only achievements stay invisible to viewers without access.
        achievements: listAchievements(id).filter((a) => pioneerAccess(req.user) || !definition(a.code)?.pioneer),
        // Hidden achievements this person has earned are shown in full on their profile.
        revealed: listAchievements(id)
          .map((a) => definition(a.code))
          .filter((d) => d?.hidden),
        pinned: getPinned(id),
        progress: progressOf(id),
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

  /** Admin: anyone. Moderator: anyone except themselves and the admin. */
  const canAward = (actor: User, targetId: string) => {
    const target = queries.userById.get(targetId) as User | undefined;
    if (!target) throw new HttpError(404, 'Пользователь не найден');
    if (actor.is_admin) return target;
    if (target.id === actor.id) throw new HttpError(403, 'Себе ачивки выдавать нельзя');
    if (target.is_admin) throw new HttpError(403, 'Админу ачивки выдаёт только админ');
    return target;
  };

  app.post('/api/users/:id/achievements', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ code: z.string() }), req.body);
    canAward(req.user, id);
    if (!isAchievement(body.code)) throw new HttpError(400, 'Нет такой ачивки');
    const holder = definition(body.code)?.unique ? holderOf(body.code) : null;
    if (holder && holder !== id) {
      const name = (queries.userById.get(holder) as User | undefined)?.nickname ?? 'кого-то другого';
      throw new HttpError(409, `Это уникальная ачивка, она уже у ${name}`);
    }
    award(id, body.code);
    return { achievements: listAchievements(id) };
  });

  app.delete('/api/users/:id/achievements/:code', { preHandler: requireStaff }, async (req) => {
    const { id, code } = parse(z.object({ id: z.string(), code: z.string() }), req.params);
    canAward(req.user, id);
    revoke(id, code);
    broadcastChannels();
    return { achievements: listAchievements(id) };
  });

  // ---------- avatars ----------

  // Raw image uploads (avatars, banners). Each route checks the real format and size.
  for (const type of ['image/webp', 'image/gif', 'image/png', 'image/jpeg']) {
    // Each route checks its own limit (avatar 2 MB, banner 4 MB, chat image 10 MB).
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: chat.ATTACH_MAX }, (_req, body, done) => done(null, body));
  }

  // Static avatars arrive as a ready square WebP; animated ones as the original GIF or
  // animated WebP (cropped to a circle by the client when shown). We check the real format.
  app.put('/api/me/avatar', { preHandler: requireUser }, async (req) => {
    const data = req.body as Buffer;
    const type = imageType(data);
    if (type !== 'image/webp' && type !== 'image/gif') throw new HttpError(400, 'Нужна картинка WebP или GIF');
    if (data.length > AVATAR_MAX) throw new HttpError(413, 'Аватар больше 2 МБ');
    await writeFile(avatarPath(req.user.id), data);
    queries.setAvatarType.run(type, req.user.id);
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
      const type = (queries.avatarType.get(id) as { avatar_type: string | null } | undefined)?.avatar_type;
      return reply
        .header('content-type', type ?? 'image/webp')
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
  app.post('/api/channels/:id/move', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ userId: z.string() }), req.body);
    getChannel(id);
    if (body.userId !== req.user.id) targetFor(req.user, body.userId);
    if (!sendMove(body.userId, id, req.user.nickname)) throw new HttpError(409, 'Пользователь сейчас не в сети');
    return { ok: true };
  });

  app.delete('/api/channels/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParam, req.params);
    getChannel(id);
    queries.deleteChannel.run(id);
    await chat.clearConversation(`ch:${id}`);
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

  // ---------- everyone: the full member list (online and offline) ----------

  app.get('/api/members', { preHandler: requireUser }, async (req) => {
    const staff = rank(req.user) > 0;
    const rows = queries.userProfiles.all() as unknown as (User & { style: string; status: string })[];
    return {
      members: rows.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        avatar: u.avatar_version,
        role: u.is_admin ? 'admin' : u.is_moderator ? 'moderator' : null,
        online: isOnline(u.id),
        lastSeenAt: u.last_seen_at,
        createdAt: u.created_at,
        muted: isMuted(u),
        mutedUntil: staff && isMuted(u) ? u.muted_until : null,
        banned: staff ? isBanned(u) : false,
        bannedUntil: staff && isBanned(u) ? u.banned_until : null,
        banReason: staff && isBanned(u) ? u.ban_reason : null,
        granted: staff ? [...parseGrants(u.cosmetics_granted)] : [],
        pioneer: staff ? !!u.is_pioneer : false,
      })),
    };
  });

  // ---------- moderation (moderators: voice only; admin: everything) ----------

  const notifyAll = () => {
    broadcastChannels();
    broadcastPresence();
  };

  app.post('/api/mod/:id/disconnect', { preHandler: requireStaff }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    sendTo(target.id, 'moderation', { action: 'disconnect', by: req.user.nickname });
    await kickFromAllRooms(target.id);
    return { ok: true };
  });

  app.post('/api/mod/:id/mute', { preHandler: requireStaff }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    const body = parse(z.object({ minutes: z.number().int().positive().nullable() }), req.body);
    if (!req.user.is_admin && (body.minutes === null || body.minutes > MOD_MAX_MUTE_MIN)) {
      throw new HttpError(403, 'Модератор может замутить максимум на 24 часа');
    }
    const until = body.minutes === null ? PERMANENT : Date.now() + body.minutes * 60_000;
    queries.setMute.run(until, target.id);
    scheduleUnmute(target.id, until);
    await applyVoicePermission(target.id, roomsOf(target.id), false);
    sendTo(target.id, 'moderation', { action: 'mute', by: req.user.nickname, until });
    notifyAll();
    return { ok: true, until };
  });

  app.post('/api/mod/:id/unmute', { preHandler: requireStaff }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    queries.setMute.run(null, target.id);
    scheduleUnmute(target.id, null);
    await applyVoicePermission(target.id, roomsOf(target.id), true);
    sendTo(target.id, 'moderation', { action: 'unmute', by: req.user.nickname });
    notifyAll();
    return { ok: true };
  });

  app.patch('/api/mod/:id/nickname', { preHandler: requireStaff }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    const body = parse(z.object({ nickname }), req.body);
    const taken = queries.userByNickname.get(body.nickname) as User | undefined;
    if (taken && taken.id !== target.id) throw new HttpError(409, 'Такой ник уже занят');
    queries.renameUser.run(body.nickname, target.id);
    sendTo(target.id, 'moderation', { action: 'rename', by: req.user.nickname, nickname: body.nickname });
    notifyAll();
    return { ok: true };
  });

  app.post('/api/mod/:id/ban', { preHandler: requireAdmin }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    const body = parse(
      z.object({ days: z.number().positive().nullable(), reason: z.string().trim().max(200).default('') }),
      req.body,
    );
    const until = body.days === null ? PERMANENT : Date.now() + body.days * 86_400_000;
    queries.setBan.run(until, body.reason || null, target.id);
    await kickFromAllRooms(target.id);
    dropConnections(target.id, banMessage({ banned_until: until, ban_reason: body.reason || null }));
    notifyAll();
    return { ok: true, until };
  });

  app.post('/api/mod/:id/unban', { preHandler: requireAdmin }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    queries.setBan.run(null, null, target.id);
    notifyAll();
    return { ok: true };
  });

  // Admin hands out (or takes back) exclusive cosmetics, like an achievement.
  app.post('/api/mod/:id/cosmetic', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    if (!queries.userById.get(id)) throw new HttpError(404, 'Пользователь не найден');
    const body = parse(z.object({ key: z.enum(GRANTABLE as [string, ...string[]]), on: z.boolean() }), req.body);
    const granted = setGrant(id, body.key, body.on);
    notifyAll();
    return { granted };
  });

  // Admin opens (or closes) the friends-only "Первооткрыватели" tab and styles for someone.
  app.post('/api/mod/:id/pioneer', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    if (!queries.userById.get(id)) throw new HttpError(404, 'Пользователь не найден');
    const body = parse(z.object({ on: z.boolean() }), req.body);
    queries.setPioneer.run(body.on ? 1 : 0, id);
    if (body.on) award(id, 'p_hello');
    sendTo(id, 'moderation', { action: 'pioneer', by: req.user.nickname, on: body.on });
    notifyAll();
    return { ok: true };
  });

  app.post('/api/mod/:id/role', { preHandler: requireAdmin }, async (req) => {
    const target = targetFor(req.user, (req.params as { id: string }).id);
    const body = parse(z.object({ role: z.enum(['moderator', 'member']) }), req.body);
    queries.setModerator.run(body.role === 'moderator' ? 1 : 0, target.id);
    sendTo(target.id, 'moderation', { action: 'role', by: req.user.nickname, role: body.role });
    notifyAll();
    return { ok: true };
  });

  // ---------- text chat (channels + private messages) ----------

  const convParam = (req: { params: unknown }) => {
    const { conv } = parse(z.object({ conv: z.string().min(4).max(120) }), req.params);
    return conv;
  };
  const access = (conv: string, user: User) => {
    try {
      chat.checkAccess(conv, user);
    } catch (e) {
      throw new HttpError(403, (e as Error).message);
    }
  };
  const deliver = (conv: string, type: 'new' | 'edit' | 'delete', message: chat.Message) =>
    sendToUsers(chat.audience(conv), 'chat', { type, message });
  const guard = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, (e as Error).message);
    }
  };

  app.get('/api/chat/:conv', { preHandler: requireUser }, async (req) => {
    const conv = convParam(req);
    access(conv, req.user);
    const query = parse(
      z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      req.query,
    );
    return { messages: chat.history(conv, query.before ?? null, query.limit) };
  });

  app.post('/api/chat/:conv', { preHandler: requireUser }, async (req) => {
    const conv = convParam(req);
    access(conv, req.user);
    const body = parse(z.object({ text: z.string(), replyTo: z.number().int().positive().nullable().default(null) }), req.body);
    const message = await guard(() => chat.post(conv, req.user, body.text, body.replyTo, null));
    deliver(conv, 'new', message);
    awardFriend(req.user.id, 'p_first_word');
    return { message };
  });

  // Image as the raw body; text and reply travel in headers (URI-encoded).
  app.post('/api/chat/:conv/image', { preHandler: requireUser }, async (req) => {
    const conv = convParam(req);
    access(conv, req.user);
    const data = req.body as Buffer;
    const type = imageType(data);
    if (!type) throw new HttpError(400, 'Можно отправлять только картинки: PNG, JPEG, WebP, GIF');
    const h = (name: string) => {
      const v = req.headers[name];
      return typeof v === 'string' ? v : '';
    };
    const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
    const message = await guard(() =>
      chat.post(conv, req.user, decodeURIComponent(h('x-echo-text')), num(h('x-echo-reply')), {
        data,
        type,
        w: num(h('x-echo-w')),
        h: num(h('x-echo-h')),
      }),
    );
    deliver(conv, 'new', message);
    return { message };
  });

  app.patch('/api/chat/message/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(idParam, req.params);
    const row = chat.getRow(id);
    if (!row || row.deleted) throw new HttpError(404, 'Сообщение не найдено');
    if (row.author !== req.user.id) throw new HttpError(403, 'Можно править только свои сообщения');
    const body = parse(z.object({ text: z.string() }), req.body);
    const message = await guard(() => chat.edit(id, body.text));
    deliver(row.conv, 'edit', message);
    return { message };
  });

  app.delete('/api/chat/message/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(idParam, req.params);
    const row = chat.getRow(id);
    if (!row || row.deleted) throw new HttpError(404, 'Сообщение не найдено');
    // Own messages anywhere; staff can remove others' messages in channels (not in private chats).
    const staffInChannel = rank(req.user) > 0 && row.conv.startsWith('ch:');
    if (row.author !== req.user.id && !staffInChannel) throw new HttpError(403, 'Можно удалять только свои сообщения');
    const message = await chat.remove(id);
    deliver(row.conv, 'delete', message);
    return { message };
  });

  app.post('/api/chat/:conv/read', { preHandler: requireUser }, async (req) => {
    const conv = convParam(req);
    access(conv, req.user);
    const body = parse(z.object({ id: z.number().int().positive() }), req.body);
    chat.markRead(req.user.id, conv, body.id);
    return { ok: true };
  });

  app.post('/api/chat/:conv/typing', { preHandler: requireUser }, async (req) => {
    const conv = convParam(req);
    access(conv, req.user);
    const to = chat.audience(conv)?.filter((id) => id !== req.user.id) ?? null;
    sendToUsers(to, 'typing', { conv, userId: req.user.id });
    return { ok: true };
  });

  app.get('/api/chat-state', { preHandler: requireUser }, async (req) => ({
    unread: chat.unread(req.user.id),
    dms: chat.dmList(req.user.id),
  }));

  // Keys are 128-bit random: knowing the link is the permission (like avatars, <img> can't send auth).
  app.get('/api/attachments/:key', async (req, reply) => {
    const { key } = parse(z.object({ key: z.string().regex(/^[0-9a-f]{32}$/) }), req.params);
    const info = chat.attachmentInfo(key);
    if (!info || info.att_gone) throw new HttpError(404, 'Файл удалён');
    try {
      const data = await readFile(join(chat.attachDir, key));
      return reply
        .header('content-type', info.att_type)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(data);
    } catch {
      throw new HttpError(404, 'Файл удалён');
    }
  });

  app.get('/api/chat-storage', { preHandler: requireAdmin }, async () => chat.storageStats());

  app.post('/api/chat-storage/cleanup', { preHandler: requireAdmin }, async (req) => {
    const body = parse(z.object({ days: z.number().int().min(0).max(3650) }), req.body);
    return { removed: await chat.cleanupOlderThan(body.days), ...chat.storageStats() };
  });

  app.delete('/api/chat/:conv', { preHandler: requireAdmin }, async (req) => {
    const conv = convParam(req);
    if (!conv.startsWith('ch:')) throw new HttpError(400, 'Чистить можно только каналы');
    await chat.clearConversation(conv);
    sendToUsers(null, 'chat', { type: 'cleared', conv });
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
    targetFor(req.user, id);
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
