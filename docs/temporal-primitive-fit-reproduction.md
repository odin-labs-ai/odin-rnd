# Reproducing the primitive-fit experiment

These instructions reproduce the **amended macOS AMD64 native tier** with Node 22 and pnpm 10.11.1. They are a clean-clone preparation guide, not a claim that the instructions were independently executed from an empty machine. The experiment's frozen `PROTOCOL.md`, `protocol.json` and `frozen-source.json` remain authoritative.

There is **no automated binary downloader in the earlier study**. Its `runtime.mjs` manages prepared processes; it does not fetch or install a runtime. The new `bootstrap(root, sourceRoot)` verifies and copies a prepared binary cache, initializes fresh database state and starts owned services. Prepare that cache manually below. An existing *verified binary cache* can also be reused without copying its database state.

This tier uses macOS `lsof`, `ps`, `du`, a Darwin AMD64 PostgreSQL distribution and `fsync_writethrough`. Apple Silicon emulation is a different host condition. Linux needs appropriate binaries and a separately frozen durability/measurement protocol; substituting Linux downloads does not reproduce this platform tier. MongoDB majority+journal is an explicit driver contract. The study does not claim its actual full-flush syscall branch was traced or that either engine passed a power-loss test.

## Prepare a fresh binary cache

Start at the repository root on an appropriate macOS host. Keep runtime files outside the checkout and retain all run directories. Confirm the required Node and pnpm versions before proceeding.

```sh
node --version
pnpm --version
export TPF_REPO_ROOT="$PWD"
export TPF_REPRO_BASE="$(mktemp -d "${TMPDIR:-/tmp}/tpf-reproduction.XXXXXX")"
export TPF_BINARY_CACHE="$TPF_REPRO_BASE/binaries"
export TPF_RUNTIME_ROOT="$TPF_REPRO_BASE/runtime"
mkdir -p "$TPF_BINARY_CACHE/downloads" "$TPF_BINARY_CACHE/postgres" \
  "$TPF_BINARY_CACHE/mongo" "$TPF_BINARY_CACHE/temporal"
```

The original study's public archive contains its binary provenance in `main/manifest.json`. Verify that archive against the committed evidence manifest, then extract just this JSON file:

```sh
node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=process.env.TPF_REPO_ROOT+'/site/data/temporal-document-fit';
const evidence=JSON.parse(await readFile(dir+'/evidence-manifest.json','utf8'));
assert.equal(createHash('sha256').update(await readFile(dir+'/raw-evidence.tar.gz')).digest('hex'),evidence.archive.sha256);
JS
tar -xOzf "$TPF_REPO_ROOT/site/data/temporal-document-fit/raw-evidence.tar.gz" \
  main/manifest.json > "$TPF_REPRO_BASE/original-manifest.json"
```

Download the exact artifacts recorded by that provenance:

```sh
curl --fail --location --output "$TPF_BINARY_CACHE/downloads/postgres.jar" \
  'https://repo.maven.apache.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-amd64/16.15.0/embedded-postgres-binaries-darwin-amd64-16.15.0.jar'
curl --fail --location --output "$TPF_BINARY_CACHE/downloads/mongodb.tgz" \
  'https://fastdl.mongodb.org/osx/mongodb-macos-x86_64-8.0.15.tgz'
curl --fail --location --output "$TPF_BINARY_CACHE/downloads/temporal.tgz" \
  'https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_darwin_amd64.tar.gz'
```

The PostgreSQL JAR and Temporal tarball SHA-256 values below come from the original preparation's retained publisher-checksum evidence. The executable verification that follows also compares all three executable bytes with the public run manifest. No MongoDB publisher-checksum verification is claimed.

```sh
python3 - <<'PY'
import hashlib, os, pathlib
root=pathlib.Path(os.environ['TPF_BINARY_CACHE'])/'downloads'
expected={
 'postgres.jar':'1229188b99515d2160d5cb6222bc96d9c5f3a248268df3bc2dfe0047e6c233d8',
 'temporal.tgz':'48cdd6c84c56e27ae8e4d9a47052b89289a9c552dee029b49dd312c6fb72873f',
}
for name,digest in expected.items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, name
PY
unzip -p "$TPF_BINARY_CACHE/downloads/postgres.jar" postgres-darwin-x86_64.txz \
  > "$TPF_BINARY_CACHE/downloads/postgres.txz"
tar -xJf "$TPF_BINARY_CACHE/downloads/postgres.txz" -C "$TPF_BINARY_CACHE/postgres"
tar -xzf "$TPF_BINARY_CACHE/downloads/mongodb.tgz" \
  --strip-components=1 -C "$TPF_BINARY_CACHE/mongo"
tar -xzf "$TPF_BINARY_CACHE/downloads/temporal.tgz" -C "$TPF_BINARY_CACHE/temporal"
```

