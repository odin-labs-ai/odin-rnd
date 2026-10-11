import type { OrderEvent } from './types.ts';

export type Subscriber = (event: OrderEvent) => Promise<void> | void;

export class EventBus {
  private readonly subscribers: Subscriber[] = [];
  private queue: Promise<void> = Promise.resolve();

  subscribe(subscriber: Subscriber): void {
    this.subscribers.push(subscriber);
  }

  publish(event: OrderEvent): Promise<void> {
    this.queue = this.queue.then(() => this.deliver(event));
    return this.queue;
  }

  private async deliver(event: OrderEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber(event);
      } catch {
        // A failing subscriber must not stop delivery to the others.
      }
    }
  }
}
