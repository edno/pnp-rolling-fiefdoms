# Agent Working Agreement

1) **Read the artifacts first**: Before starting any task, read the rulebook (`rolling-fiefdoms-rulebook.pdf`) and the player sheet (`rolling-fiefdoms-player-sheet.png`) to establish the rules context. Then read the existing code (notably `app.js`, `rules.js`, and tests) to understand current logic and gaps.

2) **Rule changes require tests**: Any change that affects rules, scoring, or turn flow must include a new test or an update to existing tests. Do not leave rule logic untested.

3) **All checks must pass**: After changes, ensure `npm test` (lint + vitest) passes. Lint must be clean.

4) **Handle errors gracefully**: Code should defensively handle undefined/null and unexpected states without crashing.

5) **Keep the log useful**: Maintain a clear, chronological log (newest first) to help users trace actions.

6) **Do not bypass rules**: Do not introduce shortcuts that skip or relax rule requirements without explicit direction; align behavior with the rulebook.

7) **Keep TODO / Known Gaps up to date**: Remove implemented tasks, add known gaps and pending tasks in the Appendix: TODO / Known Gaps.

8) **Document clarifications**: Any clarification provided by the user and not documented in the code or in the rulebook should be documented in the Appendix: Current clarifications.

9) **No duplicate entries in CSS**: CSS files should not have duplicates entries that can override each other, ie each selector should have only a unique CSS style entry

10) **Clean up temporary files**: After completing a task remove any temporary file generated, also remove any screenshot shared by the user for debugging or illustrating a request.

## Appendix: Current clarifications

- Paired faces (1/2, 4/5) are already handled without prompts; do not reintroduce prompts unless requirements change.
- Dice locking: after selecting a building or resolving pestilence/forfeit, dice are locked and should remain visible/grey until the next roll; location/build previews must persist during the lock.
- Mid-game scoring: zero-requirement buildings (Cottage, Springhouse) and vagrants can score during play; worker-requiring buildings only score after activation at game end.
- Adjacency is cardinal-only, matching the printed square grid.

## Appendix: TODO / Known Gaps

- Pestilence section assignments are fixed to the default (Forest 2–3, Sea 4–5, Mountain 7–8, Marsh 9–10, Centre 6); no per-game configuration UI.
- Turn flow: handling of no-action/blocked builds and pestilence forfeits should be aligned to the rulebook; auto-advance assumptions may be too loose.
- Worker activation UI/logic needs refinement: worker requirements should be filled one pip at a time, with no double-counting of population across buildings; activation happens only at game end.
- Dice split/lock UI is unstable: location pair and previews can disappear or allow building selection before a valid pair is set; lock state/visibility needs a stable implementation.
- Cleanup: remove duplicate/conflicting CSS selectors when encountered.
