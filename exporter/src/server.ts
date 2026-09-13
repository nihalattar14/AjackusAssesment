import { createServer } from 'node:http';
import { AuthError, ConfigError, type TaskPayload } from './types.ts';
import { exportTasks, requireConfig } from './export.ts';
import { createRealTable } from './real-table.ts';

const PORT = Number(process.env.AIRTABLE_EXPORTER_PORT || 3001);

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/export') {
      send(res, 404, { error: 'not found' });
      return;
    }

    let config;
    try {
      config = requireConfig();
    } catch (err) {
      send(res, 503, { error: err instanceof Error ? err.message : 'Airtable is not configured' });
      return;
    }

    const raw = await readBody(req);
    let tasks: TaskPayload[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch {
      send(res, 400, { error: 'invalid JSON' });
      return;
    }

    const table = createRealTable(config.apiKey, config.baseId, config.tableName);
    const result = await exportTasks(table, tasks);
    send(res, 200, result);
  } catch (err) {
    if (err instanceof ConfigError) {
      send(res, 503, { error: err.message });
      return;
    }
    if (err instanceof AuthError) {
      send(res, 502, { error: err.message });
      return;
    }
    send(res, 502, { error: err instanceof Error ? err.message : 'Airtable export failed' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`airtable exporter listening on ${PORT}\n`);
});
