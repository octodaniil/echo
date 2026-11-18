import { HttpError } from './auth.ts';
import { queries, type User } from './db.ts';
import { roomService } from './livekit.ts';

/**
 * Roles and what they may do. Admin > moderator > member, and nobody can act on someone
 * of the same or a higher role (moderators can't touch each other or the admin).
 *
 *   moderator: disconnect from voice, voice mute (up to 24 h), move, change nickname
 *   admin:     all of that without limits + ban/unban, delete, give/take moderator
 */
export const rank = (u: Pick<User, 'is_admin' | 'is_moderator'>) => (u.is_admin ? 2 : u.is_moderator ? 1 : 0);

export const PERMANENT = 32_503_680_000_000; // year 3000
export const MOD_MAX_MUTE_MIN = 24 * 60;

export function targetFor(actor: User, targetId: string): User {
  const target = queries.userById.get(targetId) as User | undefined;
  if (!target) throw new HttpError(404, 'Пользователь не найден');
  if (target.id === actor.id) throw new HttpError(400, 'С самим собой так нельзя');
  if (rank(actor) <= rank(target)) throw new HttpError(403, 'Недостаточно прав для действий с этим пользователем');
  return target;
}

export const isMuted = (u: Pick<User, 'muted_until'>) => !!u.muted_until && u.muted_until > Date.now();
export const isBanned = (u: Pick<User, 'banned_until'>) => !!u.banned_until && u.banned_until > Date.now();

export function banMessage(u: Pick<User, 'banned_until' | 'ban_reason'>): string {
  const until =
    u.banned_until && u.banned_until < PERMANENT
      ? ` до ${new Date(u.banned_until).toLocaleString('ru-RU', { timeZone: process.env.ECHO_TZ ?? 'Europe/Moscow' })}`
      : '';
  return `Ты заблокирован на сервере${until}${u.ban_reason ? `. Причина: ${u.ban_reason}` : ''}`;
}

/** Lets or stops a user publishing (voice + stream) in every room they are in right now. */
export async function applyVoicePermission(userId: string, rooms: string[], canPublish: boolean) {
  await Promise.all(
    rooms.map((room) =>
      roomService
        .updateParticipant(room, userId, undefined, {
          canPublish,
          canSubscribe: true,
          canPublishData: true,
          canUpdateMetadata: true,
        })
        .catch(() => {}),
    ),
  );
}

// ---------- automatic unmute ----------

const timers = new Map<string, NodeJS.Timeout>();
let onExpire: (userId: string) => void = () => {};

export function setMuteExpiryHandler(fn: (userId: string) => void) {
  onExpire = fn;
}

export function scheduleUnmute(userId: string, until: number | null) {
  clearTimeout(timers.get(userId));
  timers.delete(userId);
  if (!until || until >= PERMANENT) return;
  // setTimeout can't wait longer than ~24.8 days; re-check then.
  const wait = Math.min(Math.max(0, until - Date.now()), 2_000_000_000);
  timers.set(
    userId,
    setTimeout(() => {
      timers.delete(userId);
      const u = queries.userById.get(userId) as User | undefined;
      if (!u || !u.muted_until) return;
      if (u.muted_until > Date.now()) return scheduleUnmute(userId, u.muted_until);
      queries.setMute.run(null, userId);
      onExpire(userId);
    }, wait).unref(),
  );
}

export function scheduleAllUnmutes() {
  for (const r of queries.mutedUsers.all() as { id: string; muted_until: number }[]) scheduleUnmute(r.id, r.muted_until);
}
