# vendor/tesseract

The OCR engine `scripts/importer/ocr.mjs` reads picture text with. Committed
plain files, byte-identical to the published packages (nothing built or
edited here), loaded by module-relative path; no CDN URL is reachable at
runtime, because `ocr.mjs` sets `workerPath`, `corePath` and `langPath` itself
and the reader uses no cache. One core build is vendored, named by file.

| File | Package | Version | SHA-256 |
| --- | --- | --- | --- |
| `tesseract.esm.min.js` | `tesseract.js` `dist/` | 7.0.0 | `64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29` |
| `worker.min.js` | `tesseract.js` `dist/` | 7.0.0 | `576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d` |
| `worker.min.js.LICENSE.txt` | `tesseract.js` `dist/` | 7.0.0 | `45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac` |
| `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core` | 7.0.0 | `c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38` |
| `lang/eng.traineddata.gz` | `@tesseract.js-data/eng` `4.0.0_best_int/` | 1.0.0 | `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91` |
| `licenses/tesseract.js.LICENSE.md` | `tesseract.js` | 7.0.0 | `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` |
| `licenses/tesseract.js-core.LICENSE` | `tesseract.js-core` | 7.0.0 | `c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08` |
| `licenses/tesseract.js-data-eng.package.json` | `@tesseract.js-data/eng` `package.json` | 1.0.0 | `b603509212196b5d09e10519bf252c1e344b79704d065e0d62886846f8554c80` |

`tesseract.js-core` carries the engine compiled to WebAssembly and embedded in
that one file (SIMD, LSTM only).

## Licences

- `tesseract.js` and `tesseract.js-core`: Apache-2.0; texts in `licenses/`.
  `worker.min.js.LICENSE.txt` is the notice list for the third-party code
  bundled into the two `tesseract.js` bundles (MIT and BSD-3-Clause).
- `@tesseract.js-data/eng`: its `package.json` declares MIT and the package
  ships no licence file; the declaration is kept in `licenses/`. The data
  inside is the integerized `tessdata_best` English model
  (github.com/naptha/tessdata names github.com/tesseract-ocr/tessdata_best as
  its source), which the Tesseract project licenses under Apache-2.0, the
  same text as `licenses/tesseract.js-core.LICENSE`.

## Notes

- `tesseract.esm.min.js` and `worker.min.js` end in a `sourceMappingURL`
  comment; the maps are not vendored and the comment is only read by browser
  developer tools.
- The CDN addresses the bundles hold are their defaults for the three path
  options above; they are never used.
- These files are not rewritten when the repo is checked out: the
  `.gitattributes` line-ending rule leaves them as they are (no carriage
  returns in any of them).
