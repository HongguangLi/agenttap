// Single-process HTTP server: OTLP ingestion + query API + dashboard.
// No framework — node:http is plenty for a local-first tool.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodeTraceExport } from './otlp.js';
import { extractSemantics } from './semantics.js';
import { SpanStore } from './store.js';

const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui', 'index.html');

// OTLP standard path plus a Langfuse-compatible alias, so existing exporters
// pointed at Langfuse's OTLP endpoint only need a host/port change.
const INGEST_PATHS = new Set(['/v1/traces', '/api/public/otel/v1/traces']);

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createServer({ dbPath, token = null, maxBodyBytes = 32 * 1024 * 1024, logger = console }) {
  const store = new SpanStore(dbPath);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && INGEST_PATHS.has(url.pathname)) {
        // Auth is optional: local-first means zero-config by default, but a
        // shared token can be required when exposed beyond localhost.
        if (token) {
          const auth = req.headers.authorization ?? '';
          if (auth !== `Bearer ${token}` && auth !== `Basic ${token}`) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
          }
        }
        const body = await readBody(req, maxBodyBytes);
        const contentType = req.headers['content-type'] ?? 'application/x-protobuf';
        const spans = await decodeTraceExport(body, contentType);
        for (const span of spans) {
          span.semantics = extractSemantics(span);
        }
        const count = store.insertSpans(spans);
        logger.log(`[ingest] ${count} span(s) from ${spans[0]?.service ?? 'unknown'}`);
        // OTLP/HTTP success response: empty partial-success object.
        sendJson(res, 200, {});
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/traces') {
        sendJson(res, 200, {
          traces: store.listTraces({
            limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 500),
            offset: Number(url.searchParams.get('offset') ?? 0),
            service: url.searchParams.get('service'),
            q: url.searchParams.get('q'),
          }),
        });
        return;
      }

      const traceMatch = /^\/api\/traces\/([0-9a-f]{1,64})$/.exec(url.pathname);
      if (req.method === 'GET' && traceMatch) {
        const spans = store.getTrace(traceMatch[1]);
        if (spans.length === 0) {
          sendJson(res, 404, { error: 'trace not found' });
          return;
        }
        sendJson(res, 200, { spans });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/stats') {
        sendJson(res, 200, store.stats());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        // Re-read per request so dashboard tweaks don't need a restart.
        const html = readFileSync(UI_PATH);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      const statusCode = error.statusCode ?? (error instanceof SyntaxError ? 400 : 500);
      logger.error(`[error] ${req.method} ${url.pathname}: ${error.message}`);
      sendJson(res, statusCode, { error: error.message });
    }
  });

  server.on('close', () => store.close());
  return server;
}
