# langfuse-relay

**Agent-native, local-first observability platform — in a single process.**

A tiny OTLP trace collector + dashboard purpose-built for coding-agent power users — [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [OpenClaw](https://openclaw.ai), [opencode](https://github.com/sst/opencode), Hermes, [pi](https://github.com/badlogic/pi-mono) — who want to see every LLM call, token count, and tool execution their agents make, without running a fleet of containers. Agent-native means it speaks the OTLP dialects agents actually emit (GenAI, OpenInference, NeMo Relay) out of the box; local-first means everything — collector, storage, dashboard — runs on your machine and your prompts never leave it.

Inspired by two great projects and designed to sit between them:

- **[Langfuse](https://github.com/langfuse/langfuse)** — the gold standard for LLM trace *visualization*, but self-hosting requires Postgres + ClickHouse + Redis + MinIO (5 containers).
- **[NVIDIA NeMo Relay](https://github.com/NVIDIA/NeMo-Relay)** — a brilliant protocol-agnostic *capture* layer for agent runtimes, but it has no UI or storage by design.

`langfuse-relay` takes the capture-anything philosophy of NeMo Relay and the trace-inspection UX of Langfuse, and compresses them into **one Node.js process with one SQLite file and one dependency**.

```
┌─────────────────────────┐     OTLP/HTTP      ┌─────────────────────────────┐
│ Claude Code / Codex /   │  (protobuf|JSON)   │        langfuse-relay       │
│ OpenClaw / opencode /   │ ─────────────────► │  ingest → SQLite → dashboard│
│ Hermes / pi / NeMo Relay│   :4318/v1/traces  │        (one process)        │
└─────────────────────────┘                    └─────────────────────────────┘
```

## How it differs from Langfuse

Langfuse is excellent — and if you need team features, evaluations, prompt management, or production scale, use it. The two tools sit at different points:

| | Langfuse (self-hosted) | langfuse-relay |
|---|---|---|
| Positioning | Full LLM engineering platform (tracing, evals, prompt mgmt, teams) | Agent-native local tracing for one developer's machines |
| Processes | 6 containers | 1 Node process |
| Storage | Postgres + ClickHouse + Redis + MinIO | 1 SQLite file |
| Dependencies | Docker Compose | `protobufjs` (only) |
| Setup | env file with 10+ secrets | clone → `npm install` → `npm start` |
| RAM footprint | ~2 GB+ | ~50 MB |
| Semantic conventions | GenAI, OpenInference, Langfuse SDK | GenAI, OpenInference, NeMo Relay |
| Agent `nemo_relay.*` traces | Stored but Input/Output show null (data buried in Metadata) | Input/Output parsed and rendered natively |
| Data location | Your containers | One local file you can `cp`, `grep`, or delete |

**And from NeMo Relay:** NeMo Relay is a capture/export layer with no storage or UI by design — it needs a backend to send traces *to*. langfuse-relay is that backend (the lightest possible one). They compose: NeMo Relay instruments your agent runtime, langfuse-relay stores and visualizes what it exports.

## Install

Requires **Node.js ≥ 22.13** (uses the built-in `node:sqlite` — no database server needed).

```bash
# 1. Get the code
git clone https://github.com/HongguangLi/langfuse-relay
cd langfuse-relay

# 2. Install the single dependency
npm install

# 3. Run
npm start
```

You should see:

```
langfuse-relay listening on http://127.0.0.1:4318
  dashboard   http://127.0.0.1:4318/
  OTLP ingest http://127.0.0.1:4318/v1/traces
  db          ~/.langfuse-relay/traces.db
```

**Verify it works** — send a synthetic agent trace and open the dashboard:

```bash
node examples/send-test-trace.js
# then open http://127.0.0.1:4318
```

**Connect your agent** — point its OTLP exporter at `http://127.0.0.1:4318/v1/traces` (see the [per-agent guides](#agent-integration-guides) below).

**Run it persistently** (optional) — as a systemd user service:

```ini
# ~/.config/systemd/user/langfuse-relay.service
[Unit]
Description=langfuse-relay local agent observability

[Service]
ExecStart=/usr/bin/env node /path/to/langfuse-relay/src/cli.js
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now langfuse-relay
```

## What it understands

Every agent speaks a different OTLP dialect. langfuse-relay normalizes three semantic conventions into one unified view (model, input/output, token usage) — spans keep their raw attributes too:

| Convention | Namespace | Emitted by |
|---|---|---|
| OpenTelemetry GenAI | `gen_ai.*` | OTel auto-instrumentation, Codex, most SDKs |
| OpenInference | `llm.*`, `input.value`, `openinference.span.kind` | Arize/Phoenix ecosystem, NeMo Relay (openinference exporter) |
| NeMo Relay native | `nemo_relay.*` (incl. `*_json` payloads) | NeMo Relay (opentelemetry exporter) via OpenClaw etc. |

Unknown spans still get stored and displayed with heuristic typing (llm / tool / agent), so nothing is dropped on the floor.

### Langfuse-compatible ingest path

The collector also answers on `/api/public/otel/v1/traces` — the same path as Langfuse's OTLP endpoint. If your agent is already configured to export to a Langfuse instance, switching to langfuse-relay is a one-line host change. `Authorization` headers are accepted (and ignored unless you set `--token`).

## Agent integration guides

- [Claude Code](docs/integrations/claude-code.md)
- [Codex](docs/integrations/codex.md)
- [OpenClaw (via NeMo Relay)](docs/integrations/openclaw.md)
- [opencode](docs/integrations/opencode.md)
- [Hermes](docs/integrations/hermes.md)
- [pi](docs/integrations/pi.md)

## CLI

```
langfuse-relay [options]
  --port <n>    Listen port (default 4318, the OTLP/HTTP standard port)
  --host <h>    Bind address (default 127.0.0.1; use 0.0.0.0 to expose)
  --db <path>   SQLite file (default ~/.langfuse-relay/traces.db)
  --token <t>   Require this bearer/basic token on the ingest endpoint
```

Environment variables: `LANGFUSE_RELAY_PORT`, `LANGFUSE_RELAY_HOST`, `LANGFUSE_RELAY_DB`, `LANGFUSE_RELAY_TOKEN`.

## HTTP API

| Method | Path | Description |
|---|---|---|
| POST | `/v1/traces` | OTLP/HTTP trace ingest (protobuf or JSON) |
| POST | `/api/public/otel/v1/traces` | Langfuse-compatible alias of the above |
| GET | `/api/traces?limit&offset&q&service` | List traces (aggregated) |
| GET | `/api/traces/:traceId` | All spans for a trace |
| GET | `/api/stats` | Totals, per-service and per-model breakdowns |
| GET | `/health` | Liveness check |
| GET | `/` | Dashboard |

## Design principles

1. **Local-first.** Binds to loopback by default. Your prompts and outputs never leave your machine.
2. **Zero infrastructure.** No Docker, no database server, no message queue. `node:sqlite` in WAL mode handles a developer's trace volume with ease.
3. **Protocol over product.** Standard OTLP in; if you outgrow this tool, re-point the same exporter at Langfuse, Phoenix, Jaeger, or any OTLP backend. No lock-in either direction.
4. **Dialect-tolerant.** Semantic conventions are treated as hints, not requirements. Raw attributes are always preserved and inspectable.

## Non-goals

Team collaboration, user management, evaluations, prompt management, production-scale ingestion. That's Langfuse's territory — graduate to it when you need it.

## License

Apache-2.0. Not affiliated with Langfuse GmbH or NVIDIA; named in homage to the two projects that inspired the architecture.
