# ADR-0003: XML Parser Selection for Worker Well-Formedness Diagnostics (M1a)

- **Status:** Accepted (implemented in `@xmlens/core` M1a-1; worker wiring pending M1a-2)
- **Date:** 2026-11-24

## Context

In Milestone M0, quick well-formedness checking uses the browser's `DOMParser` on the main UI thread. That approach has three blockers for Milestone M1:

1. `DOMParser` is **not available in Web Workers**, so parsing cannot move off the main thread.
2. `DOMParser` error diagnostics vary by browser engine (`parsererror` HTML snippets) and cannot run inside the DOM-free `packages/core` package.
3. `DOMParser` cannot enforce consistent entity-expansion protections or structured `{ line, column, offset }` ranges across browsers.

We need an XML well-formedness parser that runs both in Web Workers and in DOM-free `packages/core` (`lib: ["ES2022"]`), supports XML Namespaces and line/column reporting, prevents external entity fetching and entity-expansion attacks, complies with the repository license policy (`AGENTS.md` §4.1.3), and keeps first-load bundle size well within the `<= 1.5 MB` gzipped JS+WASM budget (`IMPLEMENTATION_PLAN.md` §7).

## Candidates Evaluated

All metadata below (`version`, `license`, `dist.unpackedSize`, `time.modified`, `dependencies`) was queried directly from the npm registry via `npm view` on 2026-11-24. Anything not directly observed in an installed bundle is marked **unverified**.

| Candidate             | Version  | License (npm + deps)                                         | Unpacked Size (npm) | Gzipped Bundle Size (ESM)         | Last npm Publish | DOM-free / Worker                                   | Namespaces & Line/Col                                                          |
| --------------------- | -------- | ------------------------------------------------------------ | ------------------- | --------------------------------- | ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`saxes`**           | `6.0.0`  | `ISC` (`xmlchars@2.2.0`: `MIT`)                              | `163,774` B         | **`8,176` B** (`28,788` B min JS) | `2022-05-17`     | Yes (pure JS/TS)                                    | Yes (`xmlns: true`, `line`, `column`, `columnIndex`, `position`)               |
| **`fast-xml-parser`** | `5.12.1` | `MIT` (6 deps all `MIT`)                                     | `1,337,290` B       | unverified                        | `2026-11-13`     | Yes (pure JS/TS)                                    | Partial (`XMLValidator` reports `line`/`col`; parser handles prefix stripping) |
| **`libxml2-wasm`**    | `0.7.2`  | `MIT` (underlying `libxml2` C notice: unverified in tarball) | `1,228,585` B       | unverified                        | `2026-09-07`     | Yes, via WASM                                       | Yes (`line`/`col` via libxml2 error output)                                    |
| **`xmllint-wasm`**    | `5.3.0`  | `MIT` (underlying `libxml2` C notice: unverified in tarball) | `875,339` B         | unverified                        | `2026-11-14`     | Yes, via WASM (Firefox worker-module caveats noted) | Yes (`xmllint` output)                                                         |
| **`sax`**             | `1.6.1`  | `BlueOak-1.0.0` (not in allowlist)                           | `61,678` B          | unverified                        | `2026-07-24`     | Yes                                                 | Partial (less strict XML compliance)                                           |
| **`txml`**            | `6.0.3`  | `MIT`                                                        | `132,519` B         | unverified                        | `2026-08-30`     | Yes                                                 | No (forgiving HTML-like parser, not strict XML)                                |

### Detailed Comparison

#### 1. `saxes` (`6.0.0`)

- **License:** `ISC`; sole runtime dependency `xmlchars@2.2.0` is `MIT` (verified in installed `node_modules/saxes/package.json` and `node_modules/xmlchars/package.json`). Both are in the `AGENTS.md` §4.1.3 allowlist.
- **Size:** `163,774` bytes unpacked (`dist.unpackedSize`); **measured** `28,788` bytes minified ESM and **`8,176` bytes gzipped (level 9)** via `esbuild` (`saxes` + `xmlchars`).
- **Maintenance:** Stable `6.0.0` release (`2022-05-17`), zero recent release churn (maintenance responsiveness to new issues is **unverified**; pure XML 1.0/1.1 spec parser rarely needs spec changes).
- **Namespaces & Line/Column:** Full XML 1.0/1.1 + XML Namespaces (`xmlns: true`), tracking 1-based `line`, 0-based Unicode code-point `column`, 0-based UTF-16 `columnIndex`, and 0-based UTF-16 `position`.
- **Entity Handling & Security:** Streaming non-validating parser. Recognizes only predefined XML entities (`&amp;`, `&lt;`, `&gt;`, `&apos;`, `&quot;`) and numeric character references (`&#...;`). Does **not** fetch external entities and does **not** automatically expand custom `<!ENTITY>` declarations from `<!DOCTYPE>`, neutralizing recursive DTD entity-expansion ("billion laughs") attacks.
- **Error Mapping to `Diagnostic`:** Emits `error` events with `${line}:${column}: <message>` strings. `packages/core` maps recognized `saxes` messages to semantic codes and `diagnostics.xml.*` locale keys, always preserving raw error text in `params.detail` and falling back to `XML_SYNTAX_ERROR`.

