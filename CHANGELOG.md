# Changelog

This changelog separates **development changelog versions** (`DEV-NNNN`, monotonic 4-digit sequence assigned on every `main` sync/merge) from **product release versions** (`vX.Y.Z` Semantic Versioning, assigned only at official releases). Pull requests stage entries under `[Pending]` without assigning a `DEV` number; see [`AGENTS.md` §12](./AGENTS.md#12-changelog-policy) and [`docs/adr/0013-changelog-dev-versioning.md`](./docs/adr/0013-changelog-dev-versioning.md).
本ファイルは、開発変更履歴バージョン（`main` 同期・マージ毎に採番する単調増加の `DEV-NNNN`）と製品リリースバージョン（正式リリース時のみ付与するセマンティックバージョニング `vX.Y.Z`）を分離して管理します。PR は番号を採番せず `[Pending]` に追記します。運用規則の詳細は [`AGENTS.md` §12](./AGENTS.md#12-changelog-policy) および [`docs/adr/0013-changelog-dev-versioning.md`](./docs/adr/0013-changelog-dev-versioning.md) を参照してください。

## [Pending]

(none)

## [DEV-0010] - 2026-11-28

- **Sync:** direct
- **Refs:** README.md, README.ja.md, docs/feature-matrix.md, docs/legal/guard-verification.md, docs/IMPLEMENTATION_PLAN.md, CHANGELOG.md

### Changed

- Updated `README.md` and `README.ja.md` status lines to mark Milestone M0 completed following the maintainer's manual throwaway-branch repository guard verification while keeping M1 in progress.
- Updated `docs/feature-matrix.md` §1 (`CI checks ... & Pages workflow`) from `Pending manual check (M0)` to `Implemented (M0)` with the 2026-11-28 verification summary (`Disallowed Saxon-related file path: saxon-test.js`, exit code `1`, CI run `45975155206`) and removed the now-unused `Pending manual check (M0)` status legend entry.
- Appended the 2026-11-28 `Verification Record / 検証記録` section (observed `plugins:guard` CI log and run URL `45975155206`, preserving the re-execution procedure) to `docs/legal/guard-verification.md`, and recorded the verification date/run reference in `docs/IMPLEMENTATION_PLAN.md` §8 M0 Acceptance (`e2e-spike` remains awaiting verification).

## [DEV-0009] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0005, ADR-0006, spikes/codemirror/main.ts, docs/adr/0006-e2e-and-a11y-tooling.md, docs/adr/0005-codemirror-and-csp.md, CHANGELOG.md

### Fixed

- Added `'aria-hidden': 'true'` (preserving `tabindex: '-1'`) to the visually hidden `<input class="hidden-file-input">` in `spikes/codemirror/main.ts` to match `packages/app/src/main.ts` and resolve the axe `label` violation observed in `e2e-spike` CI run `45974182477` across Chromium, Firefox, and WebKit without relaxing `spikes/codemirror/e2e.spec.ts` assertions.

### Changed

- Recorded the 2026-11-27 second `e2e-spike` CI run (`45974182477`, `3/6` tests passed) and `aria-hidden="true"` fix in `docs/adr/0006-e2e-and-a11y-tooling.md` (CI Job Design) and `docs/adr/0005-codemirror-and-csp.md` (Verification Checklist Section A), keeping `ADR-0006` Status conditional `Accepted` until the first green run.

## [DEV-0008] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0005, ADR-0006, spikes/codemirror/playwright.config.ts, docs/adr/0006-e2e-and-a11y-tooling.md, docs/adr/0005-codemirror-and-csp.md, CHANGELOG.md

### Fixed

- Fixed `e2e-spike` Playwright `webServer` startup failure where `spikes/codemirror/playwright.config.ts` defaulted `webServer.cwd` to the config file directory (`spikes/codemirror/`), doubling the root-relative `--config spikes/codemirror/vite.config.ts` path; added `cwd: '../..'` (resolved by Playwright relative to the config directory, without Node globals).

### Changed

- Documented the 2026-11-27 initial `e2e-spike` CI failure and Playwright `webServer.cwd` behavior in `docs/adr/0006-e2e-and-a11y-tooling.md` (CI Job Design) and `docs/adr/0005-codemirror-and-csp.md` (Verification Checklist Section A), keeping `ADR-0006` Status conditional `Accepted` until the first green CI run.

## [DEV-0007] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0005, ADR-0006, ADR-0008, ADR-0009, ADR-0014, ADR-0015, package.json, package-lock.json, .gitignore, .github/workflows/ci.yml, spikes/codemirror/e2e.spec.ts, AGENTS.md, docs/IMPLEMENTATION_PLAN.md, docs/adr/0005-codemirror-and-csp.md, docs/adr/0006-e2e-and-a11y-tooling.md, docs/adr/0008-xml-project-model-and-packages.md, docs/adr/0009-resource-resolution-catalogs-and-security.md, docs/adr/0014-xpath-at-cursor.md, docs/adr/0015-ui-framework.md, docs/feature-matrix.md, CHANGELOG.md

### Added

- Added `npm run test:e2e:spike` script in `package.json` (`vite build --config spikes/codemirror/vite.config.ts && playwright test --config spikes/codemirror/playwright.config.ts`, excluded from `npm run check`) and documented it in `AGENTS.md` §2 while keeping main-app `test:e2e` marked unimplemented.
- Added isolated `e2e-spike` job to `.github/workflows/ci.yml` (`runs-on: ubuntu-latest`, reusing pinned 40-character `actions/checkout` and `actions/setup-node` SHAs, running `npx playwright install --with-deps chromium firefox webkit` and `npm run test:e2e:spike`, leaving `check`, `audit`, `permissions: contents: read`, and `pages.yml` untouched, and deferring `actions/upload-artifact` until its 40-char SHA is verified).
- Declared `@lezer/highlight` (`^1.2.5`, `MIT`) as a direct root `devDependency` in `package.json` (matching its existing `package-lock.json` entry and direct import in `spikes/codemirror/bridge.ts`), verified via `npm run license:check` and `npm run notices:check`.
- Drafted `docs/adr/0015-ui-framework.md` (`Status: Proposed`, no packages installed) comparing `preact@11.2.0` + `@preact/signals@2.11.4` (maintainer provisional leaning), `svelte@5.59.2`, and current plain TypeScript DOM using `npm view` license/maintenance/size data while marking tree-shaken gzip sizes `unverified`.

### Changed

- Updated `docs/adr/0005-codemirror-and-csp.md` to `Status: Accepted (provisional, 2026-11-27, conditional)` (approving `+126.2–126.5 kB` gzipped excess for CodeMirror 6 only, recording M1b `view.setState` history-reset and `Compartment.reconfigure` rules, retaining Section B manual Windows checklist, and marking Section A replaced by CI `e2e-spike`).
- Updated `docs/adr/0006-e2e-and-a11y-tooling.md` (keeping conditional `Accepted` until the first green CI `e2e` / `e2e-spike` run and recording the `actions/upload-artifact` SHA TODO), `docs/adr/0014-xpath-at-cursor.md` (`Status: Accepted (2026-11-27)` with M1b CodeMirror migration notes), `docs/adr/0008-xml-project-model-and-packages.md` and `docs/adr/0009-resource-resolution-catalogs-and-security.md` (`Status: Accepted (direction, 2026-11-27); implementation gated on Spike R1 and extended Spike S4` with reopen rule and unchanged Unverified Items), `docs/IMPLEMENTATION_PLAN.md` (§5.6 heading sync and §10 provisional decisions #2, #5, #8, #13), and `docs/feature-matrix.md`.
- Enhanced `spikes/codemirror/e2e.spec.ts` to collect `securitypolicyviolation` events via `page.addInitScript` alongside Playwright `console` (`error`) and `pageerror` listeners, and verify `0` `<style>` elements, `> 0` `adoptedStyleSheets`, Undo/Redo after Format, and `Tab` focus exit.

### Removed

- Deleted regenerated `bun.lock` from the workspace root and added `bun.lock` to `.gitignore` to keep `npm` / `package-lock.json` as the sole package lockfile.

## [DEV-0006] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0001, ADR-0005, ADR-0006, ADR-0007, package.json, package-lock.json, scripts/license-exceptions.json, .gitignore, eslint.config.mjs, tsconfig.json, vitest.config.ts, vite.config.ts, scripts/csp-build.test.mjs, spikes/codemirror/vite.config.ts, spikes/codemirror/index.html, spikes/codemirror/styles.css, spikes/codemirror/bridge.ts, spikes/codemirror/main.ts, spikes/codemirror/codemirror.test.ts, spikes/codemirror/playwright.config.ts, spikes/codemirror/e2e.spec.ts, docs/adr/0006-e2e-and-a11y-tooling.md, docs/adr/0007-dev-server-csp-and-styles.md, docs/adr/0005-codemirror-and-csp.md, docs/adr/0001-technology-stack.md, docs/feature-matrix.md, CHANGELOG.md

### Added

- Installed `@playwright/test@1.65.1` (`Apache-2.0`), `@axe-core/playwright@4.14.1` (`MPL-2.0`), `axe-core@4.14.1` (`MPL-2.0`), and the 7 MIT-licensed CodeMirror 6 spike packages (`@codemirror/state@6.7.6`, `@codemirror/view@6.44.2`, `@codemirror/commands@6.11.2`, `@codemirror/language@6.13.1`, `@codemirror/lang-xml@6.1.0`, `@codemirror/lint@6.9.8`, `@codemirror/search@6.7.3` plus 10 MIT transitives) strictly as root `devDependencies` (`dev: true` in `package-lock.json`, zero runtime dependencies added).
- Added Node/Vitest CSP build invariance regression suite `scripts/csp-build.test.mjs` verifying `packages/app/index.html` and programmatic `vite build` output retain the exact strict production CSP without `'unsafe-inline'`, `'unsafe-eval'`, `nonce-`, `csp-nonce`, `ws:`, or `wss:`, and verifying `serve`-mode nonce + `ws:`/`wss:` configuration.
- Created isolated CodeMirror 6 `Option A` (`ShadowRoot` + `adoptedStyleSheets`, zero `EditorView.cspNonce`, zero `indentWithTab`) spike under `spikes/codemirror/` (`vite.config.ts`, `index.html`, `styles.css`, `bridge.ts`, `main.ts`, `codemirror.test.ts`, `playwright.config.ts`, `e2e.spec.ts`), integrating `@xmlens/core` `Diagnostic` → `@codemirror/lint`, `xpathWorkerClient` (`shouldDiscardSpikeXPathResult` with `isComposing`), undoable `formatXml` transactions (`isolateHistory.of('full')`), `decodeXml`/`saveXml` LF/CRLF/BOM round-trip, `securitypolicyviolation` tracking, 3 themes, and `en`/`ja` `aria-label` switching without modifying `packages/app` `<textarea>` or `dist/`.

### Changed

- Updated `vite.config.ts` (`createXmlensViteConfig`, `createDevCspPlugin`, `buildServeCsp`, `applyServeCspToHtml`) to implement `ADR-0007` Option (b) (`html.cspNonce` + `connect-src 'self' ws: wss:` with per-process Web Crypto nonce) strictly when `command === 'serve'`, leaving `command === 'build'` and `packages/app/index.html` untouched.
- Updated `docs/adr/0006-e2e-and-a11y-tooling.md` to conditional `Accepted` (recording exact installed versions, `MPL-2.0` dev-only exception scope, `THIRD_PARTY_NOTICES.md` exclusion, `.gitignore` rules, and deferred CI job review notes without editing `.github/workflows/ci.yml`), `docs/adr/0007-dev-server-csp-and-styles.md` to `Accepted` with constraints and candidate `(a)`/`(b)`/`(c)` comparison, `docs/adr/0005-codemirror-and-csp.md` with Spike Results (verified vs. `unverified` matrix, `~126.2–126.5 kB` gzipped JS delta notice under `AGENTS.md` §11, and Windows manual verification checklist while keeping `<textarea>` replacement unapproved), `docs/adr/0001-technology-stack.md` (`Testing & Quality` and `Code Editor` rows), and `docs/feature-matrix.md`.
- Updated `.gitignore` (`playwright-report/`, `test-results/`, `.spike-dist/`), `eslint.config.mjs`, `tsconfig.json`, and `vitest.config.ts` for spike isolation and ignored test artifacts.

### Security

- Added reviewed `devDependencies`-only `MPL-2.0` exceptions strictly for `@axe-core/playwright` (`~4.14.1`) and `axe-core` (`~4.14.1`) in `scripts/license-exceptions.json` (`reviewed-by: "maintainer"`), verified via `npm run license:check` and `npm run notices:check`.

## [DEV-0005] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0014, packages/core/src/xmlTokenizer.ts, packages/core/src/formatter.ts, packages/core/src/xpathAtOffset.ts, packages/core/src/xpathAtOffset.test.ts, packages/core/src/index.ts, packages/workers/src/protocol.ts, packages/workers/src/handler.ts, packages/workers/src/client.ts, packages/workers/src/index.ts, packages/workers/src/workers.test.ts, packages/app/src/xpathCursor.ts, packages/app/src/xpathCursor.test.ts, packages/app/src/main.ts, packages/app/src/styles.css, locales/en.json, locales/ja.json, docs/i18n-guide.md, docs/adr/0014-xpath-at-cursor.md, docs/feature-matrix.md, CHANGELOG.md

### Added

- Implemented pure TypeScript, DOM-free `getXPathAtOffset(xml, offset)` in `@xmlens/core` (`packages/core/src/xpathAtOffset.ts`, exported via `packages/core/src/index.ts`) gated on `checkWellFormedness`, using an iterative explicit stack, quote-aware `xmlns`/`xmlns:*` namespace resolution, expanded-name sibling indexing, strict interior `(start, end)` tag-boundary containment, XPath 3.1 `Q{uri}local[n]` canonical paths, and `qname` display breadcrumbs, with Vitest coverage in `packages/core/src/xpathAtOffset.test.ts`.
- Extracted the lossless XML tokenizer from `packages/core/src/formatter.ts` into internal module `packages/core/src/xmlTokenizer.ts` so formatting and cursor XPath offset tracking share identical UTF-16 token boundaries.
- Added `'getXPathAtOffset'` RPC support (`protocol.ts`, `handler.ts`) and an independent `createXPathWorkerClient` (`client.ts`, exported via `packages/workers/src/index.ts`) with strict payload validation and Vitest tests (`packages/workers/src/workers.test.ts`) so cursor lookups never cancel in-flight well-formedness or formatting requests.
- Added 150 ms debounced cursor XPath breadcrumb lookup (`keyup`, `mouseup`, `input`, `focus`, `select`, plus diagnostic jump / format updates) and status-bar display (`#status-xpath` without `aria-live`, full-path `title`, ellipsis truncation, and `—` fallback) in `packages/app/src/main.ts`, `packages/app/src/styles.css`, and `packages/app/src/xpathCursor.ts` (`xpathCursor.test.ts`), along with `statusBar.xpath` / `statusBar.xpathNone` keys in `locales/en.json` and `locales/ja.json`.
- Created `docs/adr/0014-xpath-at-cursor.md` (`Status: Proposed`), added the `Breadcrumb` (`Undecided`) proposal to `docs/i18n-guide.md`, and updated `docs/feature-matrix.md`.

## [DEV-0004] - 2026-11-27

- **Sync:** direct
- **Refs:** scripts/check-changelog.mjs, scripts/check-changelog.test.mjs, docs/adr/0013-changelog-dev-versioning.md, CHANGELOG.md

### Fixed

- Updated `scripts/check-changelog.mjs` to report an error with the opening line number when a triple-or-more backtick code fence remains unclosed at EOF instead of silently skipping subsequent headings, and added corresponding unit tests in `scripts/check-changelog.test.mjs`.

### Changed

- Updated `docs/adr/0013-changelog-dev-versioning.md` Consequences (reflecting automated validation introduced in `DEV-0003` while noting continued need to re-read `CHANGELOG.md` to avoid number collisions) and appended the `DEV-0004` unclosed code fence check under Follow-up Work (Phase 2).

## [DEV-0003] - 2026-11-27

- **Sync:** direct
- **Refs:** ADR-0013, scripts/check-changelog.mjs, scripts/check-changelog.test.mjs, package.json, AGENTS.md, README.md, README.ja.md, CONTRIBUTING.md, docs/adr/0013-changelog-dev-versioning.md, CHANGELOG.md

### Added

- Implemented cross-platform changelog consistency checker `scripts/check-changelog.mjs` (`checkChangelog` / `inspectChangelog` and CLI entrypoint) enforcing `ADR-0013` / `AGENTS.md` §12 rules (4-digit `DEV-NNNN` uniqueness and format, strict descending order across release headings, `[Pending]` required / `[Unreleased]` forbidden, calendar-valid dates / `(UTC)` / `date-unknown` with `DEV-0001` Baseline exemption, non-empty `- **Sync:**` metadata, and `## [vX.Y.Z]` `Includes:` range validation while ignoring fenced code blocks and normalizing `CRLF`).
- Added Vitest suite `scripts/check-changelog.test.mjs` covering valid/invalid cases for all six rules, `CRLF` normalization, fenced-heading exclusion, `DEV-0001` Baseline handling, and validation against the repository's own `CHANGELOG.md`.
- Added `"changelog:check": "node scripts/check-changelog.mjs"` to `package.json` and wired it into `npm run check`.

### Changed

- Updated `AGENTS.md` (§2 command reference and §10 Definition of done), `README.md`, `README.ja.md`, and `CONTRIBUTING.md` to include `npm run changelog:check` in `npm run check`.
- Updated `docs/adr/0013-changelog-dev-versioning.md` Follow-up Work (Phase 2) section to document `scripts/check-changelog.mjs` and its six implemented checks under `DEV-0003` while keeping `Status: Accepted`.

## [DEV-0002] - 2026-11-26

- **Sync:** direct
- **Refs:** ADR-0012, ADR-0013, locales/en.json, locales/ja.json, packages/app/src/decodeXml.ts, packages/app/src/decodeXml.test.ts, docs/i18n-guide.md, docs/feature-matrix.md, AGENTS.md, CONTRIBUTING.md, CHANGELOG.md

### Added

- Added dedicated UTF-8 byte-limit diagnostic key `diagnostics.xml.formatOutputTooLargeBytes` to `locales/en.json` and `locales/ja.json`, and asserted `messageKey` and `classifyFormatFailure` behavior in `packages/app/src/decodeXml.test.ts`.
- Created `docs/adr/0013-changelog-dev-versioning.md` (`Status: Accepted`) defining the `DEV-NNNN` development changelog versioning policy, `[Pending]` PR staging, and release section format.
- Added `## 12. Changelog policy` to `AGENTS.md`.

### Changed

- Updated `locales/ja.json` `preview.formatError` to `整形に失敗しました: {detail}`, cleared `needs-ja-review` on `preview.formatOutputTooLarge` and `statusBar.formatFailed`, and added notes in `docs/i18n-guide.md` covering `Format` (`整形` vs. `整形式`, alternative candidate `フォーマット`, retaining `Undecided`) and `MB` size-limit wording (`1 MiB` = `1,048,576` bytes aligned with `preview.tooLarge`).
- Advanced `docs/adr/0012-xml-formatter.md` to `Status: Accepted` (2026-11-26 maintainer approval), reconciling Decision §2 with the Addendum's Web Worker offloading, documenting `formatEditorXml` as a DOM-free test helper and `setRangeText` replacement in M1b (CodeMirror 6), and updating `docs/feature-matrix.md`.
- Migrated `CHANGELOG.md` from `[Unreleased]` to `DEV-NNNN` development versioning (`[Pending]`, `DEV-0002`, and `DEV-0001` baseline preserving prior `[Unreleased]` history verbatim) and aligned `AGENTS.md` (§7 item 5, §10) and `CONTRIBUTING.md`.

### Fixed

- Updated `enforceFormattedByteLimit` in `packages/app/src/decodeXml.ts` to emit `diagnostics.xml.formatOutputTooLargeBytes` instead of reusing `diagnostics.xml.formatOutputTooLarge` when formatted output exceeds `1 MiB` in UTF-8 bytes, resolving the byte-count vs. character-label mismatch while preserving `code: 'XML_FORMAT_OUTPUT_TOO_LARGE'` and `classifyFormatFailure`.

## [DEV-0001] - Baseline

Baseline: 運用方式導入前の全変更を遡及的に集約した記録。個別の変更日は未記録のため推測していない。

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
- Pure TypeScript lossless XML formatter (`formatXml` in `packages/core/src/formatter.ts`, `formatter.test.ts`), gated on `checkWellFormedness` and supporting `2 spaces` / `4 spaces` / `Tab` indentation, configurable `maxOutputChars` (`FormatOutputLimitError` -> `XML_FORMAT_OUTPUT_TOO_LARGE`), and full preservation of mixed content, `xml:space="preserve"` / `"default"` transitions, BOM, XML declarations, DOCTYPE internal subsets, entity/character references (`&amp;`, `&#x...;`, `&title;`), comments, PIs, CDATA, CJK text, and surrogate pairs, executed via `@xmlens/workers` from toolbar **Format** (`#format-button`) and **Indent** (`#indent-select`) controls in `packages/app`.
- Pure TypeScript XML 1.0 Appendix F encoding autodetection (`detectXmlEncoding`, `normalizeXmlEncodingLabel`) in `@xmlens/core` (`packages/core/src/encoding.ts`, `encoding.test.ts`), supporting UTF-8/16 BOMs, BOM-less UTF-16 `<?xm` patterns, leading XML declaration extraction, BOM-vs-declaration conflict warnings (`XML_ENCODING_BOM_CONFLICT`), ASCII-header vs UTF-16-declaration mismatch errors (`XML_ENCODING_DECLARATION_MISMATCH`), and unsupported UTF-32/UCS-4/EBCDIC diagnostics (`XML_UNSUPPORTED_ENCODING`).
- Fatal Web-standard byte decoding (`decodeXmlBytes`, `utf8ByteLength`, and shared `loadAndDecodeXmlFile` / drag-and-drop helpers in `packages/app/src/decodeXml.ts`, `decodeXml.test.ts`), switching `packages/app` file opening from `file.text()` to `file.arrayBuffer()`, adding editor textarea drag-and-drop file loading via the same shared pipeline (with minimal `1px` `--focus-ring` drag-over outline), forwarding `assumedEncoding` to worker well-formedness checks, adding a toolbar file-encoding override selector (`Auto-detect` / `UTF-8` / `UTF-16LE` / `UTF-16BE` / `Shift_JIS` / `EUC-JP` / `ISO-2022-JP` / `windows-1252`), and adding an encoding/BOM indicator to the status bar.
- Save As export (`packages/core/src/xmlExport.ts`, `packages/app/src/saveXml.ts`, and accessible `<dialog>` UI in `packages/app/src/main.ts`), supporting `UTF-8` (with optional BOM) and `UTF-16LE` / `UTF-16BE` (with mandatory BOM), dominant `LF` / `CRLF` detection and conversion, user-confirmed leading XML declaration `encoding` updates, lone UTF-16 surrogate rejection with line/column/offset details, sanitized filename preservation, legacy-encoding export advisory notices, and `<a download>` + `Blob` export with `URL.revokeObjectURL` cleanup.
- Dedicated Web Worker package (`@xmlens/workers`) with versioned RPC protocol (`checkWellFormedness` + `formatXml`), request-id matching, worker termination/respawn cancellation, timeouts (`5s` check / `15s` default format), unit tests (`packages/workers/src/workers.test.ts`), and `tsc -p packages/workers/tsconfig.json --noEmit` verification under `lib: ["ES2022", "WebWorker"]`.
- Runtime third-party license notice generator and CI check (`scripts/generate-notices.mjs`, `npm run notices:generate`, `npm run notices:check`), generating `THIRD_PARTY_NOTICES.md` and same-origin `packages/app/public/THIRD_PARTY_NOTICES.md` (`dist/THIRD_PARTY_NOTICES.md` linked from the About dialog) for bundled runtime dependencies (`saxes@6.0.0`, `xmlchars@2.2.0`), with unit tests (`scripts/generate-notices.test.mjs`).
- Project documentation and community drafts: `LICENSE` (MIT), `README.md`, `README.ja.md`, `THIRD_PARTY_NOTICES.md`, `docs/feature-matrix.md`, `docs/legal/guard-verification.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` (including XML Project and Resource Resolution architecture documentation across `docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `docs/feature-matrix.md`, `docs/i18n-guide.md`, and `SECURITY.md`, plus `Encoding` terminology entry and `notices:check` command doc alignment).

### Changed

- Standardized package management on `npm` with `package-lock.json` and `engines.node >= 22.12.0` (`bun.lock` removed).
- Bundled `packages/app/src/styles.css` through Vite instead of `packages/app/public/` static linking, keeping `style-src 'self'` CSP compliance in production builds.
- Redesigned the application UI into a dense desktop-workbench layout (title bar, toolbar with working Open File / Load Sample / Check / About / File Encoding / Language / Theme controls, bordered editor and diagnostics panes, bottom status bar, and accessible `<dialog>` About modal), removing development-status/hero copy.
- Replaced the temporary main-thread `DOMParser` preview in `packages/app` with the `@xmlens/workers` Web Worker client, adding debounced input checking (300 ms), severity-labeled diagnostic list items with cursor-offset jump, and collapsible raw parser messages (`<details>`).
- Updated `docs/IMPLEMENTATION_PLAN.md` §5.2 and `docs/adr/0001-technology-stack.md` Light XML Parsing row to reflect `saxes` 6.0.0 (`ADR-0003`) replacing the M0 `DOMParser` placeholder.
- Moved `packages/app` XML formatting (`#format-button`) from synchronous main-thread execution to `@xmlens/workers` RPC (`DEFAULT_FORMAT_TIMEOUT_MS = 15_000`), sharing cancellation with well-formedness checks, discarding stale responses when editor text or request epoch advances (`shouldDiscardAsyncFormatResult`), aligning the output limit (`maxOutputChars: 1,048,576` plus UTF-8 byte ceiling via `enforceFormattedByteLimit`) with `MAX_PREVIEW_BYTES`, and distinguishing parser-invalid (`preview.formatInvalid`), oversized-output (`preview.formatOutputTooLarge`), and internal/worker failure states (`format-failed` / `statusBar.formatFailed` / `preview.formatError`).

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
- Rewrote `formatElementNode` and verbatim subtree rendering in `@xmlens/core` `formatXml` (`packages/core/src/formatter.ts`) to use explicit-stack iterative traversal with a `256 MiB`-character default output guard (plus configurable `maxOutputChars` / `XML_FORMAT_OUTPUT_TOO_LARGE`) and top-level `try/catch` (`XML_FORMAT_INTERNAL_ERROR`), preventing `RangeError` call-stack overflows on deeply nested XML and preventing multi-byte formatted output from exceeding `1 MiB` in `packages/app`.
- Forwarded `lastAssumedEncoding` to `formatXml` (`wellFormednessOptions`) when formatting an unmodified loaded file, preventing spurious `XML_ENCODING_DECLARATION_NOTE` diagnostics on format failure, and corrected `docs/adr/0012-xml-formatter.md` (no trailing newline after joining top-level nodes with `\n`, plus Node.js performance measurements and worker-offloading addendum).
