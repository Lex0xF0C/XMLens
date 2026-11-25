# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Milestone M0 Vite + strict TypeScript foundation workspace (`packages/core`, `packages/app`) with sub-path-compatible static output (`base: './'`).
- Bilingual English/Japanese UI catalogs (`locales/en.json`, `locales/ja.json`) with `npm run i18n:check` verifying key parity, `{placeholder}` parity, and non-empty strings, plus `docs/i18n-guide.md`.
- Accessible light, dark, and high-contrast themes with `color-scheme` support and `prefers-reduced-motion` handling.
- Pure TypeScript core diagnostics contract and `formatMessage` helper in `@xmlens/core`, enforced DOM-free via `packages/core/tsconfig.json` (`lib: ["ES2022"]`) and ESLint `no-restricted-globals`.
- Cross-platform quality and policy checks: ESLint (`eslint.config.mjs` including `scripts/`), Prettier (`format` / `format:check`), Vitest unit tests, `scripts/check-licenses.mjs` (with reviewed `scripts/license-exceptions.json`), and `scripts/check-no-third-party-binaries.mjs`.
- GitHub Actions CI (`.github/workflows/ci.yml`) and GitHub Pages deployment workflow (`.github/workflows/pages.yml`).
- Architecture Decision Records:
  - `docs/adr/0001-technology-stack.md`
  - `docs/adr/0002-optional-saxonjs-plugin.md`
  - `docs/adr/0003-xml-parser-for-worker.md` (accepted and verified for M1a-1 / M1a-2)
  - `docs/adr/0004-license-exceptions-blueoak.md`
  - `docs/adr/0005-codemirror-and-csp.md` (accepted in principle; spike gated on `ADR-0006`)
  - `docs/adr/0006-e2e-and-a11y-tooling.md` (proposed)
  - `docs/adr/0007-dev-server-csp-and-styles.md` (proposed)
  - `docs/adr/0008-xml-project-model-and-packages.md` (proposed)
  - `docs/adr/0009-resource-resolution-catalogs-and-security.md` (proposed)
  - `docs/adr/0010-document-encoding-detection.md` (accepted; M1 stage 2, updated in stage 3(b))
  - `docs/adr/0011-save-and-export-encoding.md` (accepted; M1 stage 3(b))
  - `docs/adr/0012-xml-formatter.md` (proposed; M1 XML formatter architecture)
