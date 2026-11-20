import { useEffect, useState } from 'preact/hooks';
import type { Look, Member, ModAction, Prestige } from '../../shared/types';
import { Avatar, Nick } from './Avatar';
import { CloseIcon } from './icons';

export type Role = 'admin' | 'moderator' | null;
const RANK: Record<string, number> = { admin: 2, moderator: 1 };
export const rankOf = (r: Role | undefined) => (r ? (RANK[r] ?? 0) : 0);

/** Can someone with role `me` act on someone with role `target`? (strictly higher rank only) */
export const canModerate = (me: Role | undefined, target: Role | undefined) => rankOf(me) > 0 && rankOf(me) > rankOf(target);

/** ADM / MOD tag next to a nickname. */
export function RoleTag({ role }: { role: Role | undefined }) {
  if (!role) return null;
  return (
    <span class={`role-tag ${role}`} title={role === 'admin' ? 'Администратор сервера' : 'Модератор'}>
      {role === 'admin' ? 'ADM' : 'MOD'}
    </span>
  );
}

const EXCLUSIVE = [
  { key: 'frame:architect', title: 'Рамка «Архитектор»' },
  { key: 'frame:guardian', title: 'Рамка «Страж»' },
  { key: 'plate:goldcode', title: 'Фон «Золотой код»' },
  { key: 'plate:shield', title: 'Фон «Щит»' },
  { key: 'name:crown', title: 'Ник «Корона»' },
  { key: 'name:guard', title: 'Ник «Страж»' },
];

export interface ModTarget {
  id: string;
  nickname: string;
  role: Role | undefined;
  muted?: boolean;
  banned?: boolean;
}

/**
 * Moderation buttons for one person. Moderators: disconnect, mute up to 24 h, rename.
 * Admin: also permanent mute, ban/unban, moderator role, delete.
 */
