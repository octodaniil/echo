import { useEffect, useState } from 'preact/hooks';
import type { Channel, PresenceUser, Session, SessionEndReason } from '../../shared/types';
import { installAppSync } from './appSync';
import { Login } from './Login';
import { setServerUrl } from './profile';
import { ServerDown } from './ServerDown';
import { Main } from './Shell';
import { voice } from './voice';

const endNotice: Record<SessionEndReason, string | null> = {
  kicked: 'Админ удалил твой аккаунт с сервера',
  invalid: 'Сессия больше не действует, нужен новый инвайт',
  logout: null,
};

export function App() {
  const [session, setSessionState] = useState<Session | null | undefined>(undefined);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Show the "server is off" screen only after a few seconds offline (not on brief blips or startup).
  const [serverDown, setServerDown] = useState(false);
  useEffect(() => {
    if (online || !session) {
      setServerDown(false);
      return;
    }
    const t = window.setTimeout(() => setServerDown(true), 4000);
    return () => clearTimeout(t);
  }, [online, session]);

  const setSession = (s: Session | null) => {
    if (s) setServerUrl(s.serverUrl);
    setSessionState(s);
  };

  useEffect(() => {
    installAppSync();
    void window.echo.getSession().then(setSession);
    void window.echo.getPresence().then(setPresence);
    void window.echo.getChannels().then((r) => {
      setChannels(r.channels);
      setOnline(r.online);
    });
    const offs = [
      window.echo.onChannels(setChannels),
      window.echo.onPresence(setPresence),
      window.echo.onServerStatus(setOnline),
      window.echo.onSessionEnded((reason) => {
        void voice.leave();
        setSession(null);
        setChannels([]);
        setPresence([]);
        setNotice(endNotice[reason]);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Fade the splash out once we know whether to show login or the app.
  useEffect(() => {
    if (session === undefined) return;
    const splash = document.getElementById('splash');
    if (!splash) return;
    // Keep it up for at least ~1.8 s from launch: the app loads so fast it only flashed.
    const wait = Math.max(0, 1800 - performance.now());
    const t1 = window.setTimeout(() => splash.classList.add('gone'), wait);
    const t2 = window.setTimeout(() => splash.remove(), wait + 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [session === undefined]);

  if (session === undefined) return null;
  if (session === null) {
    return (
      <Login
        notice={notice}
        onDone={(s) => {
          setNotice(null);
          setSession(s);
        }}
      />
    );
  }
  return (
    <>
      <Main session={session} channels={channels} presence={presence} online={online} onSession={setSession} />
      {serverDown && <ServerDown serverUrl={session.serverUrl} />}
    </>
  );
}
