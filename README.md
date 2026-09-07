# Odin R&D

[Enter the software factory](https://odin-labs-ai.github.io/odin-rnd/).

A public workshop for Odin's research: open-source tools, reproducible experiments and field notes that connect engineering work to its meaning. The factory drawing is a conceptual assembly; its stations lead into real projects and evidence.

## Explore

- [Factory floor and blueprint view](https://odin-labs-ai.github.io/odin-rnd/)
- [The public test bench](https://odin-labs-ai.github.io/odin-rnd/#experiments)
- [Public experiment runs](https://github.com/odin-labs-ai/odin-rnd/actions/workflows/publish.yml)
- [Field notes](https://odin-labs-ai.github.io/odin-rnd/#journal)
- [Propose an experiment](https://github.com/odin-labs-ai/odin-rnd/issues/new?template=experiment.yml)

## Run locally

Node 22 and pnpm 10.11.1:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm experiment
pnpm test
pnpm build
pnpm check
pnpm serve
```

Open `http://127.0.0.1:4173/odin-rnd/`. The development server mirrors the GitHub Pages project prefix.

The site uses static HTML, self-hosted fonts, CSS, native JavaScript and authored SVG. There is no visitor account, tracking script, model API or hosted execution service. Engine logic comes from the released `bce-engine@0.3.0` package; this repository does not implement its own conformance engine.

## Experiments

The runner executes three packaged BCE recipes: TypeScript module layering, Python module layering and configuration allowlisting. Each compares a clean fixture with a deliberate violation under an unchanged authored rule. A successful discrimination records both GREEN and RED; the demo process exits zero because the experiment succeeded. Its RED outcome represents a gate that would exit one.

Results include the complete transcript, its SHA-256 digest, package/version/integrity, time, execution environment, source revision and CI run URL. Selectors on the site inspect these recordings; the reproduction command runs locally. These are author-controlled mechanism tests, not measurements of agent effectiveness or production reliability.

GitHub Actions runs them on main, pull requests, manual dispatch and weekly. Failed discrimination retains its report as a workflow artifact and blocks publication. The previous successful site's timestamp remains unchanged. Artifact retention is 90 days; the site serves its current published record, and the checked-in initial local record is historical evidence, not a claim of continuous liveness.

## Contribute

Start with a question someone else can reproduce. Supply public inputs, a comparison, the expected result, what would refute it, and its limitations. See [the experiment template](.github/ISSUE_TEMPLATE/experiment.yml) and [the publishing guide](docs/PUBLISHING.md).

Code and site content are Apache-2.0. Fonts carry their SIL Open Font License notices. Odin and project names do not grant trademark rights. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
