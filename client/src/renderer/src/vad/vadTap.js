// Echo: taps the microphone for the speech detector. Downsamples 48 kHz -> 16 kHz (a small
// low-pass, then every third sample) and posts 512-sample chunks (32 ms) to the main thread.
// Outputs nothing: the node is a side branch of the graph.

class EchoVadTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(512);
    this.len = 0;
    this.phase = 0;
    this.a = 0;
    this.b = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      // 3-tap moving average is enough of an anti-alias filter for speech detection.
      const x = input[i];
      const y = (x + this.a + this.b) / 3;
      this.b = this.a;
      this.a = x;
      if (++this.phase < 3) continue;
      this.phase = 0;
      this.buf[this.len++] = y;
      if (this.len === 512) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(512);
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor('echo-vad-tap', EchoVadTap);
