import { useEffect, useState } from 'preact/hooks';
import type { ChatEvent, ChatMessage, ChatState } from '../../shared/types';

/**
 * Chat state for the whole app: loaded pages per conversation, unread / mention counters,
 * private conversations, who is typing. Pushes Windows notifications for private messages
 * and @mentions while Echo isn't in front (not in "do not disturb").
 */
class ChatStore {
  me = '';
  readonly messages = new Map<string, ChatMessage[]>();
  /** Conversations whose oldest message is already loaded. */
  readonly complete = new Set<string>();
  readonly counters = new Map<string, { unread: number; mentions: number }>();
  dms: ChatState['dms'] = [];
  readonly typing = new Map<string, Map<string, number>>();
  /** Conversation on screen right now (counts as read while the window is focused). */
  open: string | null = null;
  dnd = false;
  nameOf: (id: string) => string = () => 'кто-то';
  onOpenRequest: (conv: string) => void = () => {};

  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  version = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  async start(me: string) {
    this.stop();
    this.me = me;
    this.offs.push(
      window.echo.onChat((e) => this.onEvent(e)),
      window.echo.onChatTyping(({ conv, userId }) => {
        const map = this.typing.get(conv) ?? new Map<string, number>();
        map.set(userId, Date.now() + 4000);
        this.typing.set(conv, map);
        this.emit();
        window.setTimeout(() => this.emit(), 4100);
      }),
    );
    const onFocus = () => this.open && this.markRead(this.open);
    window.addEventListener('focus', onFocus);
    this.offs.push(() => window.removeEventListener('focus', onFocus));
    await this.refresh();
  }

  stop() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  async refresh() {
    const state = await window.echo.chatState().catch(() => null);
    if (!state) return;
    this.counters.clear();
    for (const u of state.unread) this.counters.set(u.conv, { unread: u.unread, mentions: u.mentions });
    this.dms = state.dms;
    this.emit();
  }

  typingIn(conv: string): string[] {
    const now = Date.now();
    return [...(this.typing.get(conv) ?? [])].filter(([, until]) => until > now).map(([id]) => id);
  }

  unreadOf(conv: string) {
    return this.counters.get(conv) ?? { unread: 0, mentions: 0 };
  }

  /** Total unread in private chats + mentions anywhere (for the tray / sidebar badge). */
  get attention() {
    let n = 0;
    for (const [conv, c] of this.counters) n += conv.startsWith('dm:') ? c.unread : c.mentions;
    return n;
  }

  async load(conv: string) {
    if (this.messages.has(conv)) return;
    const { messages } = await window.echo.chatHistory(conv);
    this.messages.set(conv, messages);
    if (messages.length < 50) this.complete.add(conv);
    this.emit();
  }

  async loadOlder(conv: string) {
    const list = this.messages.get(conv);
    if (!list || this.complete.has(conv) || list.length === 0) return;
    const { messages } = await window.echo.chatHistory(conv, list[0]!.id);
    if (messages.length < 50) this.complete.add(conv);
    this.messages.set(conv, [...messages, ...list]);
    this.emit();
  }

  setOpen(conv: string | null) {
    this.open = conv;
    if (conv) this.markRead(conv);
  }

  markRead(conv: string) {
    const list = this.messages.get(conv);
    const last = list?.at(-1);
    const c = this.counters.get(conv);
    if (c && (c.unread || c.mentions)) {
      this.counters.set(conv, { unread: 0, mentions: 0 });
      this.dms = this.dms.map((d) => (d.conv === conv ? { ...d, unread: 0 } : d));
      this.emit();
    }
    if (last && document.hasFocus()) void window.echo.chatRead(conv, last.id).catch(() => {});
  }

  private onEvent(e: ChatEvent) {
    if (e.type === 'cleared') {
      this.messages.set(e.conv, []);
      this.complete.add(e.conv);
      this.counters.delete(e.conv);
      this.emit();
      return;
    }
    const m = e.message;
    const list = this.messages.get(m.conv);
    if (e.type === 'new') {
      if (list && !list.some((x) => x.id === m.id)) list.push(m);
      this.typing.get(m.conv)?.delete(m.author);
      if (m.conv.startsWith('dm:')) {
        const other = m.conv.slice(3).split('|').find((p) => p !== this.me) ?? this.me;
        const prev = this.dms.find((d) => d.conv === m.conv);
        this.dms = [
          { conv: m.conv, with: other, unread: prev?.unread ?? 0, last: m },
          ...this.dms.filter((d) => d.conv !== m.conv),
        ];
      }
      if (m.author !== this.me) {
        const visible = this.open === m.conv && document.hasFocus();
        if (visible) {
          void window.echo.chatRead(m.conv, m.id).catch(() => {});
        } else {
          const c = this.counters.get(m.conv) ?? { unread: 0, mentions: 0 };
          const mentioned = m.mentions.includes(this.me);
          this.counters.set(m.conv, { unread: c.unread + 1, mentions: c.mentions + (mentioned ? 1 : 0) });
          if (m.conv.startsWith('dm:')) this.dms = this.dms.map((d) => (d.conv === m.conv ? { ...d, unread: d.unread + 1 } : d));
          if (m.conv.startsWith('dm:') || mentioned) this.notify(m, mentioned);
        }
      }
    } else if (list) {
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) list[i] = m;
    }
    this.emit();
  }

  private notify(m: ChatMessage, mentioned: boolean) {
    if (this.dnd) return;
    void window.echo.flashWindow().catch(() => {});
    if (document.hasFocus()) return;
    try {
      const who = this.nameOf(m.author);
      const n = new Notification(m.conv.startsWith('dm:') ? who : `${who} упомянул тебя`, {
        body: m.text || (m.attachment ? '🖼 Картинка' : ''),
        silent: false,
      });
      n.onclick = () => {
        void window.echo.showWindow();
        this.onOpenRequest(m.conv);
      };
    } catch {
      // Notifications unavailable: the taskbar still blinks.
    }
    void mentioned;
  }
}

export const chat = new ChatStore();

export function useChat() {
  const [, set] = useState(0);
  useEffect(() => chat.subscribe(() => set(chat.version)), []);
  return chat;
}

export const dmConv = (a: string, b: string) => `dm:${[a, b].sort().join('|')}`;

/** Static pictures -> WebP, longest side ≤ 1600 px. GIF / animated WebP go as they are. */
export async function prepareImage(file: File): Promise<{ data: Uint8Array; type: string; w: number; h: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Можно отправлять только картинки');
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const head = new TextDecoder('ascii').decode(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  const animated = file.type === 'image/gif' || (file.type === 'image/webp' && head.includes('ANIM'));
  if (animated) {
    bitmap.close();
    if (file.size > 10 * 1024 * 1024) throw new Error('Анимация больше 10 МБ');
    return { data: new Uint8Array(await file.arrayBuffer()), type: file.type, w: width, h: height };
  }
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp', w, h };
}
