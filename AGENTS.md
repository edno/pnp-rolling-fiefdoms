# Agent Working Agreement

1) **Test baseline FIRST**: Before making ANY code changes, run `npm test` to establish a baseline. Record the number of passing tests. This is your responsibility, not negotiable.

2) **Test after EVERY significant change**: Run `npm test` after each major change. If tests that were passing now fail, YOUR changes broke them. Fix them immediately.

3) **Read the artifacts first**: Before starting any task, read the rulebook (`rolling-fiefdoms-rulebook.pdf`) and the player sheet (`rolling-fiefdoms-player-sheet.webp`) to establish the rules context. Then read the existing code (notably `app.js`, `rules.js`, and tests) to understand current logic and gaps.

4) **Rule changes require tests**: Any change that affects rules, scoring, or turn flow must include a new test or an update to existing tests. Do not leave rule logic untested.

6) **Handle errors gracefully**: Code should defensively handle undefined/null and unexpected states without crashing.

7) **Keep the log useful**: Maintain a clear, chronological log (newest first) to help users trace actions.

8) **Do not bypass rules**: Do not introduce shortcuts that skip or relax rule requirements without explicit direction; align behavior with the rulebook.

10) **Document clarifications**: Any clarification provided by the user and not documented in the code or in the rulebook should be documented in the Appendix: Current clarifications.

11) **No duplicate entries in CSS**: CSS files should not have duplicates entries that can override each other, ie each selector should have only a unique CSS style entry

12) **Clean up temporary files**: After completing a task remove any temporary file generated, also remove any screenshot shared by the user for debugging or illustrating a request.

## Appendix: Current clarifications

- Windrose faces replace previous paired faces; they are wild for location (1–5), must stay in the location pair, and count as 0 during pestilence.
- Dice locking: after selecting a building or resolving pestilence/forfeit, dice are locked and should remain visible/grey until the next roll; location/build previews must persist during the lock.
- Mid-game scoring: zero-requirement buildings (Cottage, Springhouse) and vagrants can score during play; worker-requiring buildings only score after activation at game end.
- Adjacency is cardinal-only, matching the printed square grid.
- PWA behavior: a cache-first service worker (cache name `rf-cache-v1`) precaches the core shell (HTML, JS, CSS, fonts, images including `assets/img/forfeit.svg`) and serves navigation offline. Bump the cache version when changing core assets. Manifest icon uses `assets/img/forfeit.svg`.
- Influence application: Can be applied to any die with a resolved numeric value (1-5) if: (1) influence points are available, (2) no other die currently has influence applied, (3) not during pestilence. This includes N dice and X dice with resolved values. When influence is applied to adjust an X die's value, that die is included in location pair calculations via `state.influenceTarget` in `game-state.js` to properly enable rescue from forfeit situations.

## Appendix: TODO / Known Gaps

- Cleanup: remove duplicate/conflicting CSS selectors when encountered.