#### 2. `fast-xml-parser` (`5.12.1`)

- **License:** `MIT` (6 runtime dependencies — `strnum`, `is-unsafe`, `xml-naming`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher` — all `MIT` per npm).
- **Size:** `1,337,290` bytes unpacked (`dist.unpackedSize`), roughly 8x larger unpacked than `saxes` (tree-shaken `XMLValidator`-only size is **unverified**).
- **Maintenance:** Actively maintained (`2026-11-13`), though its advisory history includes entity-expansion DoS CVEs (`CVE-2026-26278`, `CVE-2026-33036`), requiring careful configuration of `processEntities` limits.
- **Namespaces & Line/Column:** `XMLValidator.validate()` returns `{ err: { code, msg, line, col } }`, though full namespace-error coverage in `XMLValidator` is **unverified**.

#### 3. `libxml2-wasm` (`0.7.2`) / `xmllint-wasm` (`5.3.0`)

- **License:** `MIT` on npm for both wrappers; underlying `libxml2` C library is MIT, though the exact bundled license notice inside the distributed npm tarball is **unverified** until inspected in Spike S4.
- **Size:** `1,228,585` bytes (`libxml2-wasm`) / `875,339` bytes (`xmllint-wasm`) unpacked; gzipped `.wasm` size is **unverified**.
- **CSP & Runtime Impact:** Running WebAssembly requires adding `'wasm-unsafe-eval'` to the CSP `script-src` directive in `packages/app/index.html` (`IMPLEMENTATION_PLAN.md` §5.1 notes this should only be added if required).
- **Entity Handling:** `libxml2` has strong protections when external entity loading and `XML_PARSE_HUGE` are disabled, though exact default parser flags exposed by `libxml2-wasm` `0.7.2` and `xmllint-wasm` `5.3.0` are **unverified** until Spike S4.

## Decision

**Accepted: `saxes` (`6.0.0`, `ISC`) for Milestone M1a well-formedness diagnostics in `packages/core` and future Web Workers.**

Rationale:

1. **Fits M1a scope cleanly:** Smallest strict XML 1.0/1.1 + Namespaces parser (`8,176` B gzipped including `xmlchars`), pure JS/TS with zero DOM dependencies (`lib: ["ES2022"]`).
2. **Preserves strict CSP in M1:** Requires no `'wasm-unsafe-eval'` relaxation in `index.html` and no heavy `.wasm` download on editor boot.
3. **Safe entity posture:** Never fetches external entities or DTDs and does not auto-expand custom DTD `<!ENTITY>` definitions, preventing entity-expansion bombs out of the box.
4. **Complementary to M3:** When XSD 1.0 and DTD validation are added in M3 (Spike S4), `libxml2-wasm` or `xmllint-wasm` will be lazy-loaded on demand in a validation worker without bloating M1's initial editor load.

## Verified behavior

Observed directly by installing `saxes@6.0.0` in `@xmlens/core`, inspecting `node_modules/saxes/saxes.js` and `saxes.d.ts`, measuring with `esbuild` + `zlib.gzipSync`, and running `packages/core/src/wellFormedness.test.ts` and `tests/fixtures/fixtures.test.mjs`:

1. **Measured bundle contribution:** `saxes@6.0.0` + `xmlchars@2.2.0` bundled together as minified ESM total **`28,788` bytes raw / `8,176` bytes gzipped (level 9)** (~0.5% of the `1.5 MB` first-load budget).
2. **Error continuation & cascading diagnostics:** When an `error` listener is registered on `SaxesParser`, `fail()` invokes the handler without throwing and continues scanning. A single syntax fault (such as `<root><a></b></root>` or whitespace-only input) can emit cascading or repeated `error` events (e.g., two `"unexpected close tag."` events at the same offset before `"unmatched closing tag: b."`, or `"document must contain a root element."` followed by `"unexpected end."`). `checkWellFormedness()` deduplicates identical `(code, offset, detail)` entries and caps diagnostics at `maxDiagnostics` (default `100`).
3. **Internal DTD `<!ENTITY>` & billion-laughs safety:** `saxes` parses `<!DOCTYPE ...>` into the `doctype` event in `< 1 ms` without expanding internal `<!ENTITY>` declarations and without fetching `SYSTEM`/`PUBLIC` external DTDs. When `&name;` later appears in text or attributes, `saxes` emits `"undefined entity."` with `parser.position` immediately after `;`. In `checkWellFormedness()`:
   - Declared internal entity names are extracted from `<!DOCTYPE ... [...]>` without expanding them; a `warning` diagnostic (`XML_DTD_ENTITY_EXPANSION_DISABLED`) is emitted once, and references to those declared entity names are suppressed so billion-laughs or valid internal-DTD documents do not emit misleading `"undefined entity"` well-formedness errors.
   - Undeclared entity references (`&missing;` with no matching `<!ENTITY>`) still emit an `error` diagnostic (`XML_UNDEFINED_ENTITY`).
   - External DTD references (`SYSTEM`/`PUBLIC`) emit a `warning` diagnostic (`XML_EXTERNAL_DTD_IGNORED`) confirming no network fetch occurred.
4. **Coordinates (`line`, `column`, `offset`):**
   - `parser.line` is 1-based; `parser.column` is **0-based Unicode code-point count** (`𠮷` U+20BB7 counts as 1); `parser.columnIndex` is **0-based UTF-16 code-unit index within the line**; `parser.position` is **0-based UTF-16 code-unit offset in the input string**.
   - Empirical observation on `<a/>hello` (length `9`): `parser.position` at EOF text-outside-root was `10` (`chunk.length + 1`). `checkWellFormedness()` clamps `offset = clamp(parser.position, 0, xml.length)` and normalizes `SourceRange` to `{ line: parser.line, column: parser.column + 1, offset }`. `offset` (UTF-16 code-unit index) is authoritative for JavaScript string slicing and editor selection.
5. **BOM, XML declaration encoding, and deep nesting:**
   - Leading UTF-8 BOM (`\uFEFF`) before `<?xml ...?>` or root element parses with zero errors (`position` includes the leading code unit).
   - `saxes` parses in-memory JavaScript UTF-16 strings regardless of `<?xml encoding="..."?>`; `checkWellFormedness()` emits an `info` diagnostic (`XML_ENCODING_DECLARATION_NOTE`) when `xmlDecl.encoding` declares a non-UTF-8/UTF-16 encoding (e.g., `ISO-8859-1`) or differs from `assumedEncoding`.
   - Deep nesting of `1,500`–`5,000` levels executes iteratively without stack overflow.
6. **Verified `saxes` error mapping:** Confirmed directly against `saxes.js` `fail()` sites (`emptyDocument`, `unboundNamespacePrefix`, `namespaceError`, `duplicateAttribute`, `unmatchedClosingTag`, `unexpectedCloseTag`, `unclosedTag`, `multipleRoots`, `textOutsideRoot`, `undefinedEntity`, `invalidEntity`, `declarationError`, and generic `XML_SYNTAX_ERROR` fallback preserving `detail`).

## Consequences

- **Positive:** Keeps `packages/core` pure TypeScript (`lib: ["ES2022"]`), keeps M1a-1 compact (`8.2 KB` gzipped), preserves strict CSP (`script-src 'self'`), prevents entity-expansion DoS, and provides exact UTF-16 offsets and localized `Diagnostic` objects.
- **Negative / Limitations:** `saxes` is a non-validating parser (no XSD or DTD validation — deferred to M3 Spike S4) and does not expand custom internal `<!ENTITY>` declarations (reported transparently via `XML_DTD_ENTITY_EXPANSION_DISABLED`).

## Alternatives Considered

- **`fast-xml-parser` (`XMLValidator`):** Viable `MIT` alternative with structured `{ code, msg, line, col }`, but significantly larger unpacked package (`1.34 MB`), more complex entity-expansion surface, and less specialized in strict XML namespace validation than `saxes`.
- **`libxml2-wasm` / `xmllint-wasm` in M1a:** Rejected for M1a well-formedness because it pulls a ~0.9–1.2 MB WASM payload into initial editing, requires CSP `'wasm-unsafe-eval'`, and duplicates Spike S4 (M3) prematurely.
- **`sax` / `txml`:** Rejected (`sax` uses `BlueOak-1.0.0` which is not on the allowlist; `txml` is non-strict).
