# ADR-0007: Vite Dev Server CSS Injection vs. Strict Meta CSP

- **Status:** Proposed (awaiting maintainer decision; CSP in `packages/app/index.html` unchanged)
- **Date:** 2026-11-24

## Context

`packages/app/index.html` enforces a strict Content Security Policy via a `<meta http-equiv="Content-Security-Policy">` element:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';
```

In Milestone M0 closure, `styles.css` was moved from `packages/app/public/` into `packages/app/src/styles.css` and imported from `packages/app/src/main.ts` so Vite bundles it into `dist/assets/index-*.css` (`<link rel="stylesheet" href="./assets/index-*.css">`).

During Task 8 verification, we inspected what both `npm run dev` (`vite`) and `npm run build && npm run preview` (`vite preview`) actually serve over HTTP, alongside `node_modules/vite/dist/client/client.mjs`.

## Verified Findings

1. **Production build (`npm run build` / `npm run preview`):**
   - `dist/index.html` contains zero `<style>` tags and links `./assets/index-*.css` and `./assets/index-*.js` from the same origin (`'self'`), using zero WebSockets.
   - Live browser rendering in this AI Studio environment is **unverified** (no Chromium/Firefox/WebKit binary or screenshot tool is installed), so visual inspection and browser console CSP checks require the maintainer manual checklist.
2. **Development server (`npm run dev` / `vite`):**
   - `curl http://127.0.0.1:3000/src/styles.css` shows Vite transforms `import './styles.css'` into a JavaScript module calling `__vite__updateStyle(__vite__id, __vite__css)`.
   - Inspecting `node_modules/vite/dist/client/client.mjs` (`updateStyle`) confirms Vite creates `document.createElement("style")` with `style.textContent = content` and appends it to `document.head` without a nonce.
   - Because `packages/app/index.html` serves `style-src 'self'` (without `'unsafe-inline'` or a matching nonce) during `vite dev`, **browsers will block Vite's injected `<style data-vite-dev-id="...">` elements in `npm run dev`**, leaving the dev server unstyled and emitting CSP `style-src` console violations.
   - Vite dev's HMR client (`/@vite/client`) also opens `new WebSocket(..., "vite-hmr")` (`connect-src` falls back to `default-src 'self'`). Whether `ws:` on the same host/port is permitted or blocked by `default-src 'self'` across Chromium/Firefox/WebKit in `vite dev` is **unverified** in a live browser here, though Vite HMR WebSocket errors are non-fatal to initial rendering.

## Options Considered

### Option 1: Inject `<meta http-equiv="Content-Security-Policy">` Only in Production Builds (`transformIndexHtml` with `apply: 'build'`)

Remove the static `<meta http-equiv="Content-Security-Policy">` tag from the source `packages/app/index.html` (or keep a dev-only exclusion) and inject the strict CSP meta tag in `vite.config.ts` via a plugin `{ name: 'xmlens-csp', apply: 'build', transformIndexHtml(...) }`.

- **Pros:** `npm run dev` renders styles and HMR normally without loosening production CSP.
- **Cons / Risk (Dev/Prod Divergence):** Removing CSP during `npm run dev` means developers will **not** catch CSP violations (such as inline `<style>`, inline `<script>`, or external fetches) during day-to-day `vite dev` coding unless they also run `npm run build && npm run preview` (and E2E tests always run against `vite preview`).

### Option 2: Keep Source `packages/app/index.html` CSP Unchanged and Inject a Dev-Only Stylesheet Link / Use `npm run build && npm run preview`

Keep `<meta http-equiv="Content-Security-Policy">` directly in `packages/app/index.html` (always active in `dist/` and visible in source) and serve `styles.css` as a regular static `<link rel="stylesheet" href="./src/styles.css">` in dev (or verify UI exclusively via `npm run build && npm run preview`).

- **Pros:** Zero dev/prod divergence for CSP enforcement (`vite dev` and `vite preview` enforce the exact same policy); a `<link rel="stylesheet" href="./src/styles.css">` is valid under `style-src 'self'` in Vite dev because Vite serves `/src/styles.css` directly when requested via `<link>` (whereas ES `import './styles.css'` triggers JS `__vite__updateStyle`). Note: HMR CSS hot-swapping would fall back to page reload if `<link>` is used instead of module CSS import, or Vite dev's JS CSS import can be avoided for the shell stylesheet.
- **Cons:** If future code (such as CodeMirror CSS or worker/UI helpers) uses JS CSS injection in dev, `vite dev` would still trigger CSP unless Option 1 or Shadow DOM (`adoptedStyleSheets`, `ADR-0005`) is used.

### Option 3: Dev-Only Vite Middleware / HTML Transform Relaxing CSP Only in `serve` Mode (Keeping Strict CSP in `packages/app/index.html` Source)

Keep the strict `<meta http-equiv="Content-Security-Policy">` in `packages/app/index.html` as the canonical source of truth, and only during `apply: 'serve'` allow Vite dev's HMR `<style>` (`'unsafe-inline'` in `style-src` + `ws:` in `connect-src`, **never** applied in `apply: 'build'`).

- **Pros:** `packages/app/index.html` remains the single readable canonical CSP for production, and `npm run dev` stays functional with HMR.
- **Cons:** Same dev/prod divergence risk as Option 1 — a developer running only `npm run dev` would not see `style-src` or `ws:` violations until running `npm run preview` / E2E CI.

## Decision Requested From Maintainer

No change has been made to `packages/app/index.html` or `vite.config.ts`. Maintainer input is requested on whether to:

1. Keep `packages/app/index.html` untouched and document `npm run build && npm run preview` as the CSP-verified local preview (or move shell CSS to `<link>` if desired), **or**
2. Adopt **Option 1** or **Option 3** (`apply: 'build'` / `apply: 'serve'` CSP handling in `vite.config.ts`) paired with running all E2E/CSP checks exclusively against `npm run preview`.
