# ADR-0010: XML Document Character Encoding Autodetection and Decoding

- **Status:** Accepted (implemented in M1 stage 2)
- **Date:** 2026-11-25

## Context

In Milestone M0 and M1a, file opening in `packages/app/src/main.ts` called `file.text()`, which per the Web File API always decodes input as UTF-8 and strips any leading UTF-8 BOM. Consequently, XML documents encoded in UTF-16LE, UTF-16BE, Shift_JIS, EUC-JP, ISO-2022-JP, or windows-1252 could produce mojibake or silent replacement characters (`U+FFFD`), and `runWorkerCheck` did not forward the actual decoded encoding to `checkWellFormedness` via `options.assumedEncoding`.

XMLens also keeps `packages/core` strictly DOM-free (`"lib": ["ES2022"]`, `eslint.config.mjs` `no-restricted-globals`), so byte-level encoding autodetection must avoid browser/DOM APIs while decoding in `packages/app` uses standard Web Platform `TextDecoder`.

## Decision

1. **Autodetection per W3C XML 1.0 (Fifth Edition) Appendix F:**
   - `packages/core/src/encoding.ts` exports pure function `detectXmlEncoding(bytes: Uint8Array)` implementing W3C XML 1.0 (Fifth Edition) **Appendix F ("Autodetection of Character Encodings (Non-Normative)")**, **§F.1 ("Detection Without External Encoding Information")**:
     - **4-byte BOMs checked before 2-byte BOMs:** `00 00 FE FF` (`UTF-32BE`), `FF FE 00 00` (`UTF-32LE`), `00 00 FF FE` / `FE FF 00 00` (`UCS-4`) → flagged `supported: false` with an `error`-severity `Diagnostic` (`XML_UNSUPPORTED_ENCODING`, `source: 'core'`).
     - **2-byte and 3-byte BOMs:** `EF BB BF` (`UTF-8`, `bomLength: 3`), `FE FF` (`UTF-16BE`, `bomLength: 2`), `FF FE` (`UTF-16LE`, `bomLength: 2`).
     - **BOM-less 4-byte initial patterns:** `00 00 00 3C` / `3C 00 00 00` / `00 00 3C 00` / `00 3C 00 00` (UTF-32 / UCS-4, unsupported), `4C 6F A7 94` (EBCDIC, unsupported), `00 3C 00 3F` (`UTF-16BE`), `3C 00 3F 00` (`UTF-16LE`).
     - **ASCII-compatible prefix (`3C 3F 78 6D`, `<?xm`):** Scans up to the first 256 bytes/units strictly anchored at document start (immediately after any BOM) to extract `encoding="..."` or `'...'` from a valid leading `<?xml ... ?>` declaration. Non-leading declarations (e.g., preceded by whitespace or inside an element) are ignored.
     - **Default:** Empty inputs, files without a BOM/pattern/declaration, and XML declarations omitting `encoding` default to `UTF-8` (`source: 'default'`).
   - **ASCII case-insensitive normalization & conflict handling:** Encoding labels are compared/normalized ASCII case-insensitively while preserving `declaredEncoding` verbatim. When a BOM or byte-order pattern conflicts with a leading XML declaration (e.g., UTF-16LE BOM with `encoding="UTF-8"`), the BOM/pattern takes precedence (`supported: true`) and a `warning`-severity `Diagnostic` (`XML_ENCODING_BOM_CONFLICT`, `source: 'core'`) is returned. (`UTF-16` declarations paired with `UTF-16LE`/`UTF-16BE` BOMs or patterns are treated as compatible.)

2. **Core vs. App Responsibility Split:**
   - `packages/core` (`encoding.ts`) performs **pure byte inspection and classification only** and never calls `TextDecoder` or browser APIs, keeping `@xmlens/core` portable across `ES2022` workers, Node, and future CLIs.
   - `packages/app` (`decodeXml.ts`) consumes `detectXmlEncoding` and performs actual decoding via `new TextDecoder(label, { fatal: true })`, preserving `hasBom = bomLength > 0` from detection because `TextDecoder` strips matching BOMs.

