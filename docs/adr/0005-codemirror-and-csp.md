# ADR-0005: CodeMirror 6 Integration Under Strict CSP (M1b Preparation)

- **Status:** Accepted (2026-11-28 — M1b prerequisites satisfied; production `<textarea>` replacement in `packages/app` not yet started)
- **Date:** 2026-11-24 (provisional conditions appended 2026-11-27; spike gates verified 2026-11-28)

### Acceptance Conditions & Ongoing M1b Constraints (2026-11-27 / Verified 2026-11-28)

1. **`> 100 KB` gzipped exception (`AGENTS.md` §11):** The `+126.2–126.5 kB` gzipped bundle delta (~`10.57%` of the `1.5 MiB` budget) is approved **for CodeMirror 6 only**. (Re-measure and re-confirm when CodeMirror 6 is integrated into `packages/app` in M1b.)
2. **Primary verification via CI `e2e-spike` (Passed 2026-11-28, run `46068522284`):** Automated verification ran via GitHub Actions `e2e-spike` across Chromium, Firefox, and WebKit (`6/6` tests passed: zero `securitypolicyviolation` via `page.addInitScript`, `<style>` `0`, `adoptedStyleSheets > 0`, and axe `wcag22aa`). Windows manual checklist Section B (`B-1` real IME, `B-2` `Tab` exit + Search panel, `B-3` screen reader, `B-4` themes / High Contrast / `prefers-reduced-motion`) also completed by the maintainer on 2026-11-28.
3. **M1b production gating & escalation:** Both prerequisites for starting M1b (`e2e-spike` passing in all 3 browsers and Windows manual Section B) are now satisfied; replacing `<textarea>` in `packages/app` remains **not yet started** and awaits maintainer approval of the M1b plan. The escalation rule stays active: if any browser fails Option A during M1b or production `test:e2e`, **stop and return the decision to the maintainer** — do not automatically switch to Option C.
4. **M1b integration design constraints:**
   - File opening and sample loading must reset Undo history using a fresh `EditorState` (`view.setState(...)`), not a document replacement transaction.
   - `ariaLabel` must update on i18n locale changes via `Compartment.reconfigure` (without destroying/re-mounting the `EditorView` and Undo stack).
   - Continue omitting `EditorView.cspNonce` and `indentWithTab`.

## Context

Milestone M1 plans to replace the temporary `<textarea>` preview in `packages/app` with **CodeMirror 6** (XML syntax highlighting, folding, tag matching, search, lint gutter, and click-to-jump diagnostics).

