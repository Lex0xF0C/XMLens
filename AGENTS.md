# AGENTS.md

Instructions for AI coding agents and human contributors working on **XMLens** (working name), a browser-only, MIT-licensed XML development and visualization tool deployed on GitHub Pages.

Read `docs/IMPLEMENTATION_PLAN.md` first. It is the source of truth for scope, priorities (P0–P3), architecture, and milestones. If this file and the plan disagree, stop and ask.

> ## ⚠️ CRITICAL — SaxonJS must NEVER enter the git repository
>
> This project is developed in **Google AI Studio**, whose **automatic GitHub integration pushes the workspace to a public repository**. We **cannot assume `.gitignore` is honored** by that integration. Therefore:
>
> 1. **Never create, download, copy, paste, vendor, or generate any SaxonJS / `saxon-js` / `xslt3` / `SaxonJS2*.js` file in the workspace.** Not for testing, not "temporarily", not under `public/`, `dist/`, `node_modules/`, or `plugins/`.
> 2. **Never add `saxon-js` or `xslt3` to `package.json`** (any dependency section) or to the lockfile. The plugin is fetched **only inside GitHub Actions** by `scripts/fetch-plugins.mjs` (which refuses to run unless `GITHUB_ACTIONS=true`). **Do not run `plugins:fetch` locally or in AI Studio.**
> 3. The only plugin-related files allowed in git are metadata: `plugins/saxonjs/pinned.json` and `plugins/saxonjs/APPROVED_LICENSE.sha256` (and docs under `docs/`).
> 4. Do **not** treat `.gitignore` as protection. Keep `node_modules/`, `dist/`, and the plugin paths listed in it anyway, but assume it may be ignored by the sync.
> 5. If you notice any such file already tracked or present in the workspace: **stop, delete it, tell the maintainer immediately**, and do not continue pushing until it is removed (history purge may be required).
> 6. The CI guard `scripts/check-no-third-party-binaries.mjs` enforces this; never weaken, bypass, or add exceptions to it.
>
> When writing or testing code that touches XSLT 2.0/3.0, use **mocks/stubs** of the plugin interface, never the real library, in the AI Studio workspace.

## 1. Project at a glance

- **What:** A static web app (no backend) to edit, validate, query, transform, compare, and visualize XML. Aimed at OSS communities and individuals who cannot afford commercial XML editors. First-class domains: LegalDocML / Akoma Ntoso, LegalRuleML, CVRF (XML predecessor of CSAF), XLIFF, plus generic XSD/XSLT/Schematron.
- **Languages (human):** English is primary. Japanese is secondary and must stay complete.
- **License:** MIT.
- **Hosting:** GitHub Pages, possibly under a sub-path (e.g. `/xmlens/`).
- **Privacy:** All processing is local. No telemetry, no uploads, no runtime network calls except explicit user actions.

## 2. Setup and commands

> The repository is scaffolded in milestone M0. Until then these scripts are the **contract** the scaffold must provide. Once they exist, keep this section accurate.

Requirements: Node.js LTS, npm. Contributors use Windows, macOS, and Linux, so **every script must be cross-platform**. No bash-only scripts, no `rm -rf`, no `sed`; use Node scripts or cross-platform packages.

```
npm ci                 # install exactly from the lockfile
npm run dev            # Vite dev server
npm run build          # production build (static output in dist/)
npm run plugins:fetch  # CI ONLY (refuses to run unless GITHUB_ACTIONS=true): downloads pinned SaxonJS via `npm pack`, verifies integrity + license hash, copies it unmodified into dist/plugins/. NEVER run in AI Studio or locally.
npm run preview        # serve the production build locally (test the sub-path base too)
npm run lint           # ESLint
npm run format         # Prettier (write); `format:check` for CI
npm run typecheck      # tsc --noEmit (strict)
npm run test           # Vitest unit tests
npm run test:e2e       # Playwright (Chromium, Firefox, WebKit) incl. axe a11y checks
npm run i18n:check     # key parity between locales/en.json and locales/ja.json
npm run license:check  # fails on disallowed dependency licenses
npm run check          # lint + typecheck + test + i18n:check + license:check
```

Before declaring any task done, run `npm run check` (and `npm run test:e2e` if UI changed). Report what you ran and the result. If you could not run something, say so explicitly. Do not claim success without evidence.

## 3. Repository layout

