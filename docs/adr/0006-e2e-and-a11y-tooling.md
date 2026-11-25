# ADR-0006: Cross-Browser E2E & Accessibility Tooling (Playwright + axe)

- **Status:** Proposed (awaiting maintainer approval before installing any packages or adding CI jobs)
- **Date:** 2026-11-24

## Context

`AGENTS.md` §4.4, §6, and `IMPLEMENTATION_PLAN.md` §7 require cross-browser E2E testing (Chromium, Firefox, WebKit) and automated WCAG 2.2 AA accessibility checks (axe). In addition, `ADR-0005` gates the CodeMirror 6 Shadow DOM + `adoptedStyleSheets` spike on live browser verification of `securitypolicyviolation` events, styling, keyboard operability, and CJK IME behavior across Chromium, Firefox, and WebKit.

Before installing any test dependencies, we must verify package licenses (`AGENTS.md` §4.1.3), maintenance status, sizes, AI Studio sandbox feasibility, and CI execution design.

## Package Metadata & License Assessment

All metadata below was queried directly from the npm registry via `npm view` on 2026-11-24 **without installing any packages**. Anything not directly installed/executed is marked **unverified**.

| Package                | Version  | License       | Unpacked Size (npm) | Last npm Publish | Direct Dependencies      |
| ---------------------- | -------- | ------------- | ------------------- | ---------------- | ------------------------ |
| `@playwright/test`     | `1.65.1` | `Apache-2.0`  | `28,542` B          | `2026-11-13`     | `playwright@1.65.1`      |
| `playwright`           | `1.65.1` | `Apache-2.0`  | `5,064,151` B       | `2026-11-13`     | `playwright-core@1.65.1` |
| `playwright-core`      | `1.65.1` | `Apache-2.0`  | `13,971,424` B      | `2026-11-13`     | `{}`                     |
| `@axe-core/playwright` | `4.14.0` | **`MPL-2.0`** | `47,795` B          | `2026-10-15`     | `axe-core@~4.14.0`       |
| `axe-core`             | `4.14.1` | **`MPL-2.0`** | `3,437,349` B       | `2026-11-16`     | `{}`                     |

### License Policy Impact (`AGENTS.md` §4.1.3 & `scripts/check-licenses.mjs`)

1. **`@playwright/test`, `playwright`, `playwright-core`:** `Apache-2.0` — in the repository allowlist (`ALLOWED_LICENSES`), actively maintained (`2026-11-13`), zero transitive dependencies beyond `playwright`/`playwright-core`. Browser binaries themselves (~hundreds of MB) are downloaded separately by `playwright install` outside npm and outside `dist/`.
2. **`@axe-core/playwright` and `axe-core`:** Both are licensed under **`MPL-2.0`**.
   - Per `AGENTS.md` §4.1.3, `MPL-2.0` is **not** automatically allowed and requires explicit maintainer approval.
   - `scripts/check-licenses.mjs` explicitly rejects `MPL-2.0` unless matching entries exist in `scripts/license-exceptions.json`.
   - **Important distinction:** If approved, `@axe-core/playwright` and `axe-core` would be **`devDependencies` only**, used **unmodified** inside the Playwright test runner, and **never bundled into `dist/`** or shipped to GitHub Pages. No file-level MPL-2.0 modifications would occur.
   - **Not yet approved:** `scripts/license-exceptions.json` currently contains no entries for `@axe-core/playwright` or `axe-core`. Maintainer approval is required before adding them.
   - **Alternative if `MPL-2.0` is declined:** Skip `@axe-core/playwright` / `axe-core` in npm, run Chromium/Playwright built-in accessibility tree snapshots + manual keyboard/screen-reader/axe-DevTools verification, or evaluate an `MIT`/`Apache-2.0` accessibility checker (none verified yet — marked **unverified**).

## AI Studio Environment Check (Read-Only Probe)

Probed the current AI Studio Linux container without installing Playwright or browser binaries:

- **Kernel / runtime:** `Linux localhost 4.19.0-gvisor #1 SMP x86_64 GNU/Linux` (gVisor sandbox), running as `uid=0(root)` with ~`504 GB` available disk and `apt-get` / `dpkg` available.
- **Pre-installed browsers:** None (`chromium`, `chromium-browser`, `google-chrome`, `firefox`, `webkit`, and `playwright` are all absent).
- **System shared libraries:** `libnss3.so`, `libgbm.so.1`, `libasound.so.2`, and `libwayland-server.so.0` are present; GTK3/WebKitGTK/Firefox runtime dependencies are **not** verified present.
- **Feasibility assessment:** Installing Playwright browsers (`playwright install`) in this AI Studio environment is **unverified** and carries two practical limits: (1) browser binaries are not persisted across workspace resets and must never be committed to git; (2) gVisor sandboxes commonly block Chromium's user-namespace sandbox unless `--no-sandbox` is passed, and Firefox/WebKit launch behavior under gVisor is **unverified**.

## Proposed CI Job Design (Not Yet Added to `.github/workflows/ci.yml`)

Run E2E + accessibility tests as a **separate CI job** in `.github/workflows/ci.yml` (isolated from the fast `check` and `audit` jobs so `npm run check` stays < 2 seconds and works without browser downloads):

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<pinned-sha> # v7
    - uses: actions/setup-node@<pinned-sha> # v7
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci
    - run: npx playwright install --with-deps chromium firefox webkit
    - run: npm run build
    - run: npm run test:e2e
    - if: failure()
      uses: actions/upload-artifact@<pinned-sha>
      with:
        name: playwright-report
        path: playwright-report/
```

Notes:

- Test against the built static site (`vite preview` / `npm run preview`, e.g., `http://127.0.0.1:3000/`) rather than `vite dev`, so the strict `<meta http-equiv="Content-Security-Policy">` (`style-src 'self'`) is exercised under production conditions.
- Check for **zero** `console.error`, `pageerror`, and `securitypolicyviolation` events in every browser (`chromium`, `firefox`, `webkit`).
- Also test sub-path hosting if needed (matching GitHub Pages `/XMLens/`).

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

## Decision Requested From Maintainer

1. Approve adding `@playwright/test` (`1.65.1`, `Apache-2.0`) as a `devDependency`?
2. Approve `MPL-2.0` dev-only exceptions in `scripts/license-exceptions.json` for `@axe-core/playwright` (`~4.14.0`) and `axe-core` (`4.14.1`), OR prefer Playwright without `axe-core`?
3. Approve adding the separate `e2e` job (`ubuntu-latest`, `npx playwright install --with-deps`) to `.github/workflows/ci.yml` once `ADR-0006` is accepted?
