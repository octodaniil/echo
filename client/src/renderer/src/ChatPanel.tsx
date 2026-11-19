import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChatMessage, Look, Prestige } from '../../shared/types';
import { Avatar, Nick } from './Avatar';
import { chat, prepareImage, useChat } from './chatStore';
import { CloseIcon } from './icons';
import { RoleTag, type Role } from './Moderation';
import { attachmentUrl } from './profile';

export interface ChatPerson {
  nickname: string;
  avatar: number | null;
  style?: Look;
  prestige?: Prestige;
  role?: Role;
}

const GROUP_MS = 5 * 60_000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function dayOf(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Text with clickable links and highlighted @mentions. */
function RichText({ text, names, myName }: { text: string; names: string[]; myName: string }) {
  const parts = useMemo(() => {
    const nickAlt = names.length ? `|@(?:${names.map(escapeRe).join('|')})` : '';
    const re = new RegExp(`(https?://[^\\s<]+${nickAlt}|@(?:все|all|everyone))`, 'giu');
    return text.split(re);
  }, [text, names.join('\n')]);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        if (/^https?:\/\//i.test(p)) {
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer">
              {p}
            </a>
          );
        }
        const self = p.slice(1).toLowerCase() === myName.toLowerCase() || /^@(все|all|everyone)$/i.test(p);
        return (
          <span key={i} class={`mention${self ? ' me' : ''}`}>
            {p}
          </span>
        );
      })}
    </>
  );
}