At the same time, XMLens deploys as a static site on GitHub Pages (`IMPLEMENTATION_PLAN.md` §1, `base: './'`) and enforces a strict Content Security Policy via `<meta http-equiv="Content-Security-Policy">` in `packages/app/index.html`:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';
```

`AGENTS.md` §4.2.2 prohibits loosening the CSP without an ADR. Because CodeMirror 6 relies on CSS-in-JS (`style-mod`) to apply editor layout and syntax-highlighting styles at runtime, we must decide how CodeMirror 6 can run without introducing `'unsafe-inline'` or breaking GitHub Pages static hosting.

## Investigation & Verified Facts

All package metadata below was queried via `npm view`, and `style-mod@4.1.5` / `@codemirror/view@6.43.15` tarball sources were inspected in memory on 2026-11-24 **without installing CodeMirror into the workspace**. Items not directly built or executed in browsers are explicitly marked **unverified**.

### 1. How CodeMirror 6 (`style-mod`) Injects Styles

By inspecting `node_modules`-equivalent tarball contents (`style-mod@4.1.5` `style-mod.js` and `@codemirror/view@6.43.15` `dist/index.js`):

- `@codemirror/view`'s `mountStyles()` delegates all editor base styles, themes, and extensions to `StyleModule.mount(this.root, modules, nonce ? { nonce } : undefined)`, reading `nonce` from the `EditorView.cspNonce` facet.
- Neither `@codemirror/view` nor `style-mod` calls `element.setAttribute('style', ...)`, and `@codemirror/view` does not create `<style>` tags directly.
- Inside `style-mod`'s `StyleSet` constructor:
  ```js
  if (!root.head && root.adoptedStyleSheets && win.CSSStyleSheet) {
    // Creates `new win.CSSStyleSheet()`, appends rules via `sheet.insertRule(...)`,
    // and attaches to `root.adoptedStyleSheets`. No <style> element is created.
  } else {
    // Creates `doc.createElement("style")`, injects CSS textContent, and sets `nonce` if provided.
  }
  ```
- **Critical consequence:** When `EditorView` mounts into Light DOM (`this.root` is `document`), `document.head` is truthy (`!root.head` is `false`), so **`style-mod` always falls back to creating a `<style>` tag**, which is **blocked by `style-src 'self'`** unless a valid nonce, hash, or `'unsafe-inline'` is present.
- Conversely, when `EditorView` mounts inside a **`ShadowRoot`** (`!root.head` is `true` and `ShadowRoot.prototype.adoptedStyleSheets` + `CSSStyleSheet` constructor exist in Chrome 73+, Firefox 101+, and Safari 16.4+), **`style-mod` uses Constructable Stylesheets (`adoptedStyleSheets`) and inserts zero `<style>` elements**.

### 2. Why `EditorView.cspNonce` Cannot Work With Static `<meta>` CSP

CodeMirror 6 documents `EditorView.cspNonce` for apps that emit a per-request CSP nonce header (`style-src 'nonce-<random>'`). That mechanism is incompatible with XMLens's architecture:

1. **No server / no per-request headers:** GitHub Pages serves static assets only; `<meta http-equiv="Content-Security-Policy">` in `index.html` is static and identical for all visitors.
2. **Static nonces defeat CSP:** Embedding a fixed `'nonce-...'` string in static HTML lets any injection payload read the fixed token from the DOM, negating the protection of a nonce.
3. **Runtime `<meta>` edits do not authorize earlier/dynamic tokens securely.**

### 3. Candidate Packages, Licenses, and Sizes

| Package                | Version  | License | Unpacked Size (npm) | Last npm Publish | Direct Dependencies                                                                                                                                                                                                                                       | Scope (`package-lock.json`) |
| ---------------------- | -------- | ------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `@codemirror/state`    | `6.7.6`  | `MIT`   | `440,367` B         | `2026-09-22`     | `@marijn/find-cluster-break` (`1.0.4`, `MIT`, `15,261` B)                                                                                                                                                                                                 | `dev: true`                 |
| `@codemirror/view`     | `6.44.2` | `MIT`   | `1,280,040` B       | `2026-11-26`     | `crelt` (`1.0.7`, `MIT`, `6,020` B), `style-mod` (`4.1.5`, `MIT`, `23,260` B), `w3c-keyname` (`2.2.8`, `MIT`, `8,381` B), `@codemirror/state`                                                                                                             | `dev: true`                 |
| `@codemirror/commands` | `6.11.2` | `MIT`   | `246,833` B         | `2026-11-25`     | `@lezer/common`, `@codemirror/view`, `@codemirror/state`, `@codemirror/language`                                                                                                                                                                          | `dev: true`                 |
| `@codemirror/language` | `6.13.1` | `MIT`   | `291,304` B         | `2026-10-07`     | `@lezer/lr` (`1.4.13`, `MIT`, `170,304` B), `@lezer/common` (`1.5.7`, `MIT`, `251,974` B), `@lezer/highlight` (`1.2.5`, `MIT`, `99,935` B), `style-mod`, `@codemirror/streamparser` (`6.0.0`, `MIT`, `23,256` B), `@codemirror/view`, `@codemirror/state` | `dev: true`                 |
| `@codemirror/lang-xml` | `6.1.0`  | `MIT`   | `45,745` B          | `2024-03-06`     | `@lezer/xml` (`1.0.6`, `MIT`, `45,097` B), `@codemirror/autocomplete` (`6.20.4`, `MIT`, `256,194` B), `@lezer/common`, `@codemirror/view`, `@codemirror/state`, `@codemirror/language`                                                                    | `dev: true`                 |
| `@codemirror/lint`     | `6.9.8`  | `MIT`   | `97,579` B          | `2026-11-13`     | `crelt`, `@codemirror/view`, `@codemirror/state`                                                                                                                                                                                                          | `dev: true`                 |
| `@codemirror/search`   | `6.7.3`  | `MIT`   | `138,040` B         | `2026-11-25`     | `crelt`, `@codemirror/view`, `@codemirror/state`                                                                                                                                                                                                          | `dev: true`                 |
| `@lezer/highlight`     | `1.2.5`  | `MIT`   | `99,935` B          | `2026-09-28`     | `@lezer/common` (`1.5.7`, `MIT`)                                                                                                                                                                                                                          | `dev: true` (direct)        |

- **License compliance:** All 17 packages (8 direct `devDependencies` including `@lezer/highlight` imported directly by `spikes/codemirror/bridge.ts` + 9 transitive) installed in `package-lock.json` use the **`MIT`** license (`dev: true` only during the spike; zero non-MIT transitives, zero exceptions required in `scripts/license-exceptions.json`).
- **Maintenance:** All packages except `@codemirror/lang-xml` (`2024-03-06`), `@lezer/xml` (`2024-12-27`), and `w3c-keyname` (`2023-06-07`) have late-2026 releases (`@lezer/highlight@1.2.5` published `2026-09-28`, `99,935` B unpacked); all belong to the official CodeMirror / Lezer ecosystem.
- **Gzipped bundle impact:** Measured via Vite production build on 2026-11-27 (see Spike Results below). Main-entry JS gzip delta is **`~126.2–126.5 kB` (`> 100 KB` gzipped threshold under `AGENTS.md` §11; provisionally approved for CodeMirror 6 only on 2026-11-27)**, keeping total JS+CSS around `~10.57%` of the `1.5 MiB` first-load budget.

## Options Considered

### Option A (Recommended): Mount CodeMirror 6 Inside a Dedicated `ShadowRoot` (`adoptedStyleSheets`) With `style-src 'self'` Unchanged

Create a host `<div class="editor-host">` with `attachShadow({ mode: 'open' })`, mount `EditorView` inside that `ShadowRoot`, inherit design tokens via CSS custom properties (`--bg`, `--fg`, `--border`, etc., which cross Shadow DOM boundaries), and keep `packages/app/index.html` CSP completely unchanged (`style-src 'self'`).

- **Pros:**
  - Keeps `style-src 'self'` strictly intact (zero `'unsafe-inline'`, zero CSP weakening).
  - Requires no server-side nonces or fragile build-time style hashing.
  - Isolates CodeMirror's DOM/styles cleanly from workbench layout CSS.
- **Caveats / Items Unverified Until Cross-Browser Playwright Spike:**
  1. Browser CSP enforcement for Constructable Stylesheets (`new CSSStyleSheet()` + `insertRule` + `shadowRoot.adoptedStyleSheets`) under `style-src 'self'` in **Chromium, Firefox, and WebKit** is **unverified** in our actual test harness (`securitypolicyviolation` listener check required in Playwright).
  2. Whether CodeMirror panels/tooltips (`@codemirror/lint`, `@codemirror/search`, `@codemirror/autocomplete`) inject `<style>` or `style="..."` or portal to `document.body` (unless `tooltips({ parent })` targets the `ShadowRoot`) is **unverified**.
  3. **Accessible name across shadow boundary:** `aria-labelledby` / IDREF cannot cross a `ShadowRoot` boundary, so the editor's accessible name must be set inside the shadow root (for example via `EditorView.contentAttributes.of({ 'aria-label': ... })` from i18n).
  4. **Inline style vs CSSOM CSP check:** CSP blocks `style="..."` attributes created via `setAttribute('style', ...)` or parsed HTML, while allowing CSSOM property writes (`el.style.x = ...`); static source inspection is insufficient, so the spike must rely on measured `securitypolicyviolation` events in live browsers.
  5. CJK IME composition, keyboard navigation, and screen-reader behavior inside `ShadowRoot` are **unverified** until tested with Playwright + axe.
  6. Actual Vite gzipped JS delta for the 7 CodeMirror packages is **unverified**.

### Option B: Build-Time `<style>` Hash Allowlist (`'sha256-...'`) or Static CSS Extraction

Attempt to compute CSP `'sha256-...'` hashes of every `style-mod` `<style>` element or extract `StyleModule.getRules()` into static CSS at build time.

- **Cons:** `StyleModule.newName()` generates sequential runtime class names (`ͼ0`, `ͼ1`, ...) whose exact selector strings depend on module registration order and dynamically enabled extensions/themes (`@codemirror/lint`, `@codemirror/search`, etc.). A single combined `<style>` tag changes hash whenever any extension mounts or unmounts, making static `<meta>` SHA-256 hashes fragile.

### Option C: Relax CSP to `style-src 'self' 'unsafe-inline'` (Keeping `script-src 'self'` Strict)

Allow inline `<style>` in Light DOM while keeping `script-src 'self'` untouched.

- **Pros:** Simplest fallback; avoids ShadowRoot tooltip/ARIA edge cases.
- **Cons:** Weakens CSP `style-src 'self'` against style-based injection/UI-redressing if untrusted markup ever reached the main DOM, and conflicts with `AGENTS.md` §4.2.2 unless Option A proves unworkable in Firefox or WebKit.

## Recommendation (Accepted in Principle; Spike Gated on ADR-0006)

Option **A** is accepted in principle as a **gated M1b spike** (pending maintainer approval of `ADR-0006` before installing any CodeMirror or test-harness packages):

1. Install the 7 MIT-licensed CodeMirror packages listed above (only after the test harness is approved and spike begins).
2. Measure the exact Vite production gzipped JS delta against the `1.5 MB` budget.
3. Verify in Playwright across **Chromium, Firefox, and WebKit** with `style-src 'self'` active that mounting `EditorView` (with `@codemirror/lang-xml`, `@codemirror/lint`, `@codemirror/search`, and an internal `aria-label` inside the `ShadowRoot`) emits **zero measured `securitypolicyviolation` events**, passes axe accessibility checks, and handles CJK/IME input properly.
4. **Escalation rule:** If any target browser fails Option A (CSP violation, broken accessibility, or broken IME), **stop and return the fallback decision to the maintainer** — do not automatically adopt Option C.

## Spike Results (2026-11-27)

An isolated spike was built under `spikes/codemirror/` (`index.html`, `main.ts`, `bridge.ts`, `styles.css`, `vite.config.ts`, `codemirror.test.ts`, `playwright.config.ts`, `e2e.spec.ts`), keeping `packages/app/` (`<textarea>`) and `dist/` completely untouched.

### 1. Verification Matrix (Verified vs. `unverified`)

| Check Item                                                                                     | Status                    | Evidence / Notes                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| License verification (all 17 packages `MIT`, zero non-MIT transitives, `devDependencies` only) | Verified                  | `package-lock.json` + `node_modules/*/package.json` + `npm run license:check` (`201` packages)                                                                                                   |
| Vite production bundle size & tree-shaken gzipped delta                                        | Verified                  | Measured via `npm run build` vs `vite build --config spikes/codemirror/vite.config.ts` (see table below)                                                                                         |
| `Option A` CSS / `style-mod` `adoptedStyleSheets` inspection in installed packages             | Verified                  | `@codemirror/view@6.44.2`, `@codemirror/lint@6.9.8`, `@codemirror/search@6.7.3` mount inside `this.root` without `setAttribute('style', ...)`                                                    |
| Multi-step Undo/Redo, XML folding, `OpenTag`/`CloseTag` bracketMatching                        | Verified                  | `spikes/codemirror/codemirror.test.ts` (`isolateHistory.of('full')`, `foldable`, `matchBrackets`)                                                                                                |
| `@xmlens/core` `Diagnostic.range.offset` → `@codemirror/lint` (incl. CJK, astral, EOF clamp)   | Verified                  | `spikes/codemirror/codemirror.test.ts` (`mapDiagnosticsToLint`, `diagnosticToLintDiagnostic`)                                                                                                    |
| Undoable `formatXml` transaction (resolving `ADR-0012` `textarea.setRangeText` limitation)     | Verified                  | `spikes/codemirror/codemirror.test.ts` (`createFormatTransactionSpec` with `isolateHistory.of('full')`)                                                                                          |
| `getXPathAtOffset` + composing/stale discard, `decodeXml` LF & `saveXml` CRLF/BOM round-trip   | Verified                  | `spikes/codemirror/codemirror.test.ts` (`extractXPathLookupInput`, `shouldDiscardSpikeXPathResult`, `decodeXmlBytes`, `prepareXmlSaveBytes`)                                                     |
| `EditorView.contentAttributes` (`aria-label`), empty `EditorView.cspNonce`, no `indentWithTab` | Verified                  | `spikes/codemirror/codemirror.test.ts` + `spikes/codemirror/bridge.ts`                                                                                                                           |
| Live browser `securitypolicyviolation` count (`style-src 'self'`) & `adoptedStyleSheets`       | Verified (CI)             | GitHub Actions `e2e-spike` run `46068522284` (2026-11-28): `CSP violations: 0`, `<style>` `0`, `adoptedStyleSheets > 0` across Chromium, Firefox, and WebKit (`unverified` locally in AI Studio) |
| Cross-browser Playwright + axe (`wcag22aa`) in Chromium / Firefox / WebKit                     | Verified (CI)             | GitHub Actions `e2e-spike` run `46068522284` (2026-11-28): `6/6` passed (`spikes/codemirror/e2e.spec.ts`), `0` axe violations, `0` console/page errors                                           |
| Real Japanese IME (`compositionstart`/`update`/`end`), Tab focus exit, screen readers          | Verified (Windows manual) | Completed by maintainer on Windows (2026-11-28) covering Section B (`B-1`–`B-4`); macOS / Safari real hardware remains **`unverified`**                                                          |

### 2. Measured Vite Bundle Sizes (`vite@7.3.8`)

| Artifact / Bundle (`npm run build` vs Spike Build)   | Raw Size    | Vite Gzip (`kB`) | `zlib` level-9 Gzip (`B`) | Share of `1.5 MiB` Budget (`1,572,864 B`) |
| ---------------------------------------------------- | ----------- | ---------------- | ------------------------- | ----------------------------------------- |
| Production `dist/assets/index-*.css`                 | `8,072` B   | `2.19` kB        | `2,191` B                 | —                                         |
| Production `dist/assets/index-*.js`                  | `82,315` B  | `24.34` kB       | `24,291` B                | —                                         |
| Production `dist/assets/xmlWorker-*.js`              | `47,903` B  | —                | `14,010` B                | —                                         |
| **Production `dist/` Total JS + CSS**                | `138,290` B | —                | **`40,492` B**            | **`~2.57%`**                              |
| Spike `.spike-dist/codemirror/assets/index-*.css`    | `5,605` B   | `1.77` kB        | `1,766` B                 | —                                         |
| Spike `.spike-dist/codemirror/assets/index-*.js`     | `463,412` B | `150.87` kB      | `150,525` B               | —                                         |
| Spike `.spike-dist/codemirror/assets/xmlWorker-*.js` | `47,903` B  | —                | `14,010` B                | —                                         |
| **Spike Total JS + CSS**                             | `516,920` B | —                | **`166,301` B**           | **`~10.57%`** (`~11.09%` of `1.5 MB`)     |

- **Main-entry JS gzip delta:** `150,525 B - 24,291 B = 126,234 B` (`~123.28 KiB` / `126.53 kB` Vite-reported).
- **Policy notice (`AGENTS.md` §11):** This gzipped delta **exceeds `100 KB` gzipped** (`> 100 KB`), provisionally approved **only for CodeMirror 6** on 2026-11-27. Total JS+CSS (`~166.3 KB` gzipped) leaves roughly `~89.4%` of the `1.5 MiB` first-load budget available for upcoming WASM validators (`libxml2-wasm`), XSLT, and visualizations.

### 3. Compatibility & Integration Findings

- **`@xmlens/core` & `@xmlens/workers`:**
  - `checkWellFormedness` UTF-16 `Diagnostic.range.offset` maps cleanly to `@codemirror/lint` (`from`, `to` clamped to `[0, doc.length]`), preserving CJK and surrogate-pair coordinates.
  - `formatXml` output integrates via `createFormatTransactionSpec` (`changes: { from: 0, to: doc.length, insert }` + `annotations: isolateHistory.of('full')`), giving deterministic single-step Undo/Redo and resolving the `ADR-0012` `textarea.setRangeText` browser variance.
  - **M1b file/sample load rule:** Unlike `formatXml`, opening a file or loading the sample in `packages/app` MUST replace the editor state with a fresh `EditorState` (`view.setState(...)`) rather than a document transaction, so prior-document Undo history is cleared.
  - `getXPathAtOffset` works via `xpathWorkerClient` with `state.selection.main.head` and `shouldDiscardSpikeXPathResult` checking `view.composing` (`isComposing`), `requestEpoch`, text, and head offset.
  - `decodeXmlBytes` + `normalizeDecodedTextForEditor` (`LF` normalization, BOM stripping into `hasBom`) round-trips through CodeMirror `state.doc.toString()` back into `prepareXmlSaveBytes` (`CRLF` + BOM restoration).
- **ShadowRoot & Accessibility:**
  - Setting `EditorView` `parent: shadowRoot` and `root: shadowRoot` causes `style-mod` to mount Constructable Stylesheets on `shadowRoot.adoptedStyleSheets`. CSS custom properties (`--bg-surface`, `--text-primary`, `--focus-ring`, `--cm-*`) cross the ShadowRoot boundary cleanly in CSS specs for Light, Dark, and High Contrast themes.
  - Excluding `indentWithTab` from `keymap` preserves `Tab` / `Shift+Tab` focus exit out of the editor. Accessible naming uses `EditorView.contentAttributes.of({ 'aria-label': ... })` via `Compartment.reconfigure` inside the ShadowRoot because `aria-labelledby` cannot cross a shadow boundary.
- **Remaining Concerns & M1b Readiness (Updated 2026-11-28):**
  - GitHub Actions `e2e-spike` (`46068522284`, `6/6` across `chromium`, `firefox`, `webkit`) and Windows manual Section B (`B-1`–`B-4`) have passed, satisfying the preconditions to plan and start M1b.
  - Production `packages/app` integration (`<textarea>` replacement, main-app `test:e2e`, and macOS/Safari real hardware verification) remains **`unverified`** until M1b is implemented. The `Escalation rule` remains in effect: if any browser fails Option A during M1b, stop and return to the maintainer without falling back to Option C.

## Verification Checklist (`spikes/codemirror/`)

### A. Replaced by GitHub Actions CI (`e2e-spike` job, `.github/workflows/ci.yml`)

Manual verification of Section A is **no longer required** unless CI fails; the `e2e-spike` job (`npm run test:e2e:spike`, building with `spikes/codemirror/vite.config.ts` and running `vite preview` on `127.0.0.1:3100` via `webServer.cwd: '../..'` because Playwright defaults `webServer.cwd` to the config file directory `spikes/codemirror/`) checks across `chromium`, `firefox`, and `webkit`.

- **2026-11-28 green run (`46068522284`):** All `6/6` tests (`2` specs × `3` browsers) passed following the `aria-hidden="true"` fix on `hidden-file-input`, confirming:

1. Zero `securitypolicyviolation` events (captured from page start via `page.addInitScript`), zero `console.error`, and zero `pageerror` events under strict `style-src 'self'`.
2. `#cm-host.shadowRoot` contains `0` `<style>` elements, `> 0` `adoptedStyleSheets`, and `.cm-content` `aria-label`.
3. `AxeBuilder` (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) reports `0` violations.
4. **Format** → **Undo** → **Redo** flow and `Tab` focus exit (without inserting `\t`).

### B. Manual-Only Windows Verification Checklist (Completed 2026-11-28)

Maintainer completed manual verification on Windows on 2026-11-28 covering all four items (`B-1` through `B-4`) below. Retain this checklist for M1b production regression verification (`npm run build && npm run preview`):

```bash
npx vite build --config spikes/codemirror/vite.config.ts
npx vite preview --config spikes/codemirror/vite.config.ts --host 127.0.0.1 --port 3100
```

1. **(`B-1`, Verified 2026-11-28) Real Japanese IME composition & cancellation:** Focus the editor, enable Microsoft IME (Japanese), type `あいう` + convert + commit inside `<root><p></p></root>`, and cancel a conversion with `Escape`. Confirm no duplicated characters, status-bar `XPath` updates cleanly after commit without flickering mid-composition, and `CSP violations: 0`.
2. **(`B-2`, Verified 2026-11-28) Keyboard-only `Tab` exit & Search panel (`Ctrl+F`):** Focus the editor, press `Tab` and `Shift+Tab`, and confirm focus exits the editor cleanly (no keyboard trap). Press `Ctrl+F` (or click **Search**), navigate search panel inputs/buttons with `Tab`, and press `Escape` to return focus to the editor while confirming `CSP violations: 0`.
3. **(`B-3`, Verified 2026-11-28) Screen reader announcement:** Focus the editor and confirm the screen reader announces `XML Input` / `XML 入力` and editable role; navigate to a diagnostic item and confirm location/message readout.
4. **(`B-4`, Verified 2026-11-28) Themes & High Contrast / `prefers-reduced-motion`:** Switch **Light / Dark / High contrast** in the spike toolbar, inspect syntax colors, selection background, gutter, and `2px` focus ring readability; verify cursor blinking stops when Windows animation effects are reduced.
