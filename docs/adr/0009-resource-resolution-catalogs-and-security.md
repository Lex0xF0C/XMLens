# ADR-0009: Resource Resolution, XML Catalogs, and Project Security Boundaries

- **Status:** Accepted (direction, 2026-11-27); implementation gated on Spike R1 and extended Spike S4
- **Date:** 2026-11-25 (updated 2026-11-27)

## Context

Multi-file XML workflows (XSD `xs:import`/`xs:include`/`xs:redefine`, XSLT `xsl:import`/`xsl:include`, Schematron `sch:include`, `xml-model` processing instructions, `DOCTYPE` declarations, and OASIS XML Catalogs) require resolving references across files consistently. An external architecture proposal (Draft 1.0) reviewed on 2026-11-24 proposed an asynchronous `resolve()` callback called directly by engines, alongside runtime external HTTP fetching and hostname/IP blocklists.

That design has three architectural issues in a browser-only static app:

1. **Synchronous WASM / JS engines:** `saxes` is synchronous, `libxml2-wasm` / `xmllint-wasm` are expected to use preloaded virtual filesystems or synchronous callbacks (exact APIs remain **unverified** pending Spike S4), and XPath/XSLT document loaders may execute synchronously.
2. **CSP and CORS restrictions:** `packages/app/index.html` enforces `default-src 'self'` with no `connect-src` exception, and standards-body hosts rarely send permissive CORS headers.
3. **Browser SSRF blocklist futility:** Browser JavaScript cannot inspect resolved DNS IP addresses or prevent DNS rebinding, so string-based localhost/private-IP checks are not a security boundary.

This ADR defines the two-phase **Bundle** architecture, synchronous pure `locate()` resolution, strict v1 network/entity security boundaries, and Spike **R1** / extended Spike **S4**.

**Status rationale (2026-11-27):** `AGENTS.md` §4.2.8–12 already enforce these security and resolver boundaries as binding repository rules; accepting the direction resolves the status mismatch with `AGENTS.md`. **Reopen rule:** Keep existing Unverified Items tracked below; if Spike R1 or extended Spike S4 results contradict any decision in this ADR, reopen this ADR before implementation.

## Decisions (Accepted Direction; Gated on Spike R1 / Extended Spike S4)

1. **Single shared Resource Resolver:** All engines (XSD, DTD, Schematron, XPath, XSLT) obtain external resources exclusively through the shared Resource Resolver / Bundle layer. Engines never open files, IndexedDB, or network URLs directly.
2. **Two-phase Bundle model (`async` build → `sync` engine read):**
   - **Async phase (Bundle builder in `packages/project`):** Starting from a root document URI, extract static references, locate targets via catalogs/project layers, enforce cycle detection, depth limits, total byte caps, and `AbortSignal`, and load bytes into an immutable `ResourceBundle` (`rootUri`, `entries: ReadonlyMap<string, Uint8Array>`, `unresolved`).
   - **Sync phase (Workers & engines):** Workers receive `ResourceBundle` instances over RPC and never touch IndexedDB or browser storage. Engines read solely from the bundle.
   - **Dynamic URI limitation:** References that cannot be discovered statically (e.g., runtime-computed `document()` URIs not already in the bundle) produce an explicit `"unresolved"` diagnostic rather than performing ad-hoc I/O inside an engine.
3. **Split Resolver API (`locate()` vs. `load()`):**
   - `locate(req)` is **synchronous and pure** (catalogs are preloaded in memory) and returns a canonical URI plus a resolution `trace` for diagnostics/debugging.
   - `load(uri)` (fetching `Uint8Array` bytes) is **asynchronous**.
   - Cycle detection, visited-URI sets, and recursion-depth caps live in the **Bundle builder**, not inside `ResourceResolver.locate()`.
   - "Registered identifiers" within a project are represented as project-level catalog entries (one unified mechanism).
4. **URI identity vs. storage path & self-written RFC 3986 resolver:**
   - Every open document receives a stable URI from M1 onward (e.g., `untitled:1` before joining a Project), distinct from filesystem/IndexedDB paths.
   - Relative references are resolved against `baseUri` per **RFC 3986 §5** **before** querying XML Catalogs.
   - Because `packages/core` and planned `packages/project` compile with `"lib": ["ES2022"]` (without DOM `URL` typings), relative URI resolution and normalization will be implemented as a **self-written pure TypeScript function** verified against the RFC 3986 §5.4 test vectors in Spike R1.
5. **Initial OASIS XML Catalogs 1.1 scope:**
   - **Initial (M3, P0):** `public`, `system`, `uri`, `rewriteSystem`, `rewriteURI`, `nextCatalog`, `group`, `xml:base`, and `prefer`.
   - **Deferred:** `delegatePublic`, `delegateSystem`, `delegateURI`, and `*Suffix` entries.
   - Precedence details between `system` and `public` entries must be verified directly from the OASIS XML Catalogs 1.1 specification during Spike R1 rather than assumed from memory.
6. **Resolution layer order:**
   > Catalog → Project files → Profile Pack read-only layer → User-attached file → Unresolved diagnostic
7. **Pluggable reference extraction:**
   - Format-specific `ReferenceExtractor` modules extract `DOCTYPE`, `xml-model` PIs, `xsi:schemaLocation` / `xsi:noNamespaceSchemaLocation`, `xs:import` / `xs:include` / `xs:redefine`, `xsl:import` / `xsl:include`, and `sch:include` using the existing `saxes` dependency (zero new dependencies).
   - Extracted "declared references" are kept distinct from explicit Project "associations" (scenarios).
