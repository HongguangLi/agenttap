# Codex → langfuse-relay

## Native OTel export

Recent Codex CLI versions ship experimental OpenTelemetry support. In `~/.codex/config.toml`:

```toml
[otel]
environment = "dev"
exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/traces", protocol = "binary" } }
```

Check `codex --help` / the [Codex config docs](https://github.com/openai/codex/blob/main/docs/config.md) for the exact schema on your version — the `[otel]` surface is still evolving.

## Proxy fallback

If your Codex version lacks OTel export, route it through a LiteLLM proxy with the OTel callback (see the [Claude Code guide](claude-code.md#full-traces-via-litellm-proxy) — identical setup, just point `OPENAI_BASE_URL` at the proxy instead).
