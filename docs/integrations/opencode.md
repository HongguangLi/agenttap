# opencode → langfuse-relay

opencode does not currently ship a first-party OTLP trace exporter, so the reliable path is a tracing proxy between opencode and your model provider.

## LiteLLM proxy

```yaml
# litellm config.yaml
model_list:
  - model_name: claude-sonnet-4-6
    litellm_params:
      model: anthropic/claude-sonnet-4-6

litellm_settings:
  callbacks: ["otel"]

environment_variables:
  OTEL_EXPORTER: otlp_http
  OTEL_ENDPOINT: http://127.0.0.1:4318/v1/traces
```

Then point the provider `baseURL` in your opencode config (`~/.config/opencode/opencode.json`) at the proxy:

```jsonc
{
  "provider": {
    "anthropic": {
      "options": { "baseURL": "http://127.0.0.1:4000" }
    }
  }
}
```

## Plugin route

opencode has a plugin system with `chat.message` / tool-execution hooks. A native exporter plugin (mirroring what NeMo Relay does for OpenClaw) would be a great contribution — PRs welcome.
