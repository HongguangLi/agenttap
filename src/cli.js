#!/usr/bin/env node
// CLI entry: `langfuse-relay [--port 4318] [--db path] [--host 127.0.0.1]`.
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from './server.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.LANGFUSE_RELAY_PORT ?? '4318' },
    host: { type: 'string', default: process.env.LANGFUSE_RELAY_HOST ?? '127.0.0.1' },
    db: { type: 'string', default: process.env.LANGFUSE_RELAY_DB ?? '' },
    token: { type: 'string', default: process.env.LANGFUSE_RELAY_TOKEN ?? '' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`langfuse-relay — local-first agent observability

Usage: langfuse-relay [options]

Options:
  --port <n>    Listen port (default 4318, the OTLP/HTTP standard port)
  --host <h>    Bind address (default 127.0.0.1; use 0.0.0.0 to expose)
  --db <path>   SQLite file (default ~/.langfuse-relay/traces.db)
  --token <t>   Require this bearer/basic token on the ingest endpoint
  --help        Show this help

Environment: LANGFUSE_RELAY_PORT, LANGFUSE_RELAY_HOST, LANGFUSE_RELAY_DB, LANGFUSE_RELAY_TOKEN`);
  process.exit(0);
}

const dbPath = values.db || path.join(os.homedir(), '.langfuse-relay', 'traces.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const server = createServer({ dbPath, token: values.token || null });
const port = Number(values.port);

server.listen(port, values.host, () => {
  console.log(`langfuse-relay listening on http://${values.host}:${port}`);
  console.log(`  dashboard   http://${values.host}:${port}/`);
  console.log(`  OTLP ingest http://${values.host}:${port}/v1/traces`);
  console.log(`  db          ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Force-exit if in-flight requests hang shutdown.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