export function ModTools({
  target,
  me,
  onDone,
  onError,
}: {
  target: ModTarget;
  me: Role | undefined;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<'mute' | 'rename' | 'ban' | 'grant' | null>(null);
  const [granted, setGranted] = useState<string[] | null>(null);
  useEffect(() => {
    if (form !== 'grant') return;
    void window.echo
      .listMembers()
      .then((list) => setGranted(list.find((m) => m.id === target.id)?.granted ?? []))
      .catch(() => setGranted([]));
  }, [form]);
  const [nick, setNick] = useState(target.nickname);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!canModerate(me, target.role)) return null;
  const admin = me === 'admin';

  const run = async (action: ModAction, body: unknown, ok: string) => {
    setBusy(true);
    try {
      await window.echo.moderate(target.id, action, body);
      onDone(ok);
      setForm(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mute = (minutes: number | null, label: string) =>
    void run('mute', { minutes }, `${target.nickname} замучен ${label}`);
  const ban = (days: number | null, label: string) =>
    void run('ban', { days, reason }, `${target.nickname} заблокирован ${label}`);

  return (
    <div class="modtools">
      <div class="modtools-title mono">// МОДЕРАЦИЯ</div>
      {form === null && (
        <div class="modtools-grid">
          <button class="mod-btn" disabled={busy} onClick={() => void run('disconnect', {}, `${target.nickname} отключён от голоса`)}>
            Отключить от голоса
          </button>
          {target.muted ? (
            <button class="mod-btn" disabled={busy} onClick={() => void run('unmute', {}, `${target.nickname} снова может говорить`)}>
              Снять мут
            </button>
          ) : (
            <button class="mod-btn" disabled={busy} onClick={() => setForm('mute')}>
              Замутить…
            </button>
          )}
          <button class="mod-btn" disabled={busy} onClick={() => setForm('rename')}>
            Сменить ник…
          </button>
          {admin && (
            <button
              class="mod-btn"
              disabled={busy}
              onClick={() =>
                void run(
                  'role',
                  { role: target.role === 'moderator' ? 'member' : 'moderator' },
                  target.role === 'moderator' ? `${target.nickname} больше не модератор` : `${target.nickname} теперь модератор`,
                )
              }
            >
              {target.role === 'moderator' ? 'Снять модератора' : 'Сделать модератором'}
            </button>
          )}
          {admin && (
            <button class="mod-btn" disabled={busy} onClick={() => setForm('grant')}>
              Эксклюзив…
            </button>
          )}
          {admin &&
            (target.banned ? (
              <button class="mod-btn" disabled={busy} onClick={() => void run('unban', {}, `${target.nickname} разблокирован`)}>
                Разбанить
              </button>
            ) : (
              <button class="mod-btn danger" disabled={busy} onClick={() => setForm('ban')}>
                Забанить…
              </button>
            ))}
          {admin && (
            <button
              class="mod-btn danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Удалить ${target.nickname} с сервера насовсем? Ачивки и статистика пропадут.`)) {
                  void run('delete', undefined, `${target.nickname} удалён`);
                }
              }}
            >
              Удалить с сервера
            </button>
          )}
        </div>
      )}

      {form === 'mute' && (
        <div class="modtools-form">
          <span class="muted tiny">Не сможет говорить и стримить, но слышит всех</span>
          <div class="modtools-grid">
            <button class="mod-btn" disabled={busy} onClick={() => mute(15, 'на 15 минут')}>15 мин</button>
            <button class="mod-btn" disabled={busy} onClick={() => mute(60, 'на час')}>1 час</button>
            <button class="mod-btn" disabled={busy} onClick={() => mute(1440, 'на сутки')}>24 часа</button>
            {admin && (
              <button class="mod-btn danger" disabled={busy} onClick={() => mute(null, 'навсегда')}>Навсегда</button>
            )}
          </div>
          <button class="link-btn" onClick={() => setForm(null)}>Отмена</button>
        </div>
      )}

      {form === 'rename' && (
        <form
          class="modtools-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run('nickname', { nickname: nick.trim() }, `Ник изменён на ${nick.trim()}`);
          }}
        >
          <input value={nick} maxLength={32} autoFocus onInput={(e) => setNick(e.currentTarget.value)} />
          <div class="modtools-row">
            <button type="button" class="link-btn" onClick={() => setForm(null)}>Отмена</button>
            <button type="submit" class="primary small" disabled={busy || nick.trim().length < 2}>Сохранить</button>
          </div>
        </form>
      )}

      {form === 'grant' && (
        <div class="modtools-form">
          <span class="muted tiny">Эксклюзивные предметы стиля — выдать или забрать</span>
          {!granted && <span class="muted tiny">Загружаем…</span>}
          {granted &&
            EXCLUSIVE.map((x) => {
              const on = granted.includes(x.key);
              return (
                <button
                  key={x.key}
                  class={`mod-btn grant${on ? ' on' : ''}`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await window.echo.moderate(target.id, 'cosmetic', { key: x.key, on: !on });
                      setGranted(on ? granted.filter((k) => k !== x.key) : [...granted, x.key]);
                    } catch (e) {
                      onError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {on ? '✓ ' : ''}
                  {x.title}
                </button>
              );
            })}
          <button class="link-btn" onClick={() => setForm(null)}>Готово</button>
        </div>
      )}

      {form === 'ban' && (
        <div class="modtools-form">
          <input value={reason} maxLength={200} placeholder="Причина (её увидит человек)" autoFocus onInput={(e) => setReason(e.currentTarget.value)} />
          <div class="modtools-grid">
            <button class="mod-btn danger" disabled={busy} onClick={() => ban(1, 'на сутки')}>1 день</button>
            <button class="mod-btn danger" disabled={busy} onClick={() => ban(7, 'на неделю')}>7 дней</button>
            <button class="mod-btn danger" disabled={busy} onClick={() => ban(30, 'на месяц')}>30 дней</button>
            <button class="mod-btn danger" disabled={busy} onClick={() => ban(null, 'навсегда')}>Навсегда</button>
          </div>
          <button class="link-btn" onClick={() => setForm(null)}>Отмена</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- everyone on the server

interface Extra {
  prestige?: Prestige;
  style?: Look;
}

function seenText(m: Member): string {
  if (m.online) return 'в сети';
  if (!m.lastSeenAt) return 'ещё не заходил';
  const mins = Math.floor((Date.now() - m.lastSeenAt) / 60_000);
  if (mins < 60) return `был ${Math.max(1, mins)} мин назад`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `был ${h} ч назад`;
  const d = Math.floor(h / 24);
  return d < 30 ? `был ${d} дн назад` : `был ${new Date(m.lastSeenAt).toLocaleDateString('ru-RU')}`;
}

/** All users of the server: staff on top, then online, then offline (and bans for staff). */
export function MembersView({
  me,
  myRole,
  extra,
  onProfile,
  onMessage,
  onClose,
  onToast,
}: {
  onMessage: (id: string) => void;
  me: string;
  myRole: Role | undefined;
  extra: (id: string) => Extra;
  onProfile: (id: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [list, setList] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = () =>
    window.echo
      .listMembers()
      .then(setList)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const all = (list ?? []).filter((m) => !q || m.nickname.toLowerCase().includes(q));
  const groups: { title: string; items: Member[] }[] = [
    { title: 'Администрация', items: all.filter((m) => m.role && !m.banned) },
    { title: 'В сети', items: all.filter((m) => !m.role && m.online && !m.banned) },
    { title: 'Не в сети', items: all.filter((m) => !m.role && !m.online && !m.banned) },
    { title: 'Заблокированы', items: all.filter((m) => m.banned) },
  ].filter((g) => g.items.length > 0);

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal members-modal">
        <header class="modal-header">
          <h2>Участники</h2>
          <span class="muted mono tiny">
            {(list ?? []).filter((m) => m.online).length} в сети · {(list ?? []).length} всего
          </span>
          <button class="icon-btn" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div class="members-body">
          <input class="members-search" placeholder="Поиск по нику" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          {!list && <p class="muted">{error ?? 'Загружаем…'}</p>}
          {groups.map((g) => (
            <section key={g.title} class="members-group">
              <div class="section-title">
                <span>
                  {g.title.toUpperCase()} <b>{String(g.items.length).padStart(2, '0')}</b>
                </span>
              </div>
              {g.items.map((m) => {
                const x = extra(m.id);
                const canMod = m.id !== me && canModerate(myRole, m.role);
                return (
                  <div key={m.id} class={`members-row${m.online ? '' : ' offline'}`}>
                    <button class="members-main" onClick={() => onProfile(m.id)}>
                      <Avatar id={m.id} name={m.nickname} avatar={m.avatar} size={32} prestige={x.prestige} look={x.style} />
                      <span class="members-who">
                        <span class="members-nick">
                          <Nick name={m.nickname} look={x.style} />
                          <RoleTag role={m.role} />
                          {m.muted && <span class="mod-flag">МУТ</span>}
                        </span>
                        <span class="muted tiny">
                          {m.banned
                            ? `бан${m.bannedUntil && m.bannedUntil < 32_503_680_000_000 ? ` до ${new Date(m.bannedUntil).toLocaleDateString('ru-RU')}` : ' навсегда'}${m.banReason ? ` · ${m.banReason}` : ''}`
                            : seenText(m)}
                        </span>
                      </span>
                    </button>
                    {m.id !== me && !m.banned && (
                      <button class="icon-btn" title="Написать лично" onClick={() => onMessage(m.id)}>
                        ✉
                      </button>
                    )}
                    {canMod && (
                      <button class="icon-btn" title="Модерация" onClick={() => setOpen(open === m.id ? null : m.id)}>
                        ⋯
                      </button>
                    )}
                    {open === m.id && (
                      <div class="members-tools">
                        <ModTools
                          target={{ id: m.id, nickname: m.nickname, role: m.role, muted: m.muted, banned: m.banned }}
                          me={myRole}
                          onDone={(msg) => {
                            onToast(msg);
                            setOpen(null);
                            void load();
                          }}
                          onError={onToast}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
