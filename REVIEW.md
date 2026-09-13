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

---

## 2. Task update has no object-level authorization

- **File:** `backend/projects/views.py`
- **Lines:** 165–185
- **Category:** Object-level authorization
- **Severity:** Critical

`PATCH /api/tasks/:id` loads the task by ID and writes `title`, `description`, `status`, and `assigneeId` with no membership or role check. Default JWT auth only requires any logged-in user. `delete` on the same class does call `_get_membership` and `_can_edit_tasks` (lines 193–197), so this is an omission, not a design choice. Any account can rewrite another team’s board, including viewers and users with no memberships.

**Minimal fix:** After loading the task, resolve membership from `task.project_id`. Return 404/403 if there is no membership. Return 403 unless the role is admin or member. Reuse the same checks as `delete`.

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