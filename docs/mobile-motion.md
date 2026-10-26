# One factory, from drawing to evidence

The home has one canonical factory drawing. On small screens the selected experiment follows its station controls; a second complete drawing is not used as a detail crop. The seven stations continue to open their existing records.

The factory is an authored illustration. Its assembly entrance, selected-station trace and blueprint transition explain the drawing and the reader's selection. They do not represent agents executing, live throughput or a measurement. Supporting motion follows the existing rule, change, gate and record story. No experiment result or recording timestamp is animated into a different claim.

Motion is finite and interruptible. Selecting another station settles the previous sequence, while the record and pressed state change immediately. Reduced motion uses the same final content; changing that preference, hiding the page or taking the factory out of view settles the visual sequence. The default HTML and CSS remain readable without JavaScript or animation APIs.

Returning from a hidden tab preserves the first entrance of diagrams the reader has not reached; completed entrances do not replay. If an animation API throws, selection, blueprint view and replay still expose the final content.

## Architectural guard

`.ai/blueprints/rnd-factory-surface.engineering-blueprint.json` was authored with the released engine's `bce author` command. It scans the four production rendering surfaces and refuses the legacy crop pipeline. This is a textual guard for that known regression, not a claim to prove every possible duplicate or browser behavior. `scripts/factory-surface.test.mjs` also requires a real build in a disposable checkout, counts its drawing and station groups, then modifies that checkout's builder to emit a second drawing without legacy crop strings. It regenerates the bound witness records and rebuilds before requiring the output assertion to fail. The test never skips for a missing local `dist/`.

Run from the repository root with the Node version in `package.json`:

```sh
pnpm exec bce validate --blueprint .ai/blueprints/rnd-factory-surface.engineering-blueprint.json
pnpm exec bce run --blueprint .ai/blueprints/rnd-factory-surface.engineering-blueprint.json --ct-repo . --no-pin --extractor line-scan --out factory-surface-report.json
node --test scripts/factory-surface.test.mjs
```

Read the report's `verdict`, `coverage` and `violations`; command completion alone is not a passing verdict. `--no-pin` examines the edited working tree. The blueprint remains a draft until review; the test consumes it through the existing required test command, without introducing a new hosted workflow.

## Evidence and limits

On 26 October 2026, before the fix, the blueprint scanned four files and reported five violations with score 0 and verdict `fail`: the build mount, the duplicate generator's class and ID, the template marker and the browser selector. The regression test seeds the old pipeline independently into each of those surfaces and requires a failing verdict, then removes it and requires a pass.

The local browser pass examined CSS viewport widths of 320, 390, 768 and 1920 pixels. Each had no horizontal page overflow, one `#factory-geometry`, seven station groups and no crop. All seven pointer controls selected their matching records. Space-key selection and the `#station-decision` deep link opened the expected evidence; switching blueprint view preserved the selection.

Changing the browser's reduced-motion preference settled all animations: the browser query reported zero animations and the replay control was hidden. With JavaScript disabled, a reload retained seven real station links and the first evidence record, while enhancement controls stayed hidden. After replay, `getAnimations()` captured thirteen finite animations; the greatest duration plus delay was 1120 milliseconds.

The local build and site check passed. At this checkpoint the full test suite was still running, and publication remained pending. This pass did not measure frame rate or use physical phone hardware. Pages receipts and an anonymous check of the final reviewed published revision are still required before claiming the change is live.
