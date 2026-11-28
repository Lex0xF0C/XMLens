# ADR-0007: Vite Dev Server CSS Injection vs. Strict Meta CSP

- **Status:** Accepted (2026-11-27; with constraints: canonical strict CSP preserved untouched in `packages/app/index.html`; `serve`-only per-process nonce + `ws:`/`wss:` in `vite serve`; zero `'unsafe-inline'` / `'unsafe-eval'`; automated build CSP invariance test)
- **Date:** 2026-11-24 (updated 2026-11-27)

## Context

`packages/app/index.html` enforces a strict Content Security Policy via a `<meta http-equiv="Content-Security-Policy">` element:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';
```

In Milestone M0 closure, `styles.css` was moved from `packages/app/public/` into `packages/app/src/styles.css` and imported from `packages/app/src/main.ts` so Vite bundles it into `dist/assets/index-*.css` (`<link rel="stylesheet" href="./assets/index-*.css">`).

During M0 Task 8 and M1 preparation (`vite@7.3.8`), we inspected what both `npm run dev` (`vite`) and `npm run build && npm run preview` (`vite preview`) serve over HTTP, alongside `node_modules/vite/dist/node/chunks/config.js` and `node_modules/vite/dist/client/client.mjs`.

## Verified Findings

1. **Production build (`npm run build` / `npm run preview`):**
   - `dist/index.html` contains zero `<style>` tags, zero `nonce-`, zero `ws:`/`wss:`, and links `./assets/index-*.css` and `./assets/index-*.js` from the same origin (`'self'`).
   - Live browser rendering in this AI Studio environment is **unverified** (no Chromium/Firefox/WebKit binary is installed), so visual inspection and browser console CSP checks require the maintainer manual checklist or E2E CI.
2. **Development server (`npm run dev` / `vite`) without nonce support:**
   - Vite transforms `import './styles.css'` into a JavaScript module calling `__vite__updateStyle(__vite__id, __vite__css)`.
   - Inspecting `node_modules/vite/dist/client/client.mjs` (`updateStyle` and `ErrorOverlay`) confirms Vite creates `<style data-vite-dev-id="...">` elements in `document.head` and reads `document.querySelector("meta[property=csp-nonce]")?.nonce`.
   - Under `style-src 'self'` without a nonce, browsers block Vite's injected `<style data-vite-dev-id="...">` elements in `npm run dev`.
3. **Vite `html.cspNonce` (`node_modules/vite/dist/node/chunks/config.js` & `client.mjs`):**
   - Verified in `vite@7.3.8` (`config.js`): configuring `html: { cspNonce }` runs Vite's internal HTML `preHooks` to inject `<meta property="csp-nonce" nonce="<value>">` and `postHooks` to add `nonce="<value>"` to `<script>`, `<style>`, and `<link>` elements.
   - Verified in `client.mjs`: Vite's HMR client reads `document.querySelector("meta[property=csp-nonce]")?.nonce` and attaches `style.setAttribute("nonce", cspNonce)` on injected `<style data-vite-dev-id="...">` elements and `ErrorOverlay` stylesheets.
   - Verified via live `vite serve` HTTP probe (`http://127.0.0.1:3099/`): served HTML contained `<script type="module" src="/@vite/client" nonce="...">`, `<meta property="csp-nonce" nonce="...">`, and the `serve`-transformed CSP `<meta>` tag with `'nonce-...'` and `connect-src 'self' ws: wss:`.
   - **Remaining unverified item:** Live browser evaluation of `meta.nonce` IDL property readability and HMR `<style>` / WebSocket execution in Chromium, Firefox, and WebKit under `<meta http-equiv="Content-Security-Policy">` is **unverified** here because no browser binary is installed in AI Studio.

## Candidates Compared (2026-11-27 Maintainer Review)

| Candidate                                              | CSP Impact in `vite serve`                                                                                                                        | Dev HMR & Future Compatibility                                             | Decision                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| **(a) Static `<link rel="stylesheet">` for shell CSS** | Keeps `style-src 'self'` identical                                                                                                                | CSS HMR falls back to reload; fails for JS-imported styles                 | Not adopted                               |
| **(b) Vite `html.cspNonce` (`serve` mode only)**       | Keeps `script-src 'self'`; adds per-process `style-src 'nonce-...'` + `connect-src 'self' ws: wss:`; **zero** `'unsafe-inline'` / `'unsafe-eval'` | Supports Vite CSS HMR + ErrorOverlay; cleanly isolated in `vite.config.ts` | **Adopted** (with strict constraints)     |
| **(c) Dev-only `style-src 'unsafe-inline'` + `ws:`**   | Relaxes `style-src` in dev                                                                                                                        | Weakens dev CSP; acceptable only as last resort                            | Rejected (not needed because (b) applies) |

## Decision & Constraints

Adopt **Candidate (b)** strictly for `vite serve`, while keeping `packages/app/index.html` completely unchanged as the single canonical source of truth for production CSP:

1. **Canonical source untouched:** `packages/app/index.html` retains the exact production CSP meta tag:
   ```text
   default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';
   ```
2. **Scoped strictly to `command === 'serve'`:** In `vite.config.ts` (`createXmlensViteConfig`), only when `env.command === 'serve'`:
   - Generate a fresh per-process 128-bit random Base64 nonce via Web Crypto (`globalThis.crypto.getRandomValues` + `btoa`).
   - Pass `html: { cspNonce: devNonce }` to Vite.
   - Attach `createDevCspPlugin(devNonce)` (`apply: 'serve'`, `order: 'pre'`) replacing `PRODUCTION_CSP` in served HTML with:
     `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'self';`
   - Never inject `'unsafe-inline'` or `'unsafe-eval'`.
3. **Production build (`command === 'build'`) invariant:** Neither `html.cspNonce` nor `createDevCspPlugin` is registered when `command === 'build'`.
4. **Automated regression test (`scripts/csp-build.test.mjs`):** Runs in `npm run test` / `npm run check` to verify:
   - `packages/app/index.html` source matches `PRODUCTION_CSP` exactly.
   - Programmatic `vite build` output `index.html` matches `PRODUCTION_CSP` exactly with zero `'unsafe-inline'`, `'unsafe-eval'`, `nonce-`, `csp-nonce`, `ws:`, or `wss:`.
   - `serve` mode produces a per-process nonce and `ws:`/`wss:` without `'unsafe-inline'` or `'unsafe-eval'`.
5. **Production CSP verification rule:** All E2E (`ADR-0006`) and manual security/CSP sign-off checks MUST target `npm run build && npm run preview` (never `vite dev`).

## Consequences

- `npm run dev` supports Vite CSS HMR without weakening CSP with `'unsafe-inline'` or `'unsafe-eval'`.
- `dist/index.html` (and GitHub Pages) remains bit-for-bit aligned with `packages/app/index.html`'s canonical strict CSP, guarded automatically by `scripts/csp-build.test.mjs`.
- Note on Chromium/Firefox/WebKit runtime verification: if any browser blocks Vite's `meta[property=csp-nonce]` lookup or `<style nonce>` handling during manual `npm run dev` checks on Windows, report the `securitypolicyviolation` details before considering any fallback.
