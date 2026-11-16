import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { queries, transaction, type Invite, type User } from './db.ts';

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// No 0/O, 1/I/L to keep codes easy to read out loud.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export function createInvite(opts: {
  admin?: boolean;
  maxUses?: number | null;
  expiresInHours?: number | null;
  createdBy?: string | null;
}): Invite {
  const code = newInviteCode();
  const now = Date.now();
  const expiresAt = opts.expiresInHours ? now + opts.expiresInHours * 3600_000 : null;
  queries.insertInvite.run(code, opts.admin ? 1 : 0, opts.maxUses ?? null, expiresAt, opts.createdBy ?? null, now);
  return queries.inviteByCode.get(code) as unknown as Invite;
}

/** Redeems an invite and creates a user. Returns the user and their (only ever shown once) token. */
export function redeemInvite(rawCode: string, nickname: string): { user: User; token: string } {
  const code = rawCode.trim().toUpperCase();
  return transaction(() => {
    const invite = queries.inviteByCode.get(code) as Invite | undefined;
    if (!invite) throw new HttpError(404, 'Инвайт не найден');
    if (invite.expires_at !== null && invite.expires_at < Date.now()) throw new HttpError(410, 'Инвайт истёк');
    if (invite.max_uses !== null && invite.uses >= invite.max_uses) throw new HttpError(410, 'Инвайт уже использован');
    if (queries.userByNickname.get(nickname)) throw new HttpError(409, 'Этот ник уже занят');

    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    queries.insertUser.run(id, nickname, invite.grants_admin, hashToken(token), Date.now());
    queries.useInvite.run(code);
    const user = queries.userByNickname.get(nickname) as unknown as User;
    return { user, token };
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

const lastTouch = new Map<string, number>();

/** preHandler: requires `Authorization: Bearer <token>`. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new HttpError(401, 'Нужна авторизация');
  const user = queries.userByTokenHash.get(hashToken(token)) as User | undefined;
  if (!user) throw new HttpError(401, 'Сессия недействительна');
  req.user = user;

  // Record activity at most once a minute.
  const now = Date.now();
  if ((lastTouch.get(user.id) ?? 0) < now - 60_000) {
    lastTouch.set(user.id, now);
    queries.touchUser.run(now, user.id);
  }
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  await requireUser(req);
  if (!req.user.is_admin) throw new HttpError(403, 'Только для админа');
}

export function publicUser(user: User) {
  return {
    id: user.id,
    nickname: user.nickname,
    isAdmin: Boolean(user.is_admin),
    avatar: user.avatar_version ?? null,
  };
}
