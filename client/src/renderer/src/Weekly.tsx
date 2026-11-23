import { useEffect, useState } from 'preact/hooks';
import type { Recap, WeeklyState } from '../../shared/types';
import { Badge, useCatalog } from './Achievements';
import { CloseIcon } from './icons';

const daysLeft = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 86_400_000));
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`);

/** Weekly challenges + duo quests (shown at the top of «Мои ачивки»). */
export function WeeklyPanel({ nameOf }: { nameOf: (id: string) => string }) {
  const [state, setState] = useState<WeeklyState | null>(null);
  useEffect(() => {
    const load = () => void window.echo.getWeekly().then(setState).catch(() => {});
    load();
    const off = window.echo.onWeekly(load);
    return off;
  }, []);
  if (!state) return null;
  const c = state.challenges;
  return (
    <div class="weekly">
      <div class="cosmetic-group level">
        ИСПЫТАНИЯ НЕДЕЛИ · ЕЩЁ {daysLeft(c.endsAt)} ДН · +25 ОЧКОВ ЗА КАЖДОЕ
      </div>
      <div class="weekly-grid">
        {c.items.map((i) => (
          <div key={i.code} class={`weekly-item${i.done ? ' done' : ''}`}>
            <span class="weekly-title">
              {i.done ? '✓ ' : ''}
              {i.title}
            </span>
            <span class="ach-progress">
              <span class="ach-progress-bar">
                <i style={{ width: `${Math.round((i.value / i.target) * 100)}%` }} />
              </span>
              <span class="mono">
                {i.value} / {i.target} {i.unit}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div class="cosmetic-group achievement">КВЕСТЫ НА ДВОИХ · +40 ОЧКОВ ОБОИМ</div>
      {state.quests.length === 0 ? (
        <p class="muted tiny">Позови друга в квест — кнопка «Квест на двоих» в его профиле.</p>
      ) : (
        <div class="weekly-grid">
          {state.quests.map((q) => (
            <div key={q.id} class={`weekly-item duo${q.done ? ' done' : ''}`}>
              <span class="weekly-title">
                {q.done ? '✓ ' : ''}с {nameOf(q.with)}: {q.title.toLowerCase()}
              </span>
              <span class="ach-progress">
                <span class="ach-progress-bar">
                  <i style={{ width: `${Math.round((q.value / q.target) * 100)}%` }} />
                </span>
                <span class="mono">
                  {q.value} / {q.target} {q.unit}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** «Итоги недели»: a card about your week, with the hour-by-hour heat map. */
export function RecapView({ which, onClose }: { which: 'last' | 'current'; onClose: () => void }) {
  const catalog = useCatalog();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [mode, setMode] = useState(which);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRecap(null);
    void window.echo
      .getRecap(mode)
      .then(setRecap)
      .catch((e: Error) => setError(e.message));
  }, [mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const max = recap ? Math.max(1, ...recap.heat.flat()) : 1;
  const defs = (recap?.achievements ?? []).map((c) => catalog.find((d) => d.code === c)).filter((d) => !!d);

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal recap-modal">
        <header class="modal-header">
          <h2>Итоги недели</h2>
          <div class="segmented">
            <button class={mode === 'last' ? 'active' : ''} onClick={() => setMode('last')}>
              Прошлая
            </button>
            <button class={mode === 'current' ? 'active' : ''} onClick={() => setMode('current')}>
              Эта неделя
            </button>
          </div>
          <button class="icon-btn" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div class="recap-body">
          {!recap ? (
            <p class="muted">{error ?? 'Считаем…'}</p>
          ) : recap.empty ? (
            <p class="muted">За эту неделю пока пусто — зайди в голос, и здесь появится твоя история.</p>
          ) : (
            <>
              <div class="recap-stats">
                <div class="stat">
                  <span class="stat-value">{hm(recap.voiceMinutes)}</span>
                  <span class="stat-label">в голосе</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{hm(recap.talkMinutes)}</span>
                  <span class="stat-label">наговорил</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{hm(recap.gameMinutes)}</span>
                  <span class="stat-label">в играх</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{recap.days} из 7</span>
                  <span class="stat-label">дней в голосе</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{recap.messages}</span>
                  <span class="stat-label">сообщений</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{recap.streams}</span>
                  <span class="stat-label">трансляций</span>
                </div>
              </div>

              <div class="cosmetic-group level">КОГДА ТЫ БЫЛ В ГОЛОСЕ</div>
              <div class="heatmap">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} class="heat-hour mono">
                    {h % 3 === 0 ? h : ''}
                  </span>
                ))}
                {recap.heat.map((row, d) => (
                  <>
                    <span class="heat-day mono">{DOW[d]}</span>
                    {row.map((m, h) => (
                      <span
                        key={`${d}-${h}`}
                        class="heat-cell"
                        style={{ opacity: m ? 0.18 + 0.82 * (m / max) : 1, background: m ? undefined : 'rgba(80,220,255,.05)' }}
                        title={`${DOW[d]} ${h}:00 — ${m} мин`}
                      />
                    ))}
                  </>
                ))}
              </div>

              <div class="recap-cols">
                <div>
                  <div class="cosmetic-group achievement">С КЕМ БОЛЬШЕ ВСЕГО</div>
                  {recap.partners.length ? (
                    recap.partners.map((p, i) => (
                      <div key={p.id} class="recap-row">
                        <span class="mono muted">#{i + 1}</span>
                        <b>{p.nickname}</b>
                        <span class="muted mono tiny">{hm(p.minutes)}</span>
                      </div>
                    ))
                  ) : (
                    <p class="muted tiny">Пока только ты и тишина</p>
                  )}
                </div>
                <div>
                  <div class="cosmetic-group level">ИГРЫ</div>
                  {recap.games.length ? (
                    recap.games.map((g) => (
                      <div key={g.game} class="recap-row">
                        <b>{g.game}</b>
                        <span class="muted mono tiny">{hm(g.minutes)}</span>
                      </div>
                    ))
                  ) : (
                    <p class="muted tiny">Без игр</p>
                  )}
                </div>
              </div>

              <div class="cosmetic-group exclusive">
                НОВЫЕ АЧИВКИ · ИСПЫТАНИЙ {recap.challenges.done.length} ИЗ {recap.challenges.total}
              </div>
              {defs.length ? (
                <div class="recap-badges">
                  {defs.map((d) => (
                    <Badge key={d!.code} def={d!} size={40} />
                  ))}
                </div>
              ) : (
                <p class="muted tiny">На этой неделе без новых ачивок</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CROWN_TITLE: Record<string, string> = {
  talk: 'Король болтовни — больше всех говорил за вечер',
  stream: 'Звезда эфира — дольше всех стримил за вечер',
};
const CROWN_LABEL: Record<string, string> = { talk: 'КОРОЛЬ БОЛТОВНИ', stream: 'ЗВЕЗДА ЭФИРА' };

/** The crown drawing: gradient body, jewels, and a shine that sweeps across. */
function CrownSvg({ kind, size }: { kind: string; size: number }) {
  const g = `crown-${kind}`;
  return (
    <svg class="crown-svg" width={size} height={Math.round(size * 0.72)} viewBox="0 0 50 36" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={kind === 'talk' ? '#fff3c4' : '#ffd0ec'} />
          <stop offset="0.45" stop-color={kind === 'talk' ? '#ffcf4a' : '#ff5cae'} />
          <stop offset="1" stop-color={kind === 'talk' ? '#c7851a' : '#9b2bd8'} />
        </linearGradient>
        <linearGradient id={`${g}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0" />
          <stop offset="0.5" stop-color="#fff" stop-opacity="0.85" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        <clipPath id={`${g}-clip`}>
          <path d="M4 30 L2 9 L14 18 L25 3 L36 18 L48 9 L46 30 Z" />
        </clipPath>
      </defs>
      <path d="M4 30 L2 9 L14 18 L25 3 L36 18 L48 9 L46 30 Z" fill={`url(#${g}-body)`} stroke="rgba(0,0,0,.35)" stroke-width="1" />
      <rect x="4" y="27" width="42" height="5" rx="1.5" fill={`url(#${g}-body)`} stroke="rgba(0,0,0,.35)" stroke-width="1" />
      <g clip-path={`url(#${g}-clip)`}>
        <rect class="crown-shine" x="-20" y="0" width="16" height="36" fill={`url(#${g}-shine)`} />
      </g>
      <circle cx="25" cy="3.5" r="2.6" class="crown-jewel" fill={kind === 'talk' ? '#5cf2ff' : '#7dffb8'} />
      <circle cx="2.5" cy="9" r="2" fill="#fff" opacity=".9" />
      <circle cx="47.5" cy="9" r="2" fill="#fff" opacity=".9" />
      <circle cx="25" cy="22" r="2.4" fill={kind === 'talk' ? '#ff4d6d' : '#5cf2ff'} />
    </svg>
  );
}

