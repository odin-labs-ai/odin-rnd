export interface Money {
  readonly cents: number;
  readonly currency: string;
}

export function money(cents: number, currency = 'EUR'): Money {
  if (!Number.isInteger(cents)) throw new RangeError('cents must be an integer');
  return { cents, currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new RangeError('currency mismatch');
  return money(a.cents + b.cents, a.currency);
}

export function multiply(a: Money, factor: number): Money {
  return money(Math.round(a.cents * factor), a.currency);
}
