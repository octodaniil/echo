import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export interface UpdateInfo {
  version: string;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

let status: UpdateStatus = { state: 'idle' };
let notify: (s: UpdateStatus) => void = () => {};
let started = false;

function set(s: UpdateStatus) {
  status = s;
  notify(s);
}

export const updateStatus = () => status;

/**
 * Checks GitHub Releases for a newer Echo (on start and hourly), downloads it in the
 * background and reports progress. If the user ignores it, it installs on quit.
 */
export function startUpdater(onReady: (info: UpdateInfo) => void, onStatus: (s: UpdateStatus) => void) {
  notify = onStatus;
  if (!app.isPackaged || started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => status.state !== 'downloading' && set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', version: (status as { version?: string }).version ?? '', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version });
    onReady({ version: info.version });
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err.message);
    set({ state: 'error', message: 'Не удалось проверить обновления' });
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000).unref();
}

/** "Check for updates" button. */
export async function checkNow(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    set({ state: 'error', message: 'Проверка обновлений работает только в установленной версии' });
    return status;
  }
  if (status.state === 'downloading' || status.state === 'ready') return status;
  set({ state: 'checking' });
  await autoUpdater.checkForUpdates().catch(() => {});
  return status;
}

export function installUpdateNow() {
  // isSilent = true (no installer UI), isForceRunAfter = true (relaunch Echo).
  autoUpdater.quitAndInstall(true, true);
}