3. **Unsupported Encodings, Fatal Decode Errors, and Overrides:**
   - Unsupported encodings (`UTF-32BE`, `UTF-32LE`, `UCS-4`, `EBCDIC`) are **not** passed to `TextDecoder`; `decodeXmlBytes` returns a structured failure (`failureReason: 'unsupported'`) with an error `Diagnostic`.
   - `TextDecoder(..., { fatal: true })` failures do not silently insert replacement characters (`U+FFFD`). Instead, `main.ts` skips the worker well-formedness check, preserves the raw `Uint8Array` bytes (up to 1 MB) in memory, and displays an error state prompting the user to select another encoding override from the toolbar (`auto`, `UTF-8`, `UTF-16LE`, `UTF-16BE`, `Shift_JIS`, `EUC-JP`, `ISO-2022-JP`, `windows-1252`).
   - Unknown encoding labels (`RangeError` from `new TextDecoder(...)`) emit a `warning` `Diagnostic` (`XML_UNKNOWN_ENCODING_FALLBACK`) and attempt `UTF-8` with `fatal: true`.

4. **Assumed Encoding Forwarding to Worker Checks:**
   - When decoding succeeds via an XML `declaration`, `decodeXmlBytes` forwards the original `declaredEncoding` string as `options.assumedEncoding` to `workerClient.check(...)` (avoiding false `XML_ENCODING_DECLARATION_NOTE` messages when the file was actually decoded using its declared encoding or alias such as `cp932`).

5. **Encoding Standard Mappings & Unverified Browser Behavior:**
   - Verified under Node.js `v22.x` ICU `TextDecoder`: `iso-8859-1` / `latin1` resolve to `windows-1252` (per the WHATWG Encoding Standard), `shift_jis` / `sjis` / `x-sjis` resolve to `shift_jis` (windows-31j compatible in WHATWG Encoding), and `cp932` / `euc_jp` throw `RangeError` if passed unnormalized (handled by `normalizeXmlEncodingLabel` before `TextDecoder` construction).
   - **Unverified:** Actual runtime `TextDecoder` label support, fatal error messages, and `<input type="file">` / toolbar `<select>` UX across real Windows/macOS/Linux browsers (Chromium, Firefox, WebKit) remain **unverified** in the AI Studio environment and require manual browser verification.

## Consequences

- **Positive:**
  - Opening UTF-8 (with/without BOM), UTF-16LE/BE (with/without BOM), Shift_JIS, EUC-JP, ISO-2022-JP, and windows-1252 XML files decodes accurately without mojibake, preserves BOM awareness in the status bar, and accurately drives `assumedEncoding` in worker well-formedness checks.
  - Zero new npm dependencies and zero relaxation of CSP or `packages/core` DOM-free rules.
- **Negative / Limitations:**
  - Only file **opening/decoding** is implemented in M1 stage 2; **saving/exporting** in original or non-UTF-8 encodings is deferred (browsers' native `TextEncoder` only encodes UTF-8).
  - Real-browser verification across Chromium, Firefox, and WebKit has not been run in AI Studio (**unverified**).
  - **Asymmetric 1 MB preview size check:** File loading enforces the 1 MB (`1,048,576`-byte) cap against raw file bytes (`file.size` / `bytes.byteLength`), whereas `runWorkerCheck` re-checks the decoded string as UTF-8 bytes via `TextEncoder`; a non-UTF-8 file under 1 MB (e.g., 700,007 Shift_JIS bytes) can expand past 1 MB in UTF-8 (1,050,007 bytes) and trigger `preview.tooLarge` after decoding.

## Alternatives Considered

- **Calling `TextDecoder` inside `packages/core`:** Rejected to preserve strict DOM/Web-API-free `"lib": ["ES2022"]` portability in `@xmlens/core` (`TextDecoder` is part of `DOM`/WHATWG globals, not ECMAScript ES2022).
- **Continuing with `file.text()` or non-fatal `TextDecoder`:** Rejected because `file.text()` always assumes UTF-8 and non-fatal decoding silently corrupts CJK/UTF-16 files with `U+FFFD` replacement characters.