- Pure TypeScript XML well-formedness and namespace diagnostics (`checkWellFormedness`) in `@xmlens/core` powered by `saxes@6.0.0` (`ISC`) and `xmlchars@2.2.0` (`MIT`), with structured `Diagnostic` mapping (`diagnostics.xml.*` keys in `en.json` and `ja.json`), clamped UTF-16 `offset` / 1-based Unicode `column`, internal DTD entity-expansion warnings (`XML_DTD_ENTITY_EXPANSION_DISABLED`), external DTD non-fetch warnings (`XML_EXTERNAL_DTD_IGNORED`), W3C XML 1.0 §4.1 external/parameter-entity warning handling (`XML_UNDECLARED_EXTERNAL_ENTITY`), and unit/fixture tests (`tests/fixtures/`).
- Pure TypeScript lossless XML formatter (`formatXml` in `packages/core/src/formatter.ts`, `formatter.test.ts`), gated on `checkWellFormedness` and supporting `2 spaces` / `4 spaces` / `Tab` indentation while preserving mixed content, `xml:space="preserve"` / `"default"` transitions, BOM, XML declarations, DOCTYPE internal subsets, entity/character references (`&amp;`, `&#x...;`, `&title;`), comments, PIs, CDATA, CJK text, and surrogate pairs, wired to toolbar **Format** (`#format-button`) and **Indent** (`#indent-select`) controls in `packages/app`.
- Pure TypeScript XML 1.0 Appendix F encoding autodetection (`detectXmlEncoding`, `normalizeXmlEncodingLabel`) in `@xmlens/core` (`packages/core/src/encoding.ts`, `encoding.test.ts`), supporting UTF-8/16 BOMs, BOM-less UTF-16 `<?xm` patterns, leading XML declaration extraction, BOM-vs-declaration conflict warnings (`XML_ENCODING_BOM_CONFLICT`), ASCII-header vs UTF-16-declaration mismatch errors (`XML_ENCODING_DECLARATION_MISMATCH`), and unsupported UTF-32/UCS-4/EBCDIC diagnostics (`XML_UNSUPPORTED_ENCODING`).
- Fatal Web-standard byte decoding (`decodeXmlBytes`, `utf8ByteLength`, and shared `loadAndDecodeXmlFile` / drag-and-drop helpers in `packages/app/src/decodeXml.ts`, `decodeXml.test.ts`), switching `packages/app` file opening from `file.text()` to `file.arrayBuffer()`, adding editor textarea drag-and-drop file loading via the same shared pipeline (with minimal `1px` `--focus-ring` drag-over outline), forwarding `assumedEncoding` to worker well-formedness checks, adding a toolbar file-encoding override selector (`Auto-detect` / `UTF-8` / `UTF-16LE` / `UTF-16BE` / `Shift_JIS` / `EUC-JP` / `ISO-2022-JP` / `windows-1252`), and adding an encoding/BOM indicator to the status bar.
- Save As export (`packages/core/src/xmlExport.ts`, `packages/app/src/saveXml.ts`, and accessible `<dialog>` UI in `packages/app/src/main.ts`), supporting `UTF-8` (with optional BOM) and `UTF-16LE` / `UTF-16BE` (with mandatory BOM), dominant `LF` / `CRLF` detection and conversion, user-confirmed leading XML declaration `encoding` updates, lone UTF-16 surrogate rejection with line/column/offset details, sanitized filename preservation, legacy-encoding export advisory notices, and `<a download>` + `Blob` export with `URL.revokeObjectURL` cleanup.
- Dedicated Web Worker package (`@xmlens/workers`) with versioned RPC protocol, request-id matching, worker termination/respawn cancellation and timeouts, unit tests (`packages/workers/src/workers.test.ts`), and `tsc -p packages/workers/tsconfig.json --noEmit` verification under `lib: ["ES2022", "WebWorker"]`.
- Runtime third-party license notice generator and CI check (`scripts/generate-notices.mjs`, `npm run notices:generate`, `npm run notices:check`), generating `THIRD_PARTY_NOTICES.md` and same-origin `packages/app/public/THIRD_PARTY_NOTICES.md` (`dist/THIRD_PARTY_NOTICES.md` linked from the About dialog) for bundled runtime dependencies (`saxes@6.0.0`, `xmlchars@2.2.0`), with unit tests (`scripts/generate-notices.test.mjs`).
- Project documentation and community drafts: `LICENSE` (MIT), `README.md`, `README.ja.md`, `THIRD_PARTY_NOTICES.md`, `docs/feature-matrix.md`, `docs/legal/guard-verification.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` (including XML Project and Resource Resolution architecture documentation across `docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `docs/feature-matrix.md`, `docs/i18n-guide.md`, and `SECURITY.md`, plus `Encoding` terminology entry and `notices:check` command doc alignment).

### Changed

- Standardized package management on `npm` with `package-lock.json` and `engines.node >= 22.12.0` (`bun.lock` removed).
- Bundled `packages/app/src/styles.css` through Vite instead of `packages/app/public/` static linking, keeping `style-src 'self'` CSP compliance in production builds.
- Redesigned the application UI into a dense desktop-workbench layout (title bar, toolbar with working Open File / Load Sample / Check / About / File Encoding / Language / Theme controls, bordered editor and diagnostics panes, bottom status bar, and accessible `<dialog>` About modal), removing development-status/hero copy.
- Replaced the temporary main-thread `DOMParser` preview in `packages/app` with the `@xmlens/workers` Web Worker client, adding debounced input checking (300 ms), severity-labeled diagnostic list items with cursor-offset jump, and collapsible raw parser messages (`<details>`).
- Updated `docs/IMPLEMENTATION_PLAN.md` §5.2 and `docs/adr/0001-technology-stack.md` Light XML Parsing row to reflect `saxes` 6.0.0 (`ADR-0003`) replacing the M0 `DOMParser` placeholder.

### Security

- Configured strict Content Security Policy in `packages/app/index.html` (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `base-uri 'self'`).
- Added a temporary 1 MB input-size cap to the M0 `DOMParser` well-formedness preview.
- Enforced safe DTD/entity handling in `@xmlens/core` `checkWellFormedness`: external DTDs are never fetched and custom `<!ENTITY>` declarations are never expanded, neutralizing recursive entity-expansion attacks.
- Enforced repository binary/license guards against disallowed third-party binaries and unreviewed licenses (`npm run plugins:guard`, `npm run license:check`), including workspace `packages/*/package.json` (`peerDependencies` included) and `package-lock.json` package/reference scanning.
- Pinned GitHub Actions workflows to 40-character commit SHAs, added a dedicated `npm audit --audit-level=high` CI job, and configured weekly Dependabot updates (`.github/dependabot.yml`).

### Fixed

- Tracked parser errors independently of `maxDiagnostics` truncation in `@xmlens/core` `checkWellFormedness` so `wellFormed` remains `false` even when earlier warnings fill the diagnostic cap before a syntax error occurs.
- Normalized encoding aliases (e.g., `cp932` ↔ `Shift_JIS`, `euc_jp` ↔ `EUC-JP`, `ISO-8859-1` ↔ `windows-1252`) in `@xmlens/core` `checkWellFormedness` via `normalizeXmlEncodingLabel` so equivalent overrides do not emit spurious `XML_ENCODING_DECLARATION_NOTE` diagnostics.
- Rejected ASCII-compatible `<?xm` files declaring `UTF-16` / `UTF-16LE` / `UTF-16BE` without a BOM or byte-order pattern in `auto` mode (`XML_ENCODING_DECLARATION_MISMATCH`), while keeping manual encoding override as a bypass.
- Unified the 1 MB (`1,048,576`-byte) preview size limit across file loading (`loadAndDecodeXmlFile`) and worker checking (`runWorkerCheck`) on decoded UTF-8 byte length (`utf8ByteLength`), guarded by a `3x` raw-byte safety cap before/after reading `arrayBuffer()`.
- Normalized decoded editor text (`CRLF` and standalone `CR`) to `LF` via `convertLineEndings` after detecting `loadedLineEnding`, ensuring initial file-load worker diagnostic offsets match `<textarea>.value` coordinates and subsequent re-checks identically.
- Rewrote `formatElementNode` and verbatim subtree rendering in `@xmlens/core` `formatXml` (`packages/core/src/formatter.ts`) to use explicit-stack iterative traversal with a `256 MiB`-character output guard and top-level `try/catch` (`XML_FORMAT_INTERNAL_ERROR`), preventing `RangeError` call-stack overflows on deeply nested XML and protecting the `packages/app` Format handler with a `try/catch` fallback.
- Forwarded `lastAssumedEncoding` to `formatXml` (`wellFormednessOptions`) when formatting an unmodified loaded file (`formatEditorXml`), preventing spurious `XML_ENCODING_DECLARATION_NOTE` diagnostics on format failure, and corrected `docs/adr/0012-xml-formatter.md` (no trailing newline after joining top-level nodes with `\n`, plus Node.js performance measurements).
