# ADR-0001: Technology Stack

- **Status:** Accepted (baseline for M0; items marked `undecided` remain open pending spikes S1–S5 and maintainer input)
- **Date:** 2026-11-24

## Context

XMLens aims to provide a zero-install, browser-only, MIT-licensed XML development and visualization workbench deployed as a static site on GitHub Pages (including under a repository sub-path). Heavy XML processing must not freeze the UI thread, and the core logic must remain usable outside the browser (e.g., future CLI or editor extensions). All runtime assets must be self-hosted with no third-party CDN calls and strict Content Security Policy (CSP).

## Decision

Adopt the baseline architecture from `docs/IMPLEMENTATION_PLAN.md` §5.2:

| Layer                     | Decision / Candidate                                               | Status                 | Rationale                                                                                        |
| ------------------------- | ------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| Language                  | TypeScript (strict mode)                                           | Decided                | Type safety across `core`, workers, and UI.                                                      |
| Build & Dev Server        | Vite (static output in `dist/`, `base: './'`)                      | Decided                | Fast static builds and sub-path Pages deployment.                                                |
| UI Framework              | Preact + signals vs. Svelte vs. plain Web Components               | **Undecided**          | M0 uses plain strict TypeScript DOM until maintainer decides (`IMPLEMENTATION_PLAN.md` §10.2).   |
| Code Editor               | CodeMirror 6 + `@codemirror/lang-xml` (candidate)                  | Proposed (M1)          | MIT-licensed, extensible, handles large files.                                                   |
| Light XML Parsing         | Native `DOMParser`                                                 | Decided (light tasks)  | Built into browsers; M1 moves parsing to workers.                                                |
| XSD / DTD Validation      | `libxml2-wasm` vs. `xmllint-wasm`                                  | **Undecided**          | Pending spike S4 (license, size, multi-file XSD + catalog).                                      |
| XPath 1.0                 | Native `document.evaluate` (candidate)                             | Proposed (M4)          | Zero-dependency browser API.                                                                     |
| XPath 3.1                 | `fontoxpath` (candidate)                                           | **Undecided**          | Pending license and bundle-size verification.                                                    |
| XSLT 1.0                  | WASM libxslt-based engine (or SaxonJS-only fallback)               | **Undecided**          | Pending spike S2; browser `XSLTProcessor` is not relied upon due to browser deprecation/removal. |
| Schematron                | Custom interpreter on XPath engine vs. ISO XSLT skeleton           | **Undecided**          | Pending spike S3.                                                                                |
| XSLT 2.0 / 3.0 (optional) | Optional off-by-default SaxonJS plugin (ADR-0002)                  | Decided (architecture) | Non-OSI component; isolated and fetched only in CI after spike S1.                               |
| Visualization             | Custom SVG + D3 modules (ISC) / Cytoscape.js or ELK                | **Undecided**          | Pending M2/M5 design and bundle budget checks.                                                   |
| i18n                      | JSON catalogs (`locales/en.json`, `locales/ja.json`) + `Intl` APIs | Decided                | 100% key parity enforced in CI (`npm run i18n:check`).                                           |
| Testing & Quality         | Vitest (unit), Playwright + axe (e2e), ESLint, Prettier, `tsc`     | Decided                | E2E Playwright deferred to M1+.                                                                  |

## Consequences

- `packages/core` is strictly isolated from DOM and browser globals (`lib: ["ES2022"]` + ESLint `no-restricted-globals`).
- M0 stays lightweight and avoids premature dependency lock-in on undecided components (UI framework, WASM validators, XSLT/XPath engines).
- Every undecided item requires a short spike (S1–S5) and an ADR or update before adoption in M1–M5.

## Alternatives Considered

- **Full SPA framework lock-in in M0 (React / Angular):** Rejected for M0 because the maintainer has not yet decided between Preact, Svelte, and Web Components, and bundle-size targets favor smaller footprints.
- **Relying on browser-native `XSLTProcessor`:** Rejected because major browsers are removing built-in XSLT support.
- **Backend / server-side validation API:** Rejected because privacy-by-design requires 100% local browser execution with no uploads.
