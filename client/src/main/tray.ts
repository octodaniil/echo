import { app, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';

export interface TrayState {
  micMuted: boolean;
  deafened: boolean;
  /** Voice channel name, or null when not in a call. */
  channel: string | null;
}

/** Icon shipped next to the app (extraResources) or from the repo in dev. */
function iconPath() {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png');
}

/**
 * Tray icon: Echo keeps running when the window is closed. Menu actions reuse the
 * hotkey actions, so the renderer handles them in one place.
 */
export function createTray(show: () => void, action: (name: string) => void, quit: () => void) {
  const tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32 }));
  let state: TrayState = { micMuted: false, deafened: false, channel: null };

  const rebuild = () => {
    tray.setToolTip(state.channel ? `Echo — ${state.channel}` : 'Echo');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть Echo', click: show },
        { type: 'separator' },
        { label: state.micMuted ? 'Включить микрофон' : 'Выключить микрофон', click: () => action('mute') },
        { label: state.deafened ? 'Включить звук' : 'Выключить звук', click: () => action('deafen') },
        ...(state.channel
          ? [{ label: `Отключиться от «${state.channel}»`, click: () => action('leave') } as const]
          : []),
        { type: 'separator' },
        { label: 'Выйти из Echo', click: quit },
      ]),
    );
  };

  rebuild();
  tray.on('click', show);
  tray.on('double-click', show);

  return {
    update(next: TrayState) {
      state = next;
      rebuild();
    },
    destroy: () => tray.destroy(),
  };
}
