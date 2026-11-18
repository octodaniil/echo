import { useEffect, useState } from 'preact/hooks';
import type { AchievementDef } from '../../shared/types';
import { Badge, RARITY_LABEL, useCatalog } from './Achievements';

interface Tip {
  text: string;
  /** Achievement code: shows a rich card instead of plain text. */
  ach: string | null;
  rect: DOMRect;
}

/**
 * Replaces every native `title` tooltip in the app with a styled one. On hover the title
 * moves into data-tip (so Windows doesn't draw its own) and we show ours after a short delay.
 * Elements with data-ach get an achievement card.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const catalog = useCatalog();

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;

    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title],[data-tip],[data-ach]') ?? null;
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      setTip(null);
      if (!el) return;
      const title = el.getAttribute('title');
      if (title) {
        el.setAttribute('data-tip', title);
        el.removeAttribute('title');
      }
      const text = el.getAttribute('data-tip') ?? '';
      const ach = el.getAttribute('data-ach');
      if (!text && !ach) return;
      timer = window.setTimeout(() => {
        if (current === el && el.isConnected) setTip({ text, ach, rect: el.getBoundingClientRect() });
      }, ach ? 120 : 380);
    };
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (!tip) return null;
  const def: AchievementDef | undefined = tip.ach ? catalog.find((a) => a.code === tip.ach) : undefined;
  const width = def ? 280 : Math.min(300, Math.max(80, tip.text.length * 7 + 24));
  const below = tip.rect.top < (def ? 150 : 60);
  const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const style = below
    ? { left, top: tip.rect.bottom + 8, width: def ? width : undefined, maxWidth: width }
    : { left, bottom: window.innerHeight - tip.rect.top + 8, width: def ? width : undefined, maxWidth: width };

  if (def) {
    return (
      <div class={`tip tip-ach r-${def.rarity}${below ? ' below' : ''}`} style={style}>
        <Badge def={def} size={46} />
        <div class="tip-ach-body">
          <div class="tip-ach-rarity mono">
            {RARITY_LABEL[def.rarity].toUpperCase()}
            {def.unique && ' · 1 ИЗ 1'}
          </div>
          <div class="tip-ach-title">{def.title}</div>
          <div class="tip-ach-desc">{def.description}</div>
          {def.unique && <div class="tip-ach-holder mono">{def.holder ? `ВЛАДЕЛЕЦ: ${def.holder}` : 'ЕЩЁ НИ У КОГО'}</div>}
        </div>
      </div>
    );
  }
  return (
    <div class={`tip${below ? ' below' : ''}`} style={style}>
      {tip.text}
    </div>
  );
}
