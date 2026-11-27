# ADR-0014: Cursor-Position XPath Breadcrumb (`getXPathAtOffset`)

- **Status:** Accepted (2026-11-27)
- **Date:** 2026-11-27

## Context

In Milestone M1, users editing XML in the workbench `<textarea>` need immediate structural orientation showing which element currently contains the text cursor (for example, `akomaNtoso › act › body › article[2]`). Looking ahead, the same DOM-free core primitive will also populate `Diagnostic.xpath` and support the M2 tree-to-editor synchronization and M4 XPath panel.

Implementing this safely in XMLens requires addressing four design constraints:

1. **Offset & tokenization consistency with `formatXml`:** Both formatting and cursor lookup partition XML into exact UTF-16 code-unit spans (`BOM`, declarations, DOCTYPE subsets, comments, PIs, CDATA, tags, and text), including CJK text and UTF-16 surrogate pairs.
2. **Tag-boundary ambiguity:** A text caret sits _between_ characters (`[0, xml.length]`), so boundary offsets (`|<tag>`, `<tag>|`, `</tag>|`, `<a>|</a>`, `<a/>|<b/>`) require explicit, deterministic rules.
3. **Namespace-agnostic canonical path vs. readable display path:** Prefix names can vary or be redeclared (`xmlns`, `xmlns:a`, `xmlns:b`, `xmlns=""`), so internal paths must not break when prefixes differ, while the status bar needs a concise human-readable breadcrumb.
4. **Worker concurrency:** `createWellFormednessWorkerClient` uses a single pending request slot and terminates the worker to cancel superseded work. Sharing that slot with cursor XPath lookups would cancel in-flight well-formedness checks or formatting jobs on every keystroke or arrow-key movement.

## Decision

1. **Shared Lossless Tokenizer (`packages/core/src/xmlTokenizer.ts`):**
   Extract `tokenizeXmlForFormat` and `XmlToken` from `packages/core/src/formatter.ts` into an internal module (`packages/core/src/xmlTokenizer.ts`) without altering token shapes or formatting behavior. `getXPathAtOffset` accumulates `token.raw.length` to derive exact `[start, end)` UTF-16 code-unit offsets.

2. **Pure Iterative `getXPathAtOffset(xml, offset)` (`packages/core/src/xpathAtOffset.ts`):**
   - Gates on `checkWellFormedness(xml)` first, returning a discriminated union (`{ ok: false, reason: 'empty' | 'not-well-formed' | 'internal-error' }`) without throwing.
   - Clamps `offset` to `[0, xml.length]` (flooring finite numbers; `NaN` / `<= 0` → `0`).
   - Uses an explicit iterative stack (safe at 5,000+ levels without `RangeError`) and quote-aware attribute scanning on start tags (`xmlns` / `xmlns:*`, plus built-in `xml:` binding) to resolve each element's `(namespaceURI, localName)` expanded name and count siblings by expanded name across distinct prefixes.
   - **Tag-boundary rule (strict open interior):** An element spanning `[start, end)` contains `offset` iff `start < offset && offset < end`. Consequently:
     - Cursors immediately before `<tag` (`offset === start`) or immediately after `>` of `</tag>` / `<tag/>` (`offset === end`) belong to the parent element (or outside root, returning `{ ok: true, segments: [], xpath: '', breadcrumb: '' }` in prologue, BOM, or epilogue).
     - Cursors inside `<tag ...>`, `<tag .../>`, `</tag>`, or between `>` and `<` (including `<a>|</a>`, text, comments, CDATA, and PIs) resolve to that element.
   - **Canonical `xpath` vs. display `breadcrumb`:**
     - `xpath` uses XPath 3.1 `URIQualifiedName` (`BracedURILiteral`) syntax `/Q{uri}local[n]` for every segment, using `Q{}local[n]` when unbound (`namespaceURI === ''`) so the grammar is uniform and independent of prefix or default-namespace context.
     - `breadcrumb` joins `segment.qname` with `' › '` (U+203A), appending `[index]` only when `siblingCount > 1` for the same expanded name.

