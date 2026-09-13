import type { AirtableRecord, AirtableTable } from '../types.ts';

type FailMode = {
  statusCode: number;
  message: string;
  remaining: number;
  taskIds?: Set<string>;
};

/**
 * In-memory Airtable table for unit tests only. Never used by production server.ts.
 */
export class MockAirtableTable implements AirtableTable {
  records = new Map<string, AirtableRecord>();
  createCalls = 0;
  updateCalls = 0;
  selectCalls = 0;
  failNextCreate: FailMode | null = null;
  failNextUpdate: FailMode | null = null;
  failSelect: FailMode | null = null;

  constructor(existing: AirtableRecord[] = []) {
    for (const rec of existing) this.records.set(rec.id, rec);
  }

  async selectAll(): Promise<AirtableRecord[]> {
    this.selectCalls += 1;
    if (this.failSelect && this.failSelect.remaining > 0) {
      this.failSelect.remaining -= 1;
      throw Object.assign(new Error(this.failSelect.message), {
        statusCode: this.failSelect.statusCode,
      });
    }
    return [...this.records.values()];
  }

  async create(fieldsList: Record<string, unknown>[]): Promise<AirtableRecord[]> {
    this.createCalls += 1;
    this._maybeFail(this.failNextCreate, fieldsList.map((f) => String(f['Task ID'] ?? '')));
    const created: AirtableRecord[] = [];
    for (const fields of fieldsList) {
      const id = `rec_${this.records.size + 1}_${String(fields['Task ID'])}`;
      const rec = { id, fields: { ...fields } };
      this.records.set(id, rec);
      created.push(rec);
    }
    return created;
  }

  async update(rows: { id: string; fields: Record<string, unknown> }[]): Promise<AirtableRecord[]> {
    this.updateCalls += 1;
    this._maybeFail(
      this.failNextUpdate,
      rows.map((r) => String(r.fields['Task ID'] ?? this.records.get(r.id)?.fields['Task ID'] ?? '')),
    );
    const updated: AirtableRecord[] = [];
    for (const row of rows) {
      const current = this.records.get(row.id);
      if (!current) {
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      }
      const rec = { id: row.id, fields: { ...current.fields, ...row.fields } };
      this.records.set(row.id, rec);
      updated.push(rec);
    }
    return updated;
  }

  private _maybeFail(mode: FailMode | null, taskIds: string[]) {
    if (!mode || mode.remaining <= 0) return;
    if (mode.taskIds && !taskIds.some((id) => mode.taskIds!.has(id))) return;
    mode.remaining -= 1;
    throw Object.assign(new Error(mode.message), { statusCode: mode.statusCode });
  }
}
