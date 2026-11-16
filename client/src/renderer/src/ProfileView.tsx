import { useEffect, useState } from 'preact/hooks';
import type { AchievementDef, Activity, Profile, Rarity } from '../../shared/types';
import { Badge, categories, RARITY_LABEL, TIER_NAMES, useCatalog } from './Achievements';
import { Avatar, Nick } from './Avatar';
import { CloseIcon } from './icons';

const RARITY_ORDER: Rarity[] = ['legendary', 'epic', 'rare', 'common'];
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
  activity,
  onClose,
}: {
  userId: string;
  meId: string;
  amAdmin: boolean;
  /** What they're playing right now (from presence). */
  activity: Activity | null;
  onClose: () => void;
}) {
  const catalog = useCatalog();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
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

  const owned = new Map((profile?.achievements ?? []).map((a) => [a.code, a.awardedAt]));
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
  const groups = (categories.length ? categories : [{ id: 'all', title: 'Ачивки' }]).map((c) => ({
    ...c,
    items: sortInGroup(catalog.filter((a) => c.id === 'all' || a.category === c.id)),
  }));

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
  const progress = p && p.nextTierAt ? (p.points - p.tierFloor) / (p.nextTierAt - p.tierFloor) : 1;

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal profile tier-${tier}`}>
        <div class="profile-banner">
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
                <Avatar id={profile.id} name={profile.nickname} avatar={profile.avatar} size={96} tier={tier} />
              </span>
              <div class="profile-id">
                <h2>
                  <Nick name={profile.nickname} tier={tier} />
                </h2>
                <div class="profile-chips">
                  {profile.isAdmin && <span class="chip-static admin">Админ</span>}
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
              <div class={`rank-card rank-t${p.tier}`}>
                <div class="rank-level mono">{p.level}</div>
                <div class="rank-body">
                  <div class="rank-title">
                    {TIER_NAMES[p.tier]} <span class="muted mono">· {p.points} очков</span>
                  </div>
                  <div class="rank-bar">
                    <span style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
                  </div>
                  <div class="muted tiny">
                    {p.nextTierAt
                      ? `До ранга «${TIER_NAMES[p.tier + 1]}» — ${p.nextTierAt - p.points} очков`
                      : 'Высший ранг'}
                  </div>
                </div>
              </div>
            )}

            {activity && (
              <div class="now-playing">
                <span class="now-playing-dot" />
                Сейчас играет в <b>{activity.game}</b>
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
                <span class="stat-value">{formatDate(profile.createdAt)}</span>
                <span class="stat-label">в Echo с</span>
              </div>
            </div>

            {(profile.topGames?.length ?? 0) > 0 && (
              <section class="profile-section">
                <h3>Любимые игры</h3>
                <div class="top-games">
                  {profile.topGames.map((g, i) => (
                    <div key={g.game} class="top-game">
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
                {amAdmin && (
                  <button class={`secondary small${manage ? ' active' : ''}`} onClick={() => setManage(!manage)}>
                    {manage ? 'Готово' : 'Выдать / забрать'}
                  </button>
                )}
              </div>
              {groups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.id} class="ach-group">
                    <div class="ach-group-title">
                      {g.title}
                      <span class="muted mono">
                        {g.items.filter((a) => owned.has(a.code)).length}/{g.items.length}
                      </span>
                    </div>
                    <div class="ach-grid">
                      {g.items.map((d) => {
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
                              <span class="ach-title">{has || manage ? d.title : '???'}</span>
                              <span class="ach-desc">{d.description}</span>
                              <span class={`ach-meta r-${d.rarity}`}>
                                {RARITY_LABEL[d.rarity]}
                                {has && ` · ${new Date(owned.get(d.code)!).toLocaleDateString('ru-RU')}`}
                                {isPinned && ' · закреплена'}
                                {manage && (has ? ' · забрать' : ' · выдать')}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              {error && <div class="error">{error}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
