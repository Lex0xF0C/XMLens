# ADR-0012: Pure TypeScript XML Formatter (Pretty-Print) & Editor Replacement Strategy

- **Status:** Accepted (formatter engine, worker execution, and output limits implemented and unit-tested; live-browser verification pending)
- **Date:** 2026-11-25

## Context

Milestone M1 requires **Format / pretty-print / indent, whitespace options** (`docs/IMPLEMENTATION_PLAN.md` §3.1, P0) implemented in pure, DOM-free TypeScript (`packages/core`) without adding new npm dependencies, while strictly preserving XML fidelity (unexpanded entities, character references, attribute quoting/order, comments, CDATA sections, processing instructions, DOCTYPE internal subsets, mixed content, and `xml:space="preserve"` subtrees).

In addition, the M1 `<textarea>` workbench UI needs a **Format** toolbar action that replaces editor contents cleanly while addressing cursor/selection behavior, accessibility, and browser Undo limitations.

## Empirical Investigation (Verified Before Implementation)

### 1. `saxes@6.0.0` Event & `parser.position` Probe

We probed `SaxesParser({ xmlns: true, position: true })` directly in Node.js `v22.23.5` against an XML sample containing `<?xml ...?>`, `<!DOCTYPE r [<!ENTITY title "T">]>`, `<!-- c -->`, `<?pi a?>`, attribute `&amp;x`, DTD entity `&title;`, `<![CDATA[x]]>`, and trailing whitespace:

- **Event payloads expand references:** `saxes` resolves `&amp;` and numeric character references in `text` and `opentag.attributes`, normalizes attribute syntax, and does not expand internal DTD general entities (`&title;` emits `error: undefined entity.` unless suppressed/ignored). Re-serializing from `saxes` event values would therefore corrupt raw source text, attribute formatting, and DTD entity references (`&title;`).
- **Inconsistent `parser.position` boundaries across event types:**
  - `xmldecl`, `doctype`, and `processinginstruction` report `parser.position` immediately _after_ closing `?>` or `>`.
  - `comment` reports `parser.position` _before_ the closing `>` (pointing at `>` itself).
  - `text` fires _after_ consuming the `<` of the following construct (`char@pos` points into the next tag/comment/PI rather than the end of the text).
  - Reconstructing raw slices purely from `parser.position` offsets would require fragile construct-specific backtracking and error recovery for `&title;`.

### 2. `<textarea>` Value Replacement & Undo API Probe

We inspected `node_modules/typescript/lib/lib.dom.d.ts` (TypeScript 5.8 DOM typings):

- `HTMLTextAreaElement.setRangeText(replacement, start, end, selectionMode)` is a standard, non-deprecated HTML Living Standard method.
- `Document.execCommand(commandId, showUI, value)` is explicitly marked `@deprecated` in `lib.dom.d.ts` and the W3C Editing spec.
- **Unverified in AI Studio:** Actual runtime `Ctrl+Z` / `Cmd+Z` native Undo behavior for `setRangeText` vs `execCommand('insertText')` across Windows Chrome/Edge, Firefox, and WebKit cannot be executed in this headless container and remains **unverified**.

## Formatter Architecture Options Compared

| Option                                                                  | Summary                                                                                                                      | Pros                                                                                                                             | Cons / Risks                                                                                                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `saxes` event re-serialization**                                   | Walk `saxes` events and re-build tags, attributes, and text strings.                                                         | No separate tokenizer needed.                                                                                                    | Destroys `&amp;` / `&#x...;` / `&title;` source forms, attribute quotes/whitespace, and entity-unexpanded DTD documents. Rejected.                                |
| **B. `saxes` event stream + `parser.position` slicing**                 | Use `saxes` events as token boundaries and slice original source text via `parser.position`.                                 | Reuses `saxes` tag/attribute parsing.                                                                                            | `parser.position` points inconsistently before `>`, after `?>`, or past `<`, and `error` fires on `&title;`. Fragile boundary math. Rejected.                     |
| **C. `checkWellFormedness` gate + lossless XML source slicer** (Chosen) | Gate on `checkWellFormedness(text)` first; for well-formed input, run a zero-copy-slice tokenizer over exact `[start, end)`. | **100% lossless** on every tag, attribute, entity (`&amp;`, `&#x...;`, `&title;`), comment, CDATA, PI, DOCTYPE, and non-WS text. | Must keep the lossless scanner strictly aligned with XML 1.0 lexical boundaries (BOM, `<?xml`, `<?pi`, `<!--`, `<![CDATA[`, `<!DOCTYPE [...] >`, tags, end tags). |

