# ADR-0013: Development Changelog Versioning (`DEV-NNNN`) Separated from Product Releases

- **Status:** Accepted (maintainer decision)
- **Date:** 2026-11-26

## Context

XMLens is developed through Google AI Studio with direct synchronization to `main` alongside occasional Pull Requests. Under a standard Keep a Changelog `[Unreleased]` workflow:

- Direct-to-main AI Studio syncs accumulate indefinitely inside `[Unreleased]` because there is no frequent `vX.Y.Z` release cadence to cut and flush `[Unreleased]`.
- Syncs from AI Studio and Pull Requests can overlap or touch related subsystems without a clear, monotonic development checkpoint identifier or per-sync date/provenance metadata (`Sync`, `Refs`).
- Conflating frequent internal sync checkpoints with Semantic Versioning (`vX.Y.Z`) would either inflate product version numbers prematurely or leave `[Unreleased]` monolithic and unsearchable.

## Decision

1. **Separate Product Versions from Development Changelog Versions:**
   - **Product versions (`vX.Y.Z`):** Semantic Versioning (`MAJOR.MINOR.PATCH`), created only on explicit maintainer-directed product releases (accompanied by a git tag).
   - **Development changelog versions (`DEV-NNNN`):** 4-digit zero-padded, monotonically increasing sequence assigned whenever changes land on `main`, independent of whether a product release occurs.
   - **Baseline migration (`DEV-0001`):** All pre-existing entries formerly under `[Unreleased]` are moved verbatim (zero edits or deletions) under `## [DEV-0001] - Baseline` with no guessed individual dates (`Baseline: 運用方式導入前の全変更を遡及的に集約した記録。個別の変更日は未記録のため推測していない。`).

2. **`CHANGELOG.md` Structure (Newest First):**
   - Brief bilingual (`en` / `ja`) introduction explaining `DEV-NNNN` vs. `vX.Y.Z` and linking `AGENTS.md` §12.
   - `## [Pending]` for PR-submitted changes prior to `DEV-NNNN` assignment (`(none)` when empty).
   - `## [DEV-NNNN] - YYYY-MM-DD` entries (with `- **Sync:**` and `- **Refs:**` metadata, and applicable subsections from `Added`, `Changed`, `Fixed`, `Security`, `Removed`, `Deprecated`; empty subsections omitted). Dates use `YYYY-MM-DD` in Asia/Tokyo when known, `YYYY-MM-DD (UTC)` if only UTC is available, or `date-unknown` if unknown (never guessed).
   - Future release headings `## [vX.Y.Z] - YYYY-MM-DD` inserted above the latest included `DEV-NNNN` entry with `Includes: DEV-xxxx … DEV-yyyy` and a user-facing summary, without modifying existing `DEV` entries.

3. **Governance Rules (`AGENTS.md` §12 & `CONTRIBUTING.md`):**
   - Update `CHANGELOG.md` in the same task for every code, documentation, or configuration change, re-reading the latest `CHANGELOG.md` first.
   - Next number = `(highest existing DEV number) + 1`, promoting `[Pending]` items into the new `DEV-NNNN` entry (not duplicating them).
   - Multiple syncs within the same working session append to that session's `DEV-NNNN` entry rather than allocating extra numbers; past `DEV-NNNN` entries are immutable (mistakes are corrected under `Fixed` in a subsequent `DEV-NNNN` entry).
   - PR contributors stage changes under `## [Pending]` without assigning a `DEV` number; `main` integration assigns the number.

## Consequences

- **Positive:** Clear, monotonic audit trail for every `main` sync without polluting `vX.Y.Z` product releases; preserves pre-policy history intact in `DEV-0001`; accommodates both direct AI Studio syncs and PR contributions cleanly.
- **Negative / Maintenance:** Requires contributors and agents to check the latest `CHANGELOG.md` before adding entries to avoid number collisions or duplicate descriptions until automated validation is added.

## Alternatives Considered

- **Date + sequence versioning (`YYYY.MM.DD-NN`, e.g., `2026.11.26-01`):** Rejected because it visually resembles CalVer product releases and introduces ordering ambiguity across contributor timezones.
- **Keep a Changelog standard (`[Unreleased]` only):** Rejected because direct-to-main syncs without frequent releases cause `[Unreleased]` to grow unboundedly without provenance boundaries.

## Follow-up Work (Phase 2 — Implemented in `DEV-0003`)

Implemented in `DEV-0003` via `scripts/check-changelog.mjs` (unit-tested in `scripts/check-changelog.test.mjs`, exposed as `npm run changelog:check`, and integrated into `npm run check`). The cross-platform Node script ignores triple-or-more backtick code fences, normalizes `CRLF` line endings, and validates all six rules:

1. Unique 4-digit zero-padded `## [DEV-NNNN]` identifiers (rejecting malformed forms such as `DEV-12`).
2. Strictly descending `DEV-NNNN` ordering from top to bottom (unaffected by interleaved `## [vX.Y.Z]` release headings).
3. Absence of `## [Unreleased]` and presence of `## [Pending]`.
4. Valid calendar `YYYY-MM-DD`, `YYYY-MM-DD (UTC)`, or `date-unknown` on `DEV-0002+` headings, while permitting `DEV-0001 - Baseline` without a date.
5. Non-empty `- **Sync:** <value>` metadata on every `DEV-0002+` entry.
6. Non-empty, valid `Includes: DEV-xxxx … DEV-yyyy` (accepting `…`, `...`, `-`, or single `DEV-xxxx`, with `start <= end` and existing DEV endpoints) on `## [vX.Y.Z]` release headings.
