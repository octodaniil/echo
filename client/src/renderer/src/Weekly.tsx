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

/** Crown next to a nickname: who talked / streamed the most tonight. */
export function Crowns({ crowns }: { crowns: string[] | undefined }) {
  if (!crowns?.length) return null;
  return (
    <>
      {crowns.map((c) => (
        <span
          key={c}
          class={`crown-tag ${c}`}
          title={c === 'talk' ? 'Король болтовни — больше всех говорил за вечер' : 'Звезда эфира — дольше всех стримил за вечер'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 18h18L19 7l-4.5 4L12 4 9.5 11 5 7Z" fill="currentColor" />
          </svg>
        </span>
      ))}
    </>
  );
}
