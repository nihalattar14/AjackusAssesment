# Backend security review — highest-impact issues

Scope: object-level authorization, SQL injection, cross-project data integrity, missing server-side validation.
Source of truth: current `backend/projects/views.py`. Ranked by business impact. No invented issues.

---

## 1. Task search interpolates user input into raw SQL

- **File:** `backend/projects/views.py`
- **Lines:** 110–123
- **Category:** SQL injection
- **Severity:** Critical

`GET /api/projects/:id/tasks?q=` builds SQL with f-strings. `q` is copied from the query string into `ILIKE`. A member of any one project can break out of that clause (for example `%' OR 1=1 --`) and read every row in `tasks`, including other projects. That is a full confidentiality break on the product’s core data. `project_id` is a URL-converted UUID, so it is not a practical second injection vector; `q` is.

**Minimal fix:** Stop using a raw cursor. Filter with the ORM, e.g. `Task.objects.filter(project_id=project_id).filter(Q(title__icontains=q) | Q(description__icontains=q))`. If SQL is kept, use `cursor.execute(...)` with placeholders only — never interpolate `q` into the string.

**Curl Commands**
1. curl.exe -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{\"email\":\"meera@taskboard.dev\",\"password\":\"password123\"}'      
2. curl.exe -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzkxODg3MTc4LCJpYXQiOjE3ODkyOTUxNzgsImp0aSI6IjM2YTBlZjUxYjNkOTQzYjU4YmMzOGUwYmVlNGM1Y2EzIiwidXNlcl9pZCI6IjU5Mjc1MjE4LTk4NDYtNDFiNS04NDlhLTUxYzFiOGUxM2M1NiJ9._XzXP77Zh5leS68IiDc9YB2UoNkn25Ewd_CKKK1jTNk" http://localhost:8000/api/projects
**Response**
{
  "projects": [
    {
      "id": "d4b8dfe3-c286-43b2-ae10-f4e0d03fa33d",
      "name": "Internal Tools Cleanup",
      "description": "Retire legacy admin tools and consolidate into the new console.",
      "role": "admin",
      "owner": {
        "id": "59275218-9846-41b5-849a-51c1b8e13c56",
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      },
      "taskCount": 0,
      "createdAt": "2026-09-13T08:38:01.684624+00:00"
    },
    {
      "id": "5caf3efc-503a-4607-8561-a4925c4b04cc",
      "name": "Customer Onboarding Revamp",
      "description": "Reduce time-to-first-value from 9 days to under 3 days.",
      "role": "member",
      "owner": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      },
      "taskCount": 5,
      "createdAt": "2026-09-13T08:38:01.662096+00:00"
    },
    {
      "id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "name": "Q3 Launch",
      "description": "Coordinate the Q3 product launch across engineering, design, and marketing.",
      "role": "admin",
      "owner": {
        "id": "59275218-9846-41b5-849a-51c1b8e13c56",
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      },
      "taskCount": 7,
      "createdAt": "2026-09-13T08:38:01.634213+00:00"
    }
  ]
}

---

## 2. Task update has no object-level authorization

- **File:** `backend/projects/views.py`
- **Lines:** 165–185
- **Category:** Object-level authorization
- **Severity:** Critical

`PATCH /api/tasks/:id` loads the task by ID and writes `title`, `description`, `status`, and `assigneeId` with no membership or role check. Default JWT auth only requires any logged-in user. `delete` on the same class does call `_get_membership` and `_can_edit_tasks` (lines 193–197), so this is an omission, not a design choice. Any account can rewrite another team’s board, including viewers and users with no memberships.

**Minimal fix:** After loading the task, resolve membership from `task.project_id`. Return 404/403 if there is no membership. Return 403 unless the role is admin or member. Reuse the same checks as `delete`.

**Curl Commands**

