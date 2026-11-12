# Lab 11 — same model, with and without a harness

One small made-up project (`fixture/`, a route planner for Northwind Labs, a courier we invented), one change to it
(`change.diff`: the departure depot is charged as a stop, which the tests say it is not, so the suite fails), and one
question about the change: which files does it touch, and does the test suite still pass?

- **Bare**: the model gets the question and the diff (`task-open.txt` or `task-forced.txt`).
- **With a harness**: the same, plus the output of three tools the harness ran first (`harness.txt`): the file list, a
  search for the changed function and the real test run with its exit status. The harness then checks the reply
  (a file not in the project, or a verdict that is not the suite's exit status, is refused) and asks once more.
- **Open / forced**: in the open question the model may answer UNKNOWN for the tests; in the forced one it must say
  PASS or FAIL.

`score.mjs` scores every reply; the site build scores the run log again with it, so no row of the published record is
typed by hand. The published page is `site/labs/same-model-harness/` and its record
`site/data/labs/same-model-harness/record.json`, built by `scripts/vendor-same-model-harness.mjs`.

## Run it again

Needs Node 22, Python 3 and an [Ollama](https://ollama.com) server with the models pulled.

```sh
OLLAMA_URL=<your Ollama server's address> node experiments/same-model-harness/run.mjs \
  --models qwen2.5:7b,qwen3:30b-a3b,qwen2.5:14b,qwen2.5:32b,qwen3:32b --runs 10 \
  --out experiments/same-model-harness/runs/<date>/rows.jsonl
```

Cells run one after another; a cell does not start while the one-minute load is above `--max-load` (default 40). The
log holds every reply as the model wrote it, with its seed, wall time and the load before the call.
