import { app, safeStorage } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { User } from '../shared/types';

interface StoredSession {
  serverUrl: string;
  user: User;
  /** API token, encrypted with the OS keychain (DPAPI on Windows) when available. */
  token: string;
  encrypted: boolean;
}

export interface ActiveSession {
  serverUrl: string;
  user: User;
  token: string;
}

const file = () => join(app.getPath('userData'), 'session.json');

export function loadSession(): ActiveSession | null {
  try {
    const stored = JSON.parse(readFileSync(file(), 'utf8')) as StoredSession;
    const token = stored.encrypted
      ? safeStorage.decryptString(Buffer.from(stored.token, 'base64'))
      : stored.token;
    return { serverUrl: stored.serverUrl, user: stored.user, token };
  } catch {
    return null;
  }
}

export async function saveSession(session: ActiveSession): Promise<void> {
  const encrypted = safeStorage.isEncryptionAvailable();
  const stored: StoredSession = {
    serverUrl: session.serverUrl,
    user: session.user,
    token: encrypted ? safeStorage.encryptString(session.token).toString('base64') : session.token,
    encrypted,
  };
  await writeFile(file(), JSON.stringify(stored), 'utf8');
}

export async function clearSession(): Promise<void> {
  await rm(file(), { force: true });
}

/** Accepts "echo-voice.duckdns.org:8443", "https://host:8443/", etc. */
export function normalizeServerUrl(input: string): string {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  return url.origin;
}
