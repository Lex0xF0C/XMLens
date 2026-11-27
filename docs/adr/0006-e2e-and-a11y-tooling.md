# ADR-0006: Cross-Browser E2E & Accessibility Tooling (Playwright + axe)

- **Status:** Accepted (2026-11-27; conditional: `devDependencies` only, unmodified, never bundled into `dist/` or GitHub Pages; `MPL-2.0` exceptions limited strictly to `@axe-core/playwright` and `axe-core`; Playwright browser binaries excluded from git and `dist/`; CI `e2e` job deferred)
- **Date:** 2026-11-24 (updated 2026-11-27)

## Context

`AGENTS.md` §4.4, §6, and `IMPLEMENTATION_PLAN.md` §7 require cross-browser E2E testing (Chromium, Firefox, WebKit) and automated WCAG 2.2 AA accessibility checks (axe). In addition, `ADR-0005` gates the CodeMirror 6 Shadow DOM + `adoptedStyleSheets` spike on live browser verification of `securitypolicyviolation` events, styling, keyboard operability, and CJK IME behavior across Chromium, Firefox, and WebKit.

Before installing any test dependencies, we verified package licenses (`AGENTS.md` §4.1.3), maintenance status, sizes, AI Studio sandbox feasibility, and CI execution design.

## Package Metadata & License Assessment

Initial registry metadata was queried via `npm view` on 2026-11-24; installed versions and `package-lock.json` metadata below were verified on 2026-11-27 after maintainer conditional approval. Browser execution in this AI Studio environment remains **unverified** (no browser binaries installed).

| Package                | Installed Version | License       | Unpacked Size (npm) | Last npm Publish | Direct Dependencies      | Scope (`package-lock.json`) |
| ---------------------- | ----------------- | ------------- | ------------------- | ---------------- | ------------------------ | --------------------------- |
| `@playwright/test`     | `1.65.1`          | `Apache-2.0`  | `28,542` B          | `2026-11-13`     | `playwright@1.65.1`      | `dev: true`                 |
| `playwright`           | `1.65.1`          | `Apache-2.0`  | `5,064,151` B       | `2026-11-13`     | `playwright-core@1.65.1` | `dev: true`                 |
| `playwright-core`      | `1.65.1`          | `Apache-2.0`  | `13,971,424` B      | `2026-11-13`     | `{}`                     | `dev: true`                 |
| `@axe-core/playwright` | `4.14.1`          | **`MPL-2.0`** | `48,901` B          | `2026-11-24`     | `axe-core@~4.14.1`       | `dev: true`                 |
| `axe-core`             | `4.14.1`          | **`MPL-2.0`** | `3,437,349` B       | `2026-11-16`     | `{}`                     | `dev: true`                 |

_(Note: the initial 2026-11-24 proposal listed `@axe-core/playwright@4.14.0`; on installation on 2026-11-27 npm resolved `@axe-core/playwright@4.14.1` published `2026-11-24`, which matches `axe-core@4.14.1`.)_

### License Policy Impact (`AGENTS.md` §4.1.3 & `scripts/check-licenses.mjs`)

1. **`@playwright/test`, `playwright`, `playwright-core`:** `Apache-2.0` — in the repository allowlist (`ALLOWED_LICENSES`), actively maintained (`2026-11-13`), zero transitive dependencies beyond `playwright`/`playwright-core`. Browser binaries themselves (~hundreds of MB) are downloaded separately by `playwright install` outside npm, are never committed to the repository, and are never included in `dist/`.
2. **`@axe-core/playwright` and `axe-core`:** Both are licensed under **`MPL-2.0`**.
   - Per `AGENTS.md` §4.1.3, `MPL-2.0` requires explicit maintainer approval.
   - `scripts/license-exceptions.json` now contains reviewed exceptions strictly scoped to `@axe-core/playwright` (`~4.14.1`, `MPL-2.0`) and `axe-core` (`~4.14.1`, `MPL-2.0`) with `reviewed-by: "maintainer"`.
   - Both packages are **`devDependencies` only** (`dev: true` in `package-lock.json`), used **unmodified** inside the Playwright test runner, and **never bundled into `dist/`** or shipped to GitHub Pages.
   - Verified via `npm run notices:check`: `THIRD_PARTY_NOTICES.md` and `packages/app/public/THIRD_PARTY_NOTICES.md` continue to list only the 2 bundled runtime packages (`saxes@6.0.0` and `xmlchars@2.2.0`), confirming test dependencies are excluded from runtime third-party notices.