8. **Security rules (non-negotiable for v1):**
   - **Untrusted imported projects:** Project manifests and imported archives cannot grant privileges. Permissions live locally per user/origin, are never stored in `xmlens.project.json`, and are never exported/imported. A manifest may only lower resource caps, never exceed application hard limits.
   - **No external network resource fetching in v1:** `packages/app/index.html` keeps `default-src 'self'` without relaxing `connect-src`. Unresolved external URIs emit a diagnostic paired with a user workflow to attach a local file and record a catalog mapping. Any future opt-in network fetch requires an ADR, a CSP update, `credentials: 'omit'`, HTTPS-only, restricted redirects, streamed byte caps, and a user-managed origin allowlist.
   - **No browser IP/localhost SSRF boundary claims:** String-based blocking of `localhost` or private IP literals is **not** a real security boundary in a browser (resolved IPs are invisible to JS and DNS rebinding cannot be prevented) and will not be claimed as one.
   - **`allowExternalEntities` is never a user setting:** External entity expansion/fetching stays hard-off. Project-local file resolution, external network fetching (off in v1), and parser entity-expansion caps are treated as three independent controls.
   - **ZIP import/export hardening (Phase 5 / M5):** Must defend against zip-slip and zip-bomb attacks, normalize paths (Unicode NFC, `..`, backslashes, Windows reserved device names), and treat internal project paths as case-sensitive while emitting collision warnings on case-folded duplicates.
   - **GitHub Pages same-origin awareness:** Documented in `SECURITY.md` (sites under `<user>.github.io` share an origin; custom domains mitigate cross-repo IndexedDB/localStorage visibility).

## Illustrative Interface Sketch (Non-Normative)

The TypeScript interfaces below illustrate the planned M3 boundary in `packages/project` (no code or package is created in this ADR):

```ts
export interface FileStat {
  readonly path: string;
  readonly size: number;
  readonly version: string;
}

export interface ProjectFileSystem {
  stat(path: string): Promise<FileStat | null>;
  list(prefix?: string): Promise<readonly FileStat[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, opts?: { ifVersion?: string }): Promise<FileStat>;
  remove(path: string): Promise<void>;
}

export interface ResourceRequest {
  readonly systemId?: string;
  readonly publicId?: string;
  readonly uri?: string;
  readonly baseUri?: string;
  readonly nature: 'dtd' | 'xsd' | 'schematron' | 'xslt' | 'xml' | 'catalog' | 'other';
}

export type LocateOutcome =
  | { readonly ok: true; readonly uri: string; readonly trace: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'not-found' | 'blocked' | 'invalid';
      readonly trace: readonly string[];
    };

export interface ResourceResolver {
  locate(req: ResourceRequest): LocateOutcome;
}

export interface ResourceBundle {
  readonly rootUri: string;
  readonly entries: ReadonlyMap<string, Uint8Array>;
  readonly unresolved: readonly {
    readonly from: string;
    readonly ref: string;
    readonly reason: string;
  }[];
}
```

## Planned Verification Spikes (Before M3 / M5)

- **Spike R1 (URI & Catalog specification conformance, before M3):** Verify RFC 3986 §5 relative resolution/normalization against RFC 3986 §5.4 examples in DOM-free TypeScript, and verify OASIS XML Catalogs 1.1 `system`/`public`/`prefer`/`xml:base`/`rewrite*`/`nextCatalog` precedence rules directly from the OASIS specification text.
- **Spike S4 extension (WASM XSD + Bundle model, before M3):** Verify whether `xmllint-wasm` and `libxml2-wasm` support preloading a `ResourceBundle` (and/or synchronous external resource hooks) to validate multi-file XSD (`xs:import`/`xs:include`) with OASIS XML Catalogs inside a Web Worker.

## Unverified Items

1. Whether `xmllint-wasm` and `libxml2-wasm` support only virtual-FS preloading or also synchronous callbacks for external resources (**unverified** — Spike S4).
2. Whether candidate XPath 3.1 / XSLT 1.0 engines (`fontoxpath`, WASM `libxslt`) require synchronous `document()` / `doc()` callbacks (**unverified** — Spikes S2 / M4).
3. Exact OASIS XML Catalogs 1.1 precedence edge cases between `system`, `public`, `prefer`, and `rewriteSystem` (**unverified** — Spike R1).
4. ZIP library candidate, license, and maintenance status (**unverified** — must be checked per `AGENTS.md` §4.1.3 / §4.1.7 before M5).

## Consequences

- **Positive:**
  - Keeps Web Workers and validation/XSLT engines pure, deterministic, and isolated from IndexedDB and network access.
  - Preserves strict CSP (`default-src 'self'`) and zero-network privacy guarantees in v1 while providing an actionable local attachment workflow for unresolved schema/catalog URIs.
  - Ensures identical RFC 3986 URI behavior across Node tests, Web Workers, and all browsers.
- **Negative / Limitations:**
  - Dynamically computed URIs (such as runtime-constructed paths passed to XSLT `document()`) cannot be fetched on the fly if omitted from the precomputed `ResourceBundle` and will report an `"unresolved"` diagnostic.

## Alternatives Considered

- **Asynchronous `resolve()` invoked directly by engines:** Rejected because WASM `libxml2` and `saxes` assume synchronous preloaded inputs or sync hooks, and exposing IndexedDB inside workers increases coupling and test complexity.
- **Allowing CORS-enabled external schema fetching in v1:** Rejected because current strict CSP (`default-src 'self'`) blocks third-party connections, most standards servers omit CORS headers, and silent network lookups conflict with XMLens's offline/privacy-by-design guarantee.
- **Host/IP blocklist for external URLs in browser JS:** Rejected as security theater because browsers do not expose DNS resolution results to JS and cannot block DNS rebinding.
