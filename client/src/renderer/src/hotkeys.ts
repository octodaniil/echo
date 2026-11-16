// Global hotkeys: recorded here, registered system-wide by the main process
// (they work while a game is focused).
import { settings } from './settings';
import { voice } from './voice';

export type HotkeyAction = 'mute' | 'deafen' | 'leave' | 'stopStream';

export const HOTKEY_ACTIONS: { action: HotkeyAction; title: string; hint: string }[] = [
  { action: 'mute', title: 'Микрофон вкл/выкл', hint: 'Мут как кнопка с микрофоном' },
  { action: 'deafen', title: 'Звук вкл/выкл', hint: 'Выключить звук и микрофон' },
  { action: 'stopStream', title: 'Остановить трансляцию', hint: 'Если ты сейчас транслируешь' },
  { action: 'leave', title: 'Отключиться от канала', hint: 'Как красная трубка' },
];

const CODE_MAP: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Pause: 'Pause',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
};

/**
 * Turns a keydown into an Electron accelerator ("Ctrl+Shift+M"). Uses physical keys,
 * so it doesn't matter whether the keyboard is in Russian or English layout.
 * Returns null while only modifiers are held.
 */
export function acceleratorFrom(e: KeyboardEvent): string | null {
  let key: string | undefined;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = `num${c.slice(6)}`;
  else key = CODE_MAP[c];
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}

export const hotkeyLabel = (accel: string) =>
  accel
    .replace(/^num(\d)$|\+num(\d)$/, (m, a, b) => (a ? `Num ${a}` : `+Num ${b}`))
    .split('+')
    .join(' + ');

/** A lone letter/digit would be swallowed in every app (typing in chat, games…). */
export const isRisky = (accel: string) => !accel.includes('+') && /^[A-Z0-9`\-=[\]\\;',./]$|^Space$|^Tab$|^Enter$/.test(accel);

/** Last registration errors, per action (set by applyHotkeys). */
export let hotkeyErrors: Record<string, string | null> = {};
const errorListeners = new Set<() => void>();
export const onHotkeyErrors = (fn: () => void) => {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
};

async function applyHotkeys() {
  try {
    hotkeyErrors = await window.echo.setHotkeys(settings.get().hotkeys);
  } catch {
    hotkeyErrors = {};
  }
  errorListeners.forEach((fn) => fn());
}

function run(action: string) {
  switch (action as HotkeyAction) {
    case 'mute':
      return void voice.toggleMic();
    case 'deafen':
      return void voice.toggleDeafen();
    case 'leave':
      return void voice.leave();
    case 'stopStream':
      return void voice.stopScreenShare();
  }
}

let installed = false;

/** Call once after login. */
export function installHotkeys() {
  if (installed) return;
  installed = true;
  void applyHotkeys();
  settings.subscribe((next, prev) => {
    if (next.hotkeys !== prev.hotkeys) void applyHotkeys();
  });
  window.echo.onHotkey(run);
}
