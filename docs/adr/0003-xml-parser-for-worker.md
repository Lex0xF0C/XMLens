# ADR-0003: XML Parser Selection for Worker Well-Formedness Diagnostics (M1a)

- **Status:** Proposed (awaiting maintainer approval before installing parser dependency)
- **Date:** 2026-11-24

## Context

In Milestone M0, quick well-formedness checking uses the browser's `DOMParser` on the main UI thread. That approach has three blockers for Milestone M1:

1. `DOMParser` is **not available in Web Workers**, so parsing cannot move off the main thread.
2. `DOMParser` error diagnostics vary by browser engine (`parsererror` HTML snippets) and cannot run inside the DOM-free `packages/core` package.
3. Moving `DOMParser` cannot enforce consistent entity-expansion protections or structured `{ line, column, offset }` ranges across browsers.

We need an XML well-formedness parser that runs both in Web Workers and in DOM-free `packages/core` (`lib: ["ES2022"]`), supports XML Namespaces and line/column reporting, prevents external entity fetching and entity-expansion attacks, complies with the repository license policy (`AGENTS.md` §4.1.3), and keeps first-load bundle size well within the `<= 1.5 MB` gzipped JS+WASM budget (`IMPLEMENTATION_PLAN.md` §7).

## Candidates Evaluated

All metadata below (`version`, `license`, `dist.unpackedSize`, `time.modified`, `dependencies`) was queried directly from the npm registry via `npm view` on 2026-11-24. Anything not directly observed in the installed package bundle is marked **unverified**.

| Candidate             | Version  | License (npm + deps)                                         | Unpacked Size (npm) | Gzipped Bundle Size | Last npm Publish | DOM-free / Worker                                   | Namespaces & Line/Col                                                          |
| --------------------- | -------- | ------------------------------------------------------------ | ------------------- | ------------------- | ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`saxes`**           | `6.0.0`  | `ISC` (`xmlchars@2.2.0`: `MIT`)                              | `163,774` B         | unverified          | `2022-05-17`     | Yes (pure JS/TS)                                    | Yes (`xmlns: true`, `line`, `column`, `position`)                              |
| **`fast-xml-parser`** | `5.12.1` | `MIT` (6 deps all `MIT`)                                     | `1,337,290` B       | unverified          | `2026-11-13`     | Yes (pure JS/TS)                                    | Partial (`XMLValidator` reports `line`/`col`; parser handles prefix stripping) |
| **`libxml2-wasm`**    | `0.7.2`  | `MIT` (underlying `libxml2` C notice: unverified in tarball) | `1,228,585` B       | unverified          | `2026-09-07`     | Yes, via WASM                                       | Yes (`line`/`col` via libxml2 error output)                                    |
| **`xmllint-wasm`**    | `5.3.0`  | `MIT` (underlying `libxml2` C notice: unverified in tarball) | `875,339` B         | unverified          | `2026-11-14`     | Yes, via WASM (Firefox worker-module caveats noted) | Yes (`xmllint` output)                                                         |
| **`sax`**             | `1.6.1`  | `BlueOak-1.0.0` (not in allowlist)                           | `61,678` B          | unverified          | `2026-07-24`     | Yes                                                 | Partial (less strict XML compliance)                                           |
| **`txml`**            | `6.0.3`  | `MIT`                                                        | `132,519` B         | unverified          | `2026-08-30`     | Yes                                                 | No (forgiving HTML-like parser, not strict XML)                                |

### Detailed Comparison

#### 1. `saxes` (`6.0.0`)

- **License:** `ISC`; sole runtime dependency `xmlchars@2.2.0` is `MIT`. Both are in the `AGENTS.md` §4.1.3 allowlist.
- **Size:** `163,774` bytes unpacked (`dist.unpackedSize`). Exact minified/gzipped bundle size is **unverified** until installed and built with Vite.
- **Maintenance:** Stable `6.0.0` release (`2022-05-17`), zero recent release churn (maintenance responsiveness to new issues is **unverified**; pure XML 1.0/1.1 spec parser rarely needs spec changes).
- **Namespaces & Line/Column:** Full XML 1.0/1.1 + XML Namespaces (`xmlns: true`), tracking 1-based `line`, `column` (Unicode code points), `columnIndex`, and `position` (UTF-16 code-unit offset).
- **Entity Handling & Security:** Streaming non-validating parser. Recognizes only predefined XML entities (`&amp;`, `&lt;`, `&gt;`, `&apos;`, `&quot;`) and numeric character references (`&#...;`). Does **not** fetch external entities and does **not** automatically expand custom `<!ENTITY>` declarations from `<!DOCTYPE>`, neutralizing classic recursive DTD entity-expansion ("billion laughs") attacks by default unless application code explicitly populates `parser.ENTITIES`.
- **Error Mapping to `Diagnostic`:** Emits `error` events with an `Error` whose `.message` is English text (e.g., unclosed tag, mismatched tag, unbound namespace prefix) along with parser `line`, `column`, and `position`. Because `saxes` does not expose stable numeric error codes (exact full set of error strings is **unverified** without inspecting `saxes` source), `packages/core` can map recognized error patterns to semantic codes (`XML_SYNTAX_ERROR`, `XML_NAMESPACE_ERROR`, `XML_UNCLOSED_TAG`, etc.) and `messageKey`s (`diagnostics.xmlSyntaxError`, etc.), always attaching the raw `Error.message` in `params.detail` for the collapsible raw detail UI (`docs/i18n-guide.md` rule 5).

