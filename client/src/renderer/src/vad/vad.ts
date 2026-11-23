import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import modelUrl from './silero_vad_16k_op15.onnx?url';
// `no-inline`: worklets refuse data: and blob: URLs here (CSP), so it must be a real file.
import tapUrl from './vadTap.js?url&no-inline';

/**
 * Speech detector (Silero VAD, MIT, https://github.com/snakers4/silero-vad): a small neural
 * net that tells speech from everything else regardless of loudness, so whispers count as
 * speech and keyboards / fans don't. 32 ms frames at 16 kHz, ~0.6 ms of CPU each.
 */

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };

let session: Promise<ort.InferenceSession> | null = null;
const tapLoaded = new WeakSet<AudioContext>();

async function getSession() {
  session ??= (async () => {
    const model = await fetch(modelUrl).then((r) => r.arrayBuffer());
    return ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  })();
  return session.catch((err) => {
    session = null;
    throw err;
  });
}

export class SpeechDetector {
  /** Latest speech probability, 0..1. */
  prob = 0;
  /** When the last frame was scored (performance.now()); 0 = never. */
  lastFrame = 0;
  readonly node: AudioWorkletNode;
  private state: ort.Tensor;
  private readonly sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  private readonly context = new Float32Array(64);
  private busy = false;
  private closed = false;

  private constructor(
    node: AudioWorkletNode,
    private readonly session: ort.InferenceSession,
  ) {
    this.node = node;
    this.state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => void this.score(e.data);
  }

  static async create(ctx: AudioContext): Promise<SpeechDetector> {
    const s = await getSession();
    if (!tapLoaded.has(ctx)) {
      await ctx.audioWorklet.addModule(tapUrl);
      tapLoaded.add(ctx);
    }
    const node = new AudioWorkletNode(ctx, 'echo-vad-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    return new SpeechDetector(node, s);
  }

  private async score(chunk: Float32Array) {
    // If inference ever lags, skip frames instead of queueing them up.
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const x = new Float32Array(576);
      x.set(this.context);
      x.set(chunk, 64);
      this.context.set(chunk.subarray(448));
      const r = await this.session.run({ input: new ort.Tensor('float32', x, [1, 576]), state: this.state, sr: this.sr });
      this.state = r.stateN as ort.Tensor;
      const p = (r.output as ort.Tensor).data[0] as number;
      this.prob = Number.isFinite(p) ? p : 0;
      this.lastFrame = performance.now();
    } catch (err) {
      console.warn('[vad]', err);
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.closed = true;
    this.node.port.onmessage = null;
    this.node.disconnect();
  }
}
