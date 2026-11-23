# DeepFilterNet 3 for Echo

- `df_bg.wasm` and the wasm-bindgen glue at the top of `dfnWorklet.js` are built from the
  official source: https://github.com/Rikorose/DeepFilterNet (libDF, commit 7b14b89),
  `cargo build -p deep_filter --release --target wasm32-unknown-unknown --no-default-features --features wasm`
  with `RUSTFLAGS="-C target-feature=+simd128"` and the `default-model` feature removed from `wasm`
  (the model is passed in at runtime), then
  `wasm-bindgen 0.2.92 --target web --remove-name-section --remove-producers-section`.
- `DeepFilterNet3_onnx.tar.gz` is the official model from the same repository (`models/`).
- License: MIT or Apache-2.0 (see LICENSE-MIT, LICENSE-APACHE).
