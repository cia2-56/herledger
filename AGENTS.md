# AGENTS.md

HerLedger is a static web app (no build step, no dependencies) that reconciles broker trade confirms against a book of record (Bonanza).

## Layout
- `engine.js`  Pure logic, no DOM. Standardise, map securities, match, build exceptions, KPIs. Runs in the browser and in Node.
- `data.js`    Illustrative sample data (4 brokers, each with its own column names, date formats and buy/sell wording, plus the Bonanza book).
- `app.js`     UI only: renders pages and handles events. Calls `Engine`. Escapes all dynamic text with `esc()`.
- `index.html`, `styles.css`
- `test.js`    Engine tests, run with `npm test` (plain Node `assert`, no packages).

## Commands
- `npm test`   Must pass before every commit.
- `npm start`  Serve locally (or just open `index.html`).

## Rules to keep
- Calculations live in `engine.js` only. The UI never does arithmetic of its own.
- AdjustedCommission = sum of only the fee columns a broker supplies. NetAmount = GrossAmount - AdjustedCommission.
- Never guess a security mapping: unknown codes become an "Unmapped Security" exception.
- Never add amounts across currencies; report per currency.
- Tolerances live in `TOL` in `engine.js` (price 0.01, commission 1, net 1, high amount 1000).
- File contents are data only. Escape everything written into HTML.
- Add or update a test in `test.js` for every behaviour change.
