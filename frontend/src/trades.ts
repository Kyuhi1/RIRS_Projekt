import { errorMessage, getJson } from './api';

interface Trade {
  ticker: string;
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
  netProfit: number;
}
interface TradesPage {
  page: number;
  pages: number;
  total: number;
  trades: Trade[];
}

const SIDE_LABELS = { long: 'long', short: 'short' };
const money = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const dateTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// Tabela poslov po času vstopa s paginacijo po 20 (strežnik vrača strani).
export async function renderTrades(container: HTMLElement, backtestId: number, onUnauthorized: () => void, page = 1): Promise<void> {
  const { status, data } = await getJson(`/api/backtests/${backtestId}/trades?page=${page}`);
  if (status === 401) return onUnauthorized();
  container.replaceChildren();
  if (status !== 200) {
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = errorMessage(data, 'Poslov ni mogoče naložiti.');
    container.append(error);
    return;
  }
  const result = data as TradesPage;
  if (result.total === 0) {
    container.textContent = 'Strategija v tem obdobju ni sklenila poslov.';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Datum</th><th>Sredstvo</th><th>Rezultat</th></tr></thead>';
  const body = table.createTBody();
  for (const trade of result.trades) {
    const row = body.insertRow();
    row.insertCell().textContent = `${dateTime(trade.entryTime)} → ${dateTime(trade.exitTime)}`;
    row.insertCell().textContent = `${trade.ticker} (${SIDE_LABELS[trade.side]})`;
    const outcome = row.insertCell();
    outcome.className = trade.netProfit >= 0 ? 'pnl-up' : 'pnl-down';
    outcome.textContent = money(trade.netProfit);
  }

  const nav = document.createElement('div');
  nav.className = 'pager';
  const button = (label: string, target: number, disabled: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => renderTrades(container, backtestId, onUnauthorized, target));
    return b;
  };
  const info = document.createElement('span');
  info.textContent = `Stran ${result.page} od ${result.pages} (${result.total} poslov)`;
  nav.append(button('Prejšnja', result.page - 1, result.page <= 1), info, button('Naslednja', result.page + 1, result.page >= result.pages));
  container.append(table, nav);
}
