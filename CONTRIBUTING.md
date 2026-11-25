# Contributing to XMLens

> **Draft (English only) — `needs-ja-review`:** Japanese translation (`CONTRIBUTING.ja.md` or bilingual section) is pending.

Thank you for contributing to XMLens! Please read [`AGENTS.md`](./AGENTS.md) and [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) before opening an issue or pull request.

## Principles & Scope

1. **Plan before code** for anything beyond a small fix: check `docs/IMPLEMENTATION_PLAN.md`, state your approach briefly, and respect milestone priorities (P0–P3). Do not implement P2/P3 or `OUT` items without an open issue and (for architectural changes) an ADR in `docs/adr/`.
2. **Clean-room & no trademarks:** Never copy code, UI layouts, screenshots, icons, or documentation from proprietary products. Do not reference commercial XML editor names or logos.
3. **Architecture Decision Records (ADRs):** Write or update an ADR in `docs/adr/NNNN-title.md` (context, decision, consequences, alternatives) for significant libraries, CSP changes, data format changes, license-sensitive decisions, or items in `IMPLEMENTATION_PLAN.md` §10.
4. **Keep `packages/core` DOM-free:** All core logic must remain pure TypeScript without DOM or browser globals.
5. **Bilingual parity:** Any user-visible UI text must use semantic keys in `locales/en.json` and `locales/ja.json` (see [`docs/i18n-guide.md`](./docs/i18n-guide.md)). If you cannot provide a polished Japanese translation, add your best attempt and mark the PR `needs-ja-review`.

## Dependencies & Licensing

- Only `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Apache-2.0`, `0BSD`, `CC0-1.0`, or `Unlicense` packages are allowed without prior review. `MPL-2.0` and any unverified license require explicit maintainer approval via `scripts/license-exceptions.json`.
- **Never** add `GPL`, `AGPL`, `LGPL`, `SSPL`, or non-OSI "source-available" dependencies.
- **Never** add `saxon-js` or `xslt3` to `package.json`, `package-lock.json`, or the workspace.
- When changing `package.json`, state each added/updated dependency's name, license, and maintenance status in your PR description.

## Git Workflow, Commits, and DCO Sign-Off

- Keep `main` always deployable; work on `feat/...`, `fix/...`, or `docs/...` branches.
- Use Conventional Commits in English, imperative mood (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **Developer Certificate of Origin (DCO):** Sign off every commit (`git commit -s`) to certify you have the right to submit the contribution under the MIT License.
- Never force-push `main`, rewrite published history, or alter workflow permissions without maintainer approval.

## Verification & Pull Request Checklist

Before opening a PR:

- Run `npm run check` (runs `lint`, `format:check`, `typecheck`, `test`, `i18n:check`, `plugins:guard`, `license:check`, and `notices:check`) and `npm run build`.
- Include in your PR description: summary, linked issue, test evidence, screenshots in both `en` and `ja` for UI changes, and dependency/license notes if `package.json` changed.
- Update `docs/feature-matrix.md` and user docs (`en` + `ja`) when features change.
- Update `CHANGELOG.md` under `[Unreleased]` in the same change for every user-visible, dependency, security, CSP, or license-policy change.
