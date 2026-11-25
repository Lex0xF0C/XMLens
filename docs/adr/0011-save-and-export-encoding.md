# ADR-0011: Save and Export Encoding, BOM, Line Ending, and Browser API Strategy

- **Status:** Proposed (awaiting maintainer approval — no save/export code implemented yet)
- **Date:** 2026-11-25

## Context

In M1 stage 2 (`ADR-0010`), XMLens added file-opening autodetection and decoding for UTF-8 (with/without BOM), UTF-16LE/BE (with/without BOM), Shift_JIS, EUC-JP, ISO-2022-JP, and windows-1252. However, saving and exporting edited XML documents back to disk is not yet implemented.

Web platform encoding APIs are asymmetric:

- **Verified in Node.js v22 (`node -e "console.log(new TextEncoder().encoding)"`) and per WHATWG Encoding Standard §7.2:** `TextEncoder` supports **only UTF-8** (`encoding === 'utf-8'`) and takes no encoding parameter. Native browser APIs cannot encode text directly to Shift_JIS, EUC-JP, ISO-2022-JP, or windows-1252.
- **Self-implemented UTF-16LE/BE encoding:** Encoding JavaScript UTF-16 strings to `UTF-16LE` or `UTF-16BE` bytes (plus optional `FF FE` / `FE FF` BOM) is straightforward in pure TypeScript (`Uint8Array` / `DataView`), provided UTF-16 surrogate pairs are validated so lone surrogates are rejected or handled explicitly rather than written as invalid XML/UTF-16.
- **Unverified in this proposal:** Behavior across real desktop/mobile browsers (Chromium, Firefox, WebKit) for `TextEncoder`, `<a download>` + `Blob`, and `showSaveFilePicker()` has not been tested in AI Studio; third-party encoding-table npm packages have not been installed or audited for license, bundle size, or maintenance status (**unverified**).

## Encoding Options Compared

| Option                                                                                                       | Summary                                                                                                                                                                                                                                  | Pros                                                                                                                                          | Cons / Risks                                                                                                                                                                                                                                        | Verification Status                                                             |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **1. Always save as UTF-8; warn if XML declaration disagrees (do not silently rewrite declaration)**         | Encode editor content using `TextEncoder` (UTF-8), preserving or optionally adding/keeping UTF-8 BOM only if chosen; warn the user when `encoding="..."` in XMLDecl is non-UTF-8 instead of modifying XML bytes silently.                | Zero new dependencies, zero encoding-table bundle cost, lossless Unicode representation, preserves XML text fidelity without silent mutation. | Saved file would be invalid XML if a user ignores the warning and keeps e.g. `encoding="Shift_JIS"` on UTF-8 bytes without updating the declaration.                                                                                                | `TextEncoder` UTF-8 support **verified** in Node 22; browser UX **unverified**. |
| **2. Rewrite XML declaration `encoding="..."` to `"UTF-8"` on save (with explicit user confirmation)**       | Prompt/confirm with the user before updating `encoding="..."` to `"UTF-8"` (or adding UTF-8 encoding attribute) and saving via `TextEncoder`.                                                                                            | Output is guaranteed self-consistent UTF-8 XML; zero new dependencies; avoids CJK/legacy encoding data loss.                                  | Modifies XML declaration text (acceptable only with explicit user confirmation, never silently).                                                                                                                                                    | Same as Option 1 (**unverified** browser UI).                                   |
| **3. Self-implemented UTF-8 + UTF-16LE/BE only; non-UTF legacy encodings explicitly unsupported for export** | Support UTF-8 (`TextEncoder`) and self-written UTF-16LE/BE encoders (with strict surrogate-pair validation); disable or warn clearly when attempting to save Shift_JIS / EUC-JP / ISO-2022-JP / windows-1252 unless converting to UTF-8. | Zero new dependencies, small code footprint (~50 LOC), covers XML 1.0 mandatory Unicode encodings (`UTF-8` and `UTF-16`).                     | Does not satisfy workflows that strictly require writing Shift_JIS / EUC-JP files back in their original encoding.                                                                                                                                  | UTF-16 surrogate validation logic straightforward; browser test **unverified**. |
| **4. Add third-party character-encoding table dependency (e.g., Shift_JIS/EUC-JP encoder)**                  | Bundle a JS library containing legacy encoding mapping tables to write Shift_JIS / EUC-JP / ISO-2022-JP / windows-1252 bytes.                                                                                                            | Preserves legacy single/multi-byte encodings on save (except characters unrepresentable in the target charset).                               | Large bundle-size impact (JIS/multi-byte lookup tables), unrepresentable-character error handling complexity, and **license / size / maintenance status are currently unverified** (`AGENTS.md` §4.1.3 / §4.1.6 / §4.1.7).                          | **Unverified** (not audited or installed).                                      |
| **5. Original-byte diff write-back**                                                                         | Keep original `Uint8Array` and patch only edited regions back in original encoding.                                                                                                                                                      | Minimizes byte diffs in untouched regions.                                                                                                    | Extremely high complexity: byte offsets drift relative to UTF-16 editor offsets, partial encoding of newly typed Unicode into legacy charsets still requires Option 4 tables, and conflict resolution breaks cleanly under CodeMirror / formatting. | Rejected complexity in assessment; not prototyped.                              |

