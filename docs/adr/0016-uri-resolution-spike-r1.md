# ADR-0016: Spike R1 (Part 1) — DOM-Free RFC 3986 URI Reference Resolver

- **Status:** Proposed
- **Date:** 2026-11-28
- **Related:** `ADR-0008`, `ADR-0009` (`Planned Verification Spikes — Spike R1`), `IMPLEMENTATION_PLAN.md` §5.6 / §8

## Context

`ADR-0009` §4 requires resolving relative references against `baseUri` per **RFC 3986 §5** before consulting OASIS XML Catalogs, using a **self-written pure TypeScript function** with `"lib": ["ES2022"]` (no DOM `URL`, `URLSearchParams`, or `window` globals) so `packages/core` and planned `packages/project` remain runtime-agnostic and identical across Node tests, Web Workers, and all browsers.

This spike (`spikes/r1-uri/`) implements and verifies the **RFC 3986** portion of Spike R1 only. Verification of **OASIS XML Catalogs 1.1** precedence rules (`system`, `public`, `prefer`, `rewriteSystem`, `nextCatalog`, `xml:base`) remains deferred to a follow-up Spike R1 part (`ADR-0009` Unverified Item #3 remains unchanged).

## Implementation Scope (`spikes/r1-uri/`)

- `spikes/r1-uri/tsconfig.json`: Enforces `"lib": ["ES2022"]`, `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"exactOptionalPropertyTypes": true`, checked in CI via `npm run typecheck`.
- `spikes/r1-uri/uri.ts` (zero dependencies):
  - `parseUri(ref)`: RFC 3986 §3 / Appendix B five-component decomposition (`scheme`, `authority`, `path`, `query`, `fragment`), preserving `undefined` (delimiter absent) vs `""` (delimiter present with empty value).
  - `removeDotSegments(path)`: Exact two-buffer RFC 3986 §5.2.4 algorithm (steps 2A–2E).
  - `mergePaths(base, relativePath)`: RFC 3986 §5.2.3 path merge handling `authority !== undefined && path === ""` and non-hierarchical base paths without `/`.
  - `recomposeUri(components)`: RFC 3986 §5.3 component recomposition.
  - `resolveReference(base, ref, options?)`: RFC 3986 §5.2.2 reference transformation (`strict: true` by default).
- **Out of scope / unimplemented in Spike R1:**
  - `normalizeUri` (RFC 3986 §6.2.2 syntax-based normalization and §6.2.3 scheme-based normalization).
  - RFC 3987 IRI-to-URI percent-encoding or character-range rejection.

## Verification Results

All test vectors in `spikes/r1-uri/uri.test.ts` were verified verbatim against the official RFC 3986 text retrieved from `https://www.rfc-editor.org/rfc/rfc3986.txt` on 2026-11-28.

### Verified

1. **DOM-free compilation:** `tsc -p spikes/r1-uri/tsconfig.json --noEmit` passes with `"lib": ["ES2022"]` only.
2. **RFC 3986 §5.4.1 Normal Examples (23/23):** All 23 vectors against base `http://a/b/c/d;p?q` match exact expected target URIs.
3. **RFC 3986 §5.4.2 Abnormal Examples (19/19):** All 19 vectors match strict RFC 3986 expectations (including `"http:g"` → `"http:g"` in strict mode, plus optional `{ strict: false }` → `"http://a/b/c/g"`).
4. **RFC 3986 §5.2.4 & Appendix B:** Step-by-step trace vectors (`/a/b/c/./../../g` → `/a/g`, `mid/content=5/../6` → `mid/6`), undefined vs empty `authority`/`query`/`fragment` preservation (`file:///path/to/doc.xml?#`, `//`, `/`), and `recomposeUri` round-tripping.
5. **XMLens edge cases:** Empty reference (`""`), fragment-only (`#article-1`), query-only (`?mode=strict`), authority-defined empty-path base (`https://example.com` + `schema.xsd` → `https://example.com/schema.xsd`), authority-less bases (`http:/b/c/d`, `untitled:a/b/c`, `file:///a/b/c.xml`), deep `../` chains (25 levels), and percent-encoded Japanese paths (`%E6%B3%95%E4%BB%A4`).

### Unverified / Out of Scope

1. **OASIS XML Catalogs 1.1 precedence rules:** Not tested in this spike (`ADR-0009` Unverified Item #3 remains open).
2. **RFC 3986 §6.2.2 / §6.2.3 URI normalization (`normalizeUri`):** Not implemented yet.
3. **Browser `new URL()` parity & IRI handling policy:** Unencoded non-ASCII characters (e.g., `http://example.com/法令/条例.xml` + `../規則/定義.xsd`) pass through Appendix B verbatim as `http://example.com/規則/定義.xsd` without UTF-8 percent-encoding (whereas DOM `new URL()` percent-encodes them per WHATWG URL / RFC 3987 style). No policy is hardcoded here.

## Open Decisions Before M3 (`packages/project`)

1. **IRI / Japanese filename handling:** When Project files or XML `schemaLocation` / `href` attributes contain unencoded Japanese characters versus `%XX`-encoded paths, decide whether `ResourceResolver` normalizes via UTF-8 percent-encoding (RFC 3987 §3.1) or decodes percent-encoded project paths before `ProjectFileSystem` lookup.
2. **Non-hierarchical `untitled:N` base resolution:** Under strict RFC 3986 §5.2.3, `resolveReference('untitled:1', 'schema.xsd')` evaluates to `'untitled:schema.xsd'` because `'1'` contains no `'/'`. Decide whether `ResourceResolver` should reject relative-path references from `untitled:N` documents (allowing only `#fragment` / catalog `publicId` / `systemId` absolute matches) rather than synthesizing `'untitled:schema.xsd'`.
3. **Minimal §6.2.2 syntax normalization scope:** Decide whether M3 `packages/project` needs scheme/host lowercasing, uppercase `%XX` hex normalization, and empty port removal before XML Catalog URI/system matching.
