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
  - `docs/adr/0003-xml-parser-for-worker.md` (accepted and verified for M1a-1)
  - `docs/adr/0004-license-exceptions-blueoak.md`
  - `docs/adr/0005-codemirror-and-csp.md` (proposed)
- Pure TypeScript XML well-formedness and namespace diagnostics (`checkWellFormedness`) in `@xmlens/core` powered by `saxes@6.0.0` (`ISC`) and `xmlchars@2.2.0` (`MIT`), with structured `Diagnostic` mapping (`diagnostics.xml.*` keys in `en.json` and `ja.json`), clamped UTF-16 `offset` / 1-based Unicode `column`, internal DTD entity-expansion warnings (`XML_DTD_ENTITY_EXPANSION_DISABLED`), external DTD non-fetch warnings (`XML_EXTERNAL_DTD_IGNORED`), and unit/fixture tests (`tests/fixtures/`).
- Project documentation and community drafts: `LICENSE` (MIT), `README.md`, `README.ja.md`, `THIRD_PARTY_NOTICES.md`, `docs/feature-matrix.md`, `docs/legal/guard-verification.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.

### Changed

- Standardized package management on `npm` with `package-lock.json` and `engines.node >= 22.12.0` (`bun.lock` removed).
- Bundled `packages/app/src/styles.css` through Vite instead of `packages/app/public/` static linking, keeping `style-src 'self'` CSP compliance in production builds.
- Redesigned the application UI into a dense desktop-workbench layout (title bar, toolbar with working Open File / Load Sample / Check / About / Language / Theme controls, bordered editor and diagnostics panes, bottom status bar, and accessible `<dialog>` About modal), removing development-status/hero copy.

### Security

- Configured strict Content Security Policy in `packages/app/index.html` (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `base-uri 'self'`).
- Added a temporary 1 MB input-size cap to the M0 `DOMParser` well-formedness preview.
- Enforced safe DTD/entity handling in `@xmlens/core` `checkWellFormedness`: external DTDs are never fetched and custom `<!ENTITY>` declarations are never expanded, neutralizing recursive entity-expansion attacks.
- Enforced repository binary/license guards against disallowed third-party binaries and unreviewed licenses (`npm run plugins:guard`, `npm run license:check`).
- Pinned GitHub Actions workflows to 40-character commit SHAs, added a dedicated `npm audit --audit-level=high` CI job, and configured weekly Dependabot updates (`.github/dependabot.yml`).
