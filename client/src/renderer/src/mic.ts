import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import dfnWasmUrl from './dfn/df_bg.wasm?url';
import dfnModelUrl from './dfn/DeepFilterNet3_onnx.tar.gz?url';
import dfnWorkletUrl from './dfn/dfnWorklet.js?url';
import type { NoiseSuppressionMode, Settings } from './settings';
import { report } from './diag';
import { SpeechDetector } from './vad/vad';

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
  /**
   * 40 ms look-ahead: voice activation decides on the live signal but the audio passing the
   * gate is delayed, so the gate is already open when the first syllable arrives (the start
   * of words used to be clipped). 40 ms is not noticeable in conversation.
   */
  private readonly lookahead = this.ctx.createDelay(0.2);
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
  private dfn: AudioWorkletNode | null = null;
  /** DeepFilterNet failed this session: «ИИ-шумодав 2.0» falls back to RNNoise. */
  private dfnBroken = false;
  /** Last heartbeat from the DeepFilterNet worklet (performance.now()). */
  private dfnBeat = 0;
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
  /** Silero speech detector on the raw mic (null until loaded, or if it failed). */
  private vad: SpeechDetector | null = null;
  /** Last moment speech was detected (for the gentle dip in continuous mode). */
  private lastSpeech = 0;
  /** Current gate gain target (1 open, 0 closed, 0.35 dipped). */
  private gateTarget = 0;
  /**
   * A little of the untouched mic mixed under the noise suppressor's output, so a word the
   * suppressor mistakes for noise is softened instead of erased. Delayed to line up with
   * the suppressor's own latency.
   */
  private readonly dryDelay = this.ctx.createDelay(0.1);
  private readonly dryGain = this.ctx.createGain();

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
    this.lookahead.delayTime.value = 0.04;
    this.lookahead.channelCount = 1;
    this.lookahead.channelCountMode = 'explicit';
    this.inputGain.connect(this.lookahead).connect(this.gate);
    for (const node of [this.dryDelay, this.dryGain] as AudioNode[]) {
      node.channelCount = 1;
      node.channelCountMode = 'explicit';
    }
    this.dryGain.gain.value = 0;
    this.dryDelay.connect(this.dryGain).connect(this.inputGain);
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
    report('mic', { reason, ns: this.applied?.noiseSuppression });
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

  /** Manual repair: rebuild the processing chain now (no 5 s guard). */
  async restartProcessing(reason: string) {
    this.lastRebuild = 0;
    await this.rebuildProcessing(reason);
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
    // The speech detector loads in the background; until then the level gate works.
    void SpeechDetector.create(this.ctx)
      .then((d) => {
        if (this.destroyed) return d.close();
        this.vad = d;
        this.source?.connect(d.node);
      })
      .catch((err) => {
        console.warn('[mic] speech detector unavailable', err);
        report('vad-failed', { error: String(err) });
      });
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
    const needRewire = needNewStream || processorOf(prev.noiseSuppression) !== processorOf(s.noiseSuppression);

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
    else this.tune(s);
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
    this.dfn?.disconnect();
    this.dfn?.port.close();
    this.dfn = null;

    this.source = this.ctx.createMediaStreamSource(this.stream!);
    this.source.connect(this.rawAnalyser);
    if (this.vad) this.source.connect(this.vad.node);
    const kind = processorOf(s.noiseSuppression);
    // Dry mix only under a neural suppressor; 'max' keeps it smaller.
    if (kind !== 'none') this.source.connect(this.dryDelay);
    if (kind === 'dfn' && !this.dfnBroken) {
      try {
        const node = await createDeepFilter(this.ctx);
        node.port.onmessage = (e: MessageEvent<{ type: string; reason?: string }>) => {
          if (this.dfn !== node) return;
          if (e.data?.type === 'beat') {
            this.dfnBeat = performance.now();
            return;
          }
          if (e.data?.type !== 'error') return;
          this.dfnBroken = true;
          this.note(`ИИ-шумодав 2.0 сломался (${e.data.reason}) — включён обычный ИИ-шумодав`);
          void this.rewire(this.applied ?? s);
        };
        this.dfn = node;
        this.dfnBeat = performance.now();
        this.source.connect(node).connect(this.inputGain);
        this.tune(s);
        return;
      } catch (err) {
        console.warn('[mic] DeepFilterNet failed', err);
        this.dfnBroken = true;
        this.note('ИИ-шумодав 2.0 не запустился — включён обычный ИИ-шумодав');
      }
    }
    if (kind === 'rnnoise' || kind === 'dfn') {
      this.rnnoise = await createRnnoise(this.ctx);
      this.source.connect(this.rnnoise).connect(this.inputGain);
    } else {
      this.source.connect(this.inputGain);
    }
    this.tune(s);
  }

  /** Dry mix and look-ahead for the current mode (no rewiring needed). */
  private tune(s: Settings) {
    const kind = processorOf(s.noiseSuppression);
    // The dry copy must line up with the suppressor's output to the sample, or the two add up
    // as a comb filter ("talking from a barrel"). RNNoise's worklet delays by exactly 992
    // samples (measured). DeepFilterNet mixes the untouched signal itself, inside its STFT
    // (attenuation limit), which is aligned by construction, so no outside copy is added.
    this.dryDelay.delayTime.value = RNNOISE_DELAY_S;
    this.dryGain.gain.value = this.rnnoise ? (s.noiseSuppression === 'max' ? 0.06 : 0.12) : 0;
    // Look-ahead: a gate that fully closes needs time to open before the first syllable;
    // the continuous mode (neural suppressor + auto) never closes, so it barely needs any.
    this.lookahead.delayTime.value = kind !== 'none' && s.sensitivityAuto ? 0.03 : 0.12;
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
    // DeepFilterNet legitimately outputs exact zeros when there is only noise: for it a hang
    // means its heartbeat stopped, not a silent output.
    const hung = this.dfn
      ? this.ctx.state === 'running' && performance.now() - this.dfnBeat > 3000
      : hearsSound && procPeak === 0;
    if (broken || hung) {
      this.stalledSince ||= performance.now();
      if (broken || performance.now() - this.stalledSince > 3000) {
        void this.rebuildProcessing(broken ? 'битый звук (NaN)' : 'завис');
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
    // Auto: well above the room noise, capped at -42 dB. The lower bound depends on whether
    // a neural suppressor runs: without one, quiet rooms with AGC sit around -55..-65 dB and
    // must not open the gate; with one, the room noise is already gone (floor -80 and below),
    // and the old -52 dB bound cut quiet speakers and whisperers mid-word.
    const kind = processorOf(s.noiseSuppression);
    const lowest = kind === 'none' ? -52 : kind === 'dfn' ? -66 : -62;
    this.threshold = s.sensitivityAuto
      ? Math.min(-42, Math.max(lowest, this.noiseFloor + 12))
      : s.sensitivityDb;

    const now = performance.now();
    // Is the person speaking? Auto: the neural speech detector (whispers count, keyboards
    // don't), held 600 ms after the last speech frame. Manual sensitivity, or no detector:
    // the level threshold, with hysteresis (closes 6 dB lower) and the same 600 ms hold.
    const vadLive = !!this.vad && now - this.vad.lastFrame < 500;
    if (s.sensitivityAuto && vadLive) {
      const p = this.vad!.prob;
      if (p > 0.5 || (this.gateOpen && p > 0.3)) this.holdUntil = now + 600;
    } else if (db > this.threshold || (this.gateOpen && db > this.threshold - 6)) {
      this.holdUntil = now + 600;
    }
    const speaking = now < this.holdUntil;
    if (speaking) this.lastSpeech = now;
    // With a neural suppressor and auto sensitivity nothing is ever cut: the suppressor
    // already removes the noise, so between phrases the voice is only dipped by 9 dB, and
    // only after 1.5 s without speech. Otherwise the gate closes as before.
    const continuous = processorOf(s.noiseSuppression) !== 'none' && s.sensitivityAuto;
    const target = continuous ? (now - this.lastSpeech < 1500 ? 1 : 0.35) : speaking ? 1 : 0;
    if (target !== this.gateTarget) {
      const opening = target > this.gateTarget;
      this.gateTarget = target;
      // Fast attack, gentle release to avoid clicks.
      this.gate.gain.setTargetAtTime(target, this.ctx.currentTime, opening ? 0.004 : continuous ? 0.25 : 0.08);
    }
    if (speaking !== this.gateOpen) {
      this.gateOpen = speaking;
      for (const fn of this.gateListeners) fn(speaking);
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
    this.vad?.close();
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rnnoise?.destroy();
    this.dfn?.port.close();
    this.gateListeners.clear();
    this.levelListeners.clear();
    await this.ctx.close();
  }
}

// 'max' stacks both: WebRTC NS handles steady hum/fans, RNNoise handles clicks and bursts.
const usesBrowserNs = (m: NoiseSuppressionMode) => m === 'standard' || m === 'max';
/** RNNoise worklet latency: 992 samples at 48 kHz (measured offline, constant). */
const RNNOISE_DELAY_S = 992 / 48_000;
/** DeepFilterNet attenuation limit (dB): its own, phase-aligned dry mix. */
const DFN_ATTEN_DB = 20;

/** Which neural suppressor runs in our graph for this mode. */
const processorOf = (m: NoiseSuppressionMode) => (m === 'dfn' ? 'dfn' : m === 'ai' || m === 'max' ? 'rnnoise' : 'none');

let dfnAssets: Promise<{ module: WebAssembly.Module; model: ArrayBuffer }> | null = null;
const dfnLoaded = new WeakSet<AudioContext>();

/**
 * DeepFilterNet 3 (built from the official source, see dfn/README.md): a stronger neural
 * suppressor than RNNoise — removes keyboard, fans, room echo while keeping the voice full.
 * About 0.5 ms of CPU per 10 ms of audio; adds ~10 ms of latency.
 */
async function createDeepFilter(ctx: AudioContext): Promise<AudioWorkletNode> {
  dfnAssets ??= (async () => {
    const [wasm, model] = await Promise.all([
      fetch(dfnWasmUrl).then((r) => r.arrayBuffer()),
      fetch(dfnModelUrl).then((r) => r.arrayBuffer()),
    ]);
    return { module: await WebAssembly.compile(wasm), model };
  })();
  const assets = await dfnAssets.catch((err) => {
    dfnAssets = null;
    throw err;
  });
  if (!dfnLoaded.has(ctx)) {
    await ctx.audioWorklet.addModule(dfnWorkletUrl);
    dfnLoaded.add(ctx);
  }
  return new AudioWorkletNode(ctx, 'echo-deepfilter', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
    // The model is copied per node; the compiled module is shared.
    // 20 dB attenuation limit: noise is cut by 20 dB at most, which also means a syllable
    // the model takes for noise is softened (to 10%) instead of erased.
    processorOptions: { module: assets.module, model: assets.model.slice(0), attenLim: DFN_ATTEN_DB },
  });
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
