import { useState } from 'preact/hooks';
import type { AchievementDef, Profile, Rarity } from '../../shared/types';
import { Badge, categories, RARITY_LABEL, useCatalog } from './Achievements';

const RARITY_ORDER: Rarity[] = ['unique', 'legendary', 'epic', 'rare', 'common'];
export const MAX_PINNED = 3;

/**
 * The full achievement grid with category tabs and progress. Used in Settings → «Мои
 * ачивки» (pin your best ones to the profile) and in someone's profile by the admin /
 * moderators in «выдать / забрать» mode.
 */
export function AchievementsBoard({
  profile,
  setProfile,
  isMe,
  manage,
  reload,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  isMe: boolean;
  /** Clicking gives / takes the achievement instead of pinning it. */
  manage: boolean;
  reload: () => Promise<unknown>;
}) {
  const baseCatalog = useCatalog();
  const [tab, setTab] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hidden achievements this person earned come with their real definition.
  const revealed = new Map((profile.revealed ?? []).map((d) => [d.code, d]));
  const owned = new Map(profile.achievements.map((a) => [a.code, a.awardedAt]));
  // Secret achievements nobody has earned here stay out of sight (except when granting).
  const catalog = baseCatalog.map((d) => revealed.get(d.code) ?? d).filter((d) => manage || !d.hidden || owned.has(d.code));
  const pinned = profile.pinned ?? [];

  const sortInGroup = (list: AchievementDef[]) =>
    [...list].sort(
      (a, b) =>
        Number(owned.has(b.code)) - Number(owned.has(a.code)) ||
        RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity),
    );
  const groups = [{ id: 'all', title: 'Все' }, ...categories]
    .map((c) => ({ ...c, items: sortInGroup(catalog.filter((a) => c.id === 'all' || a.category === c.id)) }))
    .filter((g) => g.items.length > 0);
  const current = groups.find((g) => g.id === tab) ?? groups[0];

  const togglePin = async (code: string) => {
    if (!isMe || !owned.has(code)) return;
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
      if (owned.has(code)) await window.echo.revokeAchievement(profile.id, code);
      else await window.echo.awardAchievement(profile.id, code);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
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
              const prog = profile.progress?.[d.code];
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
                    {!has && !d.hidden && prog && (
                      <span class="ach-progress">
                        <span class="ach-progress-bar">
                          <i style={{ width: `${Math.round((prog.value / prog.target) * 100)}%` }} />
                        </span>
                        <span class="mono">
                          {prog.value} / {prog.target} {prog.unit}
                        </span>
                      </span>
                    )}
                    <span class={`ach-meta r-${d.rarity}`}>
                      {RARITY_LABEL[d.rarity]}
                      {has && ` · ${new Date(owned.get(d.code)!).toLocaleDateString('ru-RU')}`}
                      {d.unique && !has && (d.holder ? ` · уже у ${d.holder}` : ' · ещё ни у кого')}
                      {d.hidden && !has && ' · прогресс скрыт'}
                      {isPinned && ' · в профиле'}
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
    </>
  );
}
