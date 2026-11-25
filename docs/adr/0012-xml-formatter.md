# ADR-0012: Pure TypeScript XML Formatter (Pretty-Print) & Editor Replacement Strategy

- **Status:** Proposed (implemented for M1 review; awaiting maintainer acceptance and live browser verification)
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
2. **Exact boundary of what changes vs. what is preserved byte-for-byte:**
   - The lossless tokenizer partitions well-formed `text` into contiguous `[start, end)` slices whose concatenation equals `text` identically.
   - **Never modified (verbatim source slices):** leading UTF-16 `\uFEFF` BOM (if present), `<?xml ... ?>`, `<!DOCTYPE ...>` (including internal subsets), `<!-- ... -->`, `<![CDATA[ ... ]]>`, `<?target ...?>`, start tags `<name ...>` / `<name .../>` (attribute order, quotes, whitespace, entity/char refs), end tags `</name>`, all non-whitespace text tokens (including `&amp;`, `&#x...;`, `&title;`, CJK, surrogate pairs like `𠮷`), whitespace inside leaf elements without child elements/comments/PIs (e.g. `<empty>   </empty>`), all whitespace inside **mixed-content** subtrees (any element with a non-whitespace text or CDATA child), and all whitespace inside **`xml:space="preserve"`** subtrees (inherited by descendants until overridden by `xml:space="default"`).
   - **Modified ONLY:** whitespace-only text tokens (`^[ \t\r\n]*$`) **between** top-level prolog/root/epilog nodes or inside non-mixed, non-`xml:space="preserve"` container elements that contain at least one child element, comment, or processing instruction.
   - **Idempotency:** Emits `\n` (LF) + `indentUnit.repeat(depth)` for container children and single `\n` separators between top-level prolog/root nodes (ending with `\n` when the formatted output ends at root closing/prolog), guaranteeing `formatXml(formatXml(x)) === formatXml(x)`.
3. **Options (Minimal M1 Scope):**
   - `indentStyle?: 'spaces-2' | 'spaces-4' | 'tab'` (default `'spaces-2'`).
   - Line ending output in `core` is fixed to `LF` (`\n`); `CRLF` / `LF` conversion remains the Save dialog's responsibility (`ADR-0011`) so `<textarea>` and worker offsets stay unified on `LF`.
   - **Deferred (Future):** Attribute wrapping/alignment, compact empty-element collapsing, and configurable blank-line preservation.

### 2. UI Toolbar Action & `<textarea>` Replacement Strategy (`packages/app`)

- Add a working **Format** (`toolbar.format`, `#format-button`) button to the workbench toolbar paired with an accessible **Indent** selector (`#indent-select`: `2 spaces`, `4 spaces`, `Tab`).
- **Size guard:** Inputs exceeding the 1 MB UTF-8 preview limit (`utf8ByteLength > MAX_PREVIEW_BYTES`) trigger `too-large` without running synchronous formatting on the main thread.
- **Replacement API:** Use standard non-deprecated `textarea.setRangeText(formatted, 0, textarea.value.length, 'start')` (falling back to `.value = formatted` if unavailable), avoiding `@deprecated` `document.execCommand('insertText')` and avoiding stealing keyboard focus from the **Format** button when activated via keyboard.
- **Limitation & Future M1b Path:** Programmatic `setRangeText` replacement in `<textarea>` typically clears or does not register a native `Ctrl+Z` / `Cmd+Z` undo entry (**exact Windows Chrome/Edge/Firefox/WebKit behavior unverified**). Full multi-step Undo/Redo across Format operations will be provided by CodeMirror 6's `EditorState` / `@codemirror/commands` history in M1b (`ADR-0005`).
- After formatting succeeds and modifies text, set `isModifiedSinceLoad = true` and schedule the debounced worker well-formedness re-check; if `formatXml` fails (`!ok`), render its `diagnostics` in the existing diagnostics list with `preview.formatInvalid` without adding separate error UI.

## Consequences

- **Positive:** Zero new npm dependencies; `packages/core` remains DOM-free (`ES2022`); formatting is 100% lossless on entities, DTDs, CDATA, mixed content, and `xml:space="preserve"`, and guaranteed idempotent.
- **Negative / Unverified:** Live browser behavior for `<textarea>.setRangeText`, native `Ctrl+Z` undo behavior, and toolbar keyboard focus across Chromium, Firefox, and WebKit remain **unverified** in AI Studio.
