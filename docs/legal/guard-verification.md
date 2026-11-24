# Repository Guard Manual Verification Procedure

Per `AGENTS.md`, SaxonJS-related files must **never** be created in the Google AI Studio workspace, because AI Studio's automatic GitHub sync may push them directly to the public repository.

Therefore, the Milestone M0 acceptance test ("confirm that the repository guard catches a deliberately added `saxon-test.js` on a throwaway branch") must be executed **manually by a maintainer on GitHub or in an isolated local clone disconnected from AI Studio**, never inside the AI Studio workspace.

## Manual Verification Steps

1. Create a temporary throwaway branch from `main` in a local clone (outside AI Studio):
   ```bash
   git checkout -b test/verify-guard
   ```
2. Add a temporary empty file named `saxon-test.js` and stage it so `git ls-files` tracks it:
   ```bash
   touch saxon-test.js
   git add saxon-test.js
   ```
3. Simulate the CI guard environment:
   ```bash
   GITHUB_ACTIONS=true node scripts/check-no-third-party-binaries.mjs
   ```
4. Confirm the command exits with code `1` and reports:
   `Disallowed Saxon-related file path: saxon-test.js`
5. Also test that pushing the throwaway branch triggers the `ci.yml` workflow failure on GitHub Actions.
6. Clean up immediately and delete the throwaway branch locally and remotely (do not merge):
   ```bash
   git reset HEAD saxon-test.js
   rm saxon-test.js
   git checkout main
   git branch -D test/verify-guard
   # If pushed to remote:
   git push origin --delete test/verify-guard
   ```