## Decision & Implemented Scope (2026-11-27)

Maintainer granted conditional acceptance of Playwright + axe under the constraints below:

1. Installed `@playwright/test@1.65.1`, `@axe-core/playwright@4.14.1`, and `axe-core@4.14.1` strictly in root `devDependencies` (zero changes to runtime `dependencies` or `packages/*/package.json`).
2. Restricted `scripts/license-exceptions.json` additions solely to `@axe-core/playwright` and `axe-core` (`~4.14.1`, `MPL-2.0`, `reviewed-by: "maintainer"`).
3. Added `playwright-report/`, `test-results/`, and `.spike-dist/` to `.gitignore` (and `eslint.config.mjs` `ignores`). Playwright browser binaries are never committed to git and never copied into `dist/`.
4. Prepared the isolated CodeMirror 6 spike E2E + axe spec (`spikes/codemirror/playwright.config.ts` and `spikes/codemirror/e2e.spec.ts`) targeting the static `vite preview` server (`http://127.0.0.1:3100/`).
5. Kept `.github/workflows/ci.yml` untouched for now; CI `e2e` job design and review notes are recorded below for a future CI PR.

## AI Studio Environment Check (Read-Only Probe)

Probed the current AI Studio Linux container without installing Playwright browser binaries:

- **Kernel / runtime:** `Linux localhost 4.19.0-gvisor #1 SMP x86_64 GNU/Linux` (gVisor sandbox), running as `uid=0(root)` with ~`504 GB` available disk and `apt-get` / `dpkg` available.
- **Pre-installed browsers:** None (`chromium`, `chromium-browser`, `google-chrome`, `firefox`, `webkit`, and system browser executables are absent).
- **System shared libraries:** `libnss3.so`, `libgbm.so.1`, `libasound.so.2`, and `libwayland-server.so.0` are present; GTK3/WebKitGTK/Firefox runtime dependencies are **not** verified present.
- **Feasibility assessment:** Running Playwright browsers (`playwright install`) in this AI Studio environment remains **unverified** (binaries would not persist across workspace resets, must never be committed to git or `dist/`, and gVisor commonly blocks Chromium user namespaces without `--no-sandbox`). Therefore, automated Playwright execution is **unverified** in AI Studio and awaits Windows manual execution or a future GitHub Actions `e2e` job.

## Proposed CI Job Design & Review Notes (Deferred — `.github/workflows/ci.yml` Unchanged)

When adding E2E + accessibility tests as a **separate CI job** in `.github/workflows/ci.yml` (isolated from the fast `check` and `audit` jobs so `npm run check` stays fast and works without browser downloads):

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
    - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci
    - run: npx playwright install --with-deps chromium firefox webkit
    - run: npm run build
    - run: npm run test:e2e
    - if: failure()
      uses: actions/upload-artifact@<pinned-40-char-sha>
      with:
        name: playwright-report
        path: playwright-report/
```

Review checklist before enabling the CI job:

- **Action SHA pinning:** Match `.github/workflows/ci.yml`'s 40-character commit SHA pinning policy (`actions/checkout` and `actions/setup-node` SHAs shown above match current `ci.yml`; look up and pin the exact 40-char SHA for `actions/upload-artifact` before committing).
- **Production static target (`npm run preview`):** Run E2E tests against the built static site (`vite preview` / `npm run preview`) rather than `vite dev`, so the strict `<meta http-equiv="Content-Security-Policy">` (`style-src 'self'`) is exercised under production conditions.
- **Playwright caching & runtime:** `npx playwright install --with-deps chromium firefox webkit` downloads ~500+ MB on `ubuntu-latest`; keep the job separate from `check` and set `retention-days` on failure artifacts if needed.
- **Telemetry / assertions:** Assert **zero** `console.error`, `pageerror`, and `securitypolicyviolation` events in every browser (`chromium`, `firefox`, `webkit`), plus `wcag22aa` axe checks and sub-path hosting parity (`/XMLens/`).

## Fallback: Manual Maintainer Checklist for Windows Browsers

When automated browser execution is unavailable in AI Studio (or before `e2e` CI lands), verify each UI/CSP milestone manually on Windows against `npm run build && npm run preview` (and on the deployed GitHub Pages URL):

1. **Browsers to test on Windows:**
   - **Microsoft Edge / Google Chrome** (Chromium engine)
   - **Mozilla Firefox** (Gecko engine)
   - **WebKit note:** Apple Safari/WebKit is not available natively on Windows; WebKit parity relies on GitHub Actions `ubuntu-latest` Playwright `webkit` (or a macOS device).
2. **CSP & Console Verification (DevTools → Console & Network):**
   - Open `http://127.0.0.1:3000/` (from `npm run preview`, **not** `vite dev`).
   - Confirm zero Content Security Policy violation errors and zero uncaught exceptions in Console.
   - Verify no external network requests occur (`Network` tab shows only `127.0.0.1` / own Pages origin).
