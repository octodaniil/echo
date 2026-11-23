import { useEffect, useState } from 'preact/hooks';

/**
 * Always-visible shortcuts above the voice panel: what used to hide in the profile menu.
 * Small badges show progress so there's a reason to look (challenges done, open bets).
 */
export function QuickDock({
  onAchievements,
  onWeekly,
  onFun,
  onRecap,
}: {
  onAchievements: () => void;
  onWeekly: () => void;
  onFun: () => void;
  onRecap: () => void;
}) {
  const [weekly, setWeekly] = useState<{ done: number; total: number } | null>(null);
  const [openBets, setOpenBets] = useState(0);
  useEffect(() => {
    const loadWeekly = () =>
      void window.echo
        .getWeekly()
        .then((w) => setWeekly({ done: w.challenges.items.filter((i) => i.done).length, total: w.challenges.items.length }))
        .catch(() => {});
    const loadFun = () =>
      void window.echo
        .getFun()
        .then((f) => setOpenBets(f.bets.filter((b) => b.status === 'open').length))
        .catch(() => {});
    loadWeekly();
    loadFun();
    const offW = window.echo.onWeekly(loadWeekly);
    const offF = window.echo.onFun(loadFun);
    return () => {
      offW();
      offF();
    };
  }, []);

  return (
    <nav class="quick-dock" aria-label="Быстрый доступ">
      <button class="quick-btn" title="Мои ачивки" onClick={onAchievements}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4h10v4a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 13v4 M8 20h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>АЧИВКИ</span>
      </button>
      <button class="quick-btn" title="Испытания недели и квесты на двоих" onClick={onWeekly}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 21V4 M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>ИСПЫТАНИЯ</span>
        {weekly && weekly.total > 0 && (
          <i class={`quick-badge mono${weekly.done === weekly.total ? ' full' : ''}`}>
            {weekly.done}/{weekly.total}
          </i>
        )}
      </button>
      <button class="quick-btn" title="Споры, прогнозы, капсулы времени" onClick={onFun}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
        <span>ВЕЧЕР</span>
        {openBets > 0 && <i class="quick-badge mono hot">{openBets}</i>}
      </button>
      <button class="quick-btn" title="Итоги недели" onClick={onRecap}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span>ИТОГИ</span>
      </button>
    </nav>
  );
}
