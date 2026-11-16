// Pushes app-level preferences that live in the main process (game detection, tray).
import { settings } from './settings';

let installed = false;

export function installAppSync() {
  if (installed) return;
  installed = true;
  const push = () => {
    const s = settings.get();
    void window.echo.setGamesConfig({ enabled: s.showGame, custom: s.customGames }).catch(() => {});
    void window.echo.setCloseToTray(s.closeToTray).catch(() => {});
  };
  push();
  settings.subscribe((next, prev) => {
    if (
      next.showGame !== prev.showGame ||
      next.customGames !== prev.customGames ||
      next.closeToTray !== prev.closeToTray
    ) {
      push();
    }
  });
}
