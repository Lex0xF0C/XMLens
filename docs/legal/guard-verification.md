# Repository Guard Manual Verification Procedure

Per `AGENTS.md`, SaxonJS-related files must **never** be created in the Google AI Studio workspace, because AI Studio's automatic GitHub sync may push them directly to the public repository.

Therefore, the Milestone M0 acceptance test ("confirm that the repository guard catches a deliberately added `saxon-test.js` on a throwaway branch") must be executed **manually by a maintainer on GitHub or in an isolated local clone disconnected from AI Studio**, never inside the AI Studio workspace.

## How the Guard Scans Files

- When `GITHUB_ACTIONS` is **unset** (local runs such as `npm run plugins:guard`), `scripts/check-no-third-party-binaries.mjs` scans local workspace files on disk (excluding `.git/`, `node_modules/`, and `dist/`), root `package.json`, all workspace manifests (`packages/*/package.json`), and `package-lock.json` (package entries and dependency references).
- When `GITHUB_ACTIONS=true` (GitHub Actions CI), the guard runs `git ls-files` so it checks **all tracked files in git**, including catching any accidentally tracked files inside `node_modules/` or `dist/`, in addition to `package.json`, `packages/*/package.json`, and `package-lock.json`.

## Manual Verification Steps

### Bash (Linux / macOS / Git Bash)

1. Create a temporary throwaway branch from `main` in an isolated local clone (outside AI Studio):
   ```bash
   git checkout -b test/verify-guard
   ```
2. Add a temporary empty file named `saxon-test.js` and stage it so `git ls-files` tracks it:
   ```bash
   touch saxon-test.js
   git add saxon-test.js
   ```
3. Run the guard in CI mode (and optionally local mode with `GITHUB_ACTIONS` unset):
   ```bash
   GITHUB_ACTIONS=true node scripts/check-no-third-party-binaries.mjs
   ```
4. Confirm the command exits with code `1` and reports:
   `Disallowed Saxon-related file path: saxon-test.js`
5. Optionally push the throwaway branch to verify `ci.yml` fails on GitHub Actions, then clean up immediately:
   ```bash
   git reset HEAD saxon-test.js
   rm saxon-test.js
   git checkout main
   git branch -D test/verify-guard
   # If pushed to remote:
   git push origin --delete test/verify-guard
   ```

### PowerShell (Windows)

1. Create a temporary throwaway branch from `main` in an isolated local clone (outside AI Studio):
   ```powershell
   git checkout -b test/verify-guard
   ```
2. Add a temporary empty file named `saxon-test.js` and stage it so `git ls-files` tracks it:
   ```powershell
   New-Item -ItemType File -Path saxon-test.js | Out-Null
   git add saxon-test.js
   ```
3. Set `GITHUB_ACTIONS=true` and run the guard:
   ```powershell
   $env:GITHUB_ACTIONS='true'
   node scripts/check-no-third-party-binaries.mjs
   $LASTEXITCODE
   ```
4. Confirm `$LASTEXITCODE` is `1` and output reports `Disallowed Saxon-related file path: saxon-test.js`.
5. Clean up environment variable, file, and branch immediately:
   ```powershell
   Remove-Item Env:GITHUB_ACTIONS
   git reset HEAD saxon-test.js
   Remove-Item saxon-test.js
   git checkout main
   git branch -D test/verify-guard
   # If pushed to remote:
   git push origin --delete test/verify-guard
   ```

## Verification Record / 検証記録

- **Date / 実施日:** 2026-11-28
- **Executor / 実施者:** Maintainer (`メンテナ`)
- **Environment / 実施場所:** Throwaway branch in an isolated local clone disconnected from Google AI Studio (branch deleted by maintainer after verification)
- **CI Run URL:** <https://github.com/Lex0xF0C/XMLens/actions/runs/45975155206>
- **Observed CI Log (`plugins:guard`):**
  ```text
  > xmlens@0.1.0 plugins:guard
  > node scripts/check-no-third-party-binaries.mjs
  Disallowed Saxon-related file path: saxon-test.js
  Error: Process completed with exit code 1.
  ```
- **Result / 結果:** Pass (`合格`) — Repository guard caught `saxon-test.js` and exited with code `1` as designed, completing the Milestone M0 repository guard acceptance test. (On the same run, the `check` job passed all 17 Vitest test files / 135 tests; `e2e-spike` results are tracked separately and remain awaiting verification.)
