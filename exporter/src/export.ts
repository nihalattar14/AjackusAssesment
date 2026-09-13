import {
  AuthError,
  ConfigError,
  FIELD,
  type AirtableTable,
  type ExportResult,
  type TaskPayload,
} from './types.ts';

export const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 4;

export function isRetryable(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode;
  if (status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const code = (err as { code?: string })?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
}

function isAuthFailure(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode;
  return status === 401 || status === 403;
}

export function taskToFields(task: TaskPayload): Record<string, unknown> {
  return {
    [FIELD.taskId]: task.id,
    [FIELD.title]: task.title,
    [FIELD.description]: task.description ?? '',
    [FIELD.status]: task.status,
    [FIELD.assignee]: task.assigneeName ?? '',
    [FIELD.position]: task.position,
    [FIELD.projectId]: task.projectId,
    [FIELD.createdAt]: task.createdAt,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  sleepFn: (ms: number) => Promise<void>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err;
      await sleepFn(Math.min(200 * 2 ** (attempt - 1), 2000));
    }
  }
  throw last;
}

async function runBatch<T>(
  items: T[],
  send: (batch: T[]) => Promise<void>,
  sleepFn: (ms: number) => Promise<void>,
  onItemError: (item: T, err: unknown) => void,
): Promise<void> {
  for (const batch of chunk(items, BATCH_SIZE)) {
    try {
      await withRetry(() => send(batch), sleepFn);
      await sleepFn(220);
    } catch (batchErr) {
      if (!isRetryable(batchErr) && batch.length > 1) {
        for (const item of batch) {
          try {
            await withRetry(() => send([item]), sleepFn);
            await sleepFn(220);
          } catch (itemErr) {
            onItemError(item, itemErr);
          }
        }
      } else {
        for (const item of batch) onItemError(item, batchErr);
      }
    }
  }
}

export async function exportTasks(
  table: AirtableTable,
  tasks: TaskPayload[],
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ExportResult> {
  const result: ExportResult = {
    total: tasks.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  let existing: Awaited<ReturnType<AirtableTable['selectAll']>>;
  try {
    existing = await withRetry(() => table.selectAll(), sleepFn);
  } catch (err) {
    if (isAuthFailure(err)) {
      throw new AuthError('invalid Airtable credentials');
    }
    throw err;
  }

  const byTaskId = new Map<string, string>();
  for (const rec of existing) {
    const taskId = rec.fields[FIELD.taskId];
    if (typeof taskId === 'string' && taskId) byTaskId.set(taskId, rec.id);
  }

  type CreateItem = { taskId: string; fields: Record<string, unknown> };
  type UpdateItem = { taskId: string; id: string; fields: Record<string, unknown> };
  const toCreate: CreateItem[] = [];
  const toUpdate: UpdateItem[] = [];

  for (const task of tasks) {
    const fields = taskToFields(task);
    const recId = byTaskId.get(task.id);
    if (recId) toUpdate.push({ taskId: task.id, id: recId, fields });
    else toCreate.push({ taskId: task.id, fields });
  }

  const fail = (taskId: string, err: unknown) => {
    result.failed += 1;
    result.errors.push({
      taskId,
      error: err instanceof Error ? err.message : 'export failed',
    });
  };

  await runBatch(
    toCreate,
    async (batch) => {
      await table.create(batch.map((b) => b.fields));
      result.created += batch.length;
    },
    sleepFn,
    (item, err) => fail(item.taskId, err),
  );

  await runBatch(
    toUpdate,
    async (batch) => {
      await table.update(batch.map((b) => ({ id: b.id, fields: b.fields })));
      result.updated += batch.length;
    },
    sleepFn,
    (item, err) => fail(item.taskId, err),
  );

  return result;
}

export function requireConfig(): { apiKey: string; baseId: string; tableName: string } {
  const apiKey = process.env.AIRTABLE_API_KEY?.trim() ?? '';
  const baseId = process.env.AIRTABLE_BASE_ID?.trim() ?? '';
  const tableName = process.env.AIRTABLE_TABLE_NAME?.trim() || 'Tasks';
  if (!apiKey || !baseId) {
    throw new ConfigError('Airtable is not configured');
  }
  return { apiKey, baseId, tableName };
}
