// Per-device preferences. Kept in localStorage (Electron persists it to the profile folder).

export type NoiseSuppressionMode = 'off' | 'standard' | 'ai' | 'max';

export interface Settings {
  inputDeviceId: string;
  outputDeviceId: string;
  /** 0..2, applied to the mic signal before it is sent. */
  inputVolume: number;
  /** 0..2, master volume for everything you hear. */
  outputVolume: number;
  noiseSuppression: NoiseSuppressionMode;
  echoCancellation: boolean;
  autoGain: boolean;
  /** Voice activation: pick the threshold automatically from the background noise. */
  sensitivityAuto: boolean;
  /** Manual voice activation threshold in dBFS (-100..0). */
  sensitivityDb: number;
  /** Per-user volume (0..2), keyed by user id. */
  userVolumes: Record<string, number>;
  /** Per-user volume of their stream's sound (0..2). */
  streamVolumes: Record<string, number>;
  /** Last used stream quality preset id. */
  streamQuality: string;
  /** Share sound along with the screen. */
  streamAudio: boolean;
  /** Stream bitrate in Mbit/s; null = automatic for the chosen quality. */
  streamBitrate: number | null;
  /** What to sacrifice when the encoder runs short: 'smooth' keeps fps, 'sharp' keeps resolution. */
  streamPriority: 'smooth' | 'sharp';
  /** Color theme id (see themes.ts). */
  theme: string;
  /** Tell friends which game is running. */
  showGame: boolean;
  /** User's own games: exe (lower-case) -> name. */
  customGames: Record<string, string>;
  /** Closing the window keeps Echo in the tray. */
  closeToTray: boolean;
  /** Global hotkeys: action -> Electron accelerator. */
  hotkeys: Record<string, string | null>;
  /** Interface sounds (join/leave/mute/...). */
  uiSounds: boolean;
  /** 0..1 */
  uiSoundsVolume: number;
}

export const defaults: Settings = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputVolume: 1,
  outputVolume: 1,
  noiseSuppression: 'ai',
  echoCancellation: true,
  autoGain: true,
  sensitivityAuto: true,
  sensitivityDb: -50,
  userVolumes: {},
  streamVolumes: {},
  streamQuality: '1080p60',
  streamAudio: true,
  streamBitrate: null,
  streamPriority: 'smooth',
  theme: 'neon',
  showGame: true,
  customGames: {},
  closeToTray: true,
  hotkeys: {},
  uiSounds: true,
  uiSoundsVolume: 0.6,
};

const KEY = 'echo.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

let current = load();
const listeners = new Set<(next: Settings, prev: Settings) => void>();

export const settings = {
  get: () => current,
  update(patch: Partial<Settings>) {
    const prev = current;
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Storage unavailable: settings still apply for this session.
    }
    for (const fn of listeners) fn(current, prev);
  },
  subscribe(fn: (next: Settings, prev: Settings) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
