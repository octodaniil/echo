import { desktopCapturer, session, type DesktopCapturerSource } from 'electron';
import type { ScreenSource } from '../shared/types';

/**
 * Screen sharing, main-process side.
 *
 * The renderer shows its own picker built from listSources(), tells us which source
 * the user chose (selectSource), then calls getDisplayMedia(). Our display-media
 * handler answers that call with the chosen source, so no system picker ever shows.
 */

let known = new Map<string, DesktopCapturerSource>();
let pending: { id: string; audio: boolean } | null = null;

export async function listSources(ownWindowTitle: string): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 384, height: 216 },
    fetchWindowIcons: true,
  });
  known = new Map(sources.map((s) => [s.id, s]));

  let screenNo = 0;
  return sources
    .filter((s) => s.name !== ownWindowTitle && !s.thumbnail.isEmpty())
    .map((s) => {
      const kind = s.id.startsWith('screen:') ? 'screen' : 'window';
      return {
        id: s.id,
        kind,
        name: kind === 'screen' ? `Экран ${++screenNo}` : s.name,
        thumbnail: `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.resize({ width: 32 }).toDataURL() : null,
      } satisfies ScreenSource;
    });
}

export function selectSource(id: string, audio: boolean) {
  if (!known.has(id)) throw new Error('Источник больше недоступен, выбери заново');
  pending = { id, audio };
}

export function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const choice = pending;
    pending = null;
    const source = choice ? known.get(choice.id) : undefined;
    if (!source || !choice) {
      // Nothing selected through our picker: refuse.
      callback({});
      return;
    }
    // 'loopback' = system audio (Windows). Echo's own playback is filtered in the
    // renderer via the restrictOwnAudio constraint where Chromium supports it.
    callback({ video: source, ...(choice.audio ? { audio: 'loopback' as const } : {}) });
  });
}
