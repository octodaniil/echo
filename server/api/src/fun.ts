import { db, queries, type User } from './db.ts';
import * as weekly from './weekly.ts';

/**
 * Evening games with no money involved: «искры» (sparks) are a play currency.
 *  - Bets: anyone opens a question with 2–4 answers, friends stake sparks, the author settles
 *    it; the pot is split among the winners in proportion to their stakes.
 *  - Predictions: before 21:00 guess who takes tonight's crowns (talk / stream); a right guess
 *    pays sparks once the evening is over.
 *  - Time capsules: a message sealed until a date, then delivered to you or posted in a channel.
 */

export const START_SPARKS = 500;
const DAILY_SPARKS = 50;
const POOR_FLOOR = 50;
const PREDICT_PRIZE = 100;
/** Predictions are taken from 15:00 until 03:00 (server time); results come the next day. */
const PREDICT_OPEN_HOUR = 15;
const PREDICT_CLOSE_HOUR = 3;
const MIN_STAKE = 10;

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sparks     INTEGER NOT NULL,
    last_daily TEXT NOT NULL DEFAULT '',
    bets_won   INTEGER NOT NULL DEFAULT 0,
    predicted  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    author      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    options     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    winner      INTEGER,
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS bet_stakes (
    bet_id  INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option  INTEGER NOT NULL,
    amount  INTEGER NOT NULL,
    payout  INTEGER,
    PRIMARY KEY (bet_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS predictions (
    evening  TEXT NOT NULL,
    kind     TEXT NOT NULL,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pick     TEXT NOT NULL,
    result   INTEGER,
    PRIMARY KEY (evening, kind, user_id)
  );
  CREATE TABLE IF NOT EXISTS capsules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    target     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    open_at    INTEGER NOT NULL,
    opened     INTEGER NOT NULL DEFAULT 0
  );
`);

const q = {
  wallet: db.prepare('SELECT sparks, last_daily, bets_won, predicted FROM wallets WHERE user_id = ?'),
  newWallet: db.prepare('INSERT OR IGNORE INTO wallets (user_id, sparks) VALUES (?, ?)'),
  setSparks: db.prepare('UPDATE wallets SET sparks = ? WHERE user_id = ?'),
  addSparks: db.prepare('UPDATE wallets SET sparks = sparks + ? WHERE user_id = ?'),
  setDaily: db.prepare('UPDATE wallets SET last_daily = ?, sparks = ? WHERE user_id = ?'),
  wonBet: db.prepare('UPDATE wallets SET bets_won = bets_won + 1 WHERE user_id = ?'),
  predictedRight: db.prepare('UPDATE wallets SET predicted = predicted + 1 WHERE user_id = ?'),
  rich: db.prepare('SELECT w.user_id, w.sparks, u.nickname FROM wallets w JOIN users u ON u.id = w.user_id ORDER BY w.sparks DESC LIMIT 5'),

  newBet: db.prepare('INSERT INTO bets (author, question, options, created_at) VALUES (?, ?, ?, ?)'),
  bet: db.prepare('SELECT * FROM bets WHERE id = ?'),
  recentBets: db.prepare(
    "SELECT * FROM bets WHERE status IN ('open', 'locked') OR resolved_at > ? ORDER BY CASE WHEN status IN ('open','locked') THEN 0 ELSE 1 END, id DESC LIMIT 20",
  ),
  setBetStatus: db.prepare('UPDATE bets SET status = ?, winner = ?, resolved_at = ? WHERE id = ?'),
  stakes: db.prepare('SELECT user_id, option, amount, payout FROM bet_stakes WHERE bet_id = ?'),
  stake: db.prepare('SELECT option, amount FROM bet_stakes WHERE bet_id = ? AND user_id = ?'),
  putStake: db.prepare(
    'INSERT INTO bet_stakes (bet_id, user_id, option, amount) VALUES (?, ?, ?, ?) ON CONFLICT(bet_id, user_id) DO UPDATE SET amount = amount + excluded.amount',
  ),
  setPayout: db.prepare('UPDATE bet_stakes SET payout = ? WHERE bet_id = ? AND user_id = ?'),

  predict: db.prepare(
    'INSERT INTO predictions (evening, kind, user_id, pick) VALUES (?, ?, ?, ?) ON CONFLICT(evening, kind, user_id) DO UPDATE SET pick = excluded.pick',
  ),
  predictionsOf: db.prepare('SELECT kind, user_id, pick FROM predictions WHERE evening = ?'),
  resultsOf: db.prepare('SELECT kind, user_id, pick, result FROM predictions WHERE evening = ? AND result IS NOT NULL'),
  unresolvedEvenings: db.prepare('SELECT DISTINCT evening FROM predictions WHERE result IS NULL AND evening < ?'),
  unresolved: db.prepare('SELECT kind, user_id, pick FROM predictions WHERE evening = ? AND result IS NULL'),
  setResult: db.prepare('UPDATE predictions SET result = ? WHERE evening = ? AND kind = ? AND user_id = ?'),

  newCapsule: db.prepare('INSERT INTO capsules (author, text, target, created_at, open_at) VALUES (?, ?, ?, ?, ?)'),
  dueCapsules: db.prepare('SELECT * FROM capsules WHERE opened = 0 AND open_at <= ?'),
  openCapsule: db.prepare('UPDATE capsules SET opened = 1 WHERE id = ?'),
  myCapsules: db.prepare('SELECT * FROM capsules WHERE author = ? OR (target = ? AND opened = 1) ORDER BY open_at DESC LIMIT 50'),
};

type BetRow = {
  id: number;
  author: string;
  question: string;
  options: string;
  status: 'open' | 'locked' | 'resolved' | 'cancelled';
  winner: number | null;
  created_at: number;
  resolved_at: number | null;
};
type CapsuleRow = { id: number; author: string; text: string; target: string; created_at: number; open_at: number; opened: number };

const nick = (id: string) => (queries.userById.get(id) as User | undefined)?.nickname ?? 'кто-то';

// ---------------- events ----------------

type FunEvent =
  | { type: 'changed' }
  | { type: 'bet-won'; userId: string; amount: number; question: string }
  | { type: 'predicted'; userId: string; kind: string; amount: number }
  | { type: 'capsule'; capsule: CapsuleRow }
  | { type: 'results' };
let listener: (e: FunEvent) => void = () => {};
export function setFunListener(fn: (e: FunEvent) => void) {
  listener = fn;
}
/** Achievements hook, set by achievements.ts consumers (avoids an import cycle). */
let onCounter: (userId: string, kind: 'bets' | 'predictions', value: number) => void = () => {};
export function setFunCounterListener(fn: typeof onCounter) {
  onCounter = fn;
}

// ---------------- wallet ----------------

/** Wallet with today's bonus applied (and a floor so nobody is out of the game for long). */
export function wallet(userId: string) {
  q.newWallet.run(userId, START_SPARKS);
  const w = q.wallet.get(userId) as { sparks: number; last_daily: string; bets_won: number; predicted: number };
  const today = weekly.eveningKey();
  if (w.last_daily !== today) {
    w.sparks = Math.max(POOR_FLOOR, w.sparks + DAILY_SPARKS);
    q.setDaily.run(today, w.sparks, userId);
  }
  return { sparks: w.sparks, betsWon: w.bets_won, predicted: w.predicted };
}

export const betsWon = (userId: string) => (q.wallet.get(userId) as { bets_won: number } | undefined)?.bets_won ?? 0;
export const predictedRight = (userId: string) => (q.wallet.get(userId) as { predicted: number } | undefined)?.predicted ?? 0;

// ---------------- bets ----------------

function betView(b: BetRow, viewer: string) {
  const options = JSON.parse(b.options) as string[];
  const stakes = q.stakes.all(b.id) as { user_id: string; option: number; amount: number; payout: number | null }[];
  return {
    id: b.id,
    author: b.author,
    authorName: nick(b.author),
    question: b.question,
    status: b.status,
    winner: b.winner,
    createdAt: b.created_at,
    options: options.map((title, i) => {
      const on = stakes.filter((s) => s.option === i);
      return {
        title,
        total: on.reduce((a, s) => a + s.amount, 0),
        people: on.map((s) => ({ id: s.user_id, nickname: nick(s.user_id), amount: s.amount, payout: s.payout })),
      };
    }),
    pot: stakes.reduce((a, s) => a + s.amount, 0),
    mine: stakes.find((s) => s.user_id === viewer) ?? null,
  };
}

export function bets(viewer: string) {
  return (q.recentBets.all(Date.now() - 3 * 86_400_000) as BetRow[]).map((b) => betView(b, viewer));
}

export function createBet(author: string, question: string, options: string[]) {
  question = question.trim();
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (question.length < 3) throw new Error('Вопрос слишком короткий');
  if (opts.length < 2 || opts.length > 4) throw new Error('Нужно от 2 до 4 вариантов');
  if (new Set(opts).size !== opts.length) throw new Error('Варианты повторяются');
  const res = q.newBet.run(author, question.slice(0, 140), JSON.stringify(opts.map((o) => o.slice(0, 60))), Date.now());
  listener({ type: 'changed' });
  return Number(res.lastInsertRowid);
}

export function placeStake(userId: string, betId: number, option: number, amount: number) {
  const b = q.bet.get(betId) as BetRow | undefined;
  if (!b) throw new Error('Спор не найден');
  if (b.status !== 'open') throw new Error('Ставки уже не принимаются');
  const options = JSON.parse(b.options) as string[];
  if (!Number.isInteger(option) || option < 0 || option >= options.length) throw new Error('Нет такого варианта');
  amount = Math.floor(amount);
  if (amount < MIN_STAKE) throw new Error(`Минимальная ставка — ${MIN_STAKE} искр`);
  const prev = q.stake.get(betId, userId) as { option: number } | undefined;
  if (prev && prev.option !== option) throw new Error('Ты уже поставил на другой вариант');
  const w = wallet(userId);
  if (w.sparks < amount) throw new Error('Не хватает искр');
  db.exec('BEGIN');
  try {
    q.addSparks.run(-amount, userId);
    q.putStake.run(betId, userId, option, amount);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  listener({ type: 'changed' });
}

/** Author (or staff) stops accepting stakes, settles with a winning option, or cancels. */
export function settleBet(user: User, betId: number, action: 'lock' | 'resolve' | 'cancel', winner?: number) {
  const b = q.bet.get(betId) as BetRow | undefined;
  if (!b) throw new Error('Спор не найден');
  if (b.author !== user.id && !user.is_admin && !user.is_moderator) throw new Error('Закрыть спор может только его автор');
  if (b.status === 'resolved' || b.status === 'cancelled') throw new Error('Спор уже закрыт');
  const stakes = q.stakes.all(betId) as { user_id: string; option: number; amount: number }[];
  if (action === 'lock') {
    q.setBetStatus.run('locked', null, null, betId);
    listener({ type: 'changed' });
    return;
  }
  db.exec('BEGIN');
  try {
    if (action === 'cancel') {
      for (const s of stakes) {
        q.addSparks.run(s.amount, s.user_id);
        q.setPayout.run(s.amount, betId, s.user_id);
      }
      q.setBetStatus.run('cancelled', null, Date.now(), betId);
    } else {
      const options = JSON.parse(b.options) as string[];
      if (winner === undefined || winner < 0 || winner >= options.length) throw new Error('Выбери победивший вариант');
      const pot = stakes.reduce((a, s) => a + s.amount, 0);
      const winners = stakes.filter((s) => s.option === winner);
      const onWinner = winners.reduce((a, s) => a + s.amount, 0);
      for (const s of stakes) {
        // Nobody guessed: everyone gets their stake back.
        const payout = onWinner === 0 ? s.amount : s.option === winner ? Math.floor((pot * s.amount) / onWinner) : 0;
        if (payout) q.addSparks.run(payout, s.user_id);
        q.setPayout.run(payout, betId, s.user_id);
      }
      q.setBetStatus.run('resolved', winner, Date.now(), betId);
      if (onWinner > 0) {
        for (const s of winners) {
          q.wonBet.run(s.user_id);
          const payout = Math.floor((pot * s.amount) / onWinner);
          queueMicrotask(() => {
            listener({ type: 'bet-won', userId: s.user_id, amount: payout, question: b.question });
            onCounter(s.user_id, 'bets', betsWon(s.user_id));
          });
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  listener({ type: 'changed' });
}

// ---------------- predictions ----------------

export function predictionsState(viewer: string) {
  const evening = weekly.eveningKey();
  const rows = q.predictionsOf.all(evening) as { kind: string; user_id: string; pick: string }[];
  const tally = (kind: string) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.kind === kind) m.set(r.pick, (m.get(r.pick) ?? 0) + 1);
    return [...m].map(([id, votes]) => ({ id, nickname: nick(id), votes })).sort((a, b) => b.votes - a.votes);
  };
  return {
    evening,
    open: predictionsOpen(),
    opensAtHour: PREDICT_OPEN_HOUR,
    closesAtHour: PREDICT_CLOSE_HOUR,
    last: lastResults(),
    prize: PREDICT_PRIZE,
    mine: Object.fromEntries(rows.filter((r) => r.user_id === viewer).map((r) => [r.kind, r.pick])),
    tally: { talk: tally('talk'), stream: tally('stream') },
    crowns: weekly.crownOfEvening(evening),
  };
}

const predictionsOpen = () => {
  const h = weekly.localHour();
  return h >= PREDICT_OPEN_HOUR || h < PREDICT_CLOSE_HOUR;
};

/** Yesterday evening's crowns and who guessed them (shown the next day). */
function lastResults() {
  const evening = weekly.eveningKey(Date.now() - 86_400_000);
  const rows = q.resultsOf.all(evening) as { kind: 'talk' | 'stream'; user_id: string; pick: string; result: number }[];
  const crowns = weekly.crownOfEvening(evening);
  const of = (kind: 'talk' | 'stream') => ({
    winner: crowns[kind] ? { id: crowns[kind], nickname: nick(crowns[kind]!) } : null,
    guessed: rows.filter((r) => r.kind === kind && r.result === 1).map((r) => nick(r.user_id)),
    votes: rows.filter((r) => r.kind === kind).length,
  });
  return { evening, talk: of('talk'), stream: of('stream') };
}

export function predict(userId: string, kind: 'talk' | 'stream', pick: string) {
  if (!predictionsOpen()) throw new Error(`Прогнозы принимаются с ${PREDICT_OPEN_HOUR}:00 до 0${PREDICT_CLOSE_HOUR}:00 ночи`);
  if (!queries.userById.get(pick)) throw new Error('Нет такого человека');
  q.predict.run(weekly.eveningKey(), kind, userId, pick);
  listener({ type: 'changed' });
}

/** Pays out predictions of evenings that are over. Runs on a timer. */
export function resolvePredictions() {
  const today = weekly.eveningKey();
  let announce = false;
  for (const { evening } of q.unresolvedEvenings.all(today) as { evening: string }[]) {
    const crowns = weekly.crownOfEvening(evening);
    announce = true;
    for (const r of q.unresolved.all(evening) as { kind: 'talk' | 'stream'; user_id: string; pick: string }[]) {
      const right = crowns[r.kind] === r.pick;
      q.setResult.run(right ? 1 : 0, evening, r.kind, r.user_id);
      if (right) {
        wallet(r.user_id);
        q.addSparks.run(PREDICT_PRIZE, r.user_id);
        q.predictedRight.run(r.user_id);
        listener({ type: 'predicted', userId: r.user_id, kind: r.kind, amount: PREDICT_PRIZE });
        onCounter(r.user_id, 'predictions', predictedRight(r.user_id));
      }
    }
  }
  if (announce) listener({ type: 'results' });
}

// ---------------- time capsules ----------------

const CAPSULE_MIN = 60 * 60_000;
const CAPSULE_MAX = 3 * 365 * 86_400_000;

export function sealCapsule(author: string, text: string, target: string, openAt: number) {
  text = text.trim();
  if (!text) throw new Error('Капсула пустая');
  if (text.length > 2000) throw new Error('Слишком длинно — до 2000 символов');
  const now = Date.now();
  if (openAt - now < CAPSULE_MIN) throw new Error('Капсула открывается не раньше чем через час');
  if (openAt - now > CAPSULE_MAX) throw new Error('Не дальше чем на 3 года вперёд');
  if (target !== 'me' && !target.startsWith('ch:')) throw new Error('Куда доставить?');
  const res = q.newCapsule.run(author, text, target === 'me' ? author : target, now, openAt);
  return Number(res.lastInsertRowid);
}

/** Your capsules: sealed ones show only the date (the text stays secret even from you). */
export function capsulesOf(userId: string) {
  return (q.myCapsules.all(userId, userId) as CapsuleRow[]).map((c) => ({
    id: c.id,
    target: c.target === userId ? 'me' : c.target,
    createdAt: c.created_at,
    openAt: c.open_at,
    opened: !!c.opened,
    text: c.opened ? c.text : null,
  }));
}

export function openDueCapsules() {
  for (const c of q.dueCapsules.all(Date.now()) as CapsuleRow[]) {
    q.openCapsule.run(c.id);
    listener({ type: 'capsule', capsule: c });
  }
}

export const capsuleText = (c: CapsuleRow) =>
  `📦 Капсула времени от ${nick(c.author)}, запечатана ${new Date(c.created_at).toLocaleDateString('ru-RU', { timeZone: process.env.ECHO_TZ ?? 'Europe/Moscow' })}:\n\n${c.text}`;

export function richest() {
  return q.rich.all() as { user_id: string; sparks: number; nickname: string }[];
}