/**
 * The crown of the evening standing on top of a call tile: as wide as the card, its band
 * resting on the card's top edge. Both crowns at once = a gold-and-pink crown.
 */
export function TileCrowns({ crowns }: { crowns: string[] | undefined }) {
  if (!crowns?.length) return null;
  const both = crowns.length > 1;
  const kind = both ? 'both' : crowns[0]!;
  const g = `big-crown-${kind}`;
  const stops: Record<string, [string, string, string]> = {
    talk: ['#fff6cf', '#ffcf4a', '#b97512'],
    stream: ['#ffd6ee', '#ff5cae', '#8e25c9'],
    both: ['#fff6cf', '#ffb347', '#d63fa0'],
  };
  const [top, mid, low] = stops[kind] ?? stops.talk;
  const label = both ? 'КОРОЛЬ БОЛТОВНИ · ЗВЕЗДА ЭФИРА' : kind === 'talk' ? 'КОРОЛЬ БОЛТОВНИ' : 'ЗВЕЗДА ЭФИРА';
  const outline = 'M6 92 L2 26 L40 62 L66 8 L100 54 L134 8 L160 62 L198 26 L194 92 Z';
  return (
    <div class={`big-crown crown-${kind}`} title={crowns.map((c) => CROWN_TITLE[c]).join('\n')}>
      <svg class="big-crown-svg" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={top} />
            <stop offset="0.5" stop-color={mid} />
            <stop offset="1" stop-color={low} />
          </linearGradient>
          <linearGradient id={`${g}-band`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color={low} />
            <stop offset="0.5" stop-color={top} />
            <stop offset="1" stop-color={low} />
          </linearGradient>
          <linearGradient id={`${g}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#fff" stop-opacity="0" />
            <stop offset="0.5" stop-color="#fff" stop-opacity="0.75" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <clipPath id={`${g}-clip`}>
            <path d={outline} />
          </clipPath>
        </defs>
        <path d={outline} fill={`url(#${g}-body)`} stroke="rgba(0,0,0,.45)" stroke-width="1.5" stroke-linejoin="round" />
        {/* inner engraving */}
        <path d="M14 84 L12 44 L42 72 L66 28 L100 68 L134 28 L158 72 L188 44 L186 84" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2" />
        <g clip-path={`url(#${g}-clip)`}>
          <rect class="big-crown-shine" x="-60" y="0" width="40" height="110" fill={`url(#${g}-shine)`} />
        </g>
        {/* band resting on the card */}
        <rect x="0" y="88" width="200" height="20" rx="3" fill={`url(#${g}-band)`} stroke="rgba(0,0,0,.45)" stroke-width="1.5" />
        {/* jewels on the tips and the middle */}
        <circle class="big-crown-jewel j1" cx="66" cy="9" r="5" fill="#5cf2ff" />
        <circle class="big-crown-jewel j2" cx="134" cy="9" r="5" fill="#7dffb8" />
        <circle cx="2" cy="26" r="3.5" fill="#fff" />
        <circle cx="198" cy="26" r="3.5" fill="#fff" />
        <path class="big-crown-jewel j3" d="M100 58 l7 10 -7 10 -7 -10 z" fill="#ff4d6d" stroke="#fff" stroke-width="1" />
      </svg>
      <span class="big-crown-label mono">{label}</span>
      <span class="tile-crown-spark s1" aria-hidden="true" />
      <span class="tile-crown-spark s2" aria-hidden="true" />
      <span class="tile-crown-spark s3" aria-hidden="true" />
    </div>
  );
}

/** Crown next to a nickname (lists, hover cards): who talked / streamed the most tonight. */
export function Crowns({ crowns }: { crowns: string[] | undefined }) {
  if (!crowns?.length) return null;
  return (
    <>
      {crowns.map((c) => (
        <span key={c} class={`crown-tag crown-${c}`} title={CROWN_TITLE[c]}>
          <CrownSvg kind={c} size={16} />
        </span>
      ))}
    </>
  );
}
