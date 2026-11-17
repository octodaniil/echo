// Interface sounds, synthesized on the fly (no audio files): short soft tones in the spirit
// of Discord's cues, but our own. The AudioContext is suspended when idle so it costs nothing.
import { settings } from './settings';

export type Cue =
  | 'join'
  | 'leave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'disconnected'
  | 'watchStart'
  | 'viewerJoin'
  | 'achievement';

/** [frequency Hz, start offset s, duration s] */
type Note = [number, number, number];

const CUES: Record<Cue, { notes: Note[]; type: OscillatorType; gain: number }> = {
  join: { notes: [[523.25, 0, 0.12], [783.99, 0.09, 0.2]], type: 'sine', gain: 0.5 },
  leave: { notes: [[783.99, 0, 0.12], [523.25, 0.09, 0.22]], type: 'sine', gain: 0.5 },
  userJoin: { notes: [[659.25, 0, 0.09], [880, 0.07, 0.14]], type: 'triangle', gain: 0.35 },
  userLeave: { notes: [[880, 0, 0.09], [587.33, 0.07, 0.16]], type: 'triangle', gain: 0.35 },
  mute: { notes: [[392, 0, 0.07], [293.66, 0.05, 0.1]], type: 'triangle', gain: 0.45 },
  unmute: { notes: [[293.66, 0, 0.07], [392, 0.05, 0.1]], type: 'triangle', gain: 0.45 },
  deafen: { notes: [[329.63, 0, 0.08], [246.94, 0.06, 0.08], [196, 0.12, 0.14]], type: 'triangle', gain: 0.45 },
  undeafen: { notes: [[196, 0, 0.08], [246.94, 0.06, 0.08], [329.63, 0.12, 0.14]], type: 'triangle', gain: 0.45 },
  // Stream cues are longer and brighter than the voice ones so they stand out.
  streamStart: {
    notes: [[392, 0, 0.12], [523.25, 0.09, 0.12], [659.25, 0.18, 0.12], [1046.5, 0.27, 0.35]],
    type: 'triangle',
    gain: 0.6,
  },
  streamStop: {
    notes: [[1046.5, 0, 0.12], [659.25, 0.09, 0.12], [523.25, 0.18, 0.12], [392, 0.27, 0.3]],
    type: 'triangle',
    gain: 0.6,
  },
  disconnected: { notes: [[440, 0, 0.14], [349.23, 0.12, 0.14], [261.63, 0.24, 0.3]], type: 'sine', gain: 0.5 },
  // You opened someone's stream.
  watchStart: { notes: [[587.33, 0, 0.08], [880, 0.07, 0.08], [1174.66, 0.14, 0.2]], type: 'sine', gain: 0.5 },
  // Someone started watching your stream.
  viewerJoin: { notes: [[880, 0, 0.07], [1174.66, 0.06, 0.16]], type: 'sine', gain: 0.4 },
  achievement: {
    notes: [[523.25, 0, 0.1], [659.25, 0.08, 0.1], [783.99, 0.16, 0.1], [1046.5, 0.24, 0.12], [1318.5, 0.34, 0.4]],
    type: 'sine',
    gain: 0.55,
  },
};

let ctx: AudioContext | null = null;
let sinkId = 'default';
let idleTimer: number | undefined;

async function context(): Promise<AudioContext> {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  const wanted = settings.get().outputDeviceId;
  if (wanted !== sinkId) {
    sinkId = wanted;
    // Same speakers/headphones as voice.
    await (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> })
      .setSinkId?.(wanted === 'default' ? '' : wanted)
      .catch(() => {});
  }
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/** "Do not disturb": cues about other people are silenced, your own actions still click. */
let quiet = false;
const NOISY: Cue[] = ['userJoin', 'userLeave', 'viewerJoin', 'watchStart', 'achievement'];
export function setQuiet(on: boolean) {
  quiet = on;
}

export async function play(cue: Cue) {
  const s = settings.get();
  if (!s.uiSounds || s.uiSoundsVolume <= 0) return;
  if (quiet && NOISY.includes(cue)) return;
  const c = await context();
  const { notes, type, gain } = CUES[cue];
  const t0 = c.currentTime + 0.01;
  const master = c.createGain();
  master.gain.value = gain * s.uiSoundsVolume * 0.6;
  master.connect(c.destination);
  let end = 0;
  for (const [freq, at, dur] of notes) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Soft attack and exponential decay: no clicks.
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(1, t0 + at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(env).connect(master);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.02);
    end = Math.max(end, at + dur);
  }
  // Put the context to sleep shortly after the last sound.
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => void ctx?.suspend(), (end + 1.5) * 1000);
}
