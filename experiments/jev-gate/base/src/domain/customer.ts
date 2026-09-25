import { DomainError } from './errors';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly creditLimitCents: number;
}

export function createCustomer(id: string, name: string, email: string): Customer {
  if (!email.includes('@')) throw new DomainError('customer.email', 'email is not valid');
  return { id, name: name.trim(), email: email.toLowerCase(), creditLimitCents: 50_000 };
}
