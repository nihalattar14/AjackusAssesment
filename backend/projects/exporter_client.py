import json
import os
import urllib.error
import urllib.request


def _exporter_url():
    return os.environ.get('AIRTABLE_EXPORTER_URL', 'http://localhost:3001').rstrip('/') + '/export'


def serialize_task(task):
    assignee = getattr(task, 'assignee', None)
    created = task.created_at.isoformat() if task.created_at else ''
    return {
        'id': str(task.id),
        'title': task.title,
        'description': task.description,
        'status': task.status,
        'assigneeName': assignee.name if assignee else None,
        'position': task.position,
        'projectId': str(task.project_id),
        'createdAt': created,
    }


def call_airtable_exporter(tasks):
    payload = json.dumps({'tasks': tasks}).encode('utf-8')
    request = urllib.request.Request(
        _exporter_url(),
        data=payload,
        method='POST',
        headers={'Content-Type': 'application/json'},
    )
    timeout = int(os.environ.get('AIRTABLE_EXPORTER_TIMEOUT', '180'))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode('utf-8') or '{}')
            return response.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode('utf-8') if exc.fp else ''
        try:
            body = json.loads(raw) if raw else {'error': exc.reason}
        except json.JSONDecodeError:
            body = {'error': raw or str(exc.reason)}
        if 'error' not in body:
            body['error'] = exc.reason
        return exc.code, body
    except urllib.error.URLError as exc:
        return 503, {'error': f'Airtable exporter unavailable: {exc.reason}'}
    except TimeoutError:
        return 503, {'error': 'Airtable exporter timed out'}
