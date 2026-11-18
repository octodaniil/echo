import { render } from 'preact';
import { App } from './App';
import { hardwareH264, installCodecPreferences } from './codecPrefs';
import '@fontsource-variable/exo-2';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import './hud.css';
import './chat.css';
import './cosmetics.css';
import { settings } from './settings';
import { installThemes } from './themes';
import { voice } from './voice';

void installCodecPreferences();
installThemes();

render(<App />, document.getElementById('app')!);

// Diagnostics handle for DevTools (stream stats, audio settings).
Object.assign(window, { __echo: { voice, settings, get hardwareH264() { return hardwareH264; } } });

// Range sliders paint their filled part from --pos (CSS can't read the value itself).
const syncRange = (el: HTMLInputElement) => {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  el.style.setProperty('--pos', `${((Number(el.value) - min) / (max - min || 1)) * 100}%`);
};
document.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') syncRange(e.target);
}, true);
new MutationObserver(() => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(syncRange)).observe(
  document.body,
  { childList: true, subtree: true },
);
