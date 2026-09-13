from unittest.mock import patch

import pytest
from users.models import User
from projects.models import Project, Membership, Task


def _ok_export(tasks):
    return 200, {
        'total': len(tasks),
        'created': len(tasks),
        'updated': 0,
        'failed': 0,
        'errors': [],
    }


@pytest.mark.django_db
class TestExport:
    def test_admin_can_export(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=user)

        with patch('projects.views.call_airtable_exporter', side_effect=_ok_export) as mocked:
            response = auth_client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 200
        assert response.data['total'] == 1
        assert response.data['created'] == 1
        assert [t['id'] for t in mocked.call_args[0][0]] == [str(task.id)]

    def test_member_can_export(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='member')
        Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        with patch('projects.views.call_airtable_exporter', side_effect=_ok_export):
            response = client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 200

    def test_viewer_cannot_export(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='viewer')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        with patch('projects.views.call_airtable_exporter') as mocked:
            response = client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 403
        mocked.assert_not_called()

    def test_non_member_cannot_export(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        with patch('projects.views.call_airtable_exporter') as mocked:
            response = client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 403
        mocked.assert_not_called()

    def test_unauthenticated_cannot_export(self, client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        response = client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 401

    def test_export_sends_only_this_project_tasks_including_large_set(self, auth_client, user):
        project = Project.objects.create(name='Mine', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        other = User.objects.create_user(email='other@example.com', name='Other', password='password123')
        other_project = Project.objects.create(name='Theirs', owner=other)
        Membership.objects.create(user=other, project=other_project, role='admin')
        Task.objects.create(project=other_project, title='Secret', created_by=other)

        Task.objects.bulk_create([
            Task(project=project, title=f'Task {i}', created_by=user, position=i)
            for i in range(1000)
        ])

        with patch('projects.views.call_airtable_exporter', side_effect=_ok_export) as mocked:
            response = auth_client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 200
        sent = mocked.call_args[0][0]
        assert len(sent) == 1000
        assert {row['projectId'] for row in sent} == {str(project.id)}
        assert 'Secret' not in {row['title'] for row in sent}

    def test_missing_configuration_is_not_reported_as_success(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Task.objects.create(project=project, title='A task', created_by=user)

        with patch('projects.views.call_airtable_exporter', return_value=(503, {'error': 'Airtable is not configured'})):
            response = auth_client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 503
        assert response.data['error'] == 'Airtable is not configured'

    def test_exporter_unavailable_is_not_reported_as_success(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Task.objects.create(project=project, title='A task', created_by=user)

        with patch(
            'projects.views.call_airtable_exporter',
            return_value=(503, {'error': 'Airtable exporter unavailable: Connection refused'}),
        ):
            response = auth_client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 503
        assert 'unavailable' in response.data['error']

    def test_partial_export_returns_failed_records(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Task.objects.create(project=project, title='A task', created_by=user)

        body = {
            'total': 2,
            'created': 1,
            'updated': 0,
            'failed': 1,
            'errors': [{'taskId': 't-bad', 'error': 'invalid'}],
        }
        with patch('projects.views.call_airtable_exporter', return_value=(200, body)):
            response = auth_client.post(f'/api/projects/{project.id}/export')
        assert response.status_code == 200
        assert response.data['failed'] == 1
        assert response.data['created'] == 1
