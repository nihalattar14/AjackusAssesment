import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExportToAirtable } from "@/components/ExportToAirtable";
import { apiFetch } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

const mockedFetch = vi.mocked(apiFetch);

function renderExport(canExport: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExportToAirtable projectId="p_1" canExport={canExport} />
    </QueryClientProvider>,
  );
}

describe("<ExportToAirtable />", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a disabled export action for viewers", () => {
    renderExport(false);
    const button = screen.getByRole("button", { name: "Export to Airtable" });
    expect(button).toBeDisabled();
  });

  it("shows loading then a success summary", async () => {
    let resolveExport!: (value: {
      total: number;
      created: number;
      updated: number;
      failed: number;
      errors: [];
    }) => void;
    mockedFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    renderExport(true);
    fireEvent.click(screen.getByRole("button", { name: "Export to Airtable" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    });
    resolveExport({
      total: 3,
      created: 3,
      updated: 0,
      failed: 0,
      errors: [],
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Exported 3 tasks (3 created, 0 updated).",
      );
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith("/api/projects/p_1/export", { method: "POST" });
  });

  it("shows a partial-failure summary", async () => {
    mockedFetch.mockResolvedValue({
      total: 2,
      created: 1,
      updated: 0,
      failed: 1,
      errors: [{ taskId: "t-bad", error: "invalid field" }],
    });
    renderExport(true);
    fireEvent.click(screen.getByRole("button", { name: "Export to Airtable" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 failed");
    });
    expect(screen.getByRole("status")).toHaveTextContent("invalid field");
  });

  it("shows a failed request error", async () => {
    mockedFetch.mockRejectedValue(new Error("Airtable is not configured"));
    renderExport(true);
    fireEvent.click(screen.getByRole("button", { name: "Export to Airtable" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Airtable is not configured");
    });
  });
});
