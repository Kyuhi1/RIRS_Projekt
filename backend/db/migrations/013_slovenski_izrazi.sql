-- Enoten jezik izrazov (slovenščina): imena in opisi referenčnih podatkov ter sistemskih strategij.
-- Imena parametrov sistemskih strategij so prav tako slovenska; vrednosti obstoječih testov se preimenujejo skupaj z njimi.

UPDATE venues SET name = 'Brez stroškov (bruto)' WHERE id = 'gross';
UPDATE venues SET name = 'WEEX terminske pogodbe (USDT-M)' WHERE id = 'weex-futures';
UPDATE venues SET name = 'WEEX promptni trg' WHERE id = 'weex-spot';
UPDATE venues SET name = 'MetaTrader posrednik z neposrednim razponom (ECN)' WHERE id = 'mt5-raw';
UPDATE venues SET name = 'CFD financiranega računa (FTMO / Alpha Capital, MT5)' WHERE id = 'prop-cfd';

UPDATE prop_plans SET plan_name = '2 stopnji, 100k' WHERE id = 'ftmo-2step-100k';
UPDATE prop_plans SET plan_name = '1 stopnja, 100k' WHERE id = 'ftmo-1step-100k';

UPDATE instruments SET description = regexp_replace(description, ' Perpetual \(', ', trajna pogodba (') WHERE description LIKE '% Perpetual (%';
UPDATE instruments SET description = 'Avstralski dolar / ameriški dolar (Dukascopy)' WHERE ticker = 'AUDUSD';
UPDATE instruments SET description = 'Evro / ameriški dolar (Dukascopy)' WHERE ticker = 'EURUSD';
UPDATE instruments SET description = 'Britanski funt / ameriški dolar (Dukascopy)' WHERE ticker = 'GBPUSD';
UPDATE instruments SET description = 'Zlato / ameriški dolar (Dukascopy)' WHERE ticker = 'XAUUSD';
UPDATE instruments SET description = 'Nasdaq 100, CFD (Dukascopy)' WHERE ticker = 'NAS100';

-- Parametri obstoječih testov dobijo nova imena, preden se preimenujejo strategije.
UPDATE backtests SET params = (params - 'fast' - 'slow') || jsonb_build_object('hitro_povprecje', params -> 'fast', 'pocasno_povprecje', params -> 'slow')
WHERE params ?& ARRAY['fast', 'slow'] AND strategy_id = (SELECT id FROM strategies WHERE owner_id IS NULL AND name = 'SMA Crossover');
UPDATE backtests SET params = (params - 'period' - 'exitPeriod') || jsonb_build_object('obdobje', params -> 'period', 'izstopno_obdobje', params -> 'exitPeriod')
WHERE params ?& ARRAY['period', 'exitPeriod'] AND strategy_id = (SELECT id FROM strategies WHERE owner_id IS NULL AND name = 'Breakout (Donchian)');

UPDATE strategies SET name = 'Nakup in zadrži',
  description = 'Kupi ob prvi svečki in drži do konca obdobja. Primerjalna osnova za druge strategije.'
WHERE owner_id IS NULL AND name = 'Buy & Hold';

UPDATE strategies SET name = 'Presek drsečih povprečij (SMA)',
  description = 'Nakup, ko hitro drseče povprečje preseže počasnega; izstop, ko pade pod njega.',
  default_params = '{"hitro_povprecje": 10, "pocasno_povprecje": 30}',
  source = $src$export default (bars, params) => {
  const { hitro_povprecje, pocasno_povprecje } = params;
  if (!(hitro_povprecje > 0 && pocasno_povprecje > hitro_povprecje)) throw new Error('Parameter pocasno_povprecje mora biti večji od hitro_povprecje, oba večja od 0');
  const sma = (i, n) => {
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += bars[k].close;
    return sum / n;
  };
  const trades = [];
  let entry = null;
  for (let i = pocasno_povprecje; i < bars.length - 1; i++) {
    const up = sma(i, hitro_povprecje) > sma(i, pocasno_povprecje);
    if (!entry && up) {
      entry = bars[i + 1];
    } else if (entry && !up) {
      trades.push({ side: 'long', entryTime: entry.time, exitTime: bars[i + 1].time, entryPrice: entry.open, exitPrice: bars[i + 1].open, orderType: 'taker' });
      entry = null;
    }
  }
  if (entry) {
    const last = bars[bars.length - 1];
    trades.push({ side: 'long', entryTime: entry.time, exitTime: last.time, entryPrice: entry.open, exitPrice: last.close, orderType: 'taker' });
  }
  return trades;
};
$src$
WHERE owner_id IS NULL AND name = 'SMA Crossover';

UPDATE strategies SET name = 'Preboj (Donchian)',
  description = 'Nakup, ko zaprtje preseže najvišjo ceno zadnjih svečk (obdobje); izstop, ko pade pod najnižjo ceno zadnjih svečk (izstopno_obdobje).',
  default_params = '{"obdobje": 20, "izstopno_obdobje": 10}',
  source = $src$export default (bars, params) => {
  const { obdobje, izstopno_obdobje } = params;
  if (!(obdobje > 0 && izstopno_obdobje > 0)) throw new Error('Parametra obdobje in izstopno_obdobje morata biti večja od 0');
  const highest = (i, n) => {
    let max = -Infinity;
    for (let k = i - n; k < i; k++) max = Math.max(max, bars[k].high);
    return max;
  };
  const lowest = (i, n) => {
    let min = Infinity;
    for (let k = i - n; k < i; k++) min = Math.min(min, bars[k].low);
    return min;
  };
  const trades = [];
  let entry = null;
  for (let i = Math.max(obdobje, izstopno_obdobje); i < bars.length - 1; i++) {
    if (!entry && bars[i].close > highest(i, obdobje)) {
      entry = bars[i + 1];
    } else if (entry && bars[i].close < lowest(i, izstopno_obdobje)) {
      trades.push({ side: 'long', entryTime: entry.time, exitTime: bars[i + 1].time, entryPrice: entry.open, exitPrice: bars[i + 1].open, orderType: 'taker' });
      entry = null;
    }
  }
  if (entry) {
    const last = bars[bars.length - 1];
    trades.push({ side: 'long', entryTime: entry.time, exitTime: last.time, entryPrice: entry.open, exitPrice: last.close, orderType: 'taker' });
  }
  return trades;
};
$src$
WHERE owner_id IS NULL AND name = 'Breakout (Donchian)';
