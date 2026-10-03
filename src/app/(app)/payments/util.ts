/** Money reads as money: "RM 1,200.00". MYR is written RM, as on the receipts. */
export function money(amount: number, currency = "MYR"): string {
  const sym = currency === "MYR" ? "RM" : currency;
  return `${sym} ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The first instant of the current month in Malaysia (UTC+8, no DST). */
export function monthStart(): Date {
  const ym = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).slice(0, 7);
  return new Date(`${ym}-01T00:00:00+08:00`);
}
