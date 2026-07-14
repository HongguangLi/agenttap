# pi → langfuse-relay

[pi](https://github.com/badlogic/pi-mono) is a minimal, hackable coding agent — which makes it easy to instrument.

## Tracing proxy (works today)

Point pi's provider base URL at a LiteLLM proxy exporting OTLP to langfuse-relay (see the [Claude Code guide](claude-code.md#full-traces-via-litellm-proxy) for the proxy config).

## Direct instrumentation (hackable route)

pi's TypeScript core makes it straightforward to emit OTLP/JSON directly — a minimal exporter is just an HTTP POST per LLM call:

```ts
await fetch("http://127.0.0.1:4318/v1/traces", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "pi" } }] },
      scopeSpans: [{
        scope: { name: "pi-tracer" },
        spans: [{
          traceId, spanId, name: "chat " + model, kind: 1,
          startTimeUnixNano: String(startNs), endTimeUnixNano: String(endNs),
          attributes: [
            { key: "gen_ai.request.model", value: { stringValue: model } },
            { key: "gen_ai.usage.input_tokens", value: { intValue: String(inputTokens) } },
            { key: "gen_ai.usage.output_tokens", value: { intValue: String(outputTokens) } },
            { key: "gen_ai.prompt", value: { stringValue: promptText } },
            { key: "gen_ai.completion", value: { stringValue: completionText } },
          ],
        }],
      }],
    }],
  }),
});
```

No SDK required — that's the whole payload.
