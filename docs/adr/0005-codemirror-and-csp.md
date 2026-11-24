# ADR-0005: CodeMirror 6 Integration Under Strict CSP (M1b Preparation)

- **Status:** Accepted in principle; spike gated on ADR-0006 (test harness decision)
- **Date:** 2026-11-24

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

| Package                | Version   | License | Unpacked Size (npm) | Last npm Publish | Direct Dependencies                                                                                                                                                                                                                                       |
| ---------------------- | --------- | ------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codemirror/state`    | `6.7.6`   | `MIT`   | `440,367` B         | `2026-09-22`     | `@marijn/find-cluster-break` (`1.0.4`, `MIT`, `15,261` B)                                                                                                                                                                                                 |
| `@codemirror/view`     | `6.43.15` | `MIT`   | `1,264,544` B       | `2026-10-19`     | `crelt` (`1.0.7`, `MIT`, `6,020` B), `style-mod` (`4.1.5`, `MIT`, `23,260` B), `w3c-keyname` (`2.2.8`, `MIT`, `8,381` B), `@codemirror/state`                                                                                                             |
| `@codemirror/commands` | `6.11.1`  | `MIT`   | `246,640` B         | `2026-09-15`     | `@lezer/common`, `@codemirror/view`, `@codemirror/state`, `@codemirror/language`                                                                                                                                                                          |
| `@codemirror/language` | `6.13.1`  | `MIT`   | `291,304` B         | `2026-10-07`     | `@lezer/lr` (`1.4.12`, `MIT`, `169,738` B), `@lezer/common` (`1.5.6`, `MIT`, `251,404` B), `@lezer/highlight` (`1.2.5`, `MIT`, `99,935` B), `style-mod`, `@codemirror/streamparser` (`6.0.0`, `MIT`, `23,256` B), `@codemirror/view`, `@codemirror/state` |
| `@codemirror/lang-xml` | `6.1.0`   | `MIT`   | `45,745` B          | `2024-03-06`     | `@lezer/xml` (`1.0.6`, `MIT`, `45,097` B), `@codemirror/autocomplete` (`6.20.4`, `MIT`, `256,194` B), `@lezer/common`, `@codemirror/view`, `@codemirror/state`, `@codemirror/language`                                                                    |
| `@codemirror/lint`     | `6.9.8`   | `MIT`   | `97,579` B          | `2026-11-13`     | `crelt`, `@codemirror/view`, `@codemirror/state`                                                                                                                                                                                                          |
| `@codemirror/search`   | `6.7.2`   | `MIT`   | `137,655` B         | `2026-08-31`     | `crelt`, `@codemirror/view`, `@codemirror/state`                                                                                                                                                                                                          |

- **License compliance:** All 17 packages (7 direct + 10 transitive) use the **`MIT`** license, matching `AGENTS.md` §4.1.3 with zero license exceptions needed.
- **Maintenance:** All packages except `@codemirror/lang-xml` (`2024-03-06`) and `@lezer/xml` (`2024-12-27`) and `w3c-keyname` (`2023-06-07`) have 2026 releases; all belong to the official CodeMirror / Lezer ecosystem.
- **Gzipped bundle impact:** Total npm `unpackedSize` across all 17 packages is `~3.14 MB` (which includes TypeScript declarations, source maps, CommonJS/ESM builds, and docs). Exact tree-shaken minified + gzipped Vite output size is **unverified** until installed and built against `IMPLEMENTATION_PLAN.md` §7 (`<= 1.5 MB` gzipped JS+WASM first-load budget).

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
