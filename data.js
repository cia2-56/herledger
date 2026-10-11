/* Sample data. Broker rows mirror the trades shown in the original HerLedger prototype.
   Each broker uses its own column names, date format and buy/sell wording.
   NOTE: the prototype only shows fee TOTALS, so the split of each total into fee lines is illustrative.
   The Bonanza book is illustrative too: it is built so the demo shows matches, breaks and missing trades. */
(function (root) {
  'use strict';

  const citigroup = [
    // Trade Ref, Account, Trade Date, Settle Date, Ticker, Side, Qty, Price, Gross, Commission, SEC Fee, Other Fee, Currency
    ['CI001', 'ACC001', '2023-10-26', '2023-10-28', 'AAPL.US', 'Buy', 100, 100, 10000, 10, 3, 2],
    ['CI002', 'ACC002', '2023-10-26', '2023-10-28', 'MSFT.US', 'Sell', 50, 300, 15000, 14, 4, 2],
    ['CI003', 'ACC001', '2023-10-27', '2023-10-29', 'GOOGL.US', 'Buy', 75, 266.66, 20000, 17, 5, 3],
    ['CI004', 'ACC003', '2023-10-27', '2023-10-29', 'AMZN.O', 'Buy', 60, 200, 12000, 10, 3, 2],
    ['CI005', 'ACC002', '2023-10-28', '2023-10-30', 'TSLA.O', 'Sell', 40, 450, 18000, 16, 4, 3],
  ].map((r) => ({ 'Trade Ref': r[0], Account: r[1], 'Trade Date': r[2], 'Settle Date': r[3], Ticker: r[4], 'Buy/Sell': r[5], Quantity: r[6], Price: r[7], 'Gross Amount': r[8], Commission: r[9], 'SEC Fee': r[10], 'Other Fee': r[11], Currency: 'USD' }));

  const cgsi = [
    // Confirm ID, Client Acct, TD, SD (DD/MM/YYYY), Instrument, Direction, Units, Exec Price, Principal, Broker Fees
    ['CG001', 'CLT001', '26/10/2023', '28/10/2023', 'TSLA.US', 'S', 20, 250, 5000, 5],
    ['CG002', 'CLT002', '27/10/2023', '29/10/2023', 'AMZN.US', 'B', 25, 300, 7500, 7.5],
    ['CG003', 'CLT001', '27/10/2023', '29/10/2023', 'NVDA.US', 'S', 30, 400, 12000, 12],
    ['CG004', 'CLT003', '28/10/2023', '30/10/2023', 'GOOGL.US', 'B', 15, 600, 9000, 9],
  ].map((r) => ({ 'Confirm ID': r[0], 'Client Acct': r[1], TD: r[2], SD: r[3], Instrument: r[4], Direction: r[5], Units: r[6], 'Exec Price': r[7], Principal: r[8], 'Broker Fees': r[9], Ccy: 'USD' }));

  const uob = [
    // Deal No, Portfolio Code, Trade Date (DD-Mon-YYYY), Value Date, Security, B/S, Qty, Price, Consideration, Brokerage, Clearing Fee, Tax
    ['UO001', 'UOBACC01', '26-Oct-2023', '28-Oct-2023', 'AAPL.US', 'BUY', 40, 200, 8000, 6, 3, 1],
    ['UO002', 'UOBACC02', '26-Oct-2023', '28-Oct-2023', 'MSFT.US', 'SELL', 20, 500, 10000, 7, 4, 1],
    ['UO003', 'UOBACC01', '27-Oct-2023', '29-Oct-2023', 'GOOGL.US', 'BUY', 50, 260, 13000, 9, 5, 1],
    ['UO004', 'UOBACC03', '28-Oct-2023', '30-Oct-2023', 'SG1L00001016', 'SELL', 35, 200, 7000, 5, 3, 1],
  ].map((r) => ({ 'Deal No': r[0], 'Portfolio Code': r[1], 'Trade Date': r[2], 'Value Date': r[3], Security: r[4], 'B/S': r[5], Qty: r[6], Price: r[7], Consideration: r[8], Brokerage: r[9], 'Clearing Fee': r[10], Tax: r[11], Curr: 'SGD' }));

  const dbs = [
    // Reference, Account, Trade Dt (YYYYMMDD), Settlement Dt, Stock Code, Action, Volume, Avg Price, Gross Value, Commission, Additional Charges
    ['DB001', 'DBSACC01', '20231026', '20231028', 'AAPL.US', 'Purchase', 60, 200, 12000, 10, 2],
    ['DB002', 'DBSACC02', '20231027', '20231029', 'MSFT.US', 'Purchase', 45, 400, 18000, 15, 3],
    ['DB003', 'DBSACC01', '20231027', '20231029', 'AMZN.US', 'Sale', 70, 314.28, 22000, 18.5, 4],
    ['DB004', 'DBSACC03', '20231028', '20231030', 'TSLA US Equity', 'Purchase', 30, 500, 15000, 12, 3],
  ].map((r) => ({ Reference: r[0], Account: r[1], 'Trade Dt': r[2], 'Settlement Dt': r[3], 'Stock Code': r[4], Action: r[5], Volume: r[6], 'Avg Price': r[7], 'Gross Value': r[8], Commission: r[9], 'Additional Charges': r[10], CCY: 'HKD' }));

  // Bonanza book of record, standard schema. Net = gross - adjusted commission.
  const bz = (id, pf, td, sd, sec, type, qty, price, gross, comm, ccy, broker) => ({
    TradeID: id, Portfolio: pf, TradeDate: td, SettlementDate: sd, SecurityCode: sec, TransactionType: type,
    Quantity: qty, Price: price, GrossAmount: gross, AdjustedCommission: comm, NetAmount: Math.round((gross - comm) * 1e4) / 1e4, Currency: ccy, Broker: broker,
  });
  const bonanza = [
    bz('BZ001', 'ACC001', '2023-10-26', '2023-10-28', 'AAPL.US', 'BUY', 100, 100, 10000, 15, 'USD', 'Citigroup'),
    bz('BZ002', 'ACC002', '2023-10-26', '2023-10-28', 'MSFT.US', 'SELL', 50, 300, 15000, 20, 'USD', 'Citigroup'),
    bz('BZ003', 'ACC001', '2023-10-27', '2023-10-29', 'GOOGL.US', 'BUY', 70, 266.66, 18666.2, 25, 'USD', 'Citigroup'), // quantity break
    bz('BZ004', 'ACC003', '2023-10-27', '2023-10-29', 'AMZN.US', 'BUY', 60, 200, 12000, 15, 'USD', 'Citigroup'),
    bz('BZ005', 'CLT001', '2023-10-26', '2023-10-28', 'TSLA.US', 'SELL', 20, 250, 5000, 5, 'USD', 'CGSI-TH'),
    bz('BZ006', 'CLT002', '2023-10-27', '2023-10-29', 'AMZN.US', 'BUY', 25, 300.01, 7500.25, 7.5, 'USD', 'CGSI-TH'), // within tolerance
    bz('BZ007', 'CLT003', '2023-10-28', '2023-10-31', 'GOOGL.US', 'BUY', 15, 600, 9000, 9, 'USD', 'CGSI-TH'), // date break
    bz('BZ008', 'UOBACC01', '2023-10-26', '2023-10-28', 'AAPL.US', 'BUY', 40, 200, 8000, 10, 'SGD', 'UOB'),
    bz('BZ009', 'UOBACC02', '2023-10-26', '2023-10-28', 'MSFT.US', 'SELL', 20, 505, 10100, 12, 'SGD', 'UOB'), // price break
    bz('BZ010', 'UOBACC01', '2023-10-27', '2023-10-29', 'GOOGL.US', 'BUY', 50, 260, 13000, 15, 'SGD', 'UOB'),
    bz('BZ011', 'DBSACC01', '2023-10-26', '2023-10-28', 'AAPL.US', 'BUY', 60, 200, 12000, 12, 'HKD', 'DBS'),
    bz('BZ012', 'DBSACC02', '2023-10-27', '2023-10-29', 'MSFT.US', 'BUY', 45, 400, 18000, 20, 'HKD', 'DBS'), // commission break
    bz('BZ013', 'DBSACC01', '2023-10-27', '2023-10-29', 'AMZN.US', 'SELL', 70, 314.28, 22000, 22.5, 'HKD', 'DBS'),
    bz('BZ014', 'DBSACC03', '2023-10-28', '2023-10-30', 'TSLA.US', 'BUY', 30, 500, 15000, 15, 'HKD', 'DBS'),
    bz('BZ015', 'ACC004', '2023-10-28', '2023-10-30', 'NVDA.US', 'BUY', 10, 410, 4100, 4, 'USD', 'CGSI-TH'), // missing at broker
  ];

  const SAMPLE = { Citigroup: citigroup, 'CGSI-TH': cgsi, UOB: uob, DBS: dbs, Bonanza: bonanza };
  if (typeof module === 'object' && module.exports) module.exports = SAMPLE; else root.SAMPLE = SAMPLE;
})(typeof window !== 'undefined' ? window : globalThis);
