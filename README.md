# Odin R&D

[Enter the software factory](https://odin-labs-ai.github.io/odin-rnd/).

A public workshop for Odin's research: open-source tools, reproducible experiments and field notes that connect engineering work to its meaning. The factory drawing is a conceptual assembly; its stations lead into real projects and evidence.

## Explore

- [Factory floor and blueprint view](https://odin-labs-ai.github.io/odin-rnd/)
- [The public test bench](https://odin-labs-ai.github.io/odin-rnd/#experiments)
- [Public experiment runs](https://github.com/odin-labs-ai/odin-rnd/actions/workflows/publish.yml)
- [Field notes](https://odin-labs-ai.github.io/odin-rnd/#journal)
- [Work with Odin](https://odin-labs-ai.github.io/odin-rnd/work-with-us/)
- [Propose an experiment](https://github.com/odin-labs-ai/odin-rnd/issues/new?template=experiment.yml)

Working documents: [company readiness](docs/company-readiness.md), [pilot delivery runbook](docs/pilot-delivery-runbook.md), [pilot charter](site/resources/pilot-charter.md) and [evaluation report](site/resources/evaluation-report.md). These are plans and blank templates, not completed engagements.

## Run locally

Node 22, pnpm 10.11.1 and JDK 21 (set `JAVA_HOME` to that JDK):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm experiment
node scripts/run-roi-demos.mjs
pnpm test
pnpm build
pnpm check
pnpm serve
```

Open `http://127.0.0.1:4173/odin-rnd/`. The development server mirrors the GitHub Pages project prefix.

The site uses static HTML, self-hosted fonts, CSS, native JavaScript and authored SVG. There is no visitor account, third-party tracker, model API or hosted experiment execution. Engine logic comes from the released `bce-engine@0.3.1` package; this repository does not implement its own conformance engine.

The enquiry and activity modules are disabled while `site/data/intake-config.json` has `apiOrigin: null`. Enabling them requires a verified HTTPS intake service: enquiry success follows durable acceptance, retries retain one request key, and activity exports only fixed event/page labels. There are no cookies, visitor identifiers, form values or query strings in activity requests. These counts are interactions rather than unique people. The local brief builder does not submit its contents. Production checks must prove the actual service, private retrieval and reporting path before enabling the endpoint; a mock transport is only a UI test.

## Experiments

The runner executes three packaged BCE recipes: TypeScript module layering, Python module layering and configuration allowlisting. Each compares a clean fixture with a deliberate violation under an unchanged authored rule. A successful discrimination records both GREEN and RED; the demo process exits zero because the experiment succeeded. Its RED outcome represents a gate that would exit one.

Results include the complete transcript, its SHA-256 digest, package/version/integrity, time, execution environment, base checkout revision, hashes of the actual experiment input files, and CI run URL. Local edits are identified by those input hashes; a base revision alone is not proof of an unchanged worktree. Selectors on the site inspect these recordings; the reproduction command runs locally. These are author-controlled mechanism tests, not measurements of agent effectiveness or production reliability.

GitHub Actions runs them on main, pull requests, manual dispatch and weekly. Failed discrimination retains its report as a workflow artifact and blocks publication. The previous successful site's timestamp remains unchanged. Artifact retention is 90 days; the site serves its current published record, and the checked-in initial local record is historical evidence, not a claim of continuous liveness.

## Contribute

Start with a question someone else can reproduce. Supply public inputs, a comparison, the expected result, what would refute it, and its limitations. See [the experiment template](.github/ISSUE_TEMPLATE/experiment.yml) and [the publishing guide](docs/PUBLISHING.md).

Code and site content are Apache-2.0. Fonts carry their SIL Open Font License notices. Odin and project names do not grant trademark rights. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Witness projects

- [Test Witness](https://odin-labs-ai.github.io/odin-rnd/projects/test-witness/) · [pilot proposal](site/resources/test-witness-pilot.md)
- [Migration Witness](https://odin-labs-ai.github.io/odin-rnd/projects/migration-witness/) · [pilot proposal](site/resources/migration-witness-pilot.md)
- [CI Witness](https://odin-labs-ai.github.io/odin-rnd/projects/ci-witness/) · [pilot proposal](site/resources/ci-witness-pilot.md)

See [scope and demand rationale](docs/roi-projects.md). These are authored Java fixture demonstrations, not measured customer ROI. The recording identifies its actual local or GitHub Actions environment, workflow run and attempt, source inputs and command receipts. CI re-executes all three projects before building the site; saved local recordings do not establish a public CI result.
