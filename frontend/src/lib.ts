export type LineItem = { description: string; quantity: string | null; amount: string | null };
export type Fields = { merchant: string | null; date: string | null; currency: string | null; subtotal: string | null; tax: string | null; total: string | null; category: string; notes: string; line_items: LineItem[] };
export type Expense = Fields & {id: string; status: 'needs_review' | 'verified'; filename: string | null; mime: string | null; warnings: string[]; created_at: string};
export type Health = {extraction_configured: boolean; model: string; categories: string[]};
export const categories = ['Meals & drinks', 'Travel', 'Office supplies', 'Software', 'Shopping', 'Utilities', 'Other'];
export const blank: Fields = {merchant: null, date: null, currency: null, subtotal: null, tax: null, total: null, category: 'Other', notes: '', line_items: []};

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`/api${path}`, {...options, signal: controller.signal});
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}). Please try again.`);
    }
    return response.status === 204 ? undefined as T : response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The request timed out. Refresh your expenses before retrying; the server may still finish processing.');
    if (error instanceof TypeError) throw new Error('Cannot connect to ReceiptPilot. Check that the backend is running.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export function money(amount: string | number | null, currency: string | null) {
  if (amount === null) return '—';
  if (!currency) return `${Number(amount).toLocaleString(undefined, {maximumFractionDigits: 3})} (currency?)`;
  try { return new Intl.NumberFormat(undefined, {style: 'currency', currency, currencyDisplay: 'code'}).format(Number(amount)); }
  catch { return `${currency} ${amount}`; }
}

export function totalsByCurrency(expenses: Expense[]) {
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    if (expense.currency && expense.total !== null) totals[expense.currency] = (totals[expense.currency] || 0) + Number(expense.total);
  }
  return totals;
}

export function fieldsOf(expense: Fields): Fields {
  return Object.fromEntries(Object.keys(blank).map(key => [key, expense[key as keyof Fields]])) as Fields;
}
