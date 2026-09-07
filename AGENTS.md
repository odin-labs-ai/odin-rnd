# Odin R&D contributor guidance

This is a static public research site, not the private Odin platform. Read PRODUCT.md, DESIGN.md and docs/PUBLISHING.md before changing the surface. Use Node 22, pnpm 10.11.1 and the frozen lockfile. Consume released upstream engine logic; never duplicate it here.

Changes must preserve keyboard use, reduced motion, mobile reading, recording timestamps and honest experiment boundaries. Keep dated source metadata beside claims. Run `pnpm test`, `pnpm build`, `pnpm check`; run `pnpm experiment` when changing the experiment runner, upstream pin, or before publication. New versions must exist on the registry before consumption.

Use an isolated worktree for multi-file changes. Keep public exports free of private customer material. Commit only your own files. Fix forward and retain failures as evidence. An independent review should examine the final change and exact PR head before merge.
