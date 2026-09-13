import { describe, it, expect } from 'vitest';
import { exportTasks, isRetryable, requireConfig, taskToFields } from './export.ts';
import { MockAirtableTable } from './lib/airtable-mock.ts';
import { ConfigError, FIELD, type TaskPayload } from './types.ts';

const sleep = async () => {};

function task(id: string, title = id): TaskPayload {
  return {
    id,
    title,
    description: null,
    status: 'todo',
    assigneeName: null,
    position: 0,
    projectId: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('exportTasks', () => {
  it('creates records on first export and updates the same Task ID on repeat', async () => {
    const table = new MockAirtableTable();
    const first = await exportTasks(table, [task('t1', 'One')], sleep);
    expect(first).toMatchObject({ total: 1, created: 1, updated: 0, failed: 0 });
    expect(table.records.size).toBe(1);

    const second = await exportTasks(table, [task('t1', 'One updated')], sleep);
    expect(second).toMatchObject({ total: 1, created: 0, updated: 1, failed: 0 });
    expect(table.records.size).toBe(1);
    const rec = [...table.records.values()][0];
    expect(rec.fields[FIELD.title]).toBe('One updated');
    expect(rec.fields[FIELD.taskId]).toBe('t1');
  });

  it('retries transient failures and does not retry permanent failures', async () => {
    const transient = new MockAirtableTable();
    transient.failNextCreate = { statusCode: 429, message: 'rate limited', remaining: 1 };
    const ok = await exportTasks(transient, [task('t1')], sleep);
    expect(ok.created).toBe(1);
    expect(ok.failed).toBe(0);
    expect(transient.createCalls).toBe(2);

    const permanent = new MockAirtableTable();
    permanent.failNextCreate = { statusCode: 422, message: 'invalid', remaining: 5 };
    const bad = await exportTasks(permanent, [task('t2')], sleep);
    expect(bad.created).toBe(0);
    expect(bad.failed).toBe(1);
    expect(permanent.createCalls).toBe(1);
  });

  it('exports remaining tasks when one record fails permanently', async () => {
    const table = new MockAirtableTable();
    table.failNextCreate = {
      statusCode: 422,
      message: 'bad record',
      remaining: 99,
      taskIds: new Set(['bad']),
    };
    const result = await exportTasks(table, [task('ok', 'OK'), task('bad', 'BAD')], sleep);
    expect(result.total).toBe(2);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].taskId).toBe('bad');
    expect([...table.records.values()].map((r) => r.fields[FIELD.taskId])).toEqual(['ok']);
  });
});

describe('config and retry helpers', () => {
  it('requireConfig fails when credentials are missing', () => {
    const prevKey = process.env.AIRTABLE_API_KEY;
    const prevBase = process.env.AIRTABLE_BASE_ID;
    delete process.env.AIRTABLE_API_KEY;
    delete process.env.AIRTABLE_BASE_ID;
    expect(() => requireConfig()).toThrow(ConfigError);
    process.env.AIRTABLE_API_KEY = prevKey;
    process.env.AIRTABLE_BASE_ID = prevBase;
  });

  it('treats 429 as retryable and 401 as not retryable', () => {
    expect(isRetryable({ statusCode: 429 })).toBe(true);
    expect(isRetryable({ statusCode: 401 })).toBe(false);
    expect(isRetryable({ statusCode: 422 })).toBe(false);
  });

  it('maps task UUID into the Task ID field', () => {
    const fields = taskToFields(task('uuid-1', 'Hello'));
    expect(fields[FIELD.taskId]).toBe('uuid-1');
  });
});
