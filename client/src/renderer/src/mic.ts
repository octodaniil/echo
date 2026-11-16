import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { Settings } from './settings';

/**
 * Microphone processing chain, all inside one 48 kHz AudioContext:
 *
 *   mic ─▶ [RNNoise] ─▶ input gain ─┬─▶ gate (voice activation) ─▶ output track (published)
 *                                   └─▶ analyser (level meter + gate decision)
 *
 * The output track never changes, so switching the mic, noise suppression mode or
 * any other setting rewires the graph without republishing to LiveKit.
 */
export class MicPipeline {
  readonly ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  private readonly dest = this.ctx.createMediaStreamDestination();
  private readonly inputGain = this.ctx.createGain();
  private readonly gate = this.ctx.createGain();
  private readonly analyser = this.ctx.createAnalyser();
  private readonly samples = new Float32Array(512);

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rnnoise: RnnoiseWorkletNode | null = null;
  private applied: Settings | null = null;
  private timer: number | undefined;

  /** Current input level in dBFS (after input gain, before the gate). */
  level = -100;
  /** Background noise estimate used for automatic sensitivity. */
  noiseFloor = -60;
  /** The threshold in use right now (auto or manual). */
  threshold = -50;
  gateOpen = false;
  private holdUntil = 0;

  private gateListeners = new Set<(open: boolean) => void>();
  private levelListeners = new Set<() => void>();

  constructor() {
    // Voice is mono. RNNoise's worklet outputs stereo with only the left channel filled,
    // which friends heard in one ear: take channel 0 explicitly and publish a mono track
    // (receivers up-mix mono to both ears).
    for (const node of [this.inputGain, this.gate, this.dest] as AudioNode[]) {
      node.channelCount = 1;
      node.channelCountMode = 'explicit';
    }
    this.inputGain.channelInterpretation = 'discrete';
    this.analyser.fftSize = 512;
    this.gate.gain.value = 0;
    this.inputGain.connect(this.analyser);
    this.inputGain.connect(this.gate);
    this.gate.connect(this.dest);
  }

  /** The processed track to publish. */
  get track(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0]!;
  }

  onGateChange(fn: (open: boolean) => void) {
    this.gateListeners.add(fn);
    return () => this.gateListeners.delete(fn);
  }

  /** Called ~50 times a second while someone listens (the settings meter). */
  onLevel(fn: () => void) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  async start(s: Settings) {
    await this.ctx.resume();
    await this.apply(s);
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  private queue: Promise<void> = Promise.resolve();

  /** Applies settings; calls are serialized so quick changes can't interleave. */
  apply(s: Settings): Promise<void> {
    this.queue = this.queue.then(() => this.doApply(s)).catch((err) => {
      console.warn('[mic] apply failed', err);
      throw err;
    });
    return this.queue;
  }

  private async doApply(s: Settings) {
    const prev = this.applied;
    this.applied = s;
    this.inputGain.gain.setTargetAtTime(s.inputVolume, this.ctx.currentTime, 0.02);

    const needNewStream =
      !prev ||
      !this.stream ||
      prev.inputDeviceId !== s.inputDeviceId ||
      prev.echoCancellation !== s.echoCancellation ||
      prev.autoGain !== s.autoGain ||
      (prev.noiseSuppression === 'standard') !== (s.noiseSuppression === 'standard');
    const needRewire = needNewStream || (prev.noiseSuppression === 'ai') !== (s.noiseSuppression === 'ai');

    if (needNewStream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDeviceId === 'default' ? undefined : { ideal: s.inputDeviceId },
          echoCancellation: s.echoCancellation,
          // Browser NS only in "standard" mode; in "ai" mode RNNoise does the job.
          noiseSuppression: s.noiseSuppression === 'standard',
          autoGainControl: s.autoGain,
          channelCount: 1,
          sampleRate: 48_000,
        },
      });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;
    }
    if (needRewire) await this.rewire(s);
  }

  private async rewire(s: Settings) {
    this.source?.disconnect();
    this.rnnoise?.disconnect();
    this.rnnoise?.destroy();
    this.rnnoise = null;

    this.source = this.ctx.createMediaStreamSource(this.stream!);
    if (s.noiseSuppression === 'ai') {
      this.rnnoise = await createRnnoise(this.ctx);
      this.source.connect(this.rnnoise).connect(this.inputGain);
    } else {
      this.source.connect(this.inputGain);
    }
  }

  private tick() {
    const s = this.applied;
    if (!s) return;

    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    const db = Math.max(-100, 10 * Math.log10(sum / this.samples.length + 1e-12));
    this.level = db;

    // Noise floor: drops quickly, rises slowly (so speech doesn't drag it up).
    this.noiseFloor = db < this.noiseFloor ? this.noiseFloor + (db - this.noiseFloor) * 0.3 : this.noiseFloor + (db - this.noiseFloor) * 0.004;
    this.noiseFloor = Math.min(-30, Math.max(-90, this.noiseFloor));
    // Auto: well above the room noise, but never below -50 dB (quiet rooms with AGC
    // still sit around -55..-65 dB) and never above -30 dB (normal speech is louder).
    this.threshold = s.sensitivityAuto
      ? Math.min(-30, Math.max(-50, this.noiseFloor + 20))
      : s.sensitivityDb;

    const now = performance.now();
    if (db > this.threshold) this.holdUntil = now + 300;
    const open = now < this.holdUntil;
    if (open !== this.gateOpen) {
      this.gateOpen = open;
      // Fast attack, gentle release to avoid clicks.
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.004 : 0.06);
      for (const fn of this.gateListeners) fn(open);
    }
    for (const fn of this.levelListeners) fn();
  }

  /** Plays the processed signal back to you (mic test). Returns a stop function. */
  monitor(outputDeviceId: string): () => void {
    const el = new Audio();
    el.srcObject = new MediaStream([this.track]);
    if (outputDeviceId !== 'default') void el.setSinkId(outputDeviceId).catch(() => {});
    void el.play();
    return () => {
      el.pause();
      el.srcObject = null;
    };
  }

  async destroy() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rnnoise?.destroy();
    this.gateListeners.clear();
    this.levelListeners.clear();
    await this.ctx.close();
  }
}

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;
const workletLoaded = new WeakSet<AudioContext>();

async function createRnnoise(ctx: AudioContext): Promise<RnnoiseWorkletNode> {
  rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  const wasmBinary = await rnnoiseBinary;
  if (!workletLoaded.has(ctx)) {
    await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
    workletLoaded.add(ctx);
  }
  return new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
}
