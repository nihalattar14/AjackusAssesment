import Airtable from 'airtable';
import type { AirtableRecord, AirtableTable } from './types.ts';

export function createRealTable(apiKey: string, baseId: string, tableName: string): AirtableTable {
  const table = new Airtable({ apiKey }).base(baseId)(tableName);

  return {
    async selectAll() {
      const records: AirtableRecord[] = [];
      await table.select({ pageSize: 100 }).eachPage((page, next) => {
        for (const rec of page) {
          records.push({ id: rec.id, fields: rec.fields as Record<string, unknown> });
        }
        next();
      });
      return records;
    },
    async create(fieldsList) {
      const created = await table.create(fieldsList.map((fields) => ({ fields })));
      return created.map((rec) => ({
        id: rec.id,
        fields: rec.fields as Record<string, unknown>,
      }));
    },
    async update(rows) {
      const updated = await table.update(rows.map((row) => ({ id: row.id, fields: row.fields })));
      return updated.map((rec) => ({
        id: rec.id,
        fields: rec.fields as Record<string, unknown>,
      }));
    },
  };
}
