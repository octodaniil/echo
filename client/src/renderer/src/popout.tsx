import { render, type VNode } from 'preact';

export interface Popout {
  win: Window;
  close: () => void;
}

/**
 * Opens a real OS window (snap to halves/quarters, maximize, other monitor…) that lives in
 * the same renderer process, so it can show the same MediaStreamTrack without decoding
 * the video a second time. Styles are copied over; the content is a normal Preact tree.
 */
export function openPopout(name: string, title: string, content: (w: Window) => VNode, onClosed: () => void): Popout | null {
  const w = window.open('about:blank', `echo-${name}`);
  if (!w) return null;
  const doc = w.document;
  doc.title = title;

  for (const sheet of [...document.styleSheets]) {
    try {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      doc.head.appendChild(style);
    } catch {
      // Cross-origin sheet: not ours, skip.
    }
  }
  // Same color theme as the app, kept in sync while the window is open.
  const syncTheme = () => {
    const t = document.documentElement.dataset.theme;
    if (t) doc.documentElement.dataset.theme = t;
    else delete doc.documentElement.dataset.theme;
  };
  syncTheme();
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  doc.body.className = 'popout-body';
  const root = doc.createElement('div');
  root.className = 'popout-root';
  doc.body.appendChild(root);
  render(content(w), root);

  let done = false;
  const finish = (reason: string) => {
    if (done) return;
    done = true;
    console.info(`[popout] ${name} closed: ${reason}`);
    clearInterval(poll);
    themeObserver.disconnect();
    render(null, root);
    onClosed();
  };
  w.addEventListener('pagehide', () => finish('pagehide'));
  // Fallback in case pagehide doesn't fire when the window is closed from the title bar.
  const poll = window.setInterval(() => w.closed && finish('closed'), 1000);

  return {
    win: w,
    close: () => {
      finish('close()');
      w.close();
    },
  };
}

/** Fullscreen toggle for an element that may live in a pop-out window. */
export function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  const doc = el.ownerDocument;
  if (doc.fullscreenElement) void doc.exitFullscreen();
  else void el.requestFullscreen();
}