```
packages/core/     Pure TypeScript. No DOM, no UI. Parse, validate, xpath, diff, stats.
packages/workers/  Web Worker entrypoints and typed RPC layer.
packages/viz/      Visualization components (tree, treemap, graphs).
packages/app/      Vite app: UI, routing, i18n wiring.
profiles/<id>/     Profile packs: profile.json, catalog, schemas, Schematron, samples, PROVENANCE.md.
plugins/          Metadata ONLY (saxonjs/pinned.json, saxonjs/APPROVED_LICENSE.sha256). Plugin binaries must never exist in git or in the AI Studio workspace.
locales/           en.json (source of truth), ja.json.
docs/              Plan, ADRs (docs/adr/), feature matrix, i18n guide.
tests/fixtures/    Test data. Every fixture needs a known license/origin.
```

Keep `packages/core` free of DOM and browser globals so it can later power a CLI or editor extension.

## 4. Hard rules (do not violate)

### 4.1 Licensing and legal
1. **Clean-room.** Never copy code, UI layout, screenshots, icons, wording, or documentation from any proprietary or commercial product. Implement from public specs (W3C, OASIS) and your own design.
2. **No trademark use.** Do not use the name or logo of any commercial XML editor in code identifiers, UI text, docs, commit messages, or issues. Do not name specific commercial products as the origin of a feature; describe features by their generic function.
3. **Dependencies must be MIT, BSD-2/3, ISC, Apache-2.0, 0BSD, CC0, or Unlicense.** MPL-2.0 needs explicit maintainer approval. **Never add** GPL, AGPL, LGPL (bundled), SSPL, or "source-available/free but not open source" packages.
4. **SaxonJS (Saxonica) is not open source and is governed by its own license** (Saxon-JS Public License v1.0, June 2020, for the pinned version; re-check on any version change). Decision (ADR-0002): it ships as an **optional, off-by-default plugin**. Rules:
   - **Never let it enter git or the AI Studio workspace** (see the CRITICAL box at the top). It is **not** an npm dependency: do not add `saxon-js`/`xslt3` to `package.json` or the lockfile. `scripts/fetch-plugins.mjs` runs only in GitHub Actions, downloads the version pinned in `plugins/saxonjs/pinned.json` via `npm pack`, verifies its integrity, and copies the files **unmodified** into `dist/plugins/saxonjs/` **after** the Vite build.
   - Never bundle, minify, tree-shake, patch, wrap-by-editing, or otherwise modify the library files. Never reverse engineer, decompile, or disassemble it, and do not rely on undocumented internals. Interact only through its documented API.
   - Always ship the full license text next to it and reproduce the copyright notice and disclaimer in the About page and `THIRD_PARTY_NOTICES.md`. Do not use the licensor's name to endorse or promote the project.
   - The build must fail if the shipped license text differs from `plugins/saxonjs/APPROVED_LICENSE.sha256`. Only a maintainer may update that hash, after reviewing the new text.
   - Maintainers decided to ship it **without requesting written permission** (ADR-0002), reading condition 4 as aimed at software-distribution sites, not at an application that uses the library. Everything below exists to keep that reading valid. Do not undermine it:
     - Never add any page, link, button, README/docs text, release asset, branch, repository, or npm package that offers the SaxonJS file for download, mirrors it, or presents our site as a way to obtain it.
     - Never publish the plugin directory in a listing (no directory index, sitemap entry, or docs link to the file). It is loaded only by the app after opt-in.
     - Keep the build flag `XMLENS_BUNDLE_SAXONJS` working. With it off, the app builds and passes all tests without any Saxon files. If a maintainer asks to remove the plugin (licensor objection, license change), do it immediately in one change.
     - Do not make claims about legal clearance in docs or UI beyond the factual notices; do not write "permitted by Saxonica".
   - Load it only after explicit user opt-in, only from our own origin (no CDN), and isolated (sandboxed iframe or worker). The default build must work fully without it.
   - Because it is not in `package.json`, `license:check` never sees it; do not add allowlist exceptions. Its license is controlled by `APPROVED_LICENSE.sha256` instead.
5. **Bundled schemas/standards files** require redistribution permission. Add `PROVENANCE.md` (source URL, version, license, retrieval date) in the profile folder. If unsure, do not bundle; support user upload instead.
6. Before adding any dependency: check its license and its maintenance status, state both in the PR, and prefer small, well-maintained packages. Pin versions via the lockfile.
7. Never invent license information. If you cannot verify a license from the package or repository itself, say "unverified" and ask.

