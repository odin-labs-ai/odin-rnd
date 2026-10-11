const BODY_LENGTH = 12;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const IdPrefix = {
  Order: 'ord',
  Customer: 'cus',
  Event: 'evt',
} as const;

export type IdPrefix = (typeof IdPrefix)[keyof typeof IdPrefix];

export type Id<P extends IdPrefix> = `${P}_${string}`;

export function newId<P extends IdPrefix>(prefix: P, random: () => number = Math.random): Id<P> {
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i++) {
    body += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}

export function parseId<P extends IdPrefix>(prefix: P, value: string): Id<P> {
  const [head, body, ...rest] = value.split('_');
  if (head !== prefix || rest.length > 0 || body === undefined || body.length !== BODY_LENGTH) {
    throw new Error(`not a ${prefix} id: ${value}`);
  }
  for (const char of body) {
    if (!ALPHABET.includes(char)) throw new Error(`not a ${prefix} id: ${value}`);
  }
  return value as Id<P>;
}
