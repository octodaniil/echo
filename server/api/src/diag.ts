import { db } from './db.ts';

/**
 * Diagnostics reports from clients: what Echo had to fix by itself (mic restarted, voice
 * stopped leaving, a friend's audio stuck) and manual «Меня не слышно» reports. Lets the
 * admin see what really happens on friends' PCs. Only the last 2000 are kept.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS diag_reports (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at       INTEGER NOT NULL,
    kind     TEXT NOT NULL,
    version  TEXT NOT NULL DEFAULT '',
    data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS diag_reports_at ON diag_reports (at);
`);

const q = {
  insert: db.prepare('INSERT INTO diag_reports (user_id, at, kind, version, data) VALUES (?, ?, ?, ?, ?)'),
  recentOf: db.prepare('SELECT COUNT(*) AS n FROM diag_reports WHERE user_id = ? AND at > ?'),
  trim: db.prepare('DELETE FROM diag_reports WHERE id <= (SELECT MAX(id) FROM diag_reports) - 2000'),
  list: db.prepare(
    `SELECT d.id, d.user_id, u.nickname, d.at, d.kind, d.version, d.data
     FROM diag_reports d JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT ?`,
  ),
};

export function addReport(userId: string, kind: string, version: string, data: unknown) {
  // At most 60 an hour per person, 8 KB each.
  if ((q.recentOf.get(userId, Date.now() - 3_600_000) as { n: number }).n >= 60) return false;
  const json = JSON.stringify(data ?? {}).slice(0, 8000);
  q.insert.run(userId, Date.now(), kind.slice(0, 40), version.slice(0, 20), json);
  q.trim.run();
  return true;
}

export function listReports(limit = 300) {
  return (q.list.all(limit) as { id: number; user_id: string; nickname: string; at: number; kind: string; version: string; data: string }[]).map(
    (r) => ({ id: r.id, userId: r.user_id, nickname: r.nickname, at: r.at, kind: r.kind, version: r.version, data: JSON.parse(r.data) as unknown }),
  );
}
