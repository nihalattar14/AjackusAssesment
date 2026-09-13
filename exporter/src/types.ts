export type TaskPayload = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeName: string | null;
  position: number;
  projectId: string;
  createdAt: string;
};

export type RecordError = {
  taskId: string;
  error: string;
};

export type ExportResult = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: RecordError[];
};

export type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

export type AirtableTable = {
  selectAll(): Promise<AirtableRecord[]>;
  create(fieldsList: Record<string, unknown>[]): Promise<AirtableRecord[]>;
  update(rows: { id: string; fields: Record<string, unknown> }[]): Promise<AirtableRecord[]>;
};

export const FIELD = {
  taskId: 'Task ID',
  title: 'Title',
  description: 'Description',
  status: 'Status',
  assignee: 'Assignee',
  position: 'Position',
  projectId: 'Project ID',
  createdAt: 'Created At',
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
