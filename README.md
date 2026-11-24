# XMLens

> **Status:** Milestone M0 (Foundation Shell) — MIT-licensed, browser-only XML development and visualization workbench.

[日本語版 README (README.ja.md)](./README.ja.md)

## Overview

XMLens is a static, zero-install web application for editing, validating, querying, transforming, comparing, and visualizing XML documents. It is designed for open-source communities and individuals working with standards such as LegalDocML (Akoma Ntoso), LegalRuleML, CVRF, and XLIFF.

See [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) and [`docs/feature-matrix.md`](./docs/feature-matrix.md) for the roadmap and current implementation status.

## Privacy Policy

- **100% client-side processing:** All XML parsing and analysis runs locally in your browser.
- **No uploads or telemetry:** Documents never leave your device, and no analytics or third-party CDN/font requests are made at runtime.

## Development

Requirements: Node.js LTS (`>= 22.0.0`) and `npm`.

```bash
npm ci             # Install dependencies from package-lock.json
npm run dev        # Start the Vite dev server (http://localhost:3000)
npm run check      # Run lint, typecheck, unit tests, i18n check, binary guard, and license check
npm run build      # Build the static production bundle into dist/
npm run preview    # Preview the production build locally
```

## Sub-Path Deployment (GitHub Pages)

The Vite build is configured with `base: './'` so static assets resolve via relative paths. This allows deployment both at the domain root (`/`) and under a repository sub-path (such as `/xmlens/` on GitHub Pages).

## License

All original source code and documentation in this repository are licensed under the [MIT License](./LICENSE).
