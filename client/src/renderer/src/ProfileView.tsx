import { useEffect, useState } from 'preact/hooks';
import type { AchievementDef, Activity, Profile } from '../../shared/types';
import { Badge, UniqueTitles, useCatalog } from './Achievements';
import { AchievementsBoard, MAX_PINNED } from './AchievementsBoard';
import { levelProgress, lookVars, RANK_NAMES } from './look';
import { StatusLine } from './Status';
import { GameCover } from './GameCover';
import { hasFrame } from './Frames';
import { RankEmblem } from './RankEmblem';
import { Avatar, Nick } from './Avatar';
import { bannerUrl } from './profile';
import { CloseIcon } from './icons';


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
  onMyAchievements,
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
  /** Own profile: open «Мои ачивки». */
  onMyAchievements?: () => void;
}) {
  const baseCatalog = useCatalog();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [questMsg, setQuestMsg] = useState<string | null>(null);
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
  const holo = (profile?.uniques?.length ?? 0) > 0;
  const pinned = profile?.pinned ?? [];
  const byCode = (c: string) => catalog.find((a) => a.code === c);
  const pinnedDefs = pinned.map(byCode).filter((a): a is AchievementDef => !!a);
  const tier = profile?.prestige.tier ?? 0;

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
                  <div class="profile-actions-row">
                    <button class="primary small profile-message" onClick={onMessage}>
                      Написать
                    </button>
                    <button
                      class="secondary small"
                      title="Совместное испытание на эту неделю: +40 очков обоим и рамка «Связка» за первый"
                      onClick={async () => {
                        try {
                          await window.echo.startQuest(userId);
                          setError(null);
                          setQuestMsg('Квест начат — смотри в «Мои ачивки»');
                        } catch (e) {
                          setQuestMsg((e as Error).message);
                        }
                      }}
                    >
                      Квест на двоих
                    </button>
                    {questMsg && <span class="muted tiny">{questMsg}</span>}
                  </div>
                )}
                <div class="profile-chips">
                  <span class="chip-static">в Echo с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}</span>
                  {profile.isAdmin && <span class="chip-static admin">Админ</span>}
                  {profile.isModerator && !profile.isAdmin && <span class="chip-static moderator">Модератор</span>}
                  <span class="chip-static">{profile.achievementsTotal ?? profile.achievements.length} ачивок</span>
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
                    <span class="rank-name">
                      <RankEmblem tier={p.tier} size={26} />
                      {RANK_NAMES[p.tier]}
                    </span>
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
                      <span
                        key={name}
                        class={`rank-node${i < p.tier ? ' done' : i === p.tier ? ' now' : ''}`}
                        title={`${name} — с ${[1, 5, 10, 15, 20, 25, 30, 35, 40, 45][i]} уровня`}
                      >
                        <b />
                        <span class="rank-node-name">{i === p.tier || i === p.tier + 1 ? name : ''}</span>
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
                {isMe ? (
                  <small class="muted">Другие видят только те, что ты выставил в профиль (они вверху, рядом с ником)</small>
                ) : (
                  !manage && <small class="muted">Видны только ачивки, которые {profile.nickname} выставил в профиль</small>
                )}
                {isMe && onMyAchievements && (
                  <button class="secondary small" onClick={onMyAchievements}>
                    Мои ачивки
                  </button>
                )}
                {!isMe && (amAdmin || (amModerator && !profile.isAdmin)) && (
                  <button class={`secondary small${manage ? ' active' : ''}`} onClick={() => setManage(!manage)}>
                    {manage ? 'Готово' : 'Выдать / забрать'}
                  </button>
                )}
              </div>
              {manage && profile.fullAchievements ? (
                <AchievementsBoard profile={profile} setProfile={setProfile} isMe={false} manage reload={load} />
              ) : (
                pinnedDefs.length === 0 && <p class="muted tiny">Пока ничего не закреплено.</p>
              )}
              {error && <div class="error">{error}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
