import { useEffect, useState } from 'preact/hooks';
import type { FunState } from '../../shared/types';
import { CloseIcon } from './icons';

type Tab = 'bets' | 'predict' | 'capsules';

const Spark = () => (
  <svg class="spark-icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" fill="currentColor" />
  </svg>
);

const OPEN_IN = [
  { id: 'day', title: 'Завтра', ms: 86_400_000 },
  { id: 'week', title: 'Через неделю', ms: 7 * 86_400_000 },
  { id: 'month', title: 'Через месяц', ms: 30 * 86_400_000 },
  { id: 'half', title: 'Через полгода', ms: 182 * 86_400_000 },
  { id: 'year', title: 'Через год', ms: 365 * 86_400_000 },
];

/** «Вечер»: bets on sparks, predictions of tonight's crowns, time capsules. */
export function FunView({
  meId,
  people,
  channels,
  onClose,
}: {
  meId: string;
  people: { id: string; nickname: string }[];
  channels: { conv: string; name: string }[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('bets');
  const [state, setState] = useState<FunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    window.echo
      .getFun()
      .then(setState)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    const off = window.echo.onFun(() => void load());
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal fun-modal">
        <header class="modal-header">
          <h2>Вечер</h2>
          <div class="segmented">
            <button class={tab === 'bets' ? 'active' : ''} onClick={() => setTab('bets')}>
              Споры
            </button>
            <button class={tab === 'predict' ? 'active' : ''} onClick={() => setTab('predict')}>
              Прогнозы
            </button>
            <button class={tab === 'capsules' ? 'active' : ''} onClick={() => setTab('capsules')}>
              Капсулы времени
            </button>
          </div>
          {state && (
            <span class="wallet mono" title="Искры — игровая валюта, не деньги. +50 каждый день">
              <Spark /> {state.wallet.sparks}
            </span>
          )}
          <button class="icon-btn" title="Закрыть" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div class="fun-body">
          {error && <div class="error">{error}</div>}
          {!state ? (
            <p class="muted">Загружаем…</p>
          ) : tab === 'bets' ? (
            <Bets state={state} meId={meId} run={run} />
          ) : tab === 'predict' ? (
            <Predictions state={state} people={people} run={run} />
          ) : (
            <Capsules state={state} channels={channels} run={run} />
          )}
        </div>
      </div>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

function Bets({ state, meId, run }: { state: FunState; meId: string; run: Run }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const create = async () => {
    if (await run(() => window.echo.createBet(question, options))) {
      setQuestion('');
      setOptions(['', '']);
    }
  };
  return (
    <>
      <div class="fun-create">
        <input
          class="input"
          placeholder="О чём спорим? Например: «Затащим катку до полуночи?»"
          value={question}
          maxLength={140}
          onInput={(e) => setQuestion(e.currentTarget.value)}
        />
        <div class="fun-options">
          {options.map((o, i) => (
            <input
              key={i}
              class="input"
              placeholder={`Вариант ${i + 1}`}
              value={o}
              maxLength={60}
              onInput={(e) => setOptions(options.map((x, j) => (j === i ? e.currentTarget.value : x)))}
            />
          ))}
          {options.length < 4 && (
            <button class="secondary small" onClick={() => setOptions([...options, ''])}>
              + вариант
            </button>
          )}
          <button class="primary small" disabled={question.trim().length < 3 || options.filter((o) => o.trim()).length < 2} onClick={() => void create()}>
            Открыть спор
          </button>
        </div>
      </div>
      {state.bets.length === 0 && <p class="muted">Споров пока нет — начни первый.</p>}
      {state.bets.map((b) => {
        const mine = b.author === meId;
        const closed = b.status === 'resolved' || b.status === 'cancelled';
        return (
          <div key={b.id} class={`bet${closed ? ' closed' : ''}`}>
            <div class="bet-head">
              <b>{b.question}</b>
              <span class="muted tiny">
                {b.authorName} ·{' '}
                {b.status === 'open' ? 'ставки открыты' : b.status === 'locked' ? 'ставки закрыты' : b.status === 'cancelled' ? 'отменён' : 'завершён'}
              </span>
              <span class="mono bet-pot">
                <Spark /> {b.pot}
              </span>
            </div>
            {b.options.map((o, i) => {
              const share = b.pot ? Math.round((o.total / b.pot) * 100) : 0;
              const won = b.winner === i;
              const key = `${b.id}:${i}`;
              const canStake = b.status === 'open' && (!b.mine || b.mine.option === i);
              return (
                <div key={i} class={`bet-option${won ? ' won' : ''}${b.mine?.option === i ? ' mine' : ''}`}>
                  <span class="bet-bar" style={{ width: `${share}%` }} />
                  <span class="bet-title">
                    {won && '🏆 '}
                    {o.title}
                  </span>
                  <span class="muted tiny bet-people" title={o.people.map((p) => `${p.nickname}: ${p.amount}`).join('\n')}>
                    {o.people.map((p) => p.nickname).join(', ')}
                  </span>
                  <span class="mono tiny">
                    {o.total} · {share}%
                  </span>
                  {canStake && (
                    <span class="bet-stake">
                      <input
                        class="input mono"
                        type="number"
                        min={10}
                        placeholder="10"
                        value={amounts[key] ?? ''}
                        onInput={(e) => setAmounts({ ...amounts, [key]: e.currentTarget.value })}
                      />
                      <button
                        class="secondary small"
                        onClick={() =>
                          void run(() => window.echo.stakeBet(b.id, i, Number(amounts[key] || 10))).then(
                            (ok) => ok && setAmounts({ ...amounts, [key]: '' }),
                          )
                        }
                      >
                        Ставлю
                      </button>
                    </span>
                  )}
                  {mine && b.status === 'locked' && (
                    <button class="secondary small" title="Этот вариант победил — разделить банк" onClick={() => void run(() => window.echo.settleBet(b.id, 'resolve', i))}>
                      Победил
                    </button>
                  )}
                </div>
              );
            })}
            {b.mine && (
              <div class="muted tiny">
                Твоя ставка: {b.mine.amount}
                {b.mine.payout != null && ` · получено ${b.mine.payout}`}
              </div>
            )}
            {mine && !closed && (
              <div class="bet-actions">
                {b.status === 'open' && (
                  <button class="secondary small" onClick={() => void run(() => window.echo.settleBet(b.id, 'lock'))}>
                    Закрыть ставки
                  </button>
                )}
                <button class="secondary small" onClick={() => void run(() => window.echo.settleBet(b.id, 'cancel'))}>
                  Отменить и вернуть искры
                </button>
              </div>
            )}
          </div>
        );
      })}
      {state.richest.length > 0 && (
        <>
          <div class="cosmetic-group level">БОГАЧИ</div>
          {state.richest.map((r, i) => (
            <div key={r.user_id} class="recap-row">
              <span class="mono muted">#{i + 1}</span>
              <b>{r.nickname}</b>
              <span class="mono tiny">
                <Spark /> {r.sparks}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Predictions({ state, people, run }: { state: FunState; people: { id: string; nickname: string }[]; run: Run }) {
  const p = state.predictions;
  const kinds = [
    { id: 'talk' as const, title: 'Король болтовни', hint: 'кто больше всех наговорит за вечер (от 20 мин)' },
    { id: 'stream' as const, title: 'Звезда эфира', hint: 'кто дольше всех простримит (от 30 мин)' },
  ];
  return (
    <>
      <p class="muted tiny">
        Угадай, кому сегодня достанется корона. Прогнозы принимаются с {p.opensAtHour}:00 до 0{p.closesAtHour}:00 ночи, итоги — на
        следующий день. Угадал — +{p.prize} искр. {p.open ? '' : `Сейчас приём закрыт — откроется в ${p.opensAtHour}:00.`}
      </p>
      {(p.last.talk.votes > 0 || p.last.stream.votes > 0 || p.last.talk.winner || p.last.stream.winner) && (
        <div class="predict predict-last">
          <div class="bet-head">
            <b>Итоги вчерашнего вечера</b>
          </div>
          {kinds.map((k) => {
            const r = p.last[k.id];
            return (
              <div key={k.id} class="tiny">
                {k.title}: <b>{r.winner?.nickname ?? 'никто не набрал'}</b>
                {r.votes > 0 && (r.guessed.length ? ` · угадали: ${r.guessed.join(', ')}` : ' · никто не угадал')}
              </div>
            );
          })}
        </div>
      )}
      {kinds.map((k) => (
        <div key={k.id} class="predict">
          <div class="bet-head">
            <b>
              <span class={`crown-tag ${k.id}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 18h18L19 7l-4.5 4L12 4 9.5 11 5 7Z" fill="currentColor" />
                </svg>
              </span>{' '}
              {k.title}
            </b>
            <span class="muted tiny">{k.hint}</span>
            {p.crowns[k.id] && (
              <span class="tiny">сейчас: {people.find((x) => x.id === p.crowns[k.id])?.nickname ?? '—'}</span>
            )}
          </div>
          <div class="predict-picks">
            {people.map((u) => {
              const votes = p.tally[k.id].find((t) => t.id === u.id)?.votes ?? 0;
              return (
                <button
                  key={u.id}
                  class={`predict-pick${p.mine[k.id] === u.id ? ' active' : ''}`}
                  disabled={!p.open}
                  onClick={() => void run(() => window.echo.predict(k.id, u.id))}
                >
                  {u.nickname}
                  {votes > 0 && <span class="mono tiny"> · {votes}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p class="muted tiny">
        Угадано всего: {state.wallet.predicted} · споров выиграно: {state.wallet.betsWon}
      </p>
    </>
  );
}

function Capsules({ state, channels, run }: { state: FunState; channels: { conv: string; name: string }[]; run: Run }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('me');
  const [when, setWhen] = useState('month');
  const seal = async () => {
    const openAt = Date.now() + (OPEN_IN.find((o) => o.id === when)?.ms ?? 30 * 86_400_000);
    if (await run(() => window.echo.sealCapsule(text, target, openAt))) setText('');
  };
  const where = (t: string) => (t === 'me' ? 'тебе' : `в #${channels.find((c) => c.conv === t)?.name ?? 'канал'}`);
  return (
    <>
      <p class="muted tiny">
        Напиши послание в будущее. Оно запечатывается — даже ты не сможешь его перечитать до даты открытия. Потом оно придёт тебе
        или появится в чате канала.
      </p>
      <div class="fun-create">
        <textarea
          class="input"
          rows={4}
          maxLength={2000}
          placeholder="Привет, я из прошлого. Сегодня мы…"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="fun-options">
          <select class="input" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
            <option value="me">Мне</option>
            {channels.map((c) => (
              <option key={c.conv} value={c.conv}>
                В чат #{c.name}
              </option>
            ))}
          </select>
          <select class="input" value={when} onChange={(e) => setWhen(e.currentTarget.value)}>
            {OPEN_IN.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          <button class="primary small" disabled={!text.trim()} onClick={() => void seal()}>
            Запечатать
          </button>
        </div>
      </div>
      {state.capsules.length === 0 && <p class="muted">Капсул пока нет.</p>}
      {state.capsules.map((c) => (
        <div key={c.id} class={`capsule${c.opened ? ' opened' : ''}`}>
          <div class="bet-head">
            <b>{c.opened ? '📬 Открыта' : '📦 Запечатана'}</b>
            <span class="muted tiny">
              {new Date(c.createdAt).toLocaleDateString('ru-RU')} → {new Date(c.openAt).toLocaleDateString('ru-RU')} · {where(c.target)}
            </span>
          </div>
          {c.opened ? <p class="capsule-text">{c.text}</p> : <p class="muted tiny">Текст скрыт до открытия.</p>}
        </div>
      ))}
    </>
  );
}
