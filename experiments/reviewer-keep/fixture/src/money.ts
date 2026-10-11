export type Cents = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`not an amount in cents: ${value}`);
  return value;
}

export function sum(amounts: readonly Cents[]): Cents {
  return amounts.reduce((total, amount) => total + amount, 0);
}

export function formatCents(amount: Cents, currency: string): string {
  const units = Math.floor(amount / 100);
  const rest = String(amount % 100).padStart(2, '0');
  return `${currency} ${units}.${rest}`;
}