## Additional Design Dimensions

### Save API Mechanisms (Browser Compatibility)

- **File System Access API (`window.showSaveFilePicker` / `FileSystemFileHandle.createWritable`):** Available in Chromium-based browsers over secure contexts; enables in-place overwrite or Save As picker, but is **not available** in Firefox or Safari (`IMPLEMENTATION_PLAN.md` §5.1 progressive enhancement). **Unverified** in real browsers here.
- **Fallback `<a download>` + `Blob` / `URL.createObjectURL`:** Works across Chromium, Firefox, and WebKit for exporting/downloading a copy (must revoke object URLs cleanly and avoid blocked popups or `window.open`). **Unverified** in real browsers here.

### Byte Order Mark (BOM) Preservation

- Open decisions for maintainer:
  - Should files opened with a BOM (`loadedEncodingInfo.hasBom === true`) preserve that BOM by default on save, strip it by default, or expose a per-save / settings toggle (e.g., "Preserve BOM on save")?
  - Note: for UTF-16 exports, XML 1.0 Appendix F / RFC 2781 strongly favors including a BOM unless out-of-band charset metadata exists.

### Line Ending (`LF` vs `CRLF`) Normalization

- Browser `<textarea>` (and standard DOM string pipelines) normalize line endings to `\n` (`LF`) upon `textarea.value` assignment, losing original `\r\n` (`CRLF`) bytes from Windows XML files.
- Open decision: Whether M1 preserves/offers a line-ending option (`LF` vs `CRLF`, detected from raw bytes before decoding) at save time or standardizes on `LF` in v1 (and how CodeMirror 6 in M1b handles line separators).

### Post-Edit `assumedEncoding` Behavior During In-Session Checking

- **Current behavior (M1 stage 2):** Once the user edits `textarea` (`input` event), `isModifiedSinceLoad` becomes `true` and `lastAssumedEncoding` resets to `undefined` because the buffer is now an in-memory JS string rather than raw file bytes. As a result, a document with `<?xml version="1.0" encoding="Shift_JIS"?>` begins emitting `XML_ENCODING_DECLARATION_NOTE` (`info`: declared `"Shift_JIS"` vs assumed `UTF-8`) after the first edit.
- **Design point:** Is emitting that `info` diagnostic after editing desired (accurately reminding the user that live edits in memory are UTF-8/UTF-16 and cannot yet be saved back as Shift_JIS), or should target-encoding metadata remain pinned to the tab until save-time conversion?

## Decision Requested From Maintainer

Before implementing M1 save/export, maintainer approval is requested on:

1. **Output encoding strategy (Recommended: Option 3 + Option 2 confirmation flow for legacy encodings):** Support **UTF-8** and **UTF-16LE/BE** natively (zero dependencies), and for documents opened from Shift_JIS / EUC-JP / ISO-2022-JP / windows-1252, offer saving as UTF-8 with an explicit prompt to update `encoding="..."` to `"UTF-8"` (never rewriting silently, and never adding unverified encoding-table packages without a separate dependency review ADR).
2. **Save transport:** Standardize on `<a download>` + `Blob` as the baseline cross-browser export mechanism first, with optional progressive enhancement to `showSaveFilePicker()` in Chromium (`M1`/`M5`).
3. **BOM default:** Confirm whether to preserve detected BOM on save by default (`UTF-8 BOM` / `UTF-16 BOM`) with an explicit user control.
4. **Line endings:** Confirm whether `LF` is acceptable for initial M1 save or if raw-byte `CRLF`/`LF` detection & preservation on save is required.
5. **Post-edit `XML_ENCODING_DECLARATION_NOTE`:** Confirm keeping the current behavior (show `info` note once edited in memory) or suppressing/adapting it when a target save encoding is selected.
