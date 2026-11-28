# ADR-0015 isolated bundle and compatibility spike

This spike is deliberately outside `packages/app`. It compares equivalent, minimal XML-outline interaction harnesses:

- Plain TypeScript DOM baseline
- Preact 11 + Signals 2

Both render the same three-item ARIA tree inside a `ShadowRoot`, support ArrowUp/ArrowDown selection, and expose a state-change button. It does not migrate or modify the application.

## Run locally

From this directory:

```sh
npm install
npm run build:plain
npm run build:preact
npm run measure
```

Open `dist/plain/index.plain.html` and `dist/preact/index.preact.html` through a static server (not `file://`) and manually verify:

1. The outline is rendered inside the host's ShadowRoot.
2. ArrowUp / ArrowDown moves focus and updates `aria-selected`.
3. The button updates the selected item and live status.
4. Browser console has no runtime errors.

The measurement script reports minified production JS and CSS raw/gzip byte counts, using Node gzip level 9. The plain-vs-Preact harness delta is the comparable framework-overhead signal. The ADR's existing 40,492-byte app baseline is contextual only; this isolated harness is not a full application migration build.

The GitHub Actions workflow installs only the pinned spike dependencies in this directory. It does not modify root dependencies or the root lockfile.
