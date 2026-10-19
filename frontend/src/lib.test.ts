import { describe, expect, it } from 'vitest';
import { blank, fieldsOf, money, totalsByCurrency, type Expense } from './lib';

const expense = (currency: string | null, total: string | null): Expense => ({...blank, id:'1', currency, total, status:'needs_review', filename:null, mime:null, warnings:[], created_at:''});
describe('Expense currency integrity', () => {
  it('keeps currencies separate and excludes incomplete totals', () => {
    expect(totalsByCurrency([expense('USD','10.10'), expense('EUR','5'), expense('USD','2.20'), expense(null,'50'), expense('USD',null)])).toEqual({USD:12.3, EUR:5});
  });
  it('does not imply a currency when it is unknown', () => {
    expect(money('20', null)).toContain('currency?');
    expect(money(null, 'USD')).toBe('—');
  });
  it('only sends editable fields back to the strict API', () => {
    const result = fieldsOf(expense('USD','10'));
    expect(Object.keys(result)).toEqual(Object.keys(blank));
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('warnings');
  });
});
