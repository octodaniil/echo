import { useEffect, useState } from 'preact/hooks';
import type { AchievementDef, Activity, Profile, Rarity } from '../../shared/types';
import { Badge, categories, RARITY_LABEL, UniqueTitles, useCatalog } from './Achievements';
import { levelProgress, lookVars, RANK_NAMES } from './look';
import { StatusLine } from './Status';
import { GameCover } from './GameCover';
import { hasFrame } from './Frames';
import { Avatar, Nick } from './Avatar';
import { bannerUrl } from './profile';
import { CloseIcon } from './icons';

const RARITY_ORDER: Rarity[] = ['unique', 'legendary', 'epic', 'rare', 'common'];
const MAX_PINNED = 3;

function hours(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function ProfileView({
  userId,
  meId,
  amAdmin,
  amModerator = false,
  activity,
  onClose,
  onMessage,
}: {
  userId: string;
  meId: string;
  amAdmin: boolean;
  /** Moderators can award / revoke too, except for themselves and the admin. */
  amModerator?: boolean;
  /** What they're playing right now (from presence). */
  activity: Activity | null;
  onClose: () => void;
  /** Open a private chat with this person (not shown on your own profile). */
  onMessage?: () => void;
}) {
  const baseCatalog = useCatalog();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const isMe = userId === meId;

  const load = () =>
    window.echo
      .getProfile(userId)
      .then(setProfile)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Refresh own profile when a new achievement drops while it's open.
    const off = window.echo.onAchievement(() => isMe && void load());
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [userId]);

  // Hidden achievements this person earned come with their real definition.
  const revealed = new Map((profile?.revealed ?? []).map((d) => [d.code, d]));
  const catalog = baseCatalog.map((d) => revealed.get(d.code) ?? d);
  const owned = new Map((profile?.achievements ?? []).map((a) => [a.code, a.awardedAt]));
  const holo = (profile?.uniques?.length ?? 0) > 0;
  const pinned = profile?.pinned ?? [];
  const byCode = (c: string) => catalog.find((a) => a.code === c);
  const pinnedDefs = pinned.map(byCode).filter((a): a is AchievementDef => !!a);
  const tier = profile?.prestige.tier ?? 0;

  const sortInGroup = (list: AchievementDef[]) =>
    [...list].sort(
      (a, b) =>
        Number(owned.has(b.code)) - Number(owned.has(a.code)) ||
        RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity),
    );
  const groups = [
    { id: 'all', title: 'Все' },
    ...categories,
  ]
    .map((c) => ({
      ...c,
      items: sortInGroup(catalog.filter((a) => c.id === 'all' || a.category === c.id)),
    }))
    .filter((g) => g.items.length > 0);
  const current = groups.find((g) => g.id === tab) ?? groups[0];

  const togglePin = async (code: string) => {
    if (!isMe || !owned.has(code) || !profile) return;
    const next = pinned.includes(code) ? pinned.filter((c) => c !== code) : [...pinned, code].slice(-MAX_PINNED);
    setProfile({ ...profile, pinned: next });
    try {
      setProfile({ ...profile, pinned: await window.echo.setPinned(next) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleAward = async (code: string) => {
    try {
      if (owned.has(code)) await window.echo.revokeAchievement(userId, code);
      else await window.echo.awardAchievement(userId, code);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const p = profile?.prestige;
  const progress = levelProgress(p);

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal profile rank-${tier}${holo ? ' holo' : ''}`} style={lookVars(profile?.style)}>
        <div
          class={`profile-banner${profile?.banner ? ' custom' : ''}`}
          style={profile?.banner ? { backgroundImage: `url("${bannerUrl(profile.id, profile.banner)}")` } : undefined}
        >
          <span class="banner-tag mono">ДОСЬЕ // ID {userId.slice(0, 4).toUpperCase()}-{userId.slice(-2).toUpperCase()}</span>
          <button class="icon-btn profile-close" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        {!profile ? (
          <div class="profile-loading muted">{error ?? 'Загружаем профиль…'}</div>
        ) : (
          <>
            <header class="profile-head">
              <span class="profile-avatar">
                <Avatar
                  id={profile.id}
                  name={profile.nickname}
                  avatar={profile.avatar}
                  size={hasFrame(profile.style?.frame) ? 64 : 96}
                  prestige={profile.prestige}
                  look={profile.style}
                  status={profile.status?.state}
                  uniques={profile.uniques}
                />
              </span>
              <div class="profile-id">
                <h2>
                  <Nick name={profile.nickname} look={profile.style} />
                </h2>
                <StatusLine status={profile.status} class="profile-status" />
                <UniqueTitles uniques={profile.uniques} />
                {onMessage && (
                  <button class="primary small profile-message" onClick={onMessage}>
                    Написать
                  </button>
                )}
                <div class="profile-chips">
                  <span class="chip-static">в Echo с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}</span>
                  {profile.isAdmin && <span class="chip-static admin">Админ</span>}
                  {profile.isModerator && !profile.isAdmin && <span class="chip-static moderator">Модератор</span>}
                  <span class="chip-static">
                    {owned.size} / {catalog.length} ачивок
                  </span>
                </div>
              </div>
              {pinnedDefs.length > 0 && (
                <div class="showcase">
                  {pinnedDefs.map((d) => (
                    <div key={d.code} class="showcase-item">
                      <Badge def={d} size={52} />
                      <span>{d.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </header>

            {p && (
              <div class="rank-card">
                <div class="rank-level mono">
                  <span class="rank-level-label">LVL</span>
                  {p.level}
                </div>
                <div class="rank-body">
                  <div class="rank-title">
                    <span class="rank-name">{RANK_NAMES[p.tier]}</span>
                    <span class="muted mono">
                      {p.points} / {p.nextLevelAt ?? '—'} очков
                    </span>
                  </div>
                  <div class="segbar" aria-label={`${Math.round(progress * 100)}%`}>
                    {Array.from({ length: 20 }, (_, i) => (
                      <i key={i} class={i < Math.round(progress * 20) ? 'on' : ''} />
                    ))}
                  </div>
                  <div class="rank-track" style={{ '--done': `${(p.tier / (RANK_NAMES.length - 1)) * 100}%` }}>
                    {RANK_NAMES.map((name, i) => (
                      <span key={name} class={`rank-node${i < p.tier ? ' done' : i === p.tier ? ' now' : ''}`}>
                        <b />
                        {name}
                      </span>
                    ))}
                  </div>
                  <div class="muted tiny">
                    {p.nextTierLevel
                      ? `Уровень ${p.level + 1} — через ${(p.nextLevelAt ?? 0) - p.points} очков · ранг «${RANK_NAMES[p.tier + 1]}» с ${p.nextTierLevel} уровня`
                      : `Высший ранг · следующий уровень через ${(p.nextLevelAt ?? 0) - p.points} очков`}
                  </div>
                </div>
              </div>
            )}

            {activity && (
              <div class="now-playing">
                <GameCover game={activity.game} width={110} />
                <span class="now-playing-text">
                  <span class="now-playing-label">
                    <span class="now-playing-dot" />
                    Сейчас играет
                  </span>
                  <b>{activity.game}</b>
                </span>
              </div>
            )}

            <div class="profile-stats four">
              <div class="stat">
                <span class="stat-value mono">{hours(profile.voiceSeconds)}</span>
                <span class="stat-label">в голосе</span>
              </div>
              <div class="stat">
                <span class="stat-value mono">{hours(profile.gameSeconds ?? 0)}</span>
                <span class="stat-label">в играх</span>
              </div>
              <div class="stat">
                <span class="stat-value mono">{profile.streamsCount}</span>
                <span class="stat-label">трансляций</span>
              </div>
              <div class="stat">
                <span class="stat-value mono">{profile.streakDays ?? 0} дн</span>
                <span class="stat-label">подряд в голосе</span>
              </div>
            </div>

            {(profile.topGames?.length ?? 0) > 0 && (
              <section class="profile-section">
                <h3>Любимые игры</h3>
                <div class="top-games">
                  {profile.topGames.map((g, i) => (
                    <div key={g.game} class="top-game">
                      <GameCover game={g.game} width={64} />
                      <span class="top-game-rank mono">#{i + 1}</span>
                      <span class="top-game-name">{g.game}</span>
                      <span class="muted mono tiny">{hours(g.seconds)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section class="profile-section">
              <div class="profile-section-head">
                <h3>Ачивки</h3>
                {isMe && <small class="muted">Нажми на полученную, чтобы закрепить в профиле (до {MAX_PINNED})</small>}
                {(amAdmin || (amModerator && !isMe && !profile.isAdmin)) && (
                  <button class={`secondary small${manage ? ' active' : ''}`} onClick={() => setManage(!manage)}>
                    {manage ? 'Готово' : 'Выдать / забрать'}
                  </button>
                )}
              </div>
              <div class="ach-tabs" role="tablist">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    role="tab"
                    class={`ach-tab${current?.id === g.id ? ' active' : ''}${g.id === 'special' ? ' special' : ''}${g.id === 'pioneers' ? ' pioneers' : ''}`}
                    onClick={() => setTab(g.id)}
                  >
                    {g.title}
                    <span class="ach-tab-count mono">
                      {g.items.filter((a) => owned.has(a.code)).length}/{g.items.length}
                    </span>
                  </button>
                ))}
              </div>
              {current && (
                  <div key={current.id} class="ach-group fade-in">
                    <div class="ach-grid">
                      {current.items.map((d) => {
                        const has = owned.has(d.code);
                        const isPinned = pinned.includes(d.code);
                        const clickable = manage || (isMe && has);
                        return (
                          <button
                            key={d.code}
                            class={`ach r-${d.rarity}${has ? '' : ' locked'}${isPinned ? ' pinned' : ''}${clickable ? ' clickable' : ''}${manage ? ' manage' : ''}`}
                            onClick={() => (manage ? void toggleAward(d.code) : void togglePin(d.code))}
                            disabled={!clickable}
                          >
                            <Badge def={d} size={44} locked={!has} title="" />
                            <span class="ach-text">
                              <span class="ach-title">
                                {has || manage ? d.title : d.hidden ? 'Скрытая ачивка' : '???'}
                                {d.unique && <span class="one-of-one">1 из 1</span>}
                              </span>
                              <span class="ach-desc">{d.description}</span>
                              {!has && !d.hidden && profile.progress?.[d.code] && (
                                <span class="ach-progress">
                                  <span class="ach-progress-bar">
                                    <i
                                      style={{
                                        width: `${Math.round((profile.progress[d.code]!.value / profile.progress[d.code]!.target) * 100)}%`,
                                      }}
                                    />
                                  </span>
                                  <span class="mono">
                                    {profile.progress[d.code]!.value} / {profile.progress[d.code]!.target} {profile.progress[d.code]!.unit}
                                  </span>
                                </span>
                              )}
                              <span class={`ach-meta r-${d.rarity}`}>
                                {RARITY_LABEL[d.rarity]}
                                {has && ` · ${new Date(owned.get(d.code)!).toLocaleDateString('ru-RU')}`}
                                {d.unique && !has && (d.holder ? ` · уже у ${d.holder}` : ' · ещё ни у кого')}
                                {d.hidden && !has && ' · прогресс скрыт'}
                                {isPinned && ' · закреплена'}
                                {manage && (has ? ' · забрать' : ' · выдать')}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
              )}
              {error && <div class="error">{error}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