The PostgreSQL embedded archive contains its complete distribution, including libraries and share files. Do not copy only the server executable. The MongoDB archive has one top-level distribution directory; Temporal has `temporal` and `LICENSE` at its root.

Verify the pinned executable hashes and create provenance consumed by the new bootstrap:

```sh
node --input-type=module <<'JS'
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.TPF_REPRO_BASE,cache=process.env.TPF_BINARY_CACHE;
const manifest=JSON.parse(await readFile(base+'/original-manifest.json','utf8'));
const original=manifest.runtime.provenance;
for(const [name,record] of Object.entries(original.binaries)) {
  assert.equal(createHash('sha256').update(await readFile(cache+'/'+record.file)).digest('hex'),record.sha256,name);
}
const provenance={...original,
  originalStudyPublisherChecksumVerified:original.publisherChecksumVerified,
  publisherChecksumVerified:[],
  reproductionVerification:'Exact executable SHA-256 match against public original-study provenance; retained PostgreSQL and Temporal archive checksum values checked separately. Original publisher-verification attribution is preserved separately.'};
await writeFile(cache+'/runtime-provenance.json',JSON.stringify(provenance,null,2)+'\n');
JS
```

The frozen helper checks executable hashes before copying binaries. It does not download packages, verify publisher signatures, or establish the safety of a modified binary cache. Preserve the downloads and their verification evidence alongside your reproduction.

## Start owned services and validate

Install only this experiment's pinned dependencies. Do not change its source files or regenerate its freeze to make a mismatch pass.

```sh
cd "$TPF_REPO_ROOT/experiments/temporal-primitive-fit"
pnpm install --frozen-lockfile
pnpm test
node --input-type=module <<'JS'
import {bootstrap} from './runtime.mjs';
const runtime=await bootstrap(process.env.TPF_RUNTIME_ROOT,process.env.TPF_BINARY_CACHE);
console.log(JSON.stringify(await runtime.durability(),null,2));
JS
pnpm preflight
PRIMITIVE_NATIVE_TESTS=1 node --test native.test.mjs
```

Bootstrap refuses occupied ports `55739`, `27329` and `17539`, an existing ownership record, or existing state. It creates PostgreSQL database `primitive_fit` for local user `experiment`, MongoDB replica set `primitivefit`, and a Temporal development server with SQLite persistence. It never adopts an unrelated listening service. A partial initialization failure must be inspected; do not delete ownership evidence or point the helper at shared services.

Preflight verifies the source freeze and owned identities without resetting workloads. Native tests reset their dedicated application schemas/collections. Run them **before** any measured execution. The runner rejects nonempty `PGOPTIONS`, checks PostgreSQL's exact owned data directory and required flush settings, and checks the owned MongoDB log for the pinned full-flush fallback warning. Absence of that warning is not syscall tracing.

## Execute the frozen matrix and independent repeat

Run the complete main matrix, then the distinct-seed reproduction. Keep other owned builds, tests, archive operations and benchmarks idle during both. Record shared-host interference rather than quietly discarding slow cells. A separate operator can execute the reproduction using the same frozen checkout and owned runtime; a separate host is a stronger future validation tier.

```sh
node run.mjs > "$TPF_REPRO_BASE/main-output.log" 2>&1
node run.mjs --reproduce > "$TPF_REPRO_BASE/reproduction-output.log" 2>&1
```

Each command's final JSON line contains its `out` directory and outcome. Set the following variables to those **exact printed paths**, then evaluate:

```sh
export TPF_MAIN_RUN='/absolute/path/printed/by/main'
export TPF_REPEAT_RUN='/absolute/path/printed/by/reproduction'
node evaluate.mjs "$TPF_MAIN_RUN" "$TPF_REPEAT_RUN" "$TPF_REPRO_BASE/evaluation.json"
```

A successful process exit alone is insufficient: both reports must be completed, source- and durability-verified, and accepted by the frozen evaluator. Reproduction rows remain separate. An interrupted or failed attempt stays in the evidence record; do not reduce counts, remove unfavorable repetitions, change thresholds or reuse its rows in a replacement run.

## Review, export and stop

An independent audit may be saved as `independent-audit.json` inside each applicable run directory. Export to a new directory after both runs and evaluation finish:

```sh
cd "$TPF_REPO_ROOT"
node scripts/export-temporal-primitive-fit.mjs \
  --run "$TPF_MAIN_RUN" --reproduction "$TPF_REPEAT_RUN" \
  --evaluation "$TPF_REPRO_BASE/evaluation.json" \
  --out "$TPF_REPRO_BASE/public-evidence"
```

