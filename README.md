# HerLedger: trade reconciliation demo

A working demo of a fund accounting reconciliation tool. It takes confirms from four brokers (Citigroup, CGSI-TH, UOB, DBS), each in its own layout, turns them into one standard format, maps the security codes, matches them against a book of record (Bonanza), and manages the differences as exception cases with an audit trail and KPIs.

It is a static web app: no build step, no dependencies, and no data leaves the browser.

## What it does

| Step | What happens |
|---|---|
| 1. Extraction | Renames each broker's columns into 13 standard fields, normalises dates and buy/sell wording, and adds up only the fee columns that broker supplies into one `AdjustedCommission`. Bad rows are rejected with a reason. |
| 2. Security mapping | `AAPL.O`, `AMZN.O`, `TSLA US Equity`, ISINs and so on are mapped to one code through a security master. Unknown codes are never guessed; they become exceptions. |
| 3. Matching | Pairs each broker trade with a Bonanza record on portfolio, trade date, security, buy/sell and currency. Quantity, currency, portfolio and dates must agree exactly; price, commission and net amount use tolerances. |
| 4. Exceptions | One case per difference with type, severity, owner and suggested action. Status can be Open, In Review, Resolved or Waived; resolving or waiving needs a reason. Nothing is deleted. |
| 5. Audit trail | Every trade shows its source file and row, fee lines, mapping, match result and any user action. |
| 6. Dashboard | Match rate, breaks by type and broker, open exceptions by severity, and unreconciled amounts per currency (never added together). |

Plus: recorded runs, analytics, and simulated notifications for High severity cases.

## Sample data (read this)

- The 17 broker trades come from the original HerLedger prototype.
- That prototype only shows fee **totals**, so how each total is split into fee lines (for example Commission 10 + SEC Fee 3 + Other Fee 2 = 15) is illustrative.
- The 15 Bonanza records are **illustrative**. They are built so the demo shows every outcome: 10 matched (one only within tolerance), 4 breaks, 2 missing in Bonanza, 1 missing at the broker and 1 unmapped security.
- Net amount is `gross - adjusted commission` for both buys and sells, as in the prototype data.
- Tolerances (price 0.01, commission 1.00, net 1.00) and severity limits are proposed defaults, not confirmed business rules.

## Run it

Open `index.html` in a browser, or serve the folder:

```
npm start
```

Upload your own CSV or Excel file for any broker (use the "Sample CSV" button to see the expected layout). Excel support loads the SheetJS library from a CDN, so it needs internet; CSV works offline.

## Test it

```
npm test
```

22 tests cover fee consolidation, date and side normalisation, security mapping, matching and tolerances, severity rules, per-currency totals, bad input, text-injection safety and the audit trail. The same command runs on every push through GitHub Actions (`.github/workflows/test.yml`).

## Deploy to GitHub Pages

1. Create a new empty repository on GitHub.
2. From this folder:
   ```
   git init
   git add .
   git commit -m "HerLedger reconciliation demo"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. In the repository go to **Settings > Pages**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## How this relates to the Microsoft Copilot Studio plan

This demo shows the behaviour. The proposed production build keeps the same logic but runs inside Microsoft 365.

| This demo | Microsoft build |
|---|---|
| `engine.js` functions | Power Automate flows used as agent tools |
| Browser storage | Dataverse tables |
| Chat-less pages | Copilot Studio agent in Teams |
| Simulated notifications | Teams or Outlook messages |
| Analytics page | Power BI report |
| Local files | SharePoint library |

The rule that carries over is that the language model never does the calculating. Fixed rules do, so results are repeatable and can be audited.

## Limits

- Demo only: no sign-in, no roles, no server, data kept in the browser.
- Matching is one-to-one on the key above. It does not split or combine trades.
- No currency conversion.
- Broker column layouts are defined in `BROKERS` in `engine.js`; a new broker or layout needs a new entry there.

## Files

```
engine.js   logic (no DOM)        data.js   sample data
app.js      user interface        test.js   tests
index.html  styles.css  AGENTS.md  package.json  .github/workflows/test.yml
```
