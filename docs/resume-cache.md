# Resume/cache

OpenFlow resume/cache replays a workflow script and reuses cached `agent()` results only for the longest unchanged prefix.

## User interface

```bash
openflow run workflow.js --resume <runId-or-path>
openflow run workflow.js --no-cache
openflow resume <runId-or-path> [--out <runs-dir>] [--report <pretty|json|jsonl>] [--no-cache]
```

`openflow resume` reads `run-input.json` from the previous run and starts a new run with `--resume` pointed at that previous run. It does not accept human input; pause/pending continuation is a separate future feature.

## Cache rule

Each `agent()` call records:

- `sequence`: the deterministic invocation order during script replay
- `callId`: `id` or `label`, when provided
- `fingerprint`: prompt, schema, structured output mode, provider, resolved model, timeout, cwd, metadata, and provider config

A cache hit requires the same sequence, compatible `callId`, matching fingerprint, and a successful previous result. After the first miss, later calls run live even if an individual later fingerprint still matches. This matches the conservative "longest unchanged prefix" model used by dynamic workflow systems.

`Date.now()`, `Math.random()`, and argument-free `new Date()` are rejected because nondeterminism breaks replay.

## Artifacts

- `run-input.json`: recorded invocation for `openflow resume`
- `calls.jsonl`: append-only audit log of all terminal agent calls
- `cache-index.json`: ordered successful entries for fast resume
- `agents/<id>/agent-result.json`: full successful result for cache materialization
- `agents/<id>/cache-hit.json`: current-run cache-hit provenance
