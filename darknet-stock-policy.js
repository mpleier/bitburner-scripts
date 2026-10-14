export const stockSignalFile = 'tasks/dnet-stock-signal.json';
/** Promotion increases volatility; only boost a held position with a favorable 4S forecast. */
export function stockPromotionSignals(stocks, has4s, now = Date.now()) {
  return { at: now, expiresAt: now + 20000, stocks: has4s ? stocks.map(stock => ({ symbol: stock.sym,
    forecast: stock.prob, long: stock.sharesLong, short: stock.sharesShort, price: stock.price })) : [] };
}
export function chooseStockPromotion(signal, now = Date.now()) {
  if (!(signal?.expiresAt > now) || signal.at > now || now - signal.at > 20000) return null;
  return (signal.stocks || []).filter(stock => /^[A-Z0-9]{1,8}$/.test(stock.symbol) &&
    Number.isFinite(stock.forecast) && stock.forecast >= 0 && stock.forecast <= 1 && stock.price > 0 &&
    ((stock.long > stock.short && stock.forecast >= 0.6) || (stock.short > stock.long && stock.forecast <= 0.4)))
    .sort((a, b) => Math.abs(b.long - b.short) * b.price * Math.abs(b.forecast - 0.5) -
      Math.abs(a.long - a.short) * a.price * Math.abs(a.forecast - 0.5))[0]?.symbol || null;
}
