# Rolling Fiefdoms (web helper)

This is a lightweight helper for the Rolling Fiefdoms roll-and-write game. It tracks the board, population nodes, dice splits, and scoring so you can focus on playing.

## Quick start

```
npm install
npm test     # eslint + vitest
npm run serve # start a static server at http://localhost:4173
```

Open `index.html` directly or serve the folder with your preferred static server. The app is plain JS/DOM; no bundler required for basic usage.

## How to play in the helper

- Roll phase: four dice (two numbered, two X) appear in the Turn panel. Click two non-X dice to set the Location pair; X dice are auto-assigned to Build. Building/Guild overlays stay disabled until two location dice are selected.
- Build phase: pick a building from the overlay, then click a highlighted plot. Dice lock (grey) after a build/forfeit/pestilence and stay visible until the next roll; location/build previews should persist while locked.
- Pestilence: if both Xs show, forfeit a plot in the indicated section (or any if full); dice lock during this step.
- The log shows the actions (newest first) and includes Pestilence details.

## Tests and lint

- `npm test` runs ESLint and Vitest. Add or update tests alongside any rule changes.

## Known gaps

See `AGENTS.md` Appendix for the current TODO/Known Gaps (pip fidelity, pestilence section config, turn flow alignment, etc.). Keep this list updated as you address issues.

## License

- Code: MIT (see `LICENSE`)
- Rulebook & player sheet: CC BY-NC-SA 4.0 (see `LICENSE-ASSETS`)
