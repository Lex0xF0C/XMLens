# ADR-0004: Scoped License Exceptions for BlueOak-1.0.0 Dev Dependencies

- **Status:** Accepted (maintainer decision)
- **Date:** 2026-11-24

## Context

`AGENTS.md` §4.1.3 restricts dependencies to `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Apache-2.0`, `0BSD`, `CC0-1.0`, and `Unlicense` (with `MPL-2.0` requiring explicit maintainer approval). `scripts/check-licenses.mjs` rejects unlisted licenses as `unverified` unless granted a reviewed entry in `scripts/license-exceptions.json`.

Installing `eslint` and `typescript-eslint` pulls in two transitive development dependencies licensed under `BlueOak-1.0.0`:

- `minimatch` (`^11.0.9`)
- `@isaacs/nonrecursive-glob-match` (`^1.1.0`)

## Decision

1. **Do not** add `BlueOak-1.0.0` to `ALLOWED_LICENSES` in `scripts/check-licenses.mjs`.
2. Grant two scoped, version-bounded exceptions in `scripts/license-exceptions.json` for `minimatch` (`^11.0.9`) and `@isaacs/nonrecursive-glob-match` (`^1.1.0`), both marked `reviewed-by: "maintainer"` as dev-only transitive dependencies of `eslint`/`typescript-eslint`.
3. Any new package using `BlueOak-1.0.0` (especially runtime dependencies) continues to fail `npm run license:check` by default unless explicitly reviewed.

## Consequences

- **Positive:** Keeps `ALLOWED_LICENSES` strictly aligned with `AGENTS.md` §4.1.3, ensures `npm run check` passes without weakening policy, and isolates the exception to two known dev-only tooling packages.
- **Consistency with ADR-0003:** Keeping `BlueOak-1.0.0` out of the global allowlist is consistent with rejecting `sax` (`BlueOak-1.0.0`) for **runtime** use in `packages/core` (ADR-0003), so runtime bundles ship exclusively under the standard OSI allowlist.
- **Maintenance:** If `minimatch` or `@isaacs/nonrecursive-glob-match` bumps to a new major version outside the caret range, `npm run license:check` will fail until re-reviewed.

## Alternatives Considered

- **Add `BlueOak-1.0.0` to `ALLOWED_LICENSES`:** Rejected because doing so would silently permit `BlueOak-1.0.0` in runtime bundles without per-package review.
- **Downgrade/replace ESLint:** Rejected as unnecessary churn for a dev-only linter toolchain.
