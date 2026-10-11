# Architecture

Callers use `OrderService` only. The service owns the rules about which status an order may
move to; the store only keeps and returns orders.

Every identifier has one format, defined in `src/ids.ts`: a fixed prefix, an underscore, and
twelve lower-case base-36 characters. Nothing else builds or parses an identifier.

Amounts are integers in minor units (cents). `src/money.ts` is the only place that formats them.

Events are delivered one at a time, in the order they were published. A subscriber that throws
does not stop delivery to the others.
