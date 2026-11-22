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

/**
 * Entry sounds (cosmetic, unlocked by level): the higher the level, the bigger the entrance.
 * notes: [freq, at, dur]; sweep: a pitch glide [from, to, at, dur]; layers add a detuned voice.
 */
interface Entry {
  notes: Note[];
  type: OscillatorType;
  gain: number;
  sweeps?: [number, number, number, number][];
  detune?: number;
  sub?: boolean;
}
const ENTRY: Record<string, Entry> = {
  chime: { notes: [[1318.5, 0, 0.5], [1975.5, 0.06, 0.6]], type: 'sine', gain: 0.4 },
  blip: { notes: [[880, 0, 0.06], [1760, 0.07, 0.08]], type: 'square', gain: 0.18 },
  rise: { notes: [[523.25, 0, 0.1], [659.25, 0.08, 0.1], [987.77, 0.16, 0.25]], type: 'triangle', gain: 0.4 },
  arp: {
    notes: [[392, 0, 0.09], [493.88, 0.07, 0.09], [587.33, 0.14, 0.09], [783.99, 0.21, 0.09], [987.77, 0.28, 0.3]],
    type: 'triangle',
    gain: 0.4,
  },
  radar: { notes: [[1500, 0, 0.08], [1500, 0.22, 0.08], [2000, 0.44, 0.35]], type: 'sine', gain: 0.32, detune: 6 },
  warp: { notes: [[1046.5, 0.32, 0.35]], type: 'sawtooth', gain: 0.16, sweeps: [[120, 1200, 0, 0.34]], detune: 8 },
  chord: {
    notes: [[261.63, 0, 0.7], [329.63, 0.03, 0.7], [392, 0.06, 0.7], [523.25, 0.09, 0.8]],
    type: 'triangle',
    gain: 0.3,
    detune: 7,
  },
  fanfare: {
    notes: [[392, 0, 0.12], [392, 0.13, 0.08], [523.25, 0.22, 0.14], [659.25, 0.36, 0.14], [783.99, 0.5, 0.55], [1046.5, 0.5, 0.55]],
    type: 'sawtooth',
    gain: 0.14,
    detune: 5,
  },
  portal: {
    notes: [[659.25, 0.4, 0.5], [987.77, 0.45, 0.5], [1318.5, 0.5, 0.6]],
    type: 'sine',
    gain: 0.35,
    sweeps: [[1800, 200, 0, 0.4]],
    detune: 9,
    sub: true,
  },
  hyper: {
    notes: [[523.25, 0.5, 0.6], [783.99, 0.5, 0.6], [1046.5, 0.56, 0.7], [2093, 0.62, 0.5]],
    type: 'sawtooth',
    gain: 0.13,
    sweeps: [[80, 2400, 0, 0.5]],
    detune: 10,
    sub: true,
  },
  nova: {
    notes: [[220, 0, 0.9], [440, 0.25, 0.8], [659.25, 0.35, 0.8], [880, 0.45, 0.8], [1318.5, 0.55, 0.9]],
    type: 'sawtooth',
    gain: 0.12,
    sweeps: [[3000, 300, 0.05, 0.3]],
    detune: 12,
    sub: true,
  },
  singularity: {
    notes: [[130.81, 0.55, 1.1], [261.63, 0.6, 1], [392, 0.65, 1], [523.25, 0.7, 1], [783.99, 0.75, 1], [1046.5, 0.8, 1.1]],
    type: 'sawtooth',
    gain: 0.12,
    sweeps: [[2400, 60, 0, 0.55], [60, 1600, 0.5, 0.25]],
    detune: 14,
    sub: true,
  },
  royal: {
    notes: [[523.25, 0, 0.16], [523.25, 0.18, 0.1], [523.25, 0.3, 0.1], [698.46, 0.42, 0.5], [880, 0.42, 0.5], [1046.5, 0.6, 0.7]],
    type: 'sawtooth',
    gain: 0.14,
    detune: 6,
    sub: true,
  },
};

/** Whose entry sound to play for a joining participant (set by the shell from styles). */
let entryOf: (identity: string) => string | undefined = () => undefined;
export function setEntryResolver(fn: (identity: string) => string | undefined) {
  entryOf = fn;
}

/** Someone joined our channel: their entry sound, or the standard cue. */
export function playUserJoin(identity: string) {
  const id = entryOf(identity);
  if (id && ENTRY[id]) void playEntry(id);
  else void play('userJoin');
}

/** Plays an entry sound; `preview` ignores "do not disturb" (Style tab). */
export async function playEntry(id: string, preview = false) {
  const s = settings.get();
  if (!s.uiSounds || s.uiSoundsVolume <= 0) return;
  if (!preview && quiet) return;
  const e = ENTRY[id];
  if (!e) return void (preview ? play('userJoin') : undefined);
  const c = await context();
  const t0 = c.currentTime + 0.01;
  const master = c.createGain();
  master.gain.value = e.gain * s.uiSoundsVolume * 0.6;
  master.connect(c.destination);
  let end = 0;
  const voice = (freq: number, at: number, dur: number, detune: number, type: OscillatorType, level = 1) => {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(level, t0 + at + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(env).connect(master);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.03);
    end = Math.max(end, at + dur);
  };
  for (const [freq, at, dur] of e.notes) {
    voice(freq, at, dur, 0, e.type);
    if (e.detune) voice(freq, at, dur, e.detune, e.type, 0.7);
    if (e.sub) voice(freq / 2, at, dur, 0, 'sine', 0.6);
  }
  for (const [from, to, at, dur] of e.sweeps ?? []) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, t0 + at);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + at + dur);
    env.gain.setValueAtTime(0.0001, t0 + at);
    env.gain.exponentialRampToValueAtTime(0.6, t0 + at + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(env).connect(master);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.03);
    end = Math.max(end, at + dur);
  }
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => void ctx?.suspend(), (end + 1.5) * 1000);
}

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