$meera = curl.exe -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{\"email\":\"meera@taskboard.dev\",\"password\":\"password123\"}' | ConvertFrom-Json
$kavya = curl.exe -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{\"email\":\"kavya@example.com\",\"password\":\"password123\"}' | ConvertFrom-Json
$dev   = curl.exe -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{\"email\":\"dev@example.com\",\"password\":\"password123\"}' | ConvertFrom-Json
$lina  = curl.exe -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{\"email\":\"lina@example.com\",\"password\":\"password123\"}' | ConvertFrom-Json

$projects = curl.exe -s -H "Authorization: Bearer $($meera.token)" http://localhost:8000/api/projects | ConvertFrom-Json
$projectId = ($projects.projects | Where-Object { $_.name -eq "Q3 Launch" }).id

$tasks = curl.exe -s -H "Authorization: Bearer $($meera.token)" "http://localhost:8000/api/projects/$projectId/tasks" | ConvertFrom-Json
$taskId = $tasks.tasks[0].id
$taskId

$body = '{"title":"Updated by admin"}'
curl.exe -s -X PATCH "http://localhost:8000/api/tasks/$taskId" -H "Authorization: Bearer $($meera.token)" -H "Content-Type: application/json" --data-raw $body
$memberBody = '{"title":"Updated by member"}'
curl.exe -s -X PATCH "http://localhost:8000/api/tasks/$taskId" -H "Authorization: Bearer $($kavya.token)" -H "Content-Type: application/json" --data-raw $memberBody

$viewerBody = '{"title":"Hacked by viewer"}'
curl.exe -s -X PATCH "http://localhost:8000/api/tasks/$taskId" -H "Authorization: Bearer $($dev.token)" -H "Content-Type: application/json" --data-raw $viewerBody
curl.exe -s -H "Authorization: Bearer $($meera.token)" "http://localhost:8000/api/projects/$projectId/tasks"

$outsiderBody = '{"title":"Hacked by outsider"}'
curl.exe -s -X PATCH "http://localhost:8000/api/tasks/$taskId" -H "Authorization: Bearer $($lina.token)" -H "Content-Type: application/json" --data-raw $outsiderBody
curl.exe -s -H "Authorization: Bearer $($meera.token)" "http://localhost:8000/api/projects/$projectId/tasks"

curl.exe -s -H "Authorization: Bearer $($meera.token)" "http://localhost:8000/api/projects/$projectId/tasks"

**Response**
4dbbb7d1-23ac-4762-9374-4bcdae02c685{
  "detail": "JSON parse error - Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"
}{
  "detail": "JSON parse error - Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"
}{
  "error": "viewers cannot update tasks"
}{
  "tasks": [
    {
      "id": "4dbbb7d1-23ac-4762-9374-4bcdae02c685",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Finalize launch date with marketing",
      "description": "Detail for: Finalize launch date with marketing",
      "status": "done",
      "assignee_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 0,
      "created_at": "2026-09-13T08:38:01.692087Z",
      "updated_at": "2026-09-13T08:38:01.692105Z",
      "assignee": {
        "id": "59275218-9846-41b5-849a-51c1b8e13c56",
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      }
    },
    {
      "id": "bcc796d2-6ccc-408a-8d0e-9c2e9ec1b237",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Record demo video",
      "description": "Detail for: Record demo video",
      "status": "in_progress",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 2,
      "created_at": "2026-09-13T08:38:01.699835Z",
      "updated_at": "2026-09-13T08:38:01.699848Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "8b18b20f-2ab9-4cb2-8981-3eb85ff1598b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Set up analytics dashboards",
      "description": "Detail for: Set up analytics dashboards",
      "status": "in_progress",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 3,
      "created_at": "2026-09-13T08:38:01.705260Z",
      "updated_at": "2026-09-13T08:38:01.705286Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "701eb891-6735-439f-b729-30b536ae51c4",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Draft press release",
      "description": "Detail for: Draft press release",
      "status": "review",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 1,
      "created_at": "2026-09-13T08:38:01.696257Z",
      "updated_at": "2026-09-13T08:38:01.696273Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "ac214a8c-ab47-4428-b441-7bca96ab202e",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Prepare customer email blast",
      "description": "Detail for: Prepare customer email blast",
      "status": "todo",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 4,
      "created_at": "2026-09-13T08:38:01.710176Z",
      "updated_at": "2026-09-13T08:38:01.710194Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "6eed0327-a4b4-4ac6-a402-71802d387b7b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Update pricing page copy",
      "description": "Detail for: Update pricing page copy",
      "status": "todo",
      "assignee_id": null,
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 5,
      "created_at": "2026-09-13T08:38:01.714321Z",
      "updated_at": "2026-09-13T08:38:01.714349Z",
      "assignee": null
    },
    {
      "id": "05cae316-ec8f-4eb9-b276-8ccbc97bf484",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "QA the new signup flow end-to-end",
      "description": "Detail for: QA the new signup flow end-to-end",
      "status": "todo",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 6,
      "created_at": "2026-09-13T08:38:01.717850Z",
      "updated_at": "2026-09-13T08:38:01.717863Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    }
  ]
}{
  "error": "forbidden"
}{
  "tasks": [
    {
      "id": "4dbbb7d1-23ac-4762-9374-4bcdae02c685",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Finalize launch date with marketing",
      "description": "Detail for: Finalize launch date with marketing",
      "status": "done",
      "assignee_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 0,
      "created_at": "2026-09-13T08:38:01.692087Z",
      "updated_at": "2026-09-13T08:38:01.692105Z",
      "assignee": {
        "id": "59275218-9846-41b5-849a-51c1b8e13c56",
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      }
    },
    {
      "id": "bcc796d2-6ccc-408a-8d0e-9c2e9ec1b237",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Record demo video",
      "description": "Detail for: Record demo video",
      "status": "in_progress",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 2,
      "created_at": "2026-09-13T08:38:01.699835Z",
      "updated_at": "2026-09-13T08:38:01.699848Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "8b18b20f-2ab9-4cb2-8981-3eb85ff1598b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Set up analytics dashboards",
      "description": "Detail for: Set up analytics dashboards",
      "status": "in_progress",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 3,
      "created_at": "2026-09-13T08:38:01.705260Z",
      "updated_at": "2026-09-13T08:38:01.705286Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "701eb891-6735-439f-b729-30b536ae51c4",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Draft press release",
      "description": "Detail for: Draft press release",
      "status": "review",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 1,
      "created_at": "2026-09-13T08:38:01.696257Z",
      "updated_at": "2026-09-13T08:38:01.696273Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "ac214a8c-ab47-4428-b441-7bca96ab202e",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Prepare customer email blast",
      "description": "Detail for: Prepare customer email blast",
      "status": "todo",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 4,
      "created_at": "2026-09-13T08:38:01.710176Z",
      "updated_at": "2026-09-13T08:38:01.710194Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "6eed0327-a4b4-4ac6-a402-71802d387b7b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Update pricing page copy",
      "description": "Detail for: Update pricing page copy",
      "status": "todo",
      "assignee_id": null,
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 5,
      "created_at": "2026-09-13T08:38:01.714321Z",
      "updated_at": "2026-09-13T08:38:01.714349Z",
      "assignee": null
    },
    {
      "id": "05cae316-ec8f-4eb9-b276-8ccbc97bf484",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "QA the new signup flow end-to-end",
      "description": "Detail for: QA the new signup flow end-to-end",
      "status": "todo",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 6,
      "created_at": "2026-09-13T08:38:01.717850Z",
      "updated_at": "2026-09-13T08:38:01.717863Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    }
  ]
}{
  "tasks": [
    {
      "id": "4dbbb7d1-23ac-4762-9374-4bcdae02c685",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Finalize launch date with marketing",
      "description": "Detail for: Finalize launch date with marketing",
      "status": "done",
      "assignee_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 0,
      "created_at": "2026-09-13T08:38:01.692087Z",
      "updated_at": "2026-09-13T08:38:01.692105Z",
      "assignee": {
        "id": "59275218-9846-41b5-849a-51c1b8e13c56",
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      }
    },
    {
      "id": "bcc796d2-6ccc-408a-8d0e-9c2e9ec1b237",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Record demo video",
      "description": "Detail for: Record demo video",
      "status": "in_progress",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 2,
      "created_at": "2026-09-13T08:38:01.699835Z",
      "updated_at": "2026-09-13T08:38:01.699848Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "8b18b20f-2ab9-4cb2-8981-3eb85ff1598b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Set up analytics dashboards",
      "description": "Detail for: Set up analytics dashboards",
      "status": "in_progress",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 3,
      "created_at": "2026-09-13T08:38:01.705260Z",
      "updated_at": "2026-09-13T08:38:01.705286Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "701eb891-6735-439f-b729-30b536ae51c4",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Draft press release",
      "description": "Detail for: Draft press release",
      "status": "review",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 1,
      "created_at": "2026-09-13T08:38:01.696257Z",
      "updated_at": "2026-09-13T08:38:01.696273Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    },
    {
      "id": "ac214a8c-ab47-4428-b441-7bca96ab202e",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Prepare customer email blast",
      "description": "Detail for: Prepare customer email blast",
      "status": "todo",
      "assignee_id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 4,
      "created_at": "2026-09-13T08:38:01.710176Z",
      "updated_at": "2026-09-13T08:38:01.710194Z",
      "assignee": {
        "id": "ad575e18-96c8-4c61-8f14-c7d50630a52d",
        "email": "kavya@example.com",
        "name": "Kavya Reddy"
      }
    },
    {
      "id": "6eed0327-a4b4-4ac6-a402-71802d387b7b",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "Update pricing page copy",
      "description": "Detail for: Update pricing page copy",
      "status": "todo",
      "assignee_id": null,
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 5,
      "created_at": "2026-09-13T08:38:01.714321Z",
      "updated_at": "2026-09-13T08:38:01.714349Z",
      "assignee": null
    },
    {
      "id": "05cae316-ec8f-4eb9-b276-8ccbc97bf484",
      "project_id": "184cd94d-f8cb-41c5-b107-afb20182c533",
      "title": "QA the new signup flow end-to-end",
      "description": "Detail for: QA the new signup flow end-to-end",
      "status": "todo",
      "assignee_id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
      "created_by_id": "59275218-9846-41b5-849a-51c1b8e13c56",
      "position": 6,
      "created_at": "2026-09-13T08:38:01.717850Z",
      "updated_at": "2026-09-13T08:38:01.717863Z",
      "assignee": {
        "id": "bed410a3-276a-4bd9-a661-dcb39fe0b89b",
        "email": "arjun@taskboard.dev",
        "name": "Arjun Rao"
      }
    }
  ]
}
---

## 3. Assignee can be any user in the system, not a project member

- **File:** `backend/projects/views.py`
- **Lines:** 151–157 (create) and 180–182 (update)
- **Category:** Cross-project data integrity
- **Severity:** High

`assignee_id` is taken from `assigneeId` and saved with no check that the user exists or has a `Membership` on that project. Combined with issue 2, an outsider can also attach tasks to arbitrary accounts. Tasks then point at people who are not on the project. Serialized `assignee` includes `email` and `name`, so identity leaks across project boundaries and “this board’s team” is no longer a data invariant.

**Minimal fix:** If `assigneeId` is set, require `Membership.objects.filter(project_id=..., user_id=assigneeId).exists()`. Otherwise return 400. Allow clear-assignee only via `null`. Apply this in both `post` and `patch`.

---

## 4. Mutating endpoints skip the field rules create already uses

- **File:** `backend/projects/views.py`
- **Lines:** 83–87 (project PATCH); 140–142 and 171–172 (task title)
- **Category:** Missing server-side validation
- **Severity:** High

`POST /api/projects` rejects an empty `name` and a `name` longer than 120 (lines 47–48). `PATCH` assigns `request.data['name'].strip()` with no equivalent check, so an admin can empty the name or send a string longer than `CharField(max_length=120)`. Django does not enforce `max_length` on `save()`; PostgreSQL then raises an unhandled `DataError` (HTTP 500). Task create only checks a non-empty title, not `max_length=500`. Task PATCH does not even require a non-empty title. Clients can wipe titles/names or trigger 500s; the API does not enforce the model contract.

**Minimal fix:** Share one validator: name 1–120 characters; title 1–500 characters after strip. On PATCH, if the field is present and invalid, return 400 and do not save. Call the same helper from create and update.

---

## Out of scope (confirmed, not counted)

- Task **delete**, project list/detail/create-task, members, and export already check membership.
- JWT lifetime, CORS, and Airtable export being a stub are not in this review’s four categories.