### 4.2 Privacy and security
1. No telemetry, analytics, tracking, or third-party CDN/fonts at runtime. All assets are self-hosted in the build.
2. No network request without an explicit user action. Optional plugins are served from our own origin; never load scripts or fonts from a third-party host. The CSP in `index.html` must stay strict; do not loosen it without an ADR.
3. No `eval`, `new Function`, `innerHTML` with untrusted data, or inline scripts.
4. XSLT output and any user-derived HTML must be rendered in a **sandboxed iframe** (or sanitized), never injected into the app DOM.
5. XML input is untrusted. Never fetch external entities or DTDs. Enforce limits for entity expansion, document size tiers, memory, and worker timeouts.
6. Run heavy work (parse, validate, XPath, XSLT, diff of large docs) in Web Workers with cancellation and timeouts. Do not block the main thread.
7. Never commit secrets, tokens, or personal data. Test fixtures must contain no real personal or confidential content.

### 4.3 Internationalization (English primary, Japanese secondary)
1. **No user-visible string literals in components.** Use message keys from `locales/en.json`. Keys are semantic (`validation.error.line`), not sentence text.
2. Every new or changed key must be added to **both** `en.json` and `ja.json` in the same change. `npm run i18n:check` must pass. If you cannot produce a good Japanese translation, add your best attempt and mark the PR with `needs-ja-review`; never leave a key missing.
3. Use ICU-style messages for plurals and interpolation; use `Intl` for numbers and dates.
4. Engine error messages (libxml2, browser) are English only. Wrap them with localized context and show raw text in a collapsible detail.
5. Follow the glossary in `docs/i18n-guide.md` (e.g. one agreed term for "well-formed" / 整形式, "validation"). Do not invent alternate terms.
6. Code, comments, commit messages, issues, and ADRs are written in English. User-facing docs exist in English and Japanese (`README.md`, `README.ja.md`, and `docs/ja/` mirrors).
7. Test with CJK content and IME composition in the editor when touching editor input code.

### 4.4 Accessibility
- Target **WCAG 2.2 AA**. All functionality must work by keyboard. Provide visible focus, sufficient contrast, and `prefers-reduced-motion` support.
- Tree view follows the ARIA tree pattern. Every graph/diagram view must have a textual or tabular alternative.
- Add or update axe checks in e2e tests for any new UI surface.

## 5. Coding conventions

- **TypeScript strict mode.** No `any` without a justification comment. Prefer `unknown` plus narrowing. No unchecked non-null assertions in core logic.
- Functions in `packages/core` are pure where possible and return typed results (`Result`-style or discriminated unions) rather than throwing for expected failures such as XML errors.
- Diagnostics are structured objects: `{ severity, code, message key, params, range (line/col/offset), xpath?, source }`. Never pass bare strings between layers.
- Workers communicate through the typed RPC layer in `packages/workers`. Messages must be serializable and versioned.
- Keep modules small and testable. Avoid global mutable state. UI state lives in the app package only.
- Do not reformat unrelated code. Match existing patterns; Prettier and ESLint are authoritative.
- Comments explain *why*, not *what*. Public functions in `core` get TSDoc.
- Prefer standard Web APIs over libraries when quality is sufficient.
- Bundle-size discipline: lazy-load large modules (validation WASM, graph layout, optional engines). Check the size impact of every dependency.

## 6. Testing requirements

- **Unit (Vitest):** every function in `core`. Use golden files for formatter, diff, Schematron/SVRL handling, and stats.
- **Fixtures:** put in `tests/fixtures/` with a sibling `README` noting origin and license. Include edge cases: BOM, UTF-16, namespaces, mixed content, large attributes, deep nesting, malformed input, CJK text, entity expansion attempts.
- **E2E (Playwright):** open → edit → validate → visualize → export, in Chromium, Firefox, and WebKit; both `en` and `ja`; include axe checks.
- **Performance:** keep the budgets in plan §7. Add a benchmark or test when touching parsing, tree rendering, or the editor extensions.
- Bug fixes include a regression test. A change without tests needs a stated reason.
- Never weaken, skip, or delete a failing test to make CI pass. Fix the cause or ask.

## 7. How to work