3. **Layout, Themes & Interactive Controls:**
   - Confirm title bar, single-row toolbar, split `XML Input` / `Diagnostics` panes, and bottom status bar render with crisp `1px` borders and legible contrast in **Light**, **Dark**, and **High contrast** themes.
   - Test **Load sample**, **Open file...** (with a local `.xml` file, plus a `> 1 MB` file to confirm the size-limit message), and **Check well-formedness** (both valid and malformed XML, verifying diagnostic `<button>` click-to-jump moves caret selection to the reported error).
   - Switch **Language** between English and Japanese and confirm all labels, diagnostics, status bar fields, and `<details>` raw text update cleanly.
4. **Keyboard & Accessibility:**
   - Tab through the skip link, toolbar buttons, selects, editor, diagnostic list buttons, and raw-detail `<details>` disclosures; verify visible focus rings (`2px`) everywhere.
   - Open **About** (`XMLens について`), press `Escape` or **Close**, and confirm focus returns to the **About** toolbar button.
5. **Save & Encoding Manual Verification (M1 Stage 3(b)):**
   - **UTF-8 (with & without BOM):** Save both with and without BOM, reopen the downloaded file in XMLens, and confirm status bar shows `UTF-8` vs `UTF-8 (BOM)` with intact CJK / emoji / `𠮷` characters.
   - **UTF-16LE / UTF-16BE:** Select `UTF-16LE` and `UTF-16BE` in **Save as...**; confirm the BOM checkbox locks checked & disabled, save files with CJK/surrogate-pair content, and verify XMLens reopens them cleanly.
   - **CRLF vs LF:** Open a `CRLF` XML file, open **Save as...**, confirm Line endings defaults to `CRLF`, save, and verify `\r\n` bytes in the output file (e.g., hex viewer or line-ending inspector).
   - **XML declaration rewrite:** Open a `Shift_JIS` (or `UTF-8`) file containing `<?xml version="1.0" encoding="..."?>` plus `<?xml` text inside an element body, switch target encoding, confirm the "Update XML declaration" checkbox appears (checked by default), save, and verify **only** the leading XML declaration changed.
   - **Shift_JIS -> UTF-8 save:** Open a `Shift_JIS` file, click **Save as...**, verify the legacy-encoding UTF-8 recommendation notice is shown, save as `UTF-8`, and reopen cleanly.
   - **ASCII + `encoding="UTF-16"` mismatch:** Open an ASCII/UTF-8 file declaring `encoding="UTF-16"` without BOM; confirm `Auto-detect` fails with the mismatch diagnostic, and switching File encoding to `UTF-8` recovers it.
   - **Blob download & CSP:** Confirm `<a download>` downloads complete in Edge/Chrome and Firefox with **zero** `securitypolicyviolation` or Console CSP errors under `npm run preview`.
   - **Save dialog keyboard flow:** Open **Save as...**, confirm focus lands on the filename input, Tab through all controls, and press `Escape` or **Cancel** to confirm focus returns to the **Save as...** button.
   - **CRLF offset alignment:** Open a `CRLF` XML file containing an error after several lines; click the diagnostic item and confirm the caret jumps accurately to the error location, and clicking **Check well-formedness** yields identical diagnostics.
   - **Format & Indent (`ADR-0012`):** Test **Format** with `2 spaces`, `4 spaces`, and `Tab` on compact XML, verify malformed XML leaves text untouched and displays diagnostics, and observe native `Ctrl+Z` undo behavior after `setRangeText` replacement.
   - **CodeMirror 6 Spike Checklist (`ADR-0005`):** See the dedicated Windows manual verification checklist in `docs/adr/0005-codemirror-and-csp.md` for `spikes/codemirror/`.
