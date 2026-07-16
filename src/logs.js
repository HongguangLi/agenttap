// Map OTLP log events into spans. Some agents (notably Claude Code) emit
// telemetry as log events rather than spans. Claude Code tags every event of
// one user turn with the same `prompt.id`, so we reconstruct an OpenClaw-style
// trace per turn: a "turn" root span with the LLM calls and tool executions
// nested underneath, instead of one detached trace per event.
//
// Correlation keys Claude Code provides:
//   prompt.id    -> one user turn        (becomes one trace + its root span)
//   request_id   -> one LLM round-trip   (api_request + assistant_response merge)
//   tool_use_id  -> one tool execution   (tool_decision + tool_result merge)
import crypto from 'node:crypto';
import { extractSessionId, extractUserId } from './semantics.js';

const hx = (s, n) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const shortName = (n) => String(n || 'log').replace(/^claude_code\./, '');
const eventName = (ev) => ev.name || ev.attributes?.['event.name'] || 'log';

function classify(name, a) {
  const n = String(name).toLowerCase();
  if (/api_error/.test(n)) return { type: 'llm', error: true };
  if (/api_request|assistant_response/.test(n)) return { type: 'llm', error: false };
  if (/tool/.test(n)) return { type: 'tool', error: false };
  if (/user_prompt|prompt/.test(n)) return { type: 'agent', error: false };
  if (a.model && (a.input_tokens != null || a.output_tokens != null)) return { type: 'llm', error: false };
  return { type: 'other', error: false };
}

// Build a span record (with semantics attached) from one log event.
// `override` supplies the grouping identity (trace/span/parent) so callers can
// place the event inside a turn, or leave it to stand alone.
function eventToSpan(ev, override = {}) {
  const a = ev.attributes ?? {};
  const name = eventName(ev);
  const { type, error } = classify(name, a);
  const model = a.model ?? a['gen_ai.request.model'] ?? null;
  const promptTokens = num(a.input_tokens ?? a['gen_ai.usage.input_tokens']);
  const completionTokens = num(a.output_tokens ?? a['gen_ai.usage.output_tokens']);
  if (type === 'other' && model === null && promptTokens === null && !override.traceId) return null;

  const startNs = ev.timeNs ?? 0n;
  const durMs = num(a.duration_ms) ?? 0;
  const endNs = startNs + BigInt(Math.round(durMs * 1e6));
  // response = assistant_response's reply; prompt = user_prompt's text.
  const inputText = a.prompt ?? a['gen_ai.prompt'] ?? null;
  const outputText = a.response ?? null;

  // A clean, event-type-independent name so api_request and assistant_response
  // (or tool_decision and tool_result) resolve to the same merged span.
  let label = shortName(name);
  if (type === 'llm') label = model ? `chat ${model}` : 'llm call';
  else if (type === 'tool') label = a.tool_name ? `tool ${a.tool_name}` : 'tool';

  return {
    traceId: override.traceId ?? hx('t:' + (ev.spanId || name + startNs), 32),
    spanId: override.spanId ?? crypto.randomBytes(8).toString('hex'),
    parentSpanId: override.parentSpanId ?? '',
    name: label,
    kind: 'CLIENT',
    service: ev.service ?? 'unknown',
    scope: ev.scope ?? 'otlp-logs',
    startNs,
    endNs,
    durationMs: durMs,
    statusCode: error || a.success === false ? 'ERROR' : 'OK',
    statusMessage: error ? String(a.error ?? a.status_code ?? 'error') : '',
    attributes: a,
    resource: ev.resource ?? {},
    events: [],
    semantics: {
      spanType: type,
      model: model ? String(model) : null,
      inputText: inputText ? String(inputText) : null,
      outputText: outputText ? String(outputText) : null,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null,
      costUsd: num(a.cost_usd),
      sessionId: extractSessionId(a),
      userId: extractUserId(a, inputText),
    },
  };
}

// Merge key that fuses the two-event LLM and tool pairs into one span.
function childSpanId(turn, ev) {
  const a = ev.attributes ?? {};
  if (a.request_id) return hx(`llm:${turn}:${a.request_id}`, 16);
  if (a.tool_use_id) return hx(`tool:${turn}:${a.tool_use_id}`, 16);
  return hx(`ev:${turn}:${a['event.sequence'] ?? ''}:${eventName(ev)}:${ev.timeNs}`, 16);
}

/** Convert a batch of normalized OTLP log events into span records. */
export function logEventsToSpans(events) {
  const turns = new Map();
  const spans = [];
  for (const ev of events) {
    const turn = ev.attributes?.['prompt.id'];
    if (turn) {
      if (!turns.has(turn)) turns.set(turn, []);
      turns.get(turn).push(ev);
    } else {
      const s = eventToSpan(ev); // ungroupable → its own trace
      if (s) spans.push(s);
    }
  }

  for (const [turn, evs] of turns) {
    const traceId = hx('t:' + turn, 32);
    const rootId = hx('r:' + turn, 16);
    evs.sort((x, y) =>
      Number((x.attributes?.['event.sequence'] ?? 0) - (y.attributes?.['event.sequence'] ?? 0)) ||
      Number((x.timeNs ?? 0n) - (y.timeNs ?? 0n)));
    const starts = evs.map((e) => e.timeNs ?? 0n);
    const minNs = starts.reduce((a, b) => (b < a ? b : a), starts[0] ?? 0n);
    let maxNs = minNs;
    for (const e of evs) {
      const end = (e.timeNs ?? 0n) + BigInt(Math.round((num(e.attributes?.duration_ms) ?? 0) * 1e6));
      if (end > maxNs) maxNs = end;
    }
    const promptEv = evs.find((e) => /prompt/.test(eventName(e)));
    const promptText = promptEv?.attributes?.prompt ?? null;
    const base = evs[0];
    const a0 = base.attributes ?? {};
    const hasErr = evs.some((e) => /api_error/.test(eventName(e)) || e.attributes?.success === false);

    // Turn root — the OpenClaw-style container everything nests under.
    spans.push({
      traceId, spanId: rootId, parentSpanId: '',
      name: promptText ? `turn: ${String(promptText).slice(0, 60)}` : `turn ${turn.slice(0, 8)}`,
      kind: 'SERVER', service: base.service ?? 'claude-code', scope: 'claude-code/turn',
      startNs: minNs, endNs: maxNs,
      durationMs: Number((maxNs - minNs) / 1000000n),
      statusCode: hasErr ? 'ERROR' : 'OK', statusMessage: '',
      attributes: { 'prompt.id': turn, 'session.id': a0['session.id'], 'user.email': a0['user.email'] },
      resource: base.resource ?? {}, events: [],
      semantics: {
        spanType: 'agent', model: null, inputText: promptText ? String(promptText) : null,
        outputText: null, promptTokens: null, completionTokens: null, totalTokens: null,
        costUsd: null, sessionId: extractSessionId(a0), userId: extractUserId(a0, promptText),
      },
    });

    for (const ev of evs) {
      if (ev === promptEv) continue; // folded into the root
      const child = eventToSpan(ev, { traceId, spanId: childSpanId(turn, ev), parentSpanId: rootId });
      if (child) spans.push(child);
    }
  }
  return spans;
}
