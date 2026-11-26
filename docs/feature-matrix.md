# Feature Matrix

Status legend:

- **Implemented (M0)** / **実装済み (M0)** — Implemented and verified locally in Milestone M0.
- **Pending manual check (M0)** / **手動確認待ち (M0)** — Implemented; awaiting manual maintainer verification.
- **Partial (M0)** / **一部着手 (M0)** — Basic M0 placeholder exists; full milestone implementation pending.
- **Not started** / **未着手** — Planned, not yet implemented.
- **Out of scope** / **対象外** — Explicitly out of scope (`OUT`).

Priority legend: **P0** = MVP · **P1** = v1.0 · **P2** = after v1.0 · **P3** = stretch · **OUT** = not planned.

## 1. Foundation (M0)

| Capability                                                                                                               | Priority | Status                    | Notes                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static Vite + strict TS shell, sub-path `base: './'`, strict CSP                                                         | P0       | Implemented (M0)          | `packages/app`, `vite.config.ts`; deployed to GitHub Pages                                                                                                                                |
| Bilingual UI (`en`/`ja`) with key & placeholder parity CI check                                                          | P0       | Implemented (M0)          | `locales/`, `scripts/check-i18n.mjs`                                                                                                                                                      |
| Light / Dark / High-contrast themes & WCAG 2.2 AA landmarks                                                              | P0       | Partial (M0)              | Themes & landmarks implemented (`packages/app/src/styles.css`); automated Playwright/axe checks not yet implemented                                                                       |
| CI checks (`lint`, `format:check`, `typecheck`, `test`, `i18n:check`, `plugins:guard`, `license:check`) & Pages workflow | P0       | Pending manual check (M0) | Automated checks pass; M0 acceptance test for the repository guard (throwaway branch with `saxon-test.js`) is a **pending manual maintainer task** per `docs/legal/guard-verification.md` |

## 2. Editing (`IMPLEMENTATION_PLAN.md` §3.1)

| Capability                                                                   | Priority | Status        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text editing mode with syntax coloring, folding, tag matching (CodeMirror 6) | P0       | Not started   | Planned for M1                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Well-formedness checking while typing (worker + inline diagnostics)          | P0       | Partial (M1a) | `@xmlens/core` `saxes` diagnostics (M1a-1) wired through `@xmlens/workers` Web Worker in `packages/app` with debounced input checking, diagnostic list, and cursor-offset jump (M1a-2); CodeMirror inline squiggles pending M1b                                                                                                                                                                                                                                                      |
| Format / pretty-print / indent, whitespace options                           | P0       | Partial (M1)  | `@xmlens/core` `formatXml` (`ADR-0012` Proposed: `2 spaces` / `4 spaces` / `Tab`, mixed-content & `xml:space="preserve"`/`"default"` preservation, lossless entity/DTD/CDATA/PI/comment slicing) executed in `@xmlens/workers` (`15s` timeout, cancellation, stale-edit discard) with `1 MiB` output-size guard (`XML_FORMAT_OUTPUT_TOO_LARGE` / UTF-8 byte ceiling) wired to toolbar **Format** + **Indent** controls; attribute wrapping & live browser verification pending       |
| Encoding / Unicode handling (UTF-8/16, BOM, CJK)                             | P0       | Partial (M1)  | M1 stages 2–3(b) (`ADR-0010`, `ADR-0011` Accepted): open/decode (`UTF-8/16`, BOM, `Shift_JIS`, `EUC-JP`, `ISO-2022-JP`, `windows-1252`, drag-and-drop, ASCII/UTF-16 mismatch check, unified decoded UTF-8 1 MB cap) + Save As `<dialog>` export (`UTF-8`, `UTF-16LE/BE`, BOM, `LF`/`CRLF`, user-confirmed leading XML declaration update, lone-surrogate rejection via `<a download>` + `Blob`; legacy-encoding export unsupported); live Windows/macOS browser verification pending |
| Schema-driven content completion                                             | P1       | Not started   | Planned for M5                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Read-only XSD diagram (Schema Design view)                                   | P1       | Not started   | Planned for M5 (edit = P3)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Code templates & snippets (JSON import/export)                               | P1       | Not started   | Planned for M1                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Multi-file project & cross-file search/replace                               | P1       | Not started   | Planned for M3+ (Project model in M3; File System Access / ZIP in M5)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Grid mode (nested table view)                                                | P2       | Not started   | Post-v1.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| XML refactoring actions                                                      | P2       | Not started   | Post-v1.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Author mode (CSS WYSIWYG)                                                    | OUT      | Out of scope  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 3. Validation (`IMPLEMENTATION_PLAN.md` §3.2)

