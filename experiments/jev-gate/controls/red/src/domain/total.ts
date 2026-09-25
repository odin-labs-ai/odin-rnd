import { checkout } from '../app/checkout';

export function total(prices: number[]): number {
  return prices.reduce((sum, price) => sum + price, 0);
}

export const preview = (prices: number[]) => checkout(prices);