#### 2. `fast-xml-parser` (`5.12.1`)

- **License:** `MIT` (6 runtime dependencies — `strnum`, `is-unsafe`, `xml-naming`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher` — all `MIT` per npm).
- **Size:** `1,337,290` bytes unpacked (`dist.unpackedSize`), roughly 8x larger unpacked than `saxes` (tree-shaken `XMLValidator`-only size is **unverified**).
- **Maintenance:** Actively maintained (`2026-11-13`), though its advisory history includes recent entity-expansion DoS CVEs (`CVE-2026-26278`, `CVE-2026-33036`), requiring careful configuration of `processEntities` limits.
- **Namespaces & Line/Column:** `XMLValidator.validate()` returns `{ err: { code, msg, line, col } }`, which maps cleanly to `Diagnostic`, though its primary design focus is JS object conversion rather than strict XML Infoset/namespace compliance (full namespace-error coverage in `XMLValidator` is **unverified**).

#### 3. `libxml2-wasm` (`0.7.2`) / `xmllint-wasm` (`5.3.0`)

- **License:** `MIT` on npm for both wrappers; underlying `libxml2` C library is MIT, though the exact bundled license notice inside the distributed npm tarball is **unverified** until inspected in Spike S4.
- **Size:** `1,228,585` bytes (`libxml2-wasm`) / `875,339` bytes (`xmllint-wasm`) unpacked; gzipped `.wasm` size is **unverified**.
- **CSP & Runtime Impact:** Running WebAssembly requires adding `'wasm-unsafe-eval'` to the CSP `script-src` directive in `packages/app/index.html` (`IMPLEMENTATION_PLAN.md` §5.1 notes this should only be added if required). `libxml2-wasm` also requires explicit manual disposal (`dispose()`) of C heap objects and top-level `await`/modern WASM support; `xmllint-wasm` browser docs note module-worker caveats in Firefox unless bundled specifically.
- **Entity Handling:** `libxml2` has strong protections when external entity loading and `XML_PARSE_HUGE` are disabled, though exact default parser flags exposed by `libxml2-wasm` `0.7.2` and `xmllint-wasm` `5.3.0` are **unverified** until Spike S4.
- **Error Mapping:** Reports rich `libxml2` errors (`line`, `column`, message); requires parsing/translating `libxml2` error callbacks or stdout into `Diagnostic` objects.

## Decision (Recommended — Pending Maintainer Approval)

**Recommend `saxes` (`6.0.0`, `ISC`) for Milestone M1a well-formedness diagnostics in `packages/core` and Web Workers.**

Rationale:

1. **Fits M1a scope cleanly:** Smallest strict XML 1.0/1.1 + Namespaces parser (`163.8 KB` unpacked, 1 `MIT` dependency `xmlchars`), pure JS/TS with zero DOM dependencies.
2. **Preserves strict CSP in M1:** Requires no `'wasm-unsafe-eval'` relaxation in `index.html` and no heavy `.wasm` download on editor boot.
3. **Safe entity posture:** Never fetches external entities or DTDs and does not auto-expand custom DTD `<!ENTITY>` definitions, preventing entity-expansion bombs out of the box.
4. **Complementary to M3:** When XSD 1.0 and DTD validation are added in M3 (Spike S4), `libxml2-wasm` or `xmllint-wasm` will be lazy-loaded on demand in a validation worker without bloating M1's initial editor load.

## Consequences

- **Positive:** Keeps `packages/core` pure TypeScript (`lib: ["ES2022"]`), moves parsing off the main thread into `packages/workers`, preserves strict CSP (`script-src 'self'`), and gives exact line/column/position diagnostics.
- **Negative / Limitations:** `saxes` is a non-validating parser (no XSD or DTD validation — deferred to M3 Spike S4) and does not expand custom internal `<!ENTITY>` declarations in `<!DOCTYPE>` (if a document uses custom internal entities, M1 should report or note that DTD entity expansion is disabled for safety).
- **Unverified Items to Verify Upon Approval:** Exact gzipped bundle size contribution of `saxes` in Vite production output, and verification of `saxes` error-message patterns across malformed/namespace/CJK test fixtures.

## Alternatives Considered

- **`fast-xml-parser` (`XMLValidator`):** Viable `MIT` alternative with structured `{ code, msg, line, col }`, but significantly larger unpacked package (`1.34 MB`), more complex entity-expansion surface, and less specialized in strict XML namespace validation than `saxes`.
- **`libxml2-wasm` / `xmllint-wasm` in M1a:** Rejected for M1a well-formedness because it pulls a ~0.9–1.2 MB WASM payload into initial editing, requires CSP `'wasm-unsafe-eval'`, and duplicates Spike S4 (M3) prematurely.
- **`sax` / `txml`:** Rejected (`sax` uses `BlueOak-1.0.0` which is not on the allowlist; `txml` is non-strict).
