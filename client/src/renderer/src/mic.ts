import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { NoiseSuppressionMode, Settings } from './settings';

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
  /** Raw microphone signal (before RNNoise / gain): to notice a mic that went dead. */
  private readonly rawAnalyser = this.ctx.createAnalyser();
  private readonly rawSamples = new Float32Array(512);
  /** Since when the raw input has been exact digital silence (a real mic never is). */
  private deadSince = 0;
  private lastRecovery = 0;
  /** Recoveries in a row that didn't bring sound back (e.g. the mic is muted in hardware). */
  private failedRecoveries = 0;
  private recovering = false;
  private destroyed = false;
  /** Recent recoveries, for diagnostics (window.__echo.voice / settings). */
  readonly log: string[] = [];
  /** Since when the processed signal is broken (NaN) or flat zero while the mic clearly hears sound. */
  private stalledSince = 0;
  private lastRebuild = 0;
  private recoverListeners = new Set<(reason: string) => void>();
  /** Input levels of the last 3 s (one per 20 ms tick), for the noise floor. */
  private readonly recent = new Float32Array(150).fill(-60);
  private recentPos = 0;

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
    this.rawAnalyser.fftSize = 512;
    // Windows can suspend the audio context (sleep, device switch): wake it up again.
    this.ctx.onstatechange = () => {
      if (!this.destroyed && this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume().catch(() => {});
    };
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
    this.gate.gain.value = 0;
    this.inputGain.connect(this.analyser);
    this.inputGain.connect(this.gate);
    this.gate.connect(this.dest);
  }

  /** The processed track to publish. */
  get track(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0]!;
  }

  /** Called when Echo had to restart the microphone or the noise suppressor by itself. */
  onRecover(fn: (reason: string) => void) {
    this.recoverListeners.add(fn);
    return () => this.recoverListeners.delete(fn);
  }

  private note(reason: string) {
    const line = `${new Date().toLocaleTimeString('ru-RU')} ${reason}`;
    this.log.push(line);
    if (this.log.length > 20) this.log.shift();
    console.warn('[mic]', line);
    for (const fn of this.recoverListeners) fn(reason);
  }

  /**
   * Rebuilds the processing part of the graph (RNNoise worklet + source) on the same mic
   * stream. RNNoise runs on its own audio thread: if it ever outputs NaN, every later
   * sample stays NaN (NaN × gain = NaN), the level reads "not a number", voice activation
   * never opens again and friends hear silence — until the whole pipeline is rebuilt,
   * which is why rejoining the channel used to be the only cure.
   */
  private async rebuildProcessing(reason: string) {
    if (this.recovering || this.destroyed || !this.applied || !this.stream) return;
    if (Date.now() - this.lastRebuild < 5000) return;
    this.lastRebuild = Date.now();
    this.recovering = true;
    this.note(`шумодав перезапущен: ${reason}`);
    try {
      await this.rewire(this.applied);
      this.recent.fill(-60);
      this.noiseFloor = -60;
      this.stalledSince = 0;
    } catch (err) {
      console.warn('[mic] rebuild failed', err);
    } finally {
      this.recovering = false;
    }
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
      usesBrowserNs(prev.noiseSuppression) !== usesBrowserNs(s.noiseSuppression);
    const needRewire = needNewStream || usesRnnoise(prev.noiseSuppression) !== usesRnnoise(s.noiseSuppression);

    if (needNewStream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDeviceId === 'default' ? undefined : { ideal: s.inputDeviceId },
          echoCancellation: s.echoCancellation,
          // Browser NS only in "standard" mode; in "ai" mode RNNoise does the job.
          noiseSuppression: usesBrowserNs(s.noiseSuppression),
          autoGainControl: s.autoGain,
          channelCount: 1,
          sampleRate: 48_000,
        },
      });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      // The device disappeared or Windows took it away: get a new one right away.
      track?.addEventListener('ended', () => {
        if (this.stream === stream) void this.recover('устройство отключилось');
      });
    }
    if (needRewire) await this.rewire(s);
  }

  private onDeviceChange = () => {
    // A headset plugged in / out or the default device changed: if our track died, recover.
    window.setTimeout(() => {
      const track = this.stream?.getAudioTracks()[0];
      if (!track || track.readyState === 'ended' || this.deadSince) void this.recover('сменилось устройство');
    }, 800);
  };

  /**
   * Re-opens the microphone with the current settings. The published track never changes
   * (it comes from our graph), so friends just hear you again — no rejoin needed.
   */
  async recover(reason: string) {
    if (this.recovering || this.destroyed || !this.applied) return;
    // Back off when re-opening doesn't help (hardware mute switch, mic unplugged for good).
    const wait = this.failedRecoveries >= 3 ? 60_000 : 8000;
    if (Date.now() - this.lastRecovery < wait) return;
    if (this.deadSince && this.lastRecovery) this.failedRecoveries++;
    this.recovering = true;
    this.lastRecovery = Date.now();
    this.note(`микрофон переподключён: ${reason}`);
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      const s = this.applied;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDeviceId === 'default' ? undefined : { ideal: s.inputDeviceId },
          echoCancellation: s.echoCancellation,
          noiseSuppression: usesBrowserNs(s.noiseSuppression),
          autoGainControl: s.autoGain,
          channelCount: 1,
          sampleRate: 48_000,
        },
      });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (this.stream === stream) void this.recover('устройство отключилось');
      });
      await this.rewire(s);
      this.deadSince = 0;
      // Fresh device, fresh noise estimate.
      this.recent.fill(-60);
      this.noiseFloor = -60;
    } catch (err) {
      console.warn('[mic] recover failed', err);
    } finally {
      this.recovering = false;
    }
  }

  private async rewire(s: Settings) {
    this.source?.disconnect();
    this.rnnoise?.disconnect();
    this.rnnoise?.destroy();
    this.rnnoise = null;

    this.source = this.ctx.createMediaStreamSource(this.stream!);
    this.source.connect(this.rawAnalyser);
    if (usesRnnoise(s.noiseSuppression)) {
      this.rnnoise = await createRnnoise(this.ctx);
      this.source.connect(this.rnnoise).connect(this.inputGain);
    } else {
      this.source.connect(this.inputGain);
    }
  }

  private tick() {
    const s = this.applied;
    if (!s) return;

    // Watchdog: exact zeros from the device for 4 s = the mic stopped delivering sound
    // (sleep, USB power saving, another app took it). Real microphones always hiss a bit.
    this.rawAnalyser.getFloatTimeDomainData(this.rawSamples);
    let peak = 0;
    for (const v of this.rawSamples) peak = Math.max(peak, Math.abs(v));
    const track = this.stream?.getAudioTracks()[0];
    if (peak === 0 && track?.enabled) {
      this.deadSince ||= performance.now();
      if (performance.now() - this.deadSince > 4000) void this.recover('пропал звук с микрофона');
    } else {
      this.deadSince = 0;
      this.failedRecoveries = 0;
    }
    if (track?.readyState === 'ended') void this.recover('устройство отключилось');

    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    let procPeak = 0;
    let broken = false;
    for (const v of this.samples) {
      if (!Number.isFinite(v)) {
        broken = true;
        break;
      }
      sum += v * v;
      procPeak = Math.max(procPeak, Math.abs(v));
    }
    // Watchdog #2, after the noise suppressor: broken samples, or dead-flat zeros while the
    // raw mic clearly hears something (≈ -46 dB peak) for 3 s = the processing hung.
    const hearsSound = peak > 0.005 && s.inputVolume > 0;
    if (broken || (hearsSound && procPeak === 0)) {
      this.stalledSince ||= performance.now();
      if (broken || performance.now() - this.stalledSince > 3000) {
        void this.rebuildProcessing(broken ? 'битый звук (NaN)' : 'завис и молчал');
      }
    } else {
      this.stalledSince = 0;
    }
    const raw = broken ? -100 : 10 * Math.log10(sum / this.samples.length + 1e-12);
    const db = Number.isFinite(raw) ? Math.max(-100, raw) : -100;
    this.level = db;
    if (!Number.isFinite(this.noiseFloor)) this.noiseFloor = -60;

    // Noise floor = the quietest moment of the last 3 s ("minimum statistics"): speech
    // always has gaps, steady noise doesn't. The old slowly-rising average crept up during
    // long silences (Windows/Chrome auto-gain keeps boosting a quiet mic), pushed the
    // threshold above normal speech and the mic seemed dead until a loud knock.
    this.recent[this.recentPos] = db;
    this.recentPos = (this.recentPos + 1) % this.recent.length;
    let min = 0;
    for (const v of this.recent) if (v < min) min = v;
    // Never learn from moments when the gate is open (that's speech, not noise).
    if (!this.gateOpen || min < this.noiseFloor) this.noiseFloor += (min - this.noiseFloor) * 0.05;
    this.noiseFloor = Math.min(-40, Math.max(-90, this.noiseFloor));
    // Auto: well above the room noise, but within -52..-42 dB: quiet rooms with AGC sit
    // around -55..-65 dB, and even quiet speech is louder than -42 dB.
    this.threshold = s.sensitivityAuto
      ? Math.min(-42, Math.max(-52, this.noiseFloor + 15))
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
    this.destroyed = true;
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rnnoise?.destroy();
    this.gateListeners.clear();
    this.levelListeners.clear();
    await this.ctx.close();
  }
}

// 'max' stacks both: WebRTC NS handles steady hum/fans, RNNoise handles clicks and bursts.
const usesBrowserNs = (m: NoiseSuppressionMode) => m === 'standard' || m === 'max';
const usesRnnoise = (m: NoiseSuppressionMode) => m === 'ai' || m === 'max';

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
