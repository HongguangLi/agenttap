# Claude Code → langfuse-relay

Claude Code has built-in OpenTelemetry support, enabled through environment variables.

## Native telemetry (metrics + events)

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
claude
```

Note: Claude Code's native telemetry focuses on **metrics and log events** (API request counts, token usage, cost). langfuse-relay ingests traces; for full request/response traces, use the proxy approach below.

## Full traces via LiteLLM proxy

Route Claude Code through a [LiteLLM](https://github.com/BerriAI/litellm) proxy with its OTel callback pointed at langfuse-relay:

```yaml
# litellm config.yaml
litellm_settings:
  callbacks: ["otel"]

environment_variables:
  OTEL_EXPORTER: otlp_http
  OTEL_ENDPOINT: http://127.0.0.1:4318/v1/traces
```

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:4000   # LiteLLM proxy
claude
```

Every LLM call now appears in the dashboard with model, tokens, and full message content (LiteLLM emits `gen_ai.*` attributes, which langfuse-relay parses natively).
