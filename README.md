# Rolling Fiefdoms — Solo Web Edition

Rolling Fiefdoms is a roll-and-write game where you grow a small fief through clever dice pairing and careful planning. Each turn, the Regent rolls four dice and groups them into two pairs; players then choose where to build cottages, markets, and landmarks on their fief. When all plots are filled, assign labourers to activate buildings, score reputation, and see whose fief prospers most.

Rolling Fiefdoms won the **[BGG 2025 Roll & Write Game Design Contest](https://boardgamegeek.com/thread/3585125/the-2025-roll-and-write-game-design-contest)**.

This repository hosts the solo-friendly browser implementation. It mirrors the printed sheet and provides digital experience while keeping the tactile “split & choose” flow intact.

## What’s inside

- **Authentic sheet & rules**: The in-browser board is the same art you’d print at home; the included PDF rulebook matches the tabletop release.
- **Solo assistant**: Lock dice, track influence, place population, and tally reputation without reaching for an eraser.
- **Offline-ready**: A lightweight service worker caches the core shell so you can play even when the connection drops.

## Learn & play

- **Official rules**: `resources/rolling-fiefdoms-rulebook.pdf`
- **Player sheet**: `resources/rolling-fiefdoms-player-sheet.webp`
- **BoardGameGeek**: [Rolling Fiefdoms @ BGG](https://boardgamegeek.com/boardgame/465867)
- **Download**: [Rolling Fiefdoms @ PnP Stash](https://pnpstash.com/product/rolling-fiefdoms/)

Open `index.html` directly or run the dev server to explore the solo app. Dice rolls, overlays, and the score log all mirror the physical experience.

## For developers

```bash
npm install
npm test      # ESLint + Vitest
npm run serve # http://localhost:4173
npm run build # outputs dist/ for deployment
```

- `npm run serve -- --dist` serves the built bundle instead of source files.
- `npm run clean` removes the `dist/` folder when you need a fresh build.

See `AGENTS.md` for the current implementation notes and design clarifications.

## License

- **Code**: MIT (see `LICENSE`)
- **Rulebook & sheet**: CC BY-NC-SA 4.0 (see `LICENSE-ASSETS`)
