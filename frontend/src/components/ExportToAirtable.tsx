import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AirtableExportResult } from "@/types";

type Props = {
  projectId: string;
  canExport: boolean;
};

export function ExportToAirtable({ projectId, canExport }: Props) {
  const [summary, setSummary] = useState<AirtableExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: () =>
      apiFetch<AirtableExportResult>(`/api/projects/${projectId}/export`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setError(null);
      setSummary(data);
    },
    onError: (err) => {
      setSummary(null);
      setError(err instanceof Error ? err.message : "export failed");
    },
  });

  if (!canExport) {
    return (
      <button
        type="button"
        disabled
        className="text-sm px-4 py-2 rounded-md border border-border text-muted cursor-not-allowed"
      >
        Export to Airtable
      </button>
    );
  }

  const pending = exportMutation.isPending;

  return (
    <div className="text-right max-w-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setSummary(null);
          exportMutation.mutate();
        }}
        className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Exporting…" : "Export to Airtable"}
      </button>
      {pending && (
        <p className="text-xs text-muted mt-2">exporting tasks…</p>
      )}
      {error && (
        <p className="text-sm text-red-400 mt-2" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <p className="text-sm mt-2" role="status">
          {summary.failed > 0
            ? `Exported ${summary.created + summary.updated} of ${summary.total} tasks (${summary.created} created, ${summary.updated} updated, ${summary.failed} failed).`
            : `Exported ${summary.total} tasks (${summary.created} created, ${summary.updated} updated).`}
          {summary.errors?.[0] ? ` ${summary.errors[0].error}` : ""}
        </p>
      )}
    </div>
  );
}