For historical uncounted smoke directories, add one `--prior DIR` per directory. An excluded interrupted measured run requires its failed finalized report, `operator-interruption.json`, `durability-diagnosis.json`, and a `sources/` directory containing the exact prior frozen files plus `frozen-source.json`. The exporter verifies that historical source archive independently; its observations remain excluded from amended decisions.

The exporter verifies sources and operation counts, recomputes the decision, sanitizes local paths/hostnames, and emits a manifest binding original and exported hashes. Frozen source bytes remain exact. Session evidence contains compact cold-body digests only after full-value oracle comparison; reconstructable synthetic bodies are not mislabeled as retained raw payloads. Review the export before any publication. Never publish the entire runtime directory or raw worker logs.

Stop only the verified owned services after all work is complete:

```sh
cd "$TPF_REPO_ROOT/experiments/temporal-primitive-fit"
node --input-type=module <<'JS'
import {OwnedRuntime} from './runtime.mjs';
await (await new OwnedRuntime(process.env.TPF_RUNTIME_ROOT).load()).shutdown();
JS
```

Retain the runtime and run evidence after shutdown. Host load, clock throttling, native flush behavior, and the synthetic workload limit the inference. A positive local candidate result is not a platform-wide adoption decision.

## Audit the published evidence without databases

The supplemental [`temporal-primitive-fit-verify-evidence.mjs`](temporal-primitive-fit-verify-evidence.mjs) is byte-identical to the independent verifier identified by the published audit receipt. It checks raw statistics, reconstructs states from the frozen synthetic fixtures, verifies snapshots and source bindings, and independently recalculates decision gates. It needs Node 22, disk space for the extracted archive, and several minutes of CPU time; it does not connect to any database.

From the repository root, verify and extract the committed archive into a fresh temporary directory. The checksum binds the archive to this checkout's evidence manifest; it is not a publisher signature.

```sh
export TPF_REPO_ROOT="$PWD"
export TPF_AUDIT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tpf-public-audit.XXXXXX")"
node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=process.env.TPF_REPO_ROOT+'/site/data/temporal-primitive-fit';
const manifest=JSON.parse(await readFile(dir+'/evidence-manifest.json','utf8'));
assert.equal(createHash('sha256').update(await readFile(dir+'/raw-evidence.tar.gz')).digest('hex'),manifest.archive.sha256);
JS
tar -xzf "$TPF_REPO_ROOT/site/data/temporal-primitive-fit/raw-evidence.tar.gz" \
  -C "$TPF_AUDIT_ROOT"
cp "$TPF_REPO_ROOT/docs/temporal-primitive-fit-verify-evidence.mjs" \
  "$TPF_AUDIT_ROOT/verify-evidence.mjs"
```

The verifier expects its run-directory parent to contain only directories. Create a dedicated `runs` directory with links to the main, reproduction and retained `excluded-prior` directories. This also makes it audit the excluded attempt's original sources and confirm its exclusion. These links affect only the temporary extraction.

```sh
mkdir "$TPF_AUDIT_ROOT/runs"
ln -s "$TPF_AUDIT_ROOT/main" "$TPF_AUDIT_ROOT/runs/main"
ln -s "$TPF_AUDIT_ROOT/reproduction" "$TPF_AUDIT_ROOT/runs/reproduction"
for TPF_EXCLUDED_RUN in "$TPF_AUDIT_ROOT"/excluded-prior/*; do
  [ -d "$TPF_EXCLUDED_RUN" ] || continue
  ln -s "$TPF_EXCLUDED_RUN" "$TPF_AUDIT_ROOT/runs/$(basename "$TPF_EXCLUDED_RUN")"
done
node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.env.TPF_AUDIT_ROOT;
const receipt=JSON.parse(await readFile(root+'/main/independent-audit.json','utf8'));
assert.equal(createHash('sha256').update(await readFile(root+'/verify-evidence.mjs')).digest('hex'),receipt.verifierSha256);
JS
node "$TPF_AUDIT_ROOT/verify-evidence.mjs" \
  "$TPF_AUDIT_ROOT/sources" "$TPF_AUDIT_ROOT/runs/main" \
  "$TPF_AUDIT_ROOT/runs/reproduction" "$TPF_AUDIT_ROOT/evaluation.json"
```

Successful verification writes `independent-evidence-audit.json` inside the temporary directory and prints `independently-verified`. Its timestamp differs from the original receipt. It verifies recorded Temporal states and attempts, but does not re-execute workflow-history replay. Cold bodies are regenerated from frozen fixtures and checked against recorded digests; the archive intentionally stores compact session projections.

The supplemental [`temporal-primitive-fit-v1-evaluate.mjs`](temporal-primitive-fit-v1-evaluate.mjs) preserves the exact superseded evaluator from the excluded first attempt. Its bytes and SHA-256 match that archived source. It is provenance only: the completed main and reproduction use the amended evaluator in `sources/evaluate.mjs`, not this historical copy.