export function ChatPanel({
  conv,
  title,
  me,
  canModerate,
  person,
  people,
  canSeeDeleted,
  onClose,
  onProfile,
}: {
  conv: string;
  title: ComponentChildren;
  me: string;
  /** Staff may delete others' messages in channels. */
  canModerate: boolean;
  person: (id: string) => ChatPerson;
  /** Everyone who can be @mentioned (id + person). */
  people: { id: string; person: ChatPerson }[];
  /** Admin / moderators see "message deleted" placeholders; others don't see them at all. */
  canSeeDeleted: boolean;
  onClose?: () => void;
  onProfile: (id: string) => void;
}) {
  const store = useChat();
  const all = store.messages.get(conv);
  const list = all && (canSeeDeleted ? all : all.filter((m) => !m.deleted));
  const [text, setText] = useState('');
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  /** Image waiting to be sent together with the text (pasted / dropped / picked). */
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  /** @mention autocomplete: what was typed after "@", where it starts, which row is selected. */
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const lastTyping = useRef(0);
  const myName = person(me).nickname;

  useEffect(() => {
    void store.load(conv).catch((e: Error) => setError(e.message));
    store.setOpen(conv);
    stick.current = true;
    setReply(null);
    setEditing(null);
    window.setTimeout(() => input.current?.focus(), 50);
    return () => {
      if (chat.open === conv) chat.setOpen(null);
    };
  }, [conv]);

  // Stay at the bottom for new messages; keep the position when older ones load on top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current && el.scrollHeight > prevHeight.current && el.scrollTop < 40) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevHeight.current = el.scrollHeight;
    if (stick.current && list?.length) store.markRead(conv);
  }, [list?.length, store.version]);

  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 80) void store.loadOlder(conv);
  };

  const names = useMemo(() => {
    const ids = new Set((list ?? []).map((m) => m.author));
    return [...ids].map((id) => person(id).nickname).sort((a, b) => b.length - a.length);
  }, [list?.length]);

  const stage = (file: File) => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending({ file, url: URL.createObjectURL(file) });
    input.current?.focus();
  };

  const send = async () => {
    const body = text;
    const attachment = pending?.file;
    if (busy || (!body.trim() && !attachment)) return;
    setBusy(true);
    setError(null);
    try {
      if (attachment) {
        const img = await prepareImage(attachment);
        await window.echo.chatImage(conv, img.data, img.type, body, reply?.id ?? null, img.w, img.h);
      } else {
        await window.echo.chatSend(conv, body, reply?.id ?? null);
      }
      setText('');
      setReply(null);
      if (pending) URL.revokeObjectURL(pending.url);
      setPending(null);
      stick.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      // The textarea stays enabled while sending, so focus never leaves it.
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  // ---- @mentions ----
  const candidates = mention
    ? [
        ...people
          .filter((p) => p.id !== me && p.person.nickname.toLowerCase().includes(mention.query.toLowerCase()))
          .sort(
            (a, b) =>
              Number(!a.person.nickname.toLowerCase().startsWith(mention.query.toLowerCase())) -
                Number(!b.person.nickname.toLowerCase().startsWith(mention.query.toLowerCase())) ||
              a.person.nickname.localeCompare(b.person.nickname, 'ru'),
          )
          .slice(0, 7),
        ...('все'.startsWith(mention.query.toLowerCase()) && conv.startsWith('ch:')
          ? [{ id: '*', person: { nickname: 'все', avatar: null } as ChatPerson }]
          : []),
      ]
    : [];

  const updateMention = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,32})$/.exec(value.slice(0, caret));
    setMention(m ? { query: m[2]!, start: caret - m[2]!.length - 1, index: 0 } : null);
  };

  const pickMention = (nick: string) => {
    if (!mention) return;
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${nick} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + nick.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (mention && candidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention({ ...mention, index: (mention.index + d + candidates.length) % candidates.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(candidates[mention.index]!.person.nickname);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Escape' && pending) {
      URL.revokeObjectURL(pending.url);
      setPending(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && reply) {
      setReply(null);
    } else if (e.key === 'ArrowUp' && !text) {
      const mine = [...(list ?? [])].reverse().find((m) => m.author === me && !m.deleted && m.text);
      if (mine) {
        e.preventDefault();
        setEditing(mine.id);
        setEditText(mine.text);
        requestAnimationFrame(() =>
          scroller.current?.querySelector('.msg-edit')?.scrollIntoView({ block: 'nearest' }),
        );
      }
    }
  };

  const onInput = (e: JSX.TargetedEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value);
    updateMention(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
    if (Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      void window.echo.chatTyping(conv).catch(() => {});
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      stage(f);
    }
  };

  const saveEdit = async (m: ChatMessage) => {
    try {
      if (editText.trim() && editText !== m.text) await window.echo.chatEdit(m.id, editText);
      setEditing(null);
      requestAnimationFrame(() => input.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const typing = store.typingIn(conv).filter((id) => id !== me);
  const byId = new Map((list ?? []).map((m) => [m.id, m]));

  return (
    <section
      class={`chat-panel${drag ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
        if (f) stage(f);
      }}
    >
      <header class="chat-head">
        <div class="chat-title">{title}</div>
        {onClose && (
          <button class="icon-btn" title="Закрыть чат" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        )}
      </header>

      <div class="chat-scroll" ref={scroller} onScroll={onScroll}>
        {list && store.complete.has(conv) && (
          <div class="chat-start mono">// НАЧАЛО ПЕРЕПИСКИ</div>
        )}
        {!list && <div class="chat-start muted">{error ?? 'Загружаем…'}</div>}
        {(list ?? []).map((m, i) => {
          const prev = list![i - 1];
          const newDay = !prev || dayOf(prev.createdAt) !== dayOf(m.createdAt);
          const grouped = !newDay && prev && prev.author === m.author && m.createdAt - prev.createdAt < GROUP_MS && !m.replyTo;
          const who = person(m.author);
          const mine = m.author === me;
          const parent = m.replyTo ? byId.get(m.replyTo) : undefined;
          return (
            <div key={m.id}>
              {newDay && (
                <div class="chat-day mono">
                  <span>{dayOf(m.createdAt).toUpperCase()}</span>
                </div>
              )}
              <div class={`msg${grouped ? ' grouped' : ''}${m.mentions.includes(me) ? ' mentioned' : ''}${m.deleted ? ' deleted' : ''}`}>
                {grouped ? (
                  <span class="msg-time-side mono">{timeOf(m.createdAt)}</span>
                ) : (
                  <button class="msg-avatar" onClick={() => onProfile(m.author)}>
                    <Avatar id={m.author} name={who.nickname} avatar={who.avatar} size={34} look={who.style} animated={false} />
                  </button>
                )}
                <div class="msg-body">
                  {parent && (
                    <div class="msg-reply">
                      <span class="msg-reply-nick">{person(parent.author).nickname}</span>
                      <span class="msg-reply-text">{parent.deleted ? 'сообщение удалено' : parent.text || '🖼 картинка'}</span>
                    </div>
                  )}
                  {!grouped && (
                    <div class="msg-head">
                      <button class="msg-nick" onClick={() => onProfile(m.author)}>
                        <Nick name={who.nickname} look={who.style} />
                      </button>
                      <RoleTag role={who.role} />
                      <span class="msg-time mono">{timeOf(m.createdAt)}</span>
                    </div>
                  )}
                  {editing === m.id ? (
                    <div class="msg-edit">
                      <textarea
                        value={editText}
                        autoFocus
                        rows={Math.min(6, editText.split('\n').length)}
                        onInput={(e) => setEditText(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void saveEdit(m);
                          } else if (e.key === 'Escape') {
                            setEditing(null);
                            requestAnimationFrame(() => input.current?.focus());
                          }
                        }}
                      />
                      <span class="muted tiny">Enter — сохранить · Esc — отмена</span>
                    </div>
                  ) : m.deleted ? (
                    <div class="msg-text muted">сообщение удалено</div>
                  ) : (
                    m.text && (
                      <div class="msg-text">
                        <RichText text={m.text} names={names} myName={myName} />
                        {m.editedAt && <span class="msg-edited muted"> (изм.)</span>}
                      </div>
                    )
                  )}
                  {m.attachment &&
                    (m.attachment.gone ? (
                      <div class="msg-gone mono">ФАЙЛ УДАЛЁН — СТАРЫЕ ВЛОЖЕНИЯ ЧИСТЯТСЯ АВТОМАТИЧЕСКИ</div>
                    ) : (
                      <button class="msg-image" onClick={() => setViewer(attachmentUrl(m.attachment!.key))}>
                        <img
                          src={attachmentUrl(m.attachment.key)}
                          alt=""
                          loading="lazy"
                          style={
                            m.attachment.w && m.attachment.h
                              ? { aspectRatio: `${m.attachment.w} / ${m.attachment.h}`, width: Math.min(360, m.attachment.w) }
                              : undefined
                          }
                          onLoad={() => {
                            if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
                          }}
                        />
                      </button>
                    ))}
                </div>
                {!m.deleted && editing !== m.id && (
                  <div class="msg-actions">
                    <button
                      title="Ответить"
                      onClick={() => {
                        setReply(m);
                        input.current?.focus();
                      }}
                    >
                      ↩
                    </button>
                    {mine && m.text && (
                      <button
                        title="Изменить"
                        onClick={() => {
                          setEditing(m.id);
                          setEditText(m.text);
                        }}
                      >
                        ✎
                      </button>
                    )}
                    {(mine || canModerate) && (
                      <button
                        title="Удалить"
                        class="danger"
                        onClick={() => {
                          if (confirm('Удалить сообщение?')) void window.echo.chatDelete(m.id).catch((e: Error) => setError(e.message));
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div class="chat-typing mono">
        {typing.length > 0 &&
          `${typing.map((id) => person(id).nickname).join(', ')} ${typing.length > 1 ? 'печатают' : 'печатает'}…`}
      </div>

      <footer class="chat-compose">
        {reply && (
          <div class="compose-reply">
            <span>
              Ответ <b>{person(reply.author).nickname}</b>: {reply.text.slice(0, 80) || '🖼 картинка'}
            </span>
            <button class="icon-btn" title="Отменить ответ" onClick={() => setReply(null)}>
              <CloseIcon size={14} />
            </button>
          </div>
        )}
        {error && <div class="compose-error">{error}</div>}
        {pending && (
          <div class="compose-pending">
            <img src={pending.url} alt="" />
            <span class="muted tiny">
              Картинка добавлена — напиши подпись или просто нажми Enter. Esc — убрать.
            </span>
            <button
              class="icon-btn"
              title="Убрать картинку"
              onClick={() => {
                URL.revokeObjectURL(pending.url);
                setPending(null);
                input.current?.focus();
              }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}
        {mention && candidates.length > 0 && (
          <div class="mention-list">
            {candidates.map((c, i) => (
              <button
                key={c.id}
                class={`mention-item${i === mention.index ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(c.person.nickname);
                }}
                onMouseEnter={() => setMention({ ...mention, index: i })}
              >
                {c.id === '*' ? (
                  <span class="mention-all mono">@</span>
                ) : (
                  <Avatar id={c.id} name={c.person.nickname} avatar={c.person.avatar} size={22} animated={false} />
                )}
                <Nick name={c.person.nickname} look={c.person.style} />
                <RoleTag role={c.person.role} />
                {c.id === '*' && <span class="muted tiny">упомянуть всех в канале</span>}
              </button>
            ))}
          </div>
        )}
        <div class="compose-row">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) stage(f);
            }}
          />
          <button class="compose-attach" title="Картинка или GIF (можно вставить Ctrl+V или перетащить)" onClick={() => file.current?.click()}>
            +
          </button>
          <textarea
            ref={input}
            value={text}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            maxLength={2000}
            placeholder="Сообщение… (@ — упомянуть, ↑ — изменить последнее)"
            onInput={onInput}
            onClick={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          <button class="compose-send" title="Отправить (Enter)" disabled={busy || (!text.trim() && !pending)} onClick={() => void send()}>
            ➤
          </button>
        </div>
      </footer>

      {viewer && (
        <div class="image-viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
        </div>
      )}
    </section>
  );
}
