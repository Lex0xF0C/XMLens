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

| Capability                                                                   | Priority | Status        | Notes                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text editing mode with syntax coloring, folding, tag matching (CodeMirror 6) | P0       | Not started   | Planned for M1                                                                                                                                                                                                                  |
| Well-formedness checking while typing (worker + inline diagnostics)          | P0       | Partial (M1a) | `@xmlens/core` `saxes` diagnostics (M1a-1) wired through `@xmlens/workers` Web Worker in `packages/app` with debounced input checking, diagnostic list, and cursor-offset jump (M1a-2); CodeMirror inline squiggles pending M1b |
| Format / pretty-print / indent, whitespace options                           | P0       | Not started   | Planned for M1                                                                                                                                                                                                                  |
| Encoding / Unicode handling (UTF-8/16, BOM, CJK)                             | P0       | Not started   | Planned for M1                                                                                                                                                                                                                  |
| Schema-driven content completion                                             | P1       | Not started   | Planned for M5                                                                                                                                                                                                                  |
| Read-only XSD diagram (Schema Design view)                                   | P1       | Not started   | Planned for M5 (edit = P3)                                                                                                                                                                                                      |
| Code templates & snippets (JSON import/export)                               | P1       | Not started   | Planned for M1                                                                                                                                                                                                                  |
| Multi-file workspace & cross-file search/replace                             | P1       | Not started   | Planned for M1+                                                                                                                                                                                                                 |
| Grid mode (nested table view)                                                | P2       | Not started   | Post-v1.0                                                                                                                                                                                                                       |
| XML refactoring actions                                                      | P2       | Not started   | Post-v1.0                                                                                                                                                                                                                       |
| Author mode (CSS WYSIWYG)                                                    | OUT      | Out of scope  | —                                                                                                                                                                                                                               |

## 3. Validation (`IMPLEMENTATION_PLAN.md` §3.2)

| Capability                               | Priority | Status       | Notes                            |
| ---------------------------------------- | -------- | ------------ | -------------------------------- |
| XML Schema (XSD 1.0) validation via WASM | P0       | Not started  | Pending Spike S4, planned for M3 |
| OASIS XML Catalogs resolution            | P0       | Not started  | Planned for M3                   |
| DTD validation via WASM                  | P1       | Not started  | Planned for M3                   |
| Schematron validation & SVRL viewer      | P1       | Not started  | Pending Spike S3, planned for M3 |
| Saved validation profiles                | P1       | Not started  | Planned for M3                   |
| RELAX NG validation                      | P2       | Not started  | Post-v1.0                        |
| XSD 1.1 assertions                       | OUT      | Out of scope | Document limitation in UI        |

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
