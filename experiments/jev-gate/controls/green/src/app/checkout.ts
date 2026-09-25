import { total } from '../domain/total';

export function checkout(prices: number[]): string {
  return `total: ${total(prices)}`;
}
