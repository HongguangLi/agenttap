# Hermes → langfuse-relay

Hermes-style agent CLIs generally expose an OpenAI-compatible provider configuration. Two options:

## 1. Native OTel (if available)

If your Hermes build supports standard OTel environment variables:

```bash
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

langfuse-relay accepts both `http/protobuf` and `http/json` OTLP.

## 2. Tracing proxy

Point Hermes's model `base_url` at a LiteLLM proxy with the OTel callback enabled — see the [Claude Code guide](claude-code.md#full-traces-via-litellm-proxy) for the proxy config. Every completion call flows through the proxy and lands in the dashboard with `gen_ai.*` semantics.
