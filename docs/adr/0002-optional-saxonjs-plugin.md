# ADR-0002: Optional SaxonJS Plugin Architecture and Compliance Posture

- **Status:** Accepted (maintainer policy recorded from `docs/IMPLEMENTATION_PLAN.md` §2 & §5.5; execution details pending Spike S1)
- **Date:** 2026-11-24

## Context

XMLens is an MIT-licensed, browser-only XML workbench. While XPath 1.0/3.1, XSD 1.0, Schematron, and XSLT 1.0 are targeted via permissively licensed engines or original TypeScript implementations, XSLT 2.0 and XSLT 3.0 have no mature MIT/BSD/Apache-2.0 browser engine.

Saxonica's SaxonJS is **not open source**. For the target series (2.x), it is governed by the **Saxon-JS Public License v1.0 (June 2020)**. Under the maintainers' reading of that license text:

1. Execution on client computers is permitted.
2. Unmodified redistribution as part of an application is conditioned on:
   - Reproducing the copyright notice and disclaimer in documentation.
   - No reverse engineering, decompilation, or disassembly.
   - Not using the licensor's name to endorse or promote the product.
   - Not copying the software to a site whose **primary purpose** is to make the software available to third parties without written permission (Condition 4).

Because XMLens is developed in Google AI Studio whose automatic GitHub integration pushes workspace files to a public repository (and may not honor `.gitignore`), any plugin binary present in the workspace could unintentionally enter git history.

## Decision

1. **Optional, off-by-default plugin:** SaxonJS is treated as an optional plugin disabled by default in settings. The core application must build, pass all checks, and provide all non-XSLT-2.0/3.0 features (including XPath 3.1 and Schematron) without it.
2. **Proceed without requesting written permission (maintainer decision):** Based on the maintainers' reading that XMLens is an XML editor application rather than a site whose primary purpose is software distribution, the maintainers decided to proceed without requesting written permission from Saxonica.
   - **Disclaimer:** This is the maintainers' own interpretation, **not legal advice**. No claim is made that the project has been "permitted by Saxonica" or "legally cleared". The residual risk is accepted by the maintainers and mitigated by the operational controls below.
3. **Never committed to git or present in AI Studio:**
   - `saxon-js` and `xslt3` must never be listed in `package.json` or `package-lock.json`.
   - No SaxonJS binary files may exist anywhere in the AI Studio workspace or git repository.
   - Only metadata (`plugins/saxonjs/pinned.json` and `plugins/saxonjs/APPROVED_LICENSE.sha256`, plus documentation under `docs/`) may be tracked in git.
   - A repository guard (`scripts/check-no-third-party-binaries.mjs`) runs in CI on `git ls-files` and fails the build on violations.
4. **CI-only acquisition and unmodified placement (M4+):**
   - When implemented in M4, `scripts/fetch-plugins.mjs` will run **only** when `GITHUB_ACTIONS=true`, fetch the pinned tarball via `npm pack`, verify its SHA-512 integrity and license SHA-256 hash against `APPROVED_LICENSE.sha256`, and copy unmodified files into `dist/plugins/saxonjs/` after the Vite build.
   - Any license text change fails the build until a maintainer re-reviews the new text.
5. **Compliance posture:**
   - No page, link, documentation text, release asset, branch, or package may offer the SaxonJS file as a standalone download or mirror.
   - The plugin directory is not advertised or listed in a directory index or sitemap.
   - Loaded only after explicit user opt-in, from the application's own origin (no third-party CDN), and isolated in a sandboxed iframe or dedicated worker (to be decided in Spike S1).
   - A build flag (`XMLENS_BUNDLE_SAXONJS`) allows removing the plugin in a single change if the license changes or the licensor objects.
   - `THIRD_PARTY_NOTICES.md` and the About view reproduce the required copyright notice and disclaimer factually without promotional endorsement.

## Consequences

- **Positive:** Keeps the default MIT codebase clean, prevents non-OSI binaries from entering git via AI Studio sync, and isolates licensing risk behind a single build switch and license hash check.
- **Negative / Risks:** Requires strict discipline from contributors and agents, manual verification of the guard on GitHub, and readiness to disable/remove the plugin promptly if requested by the licensor or if license terms change in future versions.
- **Unverified / Pending (Spike S1):** Whether the browser build of the pinned SaxonJS version supports compiling user-edited XSLT in-browser (Mode A) or requires precompiled `.sef.json` stylesheets via `xslt3` CLI (Mode B). If neither works acceptably, XSLT 2.0/3.0 will be omitted from v1.0.

## Alternatives Considered

- **Bundle SaxonJS via `package.json` / Vite:** Rejected; violates the unmodified-redistribution constraint and would fail OSI-only dependency checks and enter the workspace.
- **Omit XSLT 2.0/3.0 completely:** Remains the fallback (Mode C) if Spike S1 fails or if the plugin must be removed.
- **Request written permission upfront:** Not pursued at this stage per maintainer decision; residual risk is documented and accepted above.
