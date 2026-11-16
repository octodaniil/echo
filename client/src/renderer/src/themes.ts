import { settings } from './settings';

export interface Theme {
  id: string;
  name: string;
  /** For the swatch only; the real colors live in styles.css. */
  accent: string;
  accent2: string;
}

export const THEMES: Theme[] = [
  { id: 'neon', name: 'Неон', accent: '#29f0cf', accent2: '#7b61ff' },
  { id: 'violet', name: 'Фиалка', accent: '#a78bfa', accent2: '#ff5cc8' },
  { id: 'crimson', name: 'Алый', accent: '#ff5577', accent2: '#ff9f1c' },
  { id: 'amber', name: 'Янтарь', accent: '#ffb02e', accent2: '#ff5e3a' },
  { id: 'ice', name: 'Лёд', accent: '#4cc9ff', accent2: '#7b61ff' },
  { id: 'matrix', name: 'Матрица', accent: '#39ff6e', accent2: '#00d1b2' },
];

function apply(id: string) {
  if (id === 'neon') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

/** Applies the saved theme now and whenever it changes. */
export function installThemes() {
  apply(settings.get().theme);
  settings.subscribe((next, prev) => next.theme !== prev.theme && apply(next.theme));
}
