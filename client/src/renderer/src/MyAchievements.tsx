import { useEffect, useState } from 'preact/hooks';
import type { AchievementDef, Profile } from '../../shared/types';
import { Badge, categories, RARITY_LABEL, useCatalog } from './Achievements';
import { MAX_PINNED } from './AchievementsBoard';
import { CloseIcon } from './icons';
import { WeeklyPanel } from './Weekly';

/**
 * «Мои ачивки»: what you have earned (pick up to three for your profile) and, below,
 * the ones you are closest to. Only you see this list; others see the pinned ones.
 */
export function MyAchievementsView({ meId, onClose, nameOf }: { meId: string; onClose: () => void; nameOf: (id: string) => string }) {
  const baseCatalog = useCatalog();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('all');

  const load = () =>
    window.echo
      .getProfile(meId)
      .then(setProfile)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const off = window.echo.onAchievement(() => void load());
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, []);

  const revealed = new Map((profile?.revealed ?? []).map((d) => [d.code, d]));
  const catalog = baseCatalog.map((d) => revealed.get(d.code) ?? d);
  const owned = new Map((profile?.achievements ?? []).map((a) => [a.code, a.awardedAt]));
  const pinned = profile?.pinned ?? [];
  const earned = catalog
    .filter((d) => owned.has(d.code))
    .sort((a, b) => (owned.get(b.code) ?? 0) - (owned.get(a.code) ?? 0));
  const tabs = [{ id: 'all', title: 'Все' }, ...categories].filter(
    (c) => c.id === 'all' || earned.some((d) => d.category === c.id),
  );
  const shown = earned.filter((d) => tab === 'all' || d.category === tab);
  const closest = catalog
    .filter((d) => !owned.has(d.code) && !d.hidden && profile?.progress?.[d.code])
    .map((d) => ({ d, p: profile!.progress![d.code]! }))
    .sort((a, b) => b.p.value / b.p.target - a.p.value / a.p.target)
    .slice(0, 6);

  const togglePin = async (code: string) => {
    if (!profile) return;
    const next = pinned.includes(code) ? pinned.filter((c) => c !== code) : [...pinned, code].slice(-MAX_PINNED);
    setProfile({ ...profile, pinned: next });
    try {
      setProfile({ ...profile, pinned: await window.echo.setPinned(next) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const card = (d: AchievementDef, extra?: preact.ComponentChildren) => (
    <span class="ach-text">
      <span class="ach-title">
        {d.title}
        {d.unique && <span class="one-of-one">1 из 1</span>}
      </span>
      <span class="ach-desc">{d.description}</span>
      {extra}
    </span>
  );

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal my-ach-modal">
        <header class="modal-header">
          <h2>Мои ачивки</h2>
          <span class="muted mono tiny">
            {earned.length} / {catalog.length} получено · в профиле {pinned.length} из {MAX_PINNED}
          </span>
          <button class="icon-btn" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div class="my-ach-body">
          {!profile ? (
            <p class="muted">{error ?? 'Загружаем…'}</p>
          ) : (
            <>
              <WeeklyPanel nameOf={nameOf} />
              <div class="cosmetic-group">ПОЛУЧЕННЫЕ АЧИВКИ</div>
              <p class="muted tiny">
                Нажми на ачивку, чтобы показать её в профиле (до {MAX_PINNED}). Остальные видишь только ты.
              </p>
              {earned.length === 0 ? (
                <p class="muted">Пока ни одной — зайди в голос, и первая не заставит себя ждать.</p>
              ) : (
                <>
                  <div class="ach-tabs" role="tablist">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        class={`ach-tab${tab === t.id ? ' active' : ''}${t.id === 'pioneers' ? ' pioneers' : ''}`}
                        onClick={() => setTab(t.id)}
                      >
                        {t.title}
                        <span class="ach-tab-count mono">
                          {t.id === 'all' ? earned.length : earned.filter((d) => d.category === t.id).length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div class="ach-grid">
                    {shown.map((d) => {
                      const isPinned = pinned.includes(d.code);
                      return (
                        <button
                          key={d.code}
                          class={`ach r-${d.rarity} clickable${isPinned ? ' pinned' : ''}`}
                          onClick={() => void togglePin(d.code)}
                        >
                          <Badge def={d} size={44} title="" />
                          {card(
                            d,
                            <span class={`ach-meta r-${d.rarity}`}>
                              {RARITY_LABEL[d.rarity]} · {new Date(owned.get(d.code)!).toLocaleDateString('ru-RU')}
                              {isPinned && ' · в профиле'}
                            </span>,
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {closest.length > 0 && (
                <>
                  <div class="cosmetic-group level">БЛИЖЕ ВСЕГО К ПОЛУЧЕНИЮ</div>
                  <div class="ach-grid">
                    {closest.map(({ d, p }) => (
                      <div key={d.code} class={`ach r-${d.rarity} locked`}>
                        <Badge def={d} size={44} locked title="" />
                        {card(
                          d,
                          <span class="ach-progress">
                            <span class="ach-progress-bar">
                              <i style={{ width: `${Math.round((p.value / p.target) * 100)}%` }} />
                            </span>
                            <span class="mono">
                              {p.value} / {p.target} {p.unit}
                            </span>
                          </span>,
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {error && <div class="error">{error}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