3. **Separate Worker Client (`createXPathWorkerClient` in `packages/workers`):**
   Add `'getXPathAtOffset'` to the versioned RPC protocol (`protocol.ts` / `handler.ts`) with strict payload validation (`string` XML, finite `number` offset), and add `createXPathWorkerClient` sharing an internal single-flight RPC helper in `client.ts`. `packages/app` spawns a separate `Worker` instance for `xpathWorkerClient` from the same `xmlWorker.ts` entrypoint, so rapid cursor movement cancels only stale XPath lookups and never interrupts `checkWellFormedness` or `formatXml`.

4. **Status Bar Integration (`packages/app`):**
   Debounce cursor-related textarea events (`keyup`, `mouseup`, `input`, `focus`, `select`) at `150 ms` (without relying solely on `selectionchange`), discard stale async responses via `(requestEpoch, sentText, sentOffset)` snapshots (`shouldDiscardAsyncXPathResult`), display `—` when empty, invalid, oversized, decoded with errors, or outside root, omit `aria-live` to avoid screen-reader chatter on caret moves, and provide full-path inspection via `title` on CSS-truncated breadcrumbs.

## Consequences

- **Positive:** Guarantees consistent UTF-16 offset semantics across well-formedness, formatting, and cursor XPath lookup; prevents cursor movement from starving or aborting validation/formatting workers; provides a reusable pure core primitive for M2 tree sync, `Diagnostic.xpath`, and M4 XPath features.
- **Negative / Maintenance:** Uses two Web Worker instances on the main page (sharing one bundled worker script) and runs `checkWellFormedness` + tokenization on debounced caret moves (measured at `159.01 ms` cold in Node for a `1,048,614`-char / ~1 MiB document). If future large-document tiers (M2 Spike S5) require sub-10 ms caret updates on multi-megabyte files, cached parse/index reuse can be added behind `XPathWorkerClient` without changing the public API.

## Alternatives Considered

- **Sharing `WellFormednessWorkerClient` single slot for XPath lookups:** Rejected because `check()` / `format()` and `getXPathAtOffset()` would terminate each other's workers on normal typing and cursor navigation.
- **Treating inclusive `[start, end]` as element containment:** Rejected because cursors placed immediately before `<child>` or after `</child>` (`<a/>|<b/>` or `  |<child>`) would misleadingly report the adjacent sibling rather than the parent container, and `offset === 0` before root would report the root element instead of empty prologue.
- **Using unprefixed `local[n]` for no-namespace `xpath` segments:** Rejected in favor of uniform `Q{}local[n]` (XPath 3.1 `URIQualifiedName`) so paths remain unambiguous even when default namespaces exist in the document or evaluation context.

## Unverified Assumptions & Pending Verification

- Live browser testing of `<textarea>` caret events, CJK IME composition, `selectionStart` timing across Chromium, Firefox, and WebKit, and Windows/macOS execution has not yet been performed (Node/Vitest unit verification only).
- Automated Playwright + axe accessibility checks remain pending `ADR-0006` implementation (`e2e-spike` targets the isolated spike first; main-app `e2e` follows M1b).

## M1b Migration Note (CodeMirror 6)

When Milestone M1b migrates the editor surface in `packages/app` from `<textarea>` to CodeMirror 6 (`ADR-0005`):

- `@xmlens/core`'s `getXPathAtOffset(xml, offset)` and `@xmlens/workers`'s `createXPathWorkerClient` RPC API remain **unchanged**.
- The editor caret offset source changes from `textarea.selectionStart` to CodeMirror's `state.selection.main.head`.
- Discarding stale async worker results and suppressing updates while IME composition is active uses the `shouldDiscardSpikeXPathResult` pattern proven in `spikes/codemirror/bridge.ts` (`isComposing` from `view.composing` alongside `requestEpoch`, document text, and head offset checks).
