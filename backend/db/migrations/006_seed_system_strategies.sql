-- Sistemske strategije (brez lastnika). Vstopi in izstopi so ob odprtju svečke po signalu,
-- odprta pozicija se zapre ob zaprtju zadnje svečke. Migracija se izvede samo enkrat.

INSERT INTO strategies (owner_id, name, description, source, default_params, visibility) VALUES
(NULL, 'Buy & Hold', 'Kupi ob prvi svečki in drži do konca obdobja. Primerjalna osnova za druge strategije.',
$src$export default (bars) => {
  if (bars.length < 2) return [];
  const first = bars[0];
  const last = bars[bars.length - 1];
  return [{ side: 'long', entryTime: first.time, exitTime: last.time, entryPrice: first.open, exitPrice: last.close, orderType: 'taker' }];
};
$src$, '{}', 'shared'),

(NULL, 'SMA Crossover', 'Long, ko hitro drseče povprečje (fast) preseže počasnega (slow); izstop, ko pade pod njega.',
$src$export default (bars, params) => {
  const { fast, slow } = params;
  if (!(fast > 0 && slow > fast)) throw new Error('Parameter slow mora biti večji od fast, oba večja od 0');
  const sma = (i, n) => {
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += bars[k].close;
    return sum / n;
  };
  const trades = [];
  let entry = null;
  for (let i = slow; i < bars.length - 1; i++) {
    const up = sma(i, fast) > sma(i, slow);
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
$src$, '{"fast": 10, "slow": 30}', 'shared'),

(NULL, 'Breakout (Donchian)', 'Long, ko zaprtje preseže najvišjo ceno zadnjih period svečk; izstop, ko pade pod najnižjo ceno zadnjih exitPeriod svečk.',
$src$export default (bars, params) => {
  const { period, exitPeriod } = params;
  if (!(period > 0 && exitPeriod > 0)) throw new Error('Parametra period in exitPeriod morata biti večja od 0');
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
  for (let i = Math.max(period, exitPeriod); i < bars.length - 1; i++) {
    if (!entry && bars[i].close > highest(i, period)) {
      entry = bars[i + 1];
    } else if (entry && bars[i].close < lowest(i, exitPeriod)) {
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
$src$, '{"period": 20, "exitPeriod": 10}', 'shared');
