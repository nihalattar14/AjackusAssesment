import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskDetail } from "@/components/TaskDetail";
import type { ApiProjectMember, ApiTask } from "@/types";
import { clearSession, setSession, apiFetch } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

const mockedFetch = vi.mocked(apiFetch);

const baseTask: ApiTask = {
  id: "t_1",
  projectId: "p_1",
  title: "Set up analytics",
  description: null,
  status: "todo",
  assigneeId: "u_1",
  createdById: "u_1",
  position: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assignee: { id: "u_1", name: "Meera Iyer", email: "meera@taskboard.dev" },
};

const meera = { id: "u_1", email: "meera@taskboard.dev", name: "Meera Iyer" };

function member(role: ApiProjectMember["role"]): ApiProjectMember {
  return { id: "m_1", role, user: meera };
}

function renderDetail(members: ApiProjectMember[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskDetail task={baseTask} projectId="p_1" members={members} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("<TaskDetail /> comments", () => {
  beforeEach(() => {
    clearSession();
    setSession("tok", meera);
    mockedFetch.mockResolvedValue({
      comments: [
        {
          id: "c_1",
          task_id: "t_1",
          body: "Existing note",
          created_at: new Date().toISOString(),
          author: meera,
        },
      ],
    });
  });

  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("lists comments chronologically for a member and shows the composer", async () => {
    renderDetail([member("member")]);
    await waitFor(() => {
      expect(screen.getByText("Existing note")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("write a comment")).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith("/api/tasks/t_1/comments");
  });

  it("lets a viewer read comments but not post", async () => {
    renderDetail([member("viewer")]);
    await waitFor(() => {
      expect(screen.getByText("Existing note")).toBeInTheDocument();
    });
    expect(screen.getByText("viewers can read comments but cannot post")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("write a comment")).not.toBeInTheDocument();
  });
});