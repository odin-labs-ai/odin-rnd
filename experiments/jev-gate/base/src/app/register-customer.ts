import { createCustomer } from '../domain';
import type { CustomerRepository } from './ports';

export async function registerCustomerUseCase(
  customers: CustomerRepository,
  input: { id: string; name: string; email: string },
): Promise<void> {
  await customers.save(createCustomer(input.id, input.name, input.email));
}
