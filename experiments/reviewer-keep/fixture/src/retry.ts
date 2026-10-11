export async function retry<T>(attempts: number, run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