1. **Plan before code** for anything beyond a small fix: read the relevant plan section, state your approach in a few lines, then implement.
2. **Small, focused changes.** One concern per PR. Keep diffs reviewable.
3. **Respect priorities.** Do not implement P2/P3 or "OUT" items from the plan unless an issue and (if architectural) an ADR exist.
4. **Write an ADR** (`docs/adr/NNNN-title.md`: context, decision, consequences, alternatives) for: new framework/library of significance, CSP changes, data format changes, license-sensitive choices, anything marked "Open decisions" in the plan.
5. **Update docs with code:** user docs (en + ja), `docs/feature-matrix.md`, and this file when commands or rules change.
6. **When uncertain, ask** rather than guess. Especially for: licensing, scope, security posture, destructive operations, and translations of domain terminology.
7. **Do not fabricate.** Don't invent API behavior, package features, standards details, or test results. Verify against official docs or by running code, and cite the source in the PR when it matters (e.g., a W3C/OASIS section).

## 8. Domain notes for agents

- XML Schema support is **XSD 1.0** via a WASM libxml2 build; XSD 1.1 assertions are not supported. State limitations in the UI rather than failing silently.
- **Do not rely on browser-native XSLT** (`XSLTProcessor`): browsers are removing it. The default XSLT 1.0 engine is chosen in spike S2 (WASM). XSLT 2.0/3.0 exists only through the optional SaxonJS plugin (see 4.1.4).
- The SaxonJS **browser** build is designed to run stylesheets compiled to SEF (`.sef.json`); Node.js can execute XSLT directly and export SEF. Whether user-edited XSLT can be compiled in the browser is **unconfirmed** (spike S1). Do not claim live XSLT 2.0/3.0 editing support until S1 is done. The free compiler is invoked with the `xslt3` CLI; the XJ compiler belongs to the commercial Saxon-EE product and must not be assumed available.
- XPath 3.1 (XPath panel) and Schematron come from our own engine/interpreter, not from SaxonJS, so the default build keeps them without the plugin.
- Remote schema URLs usually fail in browsers due to CORS. Prefer bundled (if redistributable) or user-uploaded schemas, resolved through an XML Catalog.
- **CSAF 2.x is JSON**; its XML predecessor is **CVRF**. Do not claim "CSAF XML" support.
- Akoma Ntoso: `eId`, `wId`, `GUID`, and `href`/`refersTo` references are central to the reference graph and broken-link checks.
- Namespaces matter everywhere: always handle prefix ≠ namespace URI correctly in XPath, completion, and the tree view.
- Whitespace is significant in mixed content. Formatter and diff must be `xml:space`-aware and offer clear options.

## 9. Git, CI, and deployment

- Branches: `main` is always deployable. Work on `feat/…`, `fix/…`, `docs/…`.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`), English, imperative mood. Sign off commits (`-s`, DCO).
- PRs must include: summary, linked issue, test evidence, screenshots for UI changes (in both languages when text changes), and a dependency/license note if `package.json` changed.
- CI (GitHub Actions) runs `npm run check`, e2e, build, and license check. Pages deployment runs only from `main` via the official Pages actions and must work with a sub-path `base`.
- CI also runs `scripts/check-no-third-party-binaries.mjs`, which fails if any tracked file matches `*saxon*` (outside the allowlisted metadata and `docs/`), contains the vendor copyright line outside docs, or lies under `node_modules/` or `dist/`. A failure blocks Pages deployment. After each AI Studio sync that touches scripts, workflows, or plugin metadata, a maintainer should look at the repository on GitHub to confirm nothing forbidden was pushed.
- Do not force-push `main`, rewrite published history, or change workflow permissions without maintainer approval.

## 10. Definition of done

A change is done only when:
- [ ] Behavior matches the relevant section of `docs/IMPLEMENTATION_PLAN.md`
- [ ] `npm run check` passes (plus e2e for UI changes)
- [ ] New/changed strings exist in both `en.json` and `ja.json`
- [ ] Accessibility checked (keyboard, focus, labels, axe)
- [ ] No new network calls, no CSP loosening, no disallowed licenses
- [ ] No SaxonJS/`xslt3` file in the workspace or git; `package.json` and lockfile unchanged in that respect; repository guard passes
- [ ] Docs and feature matrix updated (en + ja where user-facing)
- [ ] Risks, limitations, and unverified assumptions are stated in the PR description

## 11. Ask before doing any of the following

- Adding a dependency with an unusual license, large size (> 100 KB gzipped), or weak maintenance
- Adding or changing any non-OSI-licensed component, or changing the pinned SaxonJS version (re-review its license text first)
- Changing how the SaxonJS file is hosted, linked, documented, or loaded (anything that could make the site look like a download source for it)
- Bundling third-party schemas or standards files
- Loosening CSP, adding network access, or adding any analytics
- Changing the UI framework, build tool, or repository layout
- Removing a feature, test, or translation key
- Renaming the project or changing the license
