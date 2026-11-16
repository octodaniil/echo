import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export interface UpdateInfo {
  version: string;
}

/**
 * Checks GitHub Releases for a newer Echo, downloads it in the background and
 * tells the UI when it is ready. If the user ignores it, it installs on quit.
 */
export function startUpdater(onReady: (info: UpdateInfo) => void) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => onReady({ version: info.version }));
  autoUpdater.on('error', (err) => console.warn('[updater]', err.message));

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000).unref();
}

export function installUpdateNow() {
  // isSilent = true (no installer UI), isForceRunAfter = true (relaunch Echo).
  autoUpdater.quitAndInstall(true, true);
}
