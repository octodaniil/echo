import { useEffect, useState } from 'preact/hooks';
import type { Channel, Session, SessionEndReason } from '../../shared/types';
import { Login } from './Login';
import { Main } from './Shell';
import { voice } from './voice';

const endNotice: Record<SessionEndReason, string | null> = {
  kicked: 'Админ удалил твой аккаунт с сервера',
  invalid: 'Сессия больше не действует, нужен новый инвайт',
  logout: null,
};

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void window.echo.getSession().then(setSession);
    void window.echo.getChannels().then((r) => {
      setChannels(r.channels);
      setOnline(r.online);
    });
    const offs = [
      window.echo.onChannels(setChannels),
      window.echo.onServerStatus(setOnline),
      window.echo.onSessionEnded((reason) => {
        void voice.leave();
        setSession(null);
        setChannels([]);
        setNotice(endNotice[reason]);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

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
  return <Main session={session} channels={channels} online={online} />;
}
