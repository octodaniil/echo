import { render } from 'preact';
import { App } from './App';
import { hardwareH264, installCodecPreferences } from './codecPrefs';
import './styles.css';
import { settings } from './settings';
import { voice } from './voice';

void installCodecPreferences();

render(<App />, document.getElementById('app')!);

// Diagnostics handle for DevTools (stream stats, audio settings).
Object.assign(window, { __echo: { voice, settings, get hardwareH264() { return hardwareH264; } } });
