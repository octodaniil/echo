import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.ts';
import { db } from './db.ts';

/**
 * Nightly copy of the database (users, achievements, chat history…) into data/backups,
 * keeping the last 7. `VACUUM INTO` makes a consistent snapshot while the server runs.
 * Avatars, banners and chat images are plain files next to it and are not copied here.
 */
export const backupDir = join(dirname(config.dbPath), 'backups');
const KEEP = 7;
const DAY = 86_400_000;

function list() {
  mkdirSync(backupDir, { recursive: true });
  return readdirSync(backupDir)
    .filter((f) => /^echo-\d{8}-\d{4}\.db$/.test(f))
    .sort();
}

export function backupNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `echo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.db`;
  const file = join(backupDir, name);
  list();
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = list();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) rmSync(join(backupDir, old), { force: true });
  return file;
}

/** Makes a backup when the newest one is older than a day; checks every hour. */
export function startBackups(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  const check = () => {
    try {
      const all = list();
      const newest = all.at(-1);
      if (newest && Date.now() - statSync(join(backupDir, newest)).mtimeMs < DAY) return;
      log.info({ file: backupNow() }, 'database backup made');
    } catch (err) {
      log.warn({ err }, 'database backup failed');
    }
  };
  check();
  setInterval(check, 3_600_000).unref();
}