| Capability                               | Priority | Status       | Notes                                  |
| ---------------------------------------- | -------- | ------------ | -------------------------------------- |
| XML Schema (XSD 1.0) validation via WASM | P0       | Not started  | Pending Spike S4, planned for M3       |
| OASIS XML Catalogs resolution            | P0       | Not started  | Planned for M3 (pending Spike R1 & S4) |
| DTD validation via WASM                  | P1       | Not started  | Planned for M3                         |
| Schematron validation & SVRL viewer      | P1       | Not started  | Pending Spike S3, planned for M3       |
| Saved validation scenarios (Project)     | P1       | Not started  | Planned for M3                         |
| RELAX NG validation                      | P2       | Not started  | Post-v1.0                              |
| XSD 1.1 assertions                       | OUT      | Out of scope | Document limitation in UI              |

## 4. Querying and Transformation (`IMPLEMENTATION_PLAN.md` §3.3)

| Capability                                              | Priority | Status       | Notes                                                             |
| ------------------------------------------------------- | -------- | ------------ | ----------------------------------------------------------------- |
| XPath 1.0 evaluator & result highlighting               | P0       | Not started  | Planned for M4                                                    |
| XPath 3.1 evaluator                                     | P1       | Not started  | Planned for M4                                                    |
| XSLT 1.0 transformation (WASM engine)                   | P0/P1    | Not started  | Pending Spike S2, planned for M4 (not relying on `XSLTProcessor`) |
| XSLT 2.0 / 3.0 transformation (optional SaxonJS plugin) | P1       | Not started  | Pending Spike S1, planned for M4 (off by default)                 |
| Saved transformation scenarios                          | P1       | Not started  | Planned for M4                                                    |
| Lightweight XSLT trace panel / XQuery                   | P3       | Not started  | Stretch                                                           |
| Profiler                                                | OUT      | Out of scope | —                                                                 |

## 5. Visualization (`IMPLEMENTATION_PLAN.md` §3.4)

| Capability                                                      | Priority | Status      | Notes                            |
| --------------------------------------------------------------- | -------- | ----------- | -------------------------------- |
| Synchronized tree view + XPath breadcrumb                       | P0       | Not started | Planned for M2                   |
| Outline & structure statistics                                  | P0       | Not started | Planned for M2                   |
| Large-document tiered mode                                      | P1       | Not started | Pending Spike S5, planned for M2 |
| Treemap / sunburst & SVG/PNG export                             | P1       | Not started | Planned for M2                   |
| Schema (XSD) diagram                                            | P1       | Not started | Planned for M5                   |
| Dependency graph (`xs`/`xsl` import/include)                    | P1       | Not started | Planned for M5                   |
| Reference graph (`ID`/`IDREF`, `href`, Akoma Ntoso `eId`/`wId`) | P1       | Not started | Planned for M5                   |
| Structural XML diff view                                        | P1       | Not started | Planned for M5                   |
| LegalRuleML rule/norm graph                                     | P2       | Not started | Post-v1.0                        |

## 6. Documentation, Conversion, Integration & AI-era Helpers (`IMPLEMENTATION_PLAN.md` §3.5–§3.7)

| Capability                                                                  | Priority | Status       | Notes          |
| --------------------------------------------------------------------------- | -------- | ------------ | -------------- |
| LLM-output validator (local repair report export)                           | P1       | Not started  | Planned for M3 |
| XSD documentation generator / sample XML generator / XML↔JSON / share links | P2       | Not started  | Post-v1.0      |
| Schema-to-prompt helper                                                     | P2       | Not started  | Post-v1.0      |
| CSV import / JSON Schema (CSAF 2.x) / bilingual alignment / XSLT docs       | P3       | Not started  | Stretch        |
| Git/SVN clients, WebDAV, SharePoint, XML databases                          | OUT      | Out of scope | —              |

## 7. Project & Resource Resolution (`ADR-0008`, `ADR-0009`)

| Capability                                                                       | Priority | Status       | Notes                                                                    |
| -------------------------------------------------------------------------------- | -------- | ------------ | ------------------------------------------------------------------------ |
| OASIS XML Catalogs resolution (`public`/`system`/`uri`/`rewrite*`/`nextCatalog`) | P0       | Not started  | Planned for M3 (unchanged; see §3 & Spike R1)                            |
| Resource Resolver (RFC 3986 URI resolution, `locate()`, `ResourceBundle`)        | P0       | Not started  | Planned for M3 (`ADR-0009`, Spike R1 / S4)                               |
| Project model (`xmlens.project.json`), scenarios, IndexedDB & Project Explorer   | P1       | Not started  | Planned for M3 (`ADR-0008`; storage adapter in `packages/app`)           |
| File System Access API & ZIP import/export                                       | P1       | Not started  | Planned for M5 (`ADR-0008`, `ADR-0009`; `webkitdirectory` import paired) |
| External network resource fetching                                               | OUT      | Out of scope | Excluded in v1 (`ADR-0009`; upload or local project attachment instead)  |