## Decision

### 1. Formatter Engine (`packages/core/src/formatter.ts`) — Option C

1. **Pre-validation gate (`Result` discriminated union, never throws):**
   - `formatXml(text, options?)` first runs `checkWellFormedness(text)`.
   - If `!wf.wellFormed`, returns `{ ok: false, diagnostics: wf.diagnostics }` without modifying the input.
   - If `wf.wellFormed`, returns `{ ok: true, formatted, changed, diagnostics: wf.diagnostics }` so any existing non-fatal diagnostics (e.g. `XML_DTD_ENTITY_EXPANSION_DISABLED`, `XML_ENCODING_DECLARATION_NOTE`) remain observable.
   - The entire `formatXml` execution is wrapped in `try/catch` so unexpected runtime errors (including `RangeError` when formatted indentation exceeds `MAX_FORMATTED_CHARS = 256 * 1024 * 1024` characters, safely below V8's `536,870,888`-char `MAX_STRING_LENGTH`) return `{ ok: false, diagnostics: [XML_FORMAT_INTERNAL_ERROR] }` rather than throwing.
2. **Exact boundary of what changes vs. what is preserved byte-for-byte:**
   - The lossless tokenizer partitions well-formed `text` into contiguous `[start, end)` slices whose concatenation equals `text` identically.
   - **Never modified (verbatim source slices):** leading UTF-16 `\uFEFF` BOM (if present), `<?xml ... ?>`, `<!DOCTYPE ...>` (including internal subsets), `<!-- ... -->`, `<![CDATA[ ... ]]>`, `<?target ...?>`, start tags `<name ...>` / `<name .../>` (attribute order, quotes, whitespace, entity/char refs), end tags `</name>`, all non-whitespace text tokens (including `&amp;`, `&#x...;`, `&title;`, CJK, surrogate pairs like `𠮷`), whitespace inside leaf elements without child elements/comments/PIs (e.g. `<empty>   </empty>`), all whitespace inside **mixed-content** subtrees (any element with a non-whitespace text or CDATA child), and all whitespace inside **`xml:space="preserve"`** subtrees (inherited by descendants until overridden by `xml:space="default"`).
   - **Modified ONLY:** whitespace-only text tokens (`^[ \t\r\n]*$`) **between** top-level prolog/root/epilog nodes or inside non-mixed, non-`xml:space="preserve"` container elements that contain at least one child element, comment, or processing instruction.
   - **Iterative traversal & idempotency:** Element formatting and verbatim subtree rendering use explicit heap stacks (no JS call-stack recursion) so deep nesting (verified up to 5,000+ levels end-to-end and 100,000 levels in the iterative formatter pipeline under `xml:space="preserve"`) never throws `RangeError: Maximum call stack size exceeded`. Emits `\n` (LF) + `indentUnit.repeat(depth)` for container children and joins top-level prolog/root/epilog nodes with `\n` without adding a trailing newline, guaranteeing `formatXml(formatXml(x)) === formatXml(x)`.
3. **Options (Minimal M1 Scope):**
   - `indentStyle?: 'spaces-2' | 'spaces-4' | 'tab'` (default `'spaces-2'`).
   - Line ending output in `core` is fixed to `LF` (`\n`); `CRLF` / `LF` conversion remains the Save dialog's responsibility (`ADR-0011`) so `<textarea>` and worker offsets stay unified on `LF`.
   - **Deferred (Future):** Attribute wrapping/alignment, compact empty-element collapsing, and configurable blank-line preservation.

### 2. UI Toolbar Action & `<textarea>` Replacement Strategy (`packages/app`)

> **Accepted:** 2026-11-26 (maintainer approval). Note: Synchronous main-thread formatting described in the initial draft (`formatEditorXml` directly in the click handler with `worker-error` fallback) has been **replaced by the Addendum below (Web Worker offloading via `@xmlens/workers`)**.

- Add a working **Format** (`toolbar.format`, `#format-button`) button to the workbench toolbar paired with an accessible **Indent** selector (`#indent-select`: `2 spaces`, `4 spaces`, `Tab`).
- **Size guard & Worker execution (superseded by Addendum):** Inputs exceeding `MAX_PREVIEW_BYTES` (`1 MiB` UTF-8) trigger `too-large` before dispatching; valid-sized inputs run asynchronously in `@xmlens/workers` (`formatXml` RPC with `maxOutputChars: MAX_PREVIEW_BYTES`, `15s` timeout, cancellation, and `enforceFormattedByteLimit` UTF-8 check on return). `formatEditorXml` in `packages/app/src/decodeXml.ts` now exists purely as a DOM-free test helper mirroring the worker policy.
- **Replacement API:** Use standard non-deprecated `textarea.setRangeText(formatted, 0, textarea.value.length, 'start')` (falling back to `.value = formatted` if unavailable), avoiding `@deprecated` `document.execCommand('insertText')` and avoiding stealing keyboard focus from the **Format** button when activated via keyboard.
- **Limitation & Future M1b Path:** Programmatic `setRangeText` replacement in `<textarea>` typically clears or does not register a native `Ctrl+Z` / `Cmd+Z` undo entry (exact browser behavior unverified). The `<textarea>` replacement strategy itself is expected to be replaced by CodeMirror 6 (`EditorState` / `@codemirror/commands` multi-step history) in M1b (`ADR-0005`).
- After formatting succeeds and modifies text, set `isModifiedSinceLoad = true` and trigger `runWorkerCheck`; if formatting fails (`!ok`), `classifyFormatFailure` distinguishes `preview.formatInvalid` (`'invalid'`), `preview.formatOutputTooLarge` (`'output-too-large'`), and `preview.formatError` (`'internal-error'`).

## Measured Performance

To evaluate synchronous main-thread execution vs. `AGENTS.md` §4.2.6 ("Run heavy work ... in Web Workers"), we measured `formatXml` (compiled from `packages/core/src/formatter.ts` via `esbuild`) across 5 timed runs after 1 warmup run in **Node.js `v22.23.5` (`x64`, `linux`)**:

| ~1 MiB Workload                                                   | Input Bytes | Result                                    | Output Chars  | Run Times (ms)                           | Median (ms)  |
| ----------------------------------------------------------------- | ----------- | ----------------------------------------- | ------------- | ---------------------------------------- | ------------ |
| Flat document (`41,943` elements, depth 2)                        | `1,048,563` | `ok: true`                                | `1,174,390`   | `224.7, 217.6, 191.6, 155.9, 148.7`      | **`191.6`**  |
| Medium depth (`149,001` elements, 748 depth-200 subtrees)         | `1,048,228` | `ok: true`                                | `60,945,484`  | `916.5, 909.3, 1020.3, 883.4, 930.3`     | **`916.5`**  |
| Extreme depth (`9,981` nested `<a p="...">` elements)             | `1,047,904` | `ok: true`                                | `200,268,664` | `2134.7, 2181.6, 2151.4, 2114.3, 2066.3` | **`2134.7`** |
| Extreme depth (`59,001` `<a xmlns="x">` container -> guard)       | `1,003,004` | `ok: false` (`XML_FORMAT_INTERNAL_ERROR`) | `0`           | `152.9, 157.8, 141.9, 179.7, 171.8`      | **`157.8`**  |
| Extreme depth (`59,001` `<a xmlns="x">` + `xml:space="preserve"`) | `1,003,025` | `ok: true`                                | `1,003,025`   | `211.2, 197.0, 177.7, 280.3, 215.0`      | **`211.2`**  |

Note on `saxes` scaling: on deeply nested elements **without** `xmlns` bindings on each element (e.g., `<a>` repeated 10,000+ times), `saxes@6.0.0`'s `resolve(prefix)` walks ancestor tags linearly ($O(D^2)$), so `checkWellFormedness` alone can exceed 1–3+ seconds at depth 10,000–17,000 (~139 s at depth 100,000 in un-namespaced XML).

**Important:** Actual browser main-thread responsiveness, perceived UI freeze, and `<textarea>.setRangeText` / CodeMirror layout-reflow cost across Chromium, Firefox, and WebKit are **unverified** in AI Studio.

### Decision Input for M1b (Resolved — Implemented in Addendum Below)

- **Rationale for moving `formatXml` into `@xmlens/workers`:** Even a 1 MiB flat document takes ~192 ms in Node (`> 50 ms` INP responsiveness budget), medium/deep 1 MiB documents take ~0.9–2.1 s, and un-namespaced deep nesting can trigger multi-second `saxes` runs—all of which freeze the browser main thread when run synchronously and benefit from worker timeouts and cancellation (`AGENTS.md` §4.2.6).
- **Trade-offs addressed:** Moving `formatXml` to `@xmlens/workers` uses asynchronous editor replacement with epoch + text-snapshot stale-result discard (`shouldDiscardAsyncFormatResult`) when the user edits or issues a newer request while formatting is in flight, alongside a `1 MiB` output limit aligned with `MAX_PREVIEW_BYTES`.

## Consequences

- **Positive:** Zero new npm dependencies; `packages/core` remains DOM-free (`ES2022`); formatting is 100% lossless on entities, DTDs, CDATA, mixed content, and `xml:space="preserve"`, stack-safe on deep nesting, guarded against `RangeError`/OOM and oversized formatted output, non-blocking via `@xmlens/workers`, and guaranteed idempotent.
- **Unverified (pending live-browser check):**
  - `<textarea>.setRangeText` and native `Ctrl+Z` / `Cmd+Z` undo behavior
  - Live browser responsiveness and Web Worker cancellation UX
  - Keyboard focus behavior across Windows browsers (and Chromium/Firefox/WebKit)

## Addendum (2026-11-25): Output Cap Alignment, Failure Classification & Worker Execution

**Accepted:** 2026-11-26 (maintainer approval). Following review of the initial M1 formatter implementation, the following improvements were applied before advancing this ADR to `Accepted`:

1. **Practical Output-Size Limit (`1 MiB` Alignment in `packages/app`):**
   - `packages/core` `FormatXmlOptions` now accepts an optional `maxOutputChars?: number` (preserving `MAX_FORMATTED_CHARS = 256 * 1024 * 1024` as the default for direct `core` callers). `FormattedOutputBuffer` throws `FormatOutputLimitError` (`extends RangeError`) when exceeded, and `formatXml` maps `FormatOutputLimitError` to `XML_FORMAT_OUTPUT_TOO_LARGE` (`diagnostics.xml.formatOutputTooLarge`, `source: 'core'`), keeping unexpected runtime errors under `XML_FORMAT_INTERNAL_ERROR`.
   - `packages/app` passes `maxOutputChars: MAX_PREVIEW_BYTES` (`1,048,576`) to the worker and also enforces `enforceFormattedByteLimit(result, MAX_PREVIEW_BYTES)` via `utf8ByteLength`, rejecting multi-byte XML outputs whose UTF-16 character length fits within `1,048,576` chars but whose UTF-8 byte length exceeds `1 MiB` (emitting `XML_FORMAT_OUTPUT_TOO_LARGE` with `diagnostics.xml.formatOutputTooLargeBytes`) without mutating `<textarea>`.
2. **Explicit Format Failure Classification in UI (`classifyFormatFailure`):**
   - `packages/app` distinguishes three failure classes in `ValidationStatus`: parser well-formedness rejections (`'invalid'` -> `preview.formatInvalid` + `statusBar.notWellFormed`), output-limit rejections (`'output-too-large'` -> `format-failed` with `preview.formatOutputTooLarge` + `statusBar.formatFailed`), and internal/worker/timeout errors (`'internal-error'` -> `format-failed` with `preview.formatError` + `statusBar.formatFailed`, eliminating reuse of `preview.workerError`).
3. **Web Worker Offloading (`@xmlens/workers`):**
   - Added versioned `'formatXml'` request/response handling (`WORKER_PROTOCOL_VERSION = 1`) in `packages/workers` with strict option validation (`INVALID_REQUEST` on invalid `indentStyle`, negative/non-finite `maxOutputChars`, or invalid option types).
   - Added `client.format(text, options?, { timeoutMs? })` (`DEFAULT_FORMAT_TIMEOUT_MS = 15_000`) sharing the single `pending` slot with `client.check()` so double-clicking **Format**, typing, opening a file, or clicking **Check** mutually supersedes prior in-flight work.
   - `packages/app/src/main.ts` invokes `workerClient.format(...)` asynchronously, displays `statusBar.checking` while running, discards stale responses via `shouldDiscardAsyncFormatResult({ requestEpoch, currentEpoch, sentText, currentTextareaValue })`, and leaves `<textarea>` untouched on any failure or cancellation.
