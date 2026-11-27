# ADR-0015: UI Framework for Milestone M2+ (Preact + Signals vs. Svelte vs. Plain TypeScript DOM)

- **Status:** Proposed (drafted 2026-11-27 ahead of M2; no packages installed)
- **Date:** 2026-11-27

## Context

`docs/IMPLEMENTATION_PLAN.md` §10 #2 and `ADR-0001` deferred choosing a UI framework beyond Milestone M0/M1's plain strict TypeScript DOM (`packages/app/src/main.ts`). Ahead of Milestone M2 (synchronized XML tree view, outline, statistics, treemap/sunburst, and large-file tiers), the maintainer recorded a provisional leaning toward **Preact + signals** while requesting a formal comparison ADR against **Svelte** and **continuing with plain strict TypeScript DOM**.

Per `AGENTS.md` §4.1.6–7 and §11, no npm packages are installed in this ADR; registry metadata below comes solely from `npm view` on 2026-11-27, and metrics that require installation/bundling are explicitly marked **`unverified`**.

## Candidate Metadata (`npm view`, 2026-11-27; No Packages Installed)

| Candidate / Package      | Latest Version | License | Unpacked Size (npm) | Last npm Publish | Direct Dependencies           | Tree-Shaken Gzipped Runtime Size                                |
| ------------------------ | -------------- | ------- | ------------------- | ---------------- | ----------------------------- | --------------------------------------------------------------- |
| **Plain TypeScript DOM** | Built-in       | `MIT`   | `0` B               | —                | `0`                           | `0` B framework overhead (`dist/` total JS+CSS `40,492` B gzip) |
| `preact`                 | `11.2.0`       | `MIT`   | `623,595` B         | `2026-11-06`     | `0`                           | **`unverified`**                                                |
| `@preact/signals`        | `2.11.4`       | `MIT`   | `226,477` B         | `2026-10-27`     | `@preact/signals-core@1.14.5` | **`unverified`**                                                |
| `@preact/signals-core`   | `1.14.5`       | `MIT`   | `269,115` B         | `2026-10-27`     | `0`                           | **`unverified`**                                                |
| `svelte`                 | `5.59.2`       | `MIT`   | `3,116,202` B       | `2026-11-25`     | `15` (compiler/tooling deps)  | **`unverified`**                                                |

## Options Compared

### Option 1: Preact + `@preact/signals` (Maintainer Provisional Leaning)

- **Licensing & maintenance:** `preact`, `@preact/signals`, and `@preact/signals-core` are all **`MIT`**-licensed, actively maintained (late-2026 releases), with minimal dependency surface (`@preact/signals` depends only on `@preact/signals-core`).
- **Fit for XMLens:** Preserves pure TypeScript + TSX views inside `packages/app` without adding a bespoke component compiler (`vite` already handles JSX/TSX natively), and fine-grained signals pair naturally with incremental tree/diagnostic/XPath updates and CodeMirror 6 `EditorView` integration (`ADR-0005`).
- **Unverified items:** Exact Vite minified + gzipped delta for `preact` + `@preact/signals` (`unverified`), and TSX + `ShadowRoot` / ARIA tree keyboard interaction ergonomics in `packages/app` (`unverified`).

### Option 2: Svelte (`svelte@5.59.2`)

- **Licensing & maintenance:** `MIT`-licensed, actively maintained (`2026-11-25`), though the compiler package brings 15 npm dependencies (`acorn`, `esrap`, `magic-string`, `aria-query`, `@sveltejs/acorn-typescript`, etc. — dev/build-time vs runtime impact unverified without installation).
- **Fit for XMLens:** Compiles `.svelte` templates cleanly, but requires adding `@sveltejs/vite-plugin-svelte` (not yet evaluated for version/license/maintenance), switching files from `.ts` to `.svelte` SFCs, and configuring Svelte-specific ESLint/TypeScript tooling (`svelte-check`).
- **Unverified items:** Exact compiled runtime gzipped delta (`unverified`), plugin dependency license/maintenance chain (`unverified`), and strict CSP (`style-src 'self'`) handling for Svelte component `<style>` blocks (`unverified`).

### Option 3: Continue Plain Strict TypeScript DOM

- **Licensing & maintenance:** Zero additional dependencies and zero framework bundle overhead.
- **Fit for XMLens:** Worked well for M0/M1's shell, dialogs, and toolbar, and keeps `dist/` small. However, building synchronized virtualized XML tree views (ARIA tree keyboard model, expand/collapse state), outline panels, multi-tab state (M1/M3), and Project Explorer (M3) solely with imperative `document.createElement` / `replaceChildren` increases DOM reconciliation boilerplate and bug risk.

## Proposed Next Steps (Before M2 Implementation)

1. Keep `packages/app` on plain TypeScript DOM through M1b (CodeMirror 6 integration).
2. Prior to M2, if maintainer confirms Option 1 (`Preact + signals`), verify exact Vite production gzipped bundle size against the `1.5 MiB` budget (`IMPLEMENTATION_PLAN.md` §7) and `ShadowRoot` + ARIA tree compatibility, then update this ADR to `Accepted`.
