# ADR-0008: XML Project Model, Package Boundaries, and Persistence Layering

- **Status:** Proposed (awaiting maintainer approval)
- **Date:** 2026-11-25

## Context

`docs/IMPLEMENTATION_PLAN.md` previously spread multi-file project concerns across several separate concepts: "Workspace" (`§3.1`), OASIS XML Catalogs and saved validation profiles (`§3.2`), transformation scenarios (`§3.3`), dependency graphs (`§3.4`), Profile Packs (`§4`), and schema upload/preloading (`§8` M3).

An external architecture proposal (Draft 1.0) reviewed on 2026-11-24 recommended unifying these elements into a single **XML Project** model and separating shared resource resolution from validation/transformation engines. While that direction aligns with XMLens's roadmap, the draft proposal placed IndexedDB storage inside a core `project` package, held a redundant file inventory in the project manifest, and placed security-permission flags inside the portable manifest.

This ADR defines the adapted **XML Project** model, clean package boundaries, manifest boundaries, and storage layering ahead of M3 implementation.

## Decisions Proposed (Maintainer Review Summary)

1. **Unify terminology on "Project":** **"Project"** is the canonical domain concept (virtual file tree + manifest). The earlier term **"Workspace"** in `docs/IMPLEMENTATION_PLAN.md` §3.1 is replaced by **Project** and is not retained as a separate concept.
2. **Project composition & byte-level storage:** A Project consists of files, XML Catalogs, scenarios (validation and transformation associations), and portable non-security settings. File content is stored as raw **bytes** (`Uint8Array`) rather than decoded strings so declared encodings (e.g., UTF-8, UTF-16 LE/BE, ISO-8859-1) remain intact; decoding happens at the editor or engine boundary.
3. **Package boundaries (not created yet — planned before M3):**
   - `packages/project` will be pure TypeScript, strictly DOM-free (`lib: ["ES2022"]`), and will depend on `@xmlens/core` **only** for the `Diagnostic` type (`Diagnostic.source` will gain `'resolver'` at creation time).
   - `@xmlens/core` never depends on `@xmlens/project`.
   - `@xmlens/workers` may depend on `@xmlens/project` **only** for bundle types (`ResourceBundle`), never touching persistent storage.
   - **Browser storage adapters** (IndexedDB, File System Access API, `<input webkitdirectory>` import fallback) live in **`packages/app`**. `packages/project` defines only the `ProjectFileSystem` interface and an in-memory `MemoryFs` implementation for testing.
   - When `packages/project` is created before M3, it requires its own `tsconfig.json` (`lib: ["ES2022"]`), an entry in the root `typecheck` script, and an ESLint `no-restricted-globals` block (including DOM globals and `indexedDB`).
4. **Manifest (`xmlens.project.json`, with `schemaVersion`) stores intent only:**
   - Stores root document URIs, catalog entry points, scenarios, role overrides, and optionally lowered resource limits.
   - Does **not** store a `files[]` inventory (the file list is derived from `ProjectFileSystem.list()` to avoid dual-source drift).
   - Does **not** store security permissions (see `ADR-0009`: imported manifests are untrusted and cannot grant permissions; manifest limits may only lower, never raise, application hard caps).
5. **Storage backend layering (`ProjectFileSystem` interface only in `packages/project`):**
   - `ProjectFileSystem` exposes `stat`, `list`, `read`, `write`, and `remove`, with a version token on `write` (`ifVersion`) to detect multi-tab conflicts.
   - **IndexedDB** is the primary persistent backend in `packages/app` (calling `navigator.storage.persist()` where available and pairing with project export to mitigate browser storage eviction).
   - **File System Access API** is an opt-in backend (Chromium only) suited to projects with heavy relative references, paired with `<input webkitdirectory>` directory import fallback into IndexedDB for Firefox and Safari.
6. **Profile Packs as read-only Project layers:** Domain Profile Packs (`profiles/<id>/`, `IMPLEMENTATION_PLAN.md` §4) are modeled as read-only Project layers participating in resolution after user project files (see `ADR-0009`).
7. **Domain isolation:** LegalDocML / LegalRuleML / CVRF / XLIFF specifics remain outside the generic Project model and live in Profile Packs and pluggable extractors.
8. **Explicitly out of v1 scope:**
   - External network resource resolver (see `ADR-0009`).
   - `allowExternalEntities` configuration (hard-off).
   - XML Catalog `delegate*` and `*Suffix` elements.
   - Storing a file inventory inside `xmlens.project.json`.
   - Project Exporter before the persistence phase (M3 persistence precedes M5 ZIP export).

## Priorities & Milestone Placement

- **M1 (small seam only):** Establish stable document URI identities for open tabs (e.g., `untitled:1` before a document belongs to a Project).
- **Pre-M3 (Spike R1 + Spike S4 extension):** Verify RFC 3986 URI resolution + OASIS XML Catalogs 1.1 conformance (`R1`) and multi-file XSD + catalog execution via prebuilt `ResourceBundle` (`S4`).
- **M3:** Create `packages/project`, implement **P0** Resource Resolver (`URI` resolution, `locate()`, `ResourceBundle` builder) and **P0** OASIS XML Catalogs resolution, plus **P1** Project model (`xmlens.project.json`), scenarios, IndexedDB adapter in `packages/app`, and a minimal Project Explorer.
- **M5:** Dependency graph visualization, File System Access API adapter, and **P1** ZIP import/export.
- **M6:** Integrate Profile Packs (`profiles/<id>/`) as read-only Project layers.

## Consequences

- **Positive:**
  - Keeps `packages/core` lightweight and independent of Project/storage concerns while preserving `lib: ["ES2022"]` purity across both `core` and planned `project`.
  - Prevents dual maintenance between manifest metadata and VFS state, preserves non-UTF-8 byte encodings, and isolates browser-specific storage APIs inside `packages/app`.
  - Unblocks M3's **P0** acceptance criterion ("validate against a multi-file XSD with catalog") cleanly.
- **Negative / Unverified Items:**
  - Adds a pre-M3 spike (`R1`) and defers File System Access / ZIP import-export to M5.
  - Exact `xmlens.project.json` schema details (`schemaVersion` 1 fields) remain open (`IMPLEMENTATION_PLAN.md` §10).
  - ZIP library selection, license verification (`AGENTS.md` §4.1.3 / §4.1.7), and maintenance status remain **unverified** and must pass review before any M5 ADR or installation.
  - Exact browser behavior of `navigator.storage.persist()` and `<input webkitdirectory>` across Chromium/Firefox/WebKit is **unverified**.

## Alternatives Considered

- **Put Project model, Catalog, and Resolver inside `packages/core`:** Rejected because `packages/core` focuses on pure single-document XML parsing/diagnostics/XPath/diff/stats primitives; keeping `packages/project` separate preserves small bundle imports for M1/M2 and keeps dependency direction acyclic (`core ← project ← workers ← app`).
- **Put IndexedDB / File System Access implementations inside `packages/project`:** Rejected because doing so pulls DOM/browser storage globals (`indexedDB`, `window.showDirectoryPicker`) into a shared pure-TS package, breaking DOM-free testability and future CLI reuse.
- **Store `files[]` inventory inside `xmlens.project.json`:** Rejected because every file creation, rename, or deletion would require synchronized manifest writes, risking stale inventories vs. `ProjectFileSystem.list()`.
