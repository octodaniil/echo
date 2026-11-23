let wasm;

const heap = new Array(128).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) { return heap[idx]; }

let heap_next = heap.length;

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8Memory0 = null;

function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
        cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
* Create a DeepFilterNet Model
*
* Args:
*     - path: File path to a DeepFilterNet tar.gz onnx model
*     - atten_lim: Attenuation limit in dB.
*
* Returns:
*     - DF state doing the full processing: stft, DNN noise reduction, istft.
* @param {Uint8Array} model_bytes
* @param {number} atten_lim
* @returns {number}
*/
export function df_create(model_bytes, atten_lim) {
    const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.df_create(ptr0, len0, atten_lim);
    return ret >>> 0;
}

/**
* Get DeepFilterNet frame size in samples.
* @param {number} st
* @returns {number}
*/
export function df_get_frame_length(st) {
    const ret = wasm.df_get_frame_length(st);
    return ret >>> 0;
}

/**
* Set DeepFilterNet attenuation limit.
*
* Args:
*     - lim_db: New attenuation limit in dB.
* @param {number} st
* @param {number} lim_db
*/
export function df_set_atten_lim(st, lim_db) {
    wasm.df_set_atten_lim(st, lim_db);
}

/**
* Set DeepFilterNet post filter beta. A beta of 0 disables the post filter.
*
* Args:
*     - beta: Post filter attenuation. Suitable range between 0.05 and 0;
* @param {number} st
* @param {number} beta
*/
export function df_set_post_filter_beta(st, beta) {
    wasm.df_set_post_filter_beta(st, beta);
}

let cachedFloat32Memory0 = null;

function getFloat32Memory0() {
    if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
        cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32Memory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32Memory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
* Processes a chunk of samples.
*
* Args:
*     - df_state: Created via df_create()
*     - input: Input buffer of length df_get_frame_length()
*     - output: Output buffer of length df_get_frame_length()
*
* Returns:
*     - Local SNR of the current frame.
* @param {number} st
* @param {Float32Array} input
* @returns {Float32Array}
*/
export function df_process_frame(st, input) {
    const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.df_process_frame(st, ptr0, len0);
    return takeObject(ret);
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_exn_store(addHeapObject(e));
    }
}

const DFStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dfstate_free(ptr >>> 0));
/**
*/
export class DFState {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DFStateFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dfstate_free(ptr);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
        takeObject(arg0);
    };
    imports.wbg.__wbg_crypto_566d7465cdbb6b7a = function(arg0) {
        const ret = getObject(arg0).crypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_is_object = function(arg0) {
        const val = getObject(arg0);
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg_process_dc09a8c7d59982f6 = function(arg0) {
        const ret = getObject(arg0).process;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_versions_d98c6400c6ca2bd8 = function(arg0) {
        const ret = getObject(arg0).versions;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_node_caaf83d002149bd5 = function(arg0) {
        const ret = getObject(arg0).node;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_is_string = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'string';
        return ret;
    };
    imports.wbg.__wbg_require_94a9da52636aacbf = function() { return handleError(function () {
        const ret = module.require;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbindgen_is_function = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'function';
        return ret;
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_msCrypto_0b84745e9245cdf6 = function(arg0) {
        const ret = getObject(arg0).msCrypto;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_randomFillSync_290977693942bf03 = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).randomFillSync(takeObject(arg1));
    }, arguments) };
    imports.wbg.__wbg_getRandomValues_260cc23a41afad9a = function() { return handleError(function (arg0, arg1) {
        getObject(arg0).getRandomValues(getObject(arg1));
    }, arguments) };
    imports.wbg.__wbindgen_object_clone_ref = function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_call_27c0f87801dedf93 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_newnoargs_e258087cd0daa0ea = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_call_b3ca7c6051f9bec1 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_buffer_12d079cc21e14bdb = function(arg0) {
        const ret = getObject(arg0).buffer;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb = function(arg0, arg1, arg2) {
        const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_63b92bc8671ed464 = function(arg0) {
        const ret = new Uint8Array(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_a47bac70306a19a7 = function(arg0, arg1, arg2) {
        getObject(arg0).set(getObject(arg1), arg2 >>> 0);
    };
    imports.wbg.__wbg_newwithbyteoffsetandlength_4a659d079a1650e0 = function(arg0, arg1, arg2) {
        const ret = new Float32Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_9efabd6b6d2ce46d = function(arg0) {
        const ret = new Float32Array(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_newwithlength_e9b4878cebadb3d3 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_subarray_a1f73cd4b5b42fe1 = function(arg0, arg1, arg2) {
        const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_self_ce0dbfc45cf2f5be = function() { return handleError(function () {
        const ret = self.self;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_window_c6fb939a7f436783 = function() { return handleError(function () {
        const ret = window.window;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_globalThis_d1e6af4856ba331b = function() { return handleError(function () {
        const ret = globalThis.globalThis;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_global_207b558942527489 = function() { return handleError(function () {
        const ret = global.global;
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbindgen_is_undefined = function(arg0) {
        const ret = getObject(arg0) === undefined;
        return ret;
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm.memory;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, maybe_memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedFloat32Memory0 = null;
    cachedUint8Memory0 = null;


    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(input) {
    if (wasm !== undefined) return wasm;

    if (typeof input === 'undefined') {
        input = new URL('df_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await input, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync }
export default __wbg_init;

// ---------------------------------------------------------------------------------------
// Echo: DeepFilterNet 3 noise suppression as an AudioWorklet.
// The wasm-bindgen glue above was generated from the official DeepFilterNet source
// (see README.md next to this file). The processor below is Echo's own.

const QUANTUM = 128;

class EchoDeepFilter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.ok = false;
    this.reported = false;
    try {
      initSync(o.module);
      this.state = df_create(new Uint8Array(o.model), o.attenLim ?? 100);
      this.hop = df_get_frame_length(this.state);
      this.ok = true;
    } catch (e) {
      this.fail('init: ' + (e && e.message ? e.message : String(e)));
    }
    const hop = this.hop || 480;
    // Input collects one model frame (10 ms); output is a FIFO primed with silence so it
    // never runs dry between frames (≈ 10 ms of extra latency).
    this.inBuf = new Float32Array(hop);
    this.inLen = 0;
    this.outBuf = new Float32Array(hop * 4);
    this.outRead = 0;
    this.outLen = hop + QUANTUM;
    this.port.onmessage = (e) => {
      if (this.ok && e.data && e.data.type === 'atten') df_set_atten_lim(this.state, e.data.value);
    };
  }

  fail(reason) {
    this.ok = false;
    if (!this.reported) {
      this.reported = true;
      this.port.postMessage({ type: 'error', reason });
    }
  }

  push(samples) {
    const cap = this.outBuf.length;
    for (let i = 0; i < samples.length; i++) {
      if (this.outLen >= cap) break; // should never happen; drop rather than overwrite
      this.outBuf[(this.outRead + this.outLen) % cap] = samples[i];
      this.outLen++;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0][0];
    if (!this.ok) {
      // Broken: pass the voice through untouched (the main thread switches to RNNoise).
      if (input) output.set(input);
      return true;
    }
    const src = input || (this.silence ||= new Float32Array(QUANTUM));
    for (let i = 0; i < src.length; i++) {
      this.inBuf[this.inLen++] = src[i];
      if (this.inLen === this.hop) {
        this.inLen = 0;
        let out;
        try {
          out = df_process_frame(this.state, this.inBuf);
        } catch (e) {
          this.fail('process: ' + (e && e.message ? e.message : String(e)));
          output.set(src);
          return true;
        }
        for (let j = 0; j < out.length; j++) {
          if (!Number.isFinite(out[j])) {
            this.fail('NaN');
            output.set(src);
            return true;
          }
        }
        this.push(out);
      }
    }
    const cap = this.outBuf.length;
    const n = Math.min(output.length, this.outLen);
    for (let i = 0; i < n; i++) output[i] = this.outBuf[(this.outRead + i) % cap];
    this.outRead = (this.outRead + n) % cap;
    this.outLen -= n;
    return true;
  }
}

registerProcessor('echo-deepfilter', EchoDeepFilter);
