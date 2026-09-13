from unittest.mock import patch

import pytest
from rest_framework.test import APIClient
from users.models import User
from projects.models import Project, Membership, Task, TaskComment


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(email='meera@taskboard.dev', name='Meera Iyer', password='password123')


@pytest.fixture
def auth_client(client, user):
    response = client.post('/api/auth/login', {
        'email': 'meera@taskboard.dev',
        'password': 'password123',
    }, format='json')
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['token']}")
    return client


@pytest.mark.django_db
class TestProjects:
    def test_create_project(self, auth_client, user):
        response = auth_client.post('/api/projects', {'name': 'My Project'}, format='json')
        assert response.status_code == 201
        assert response.data['project']['name'] == 'My Project'

    def test_list_only_returns_member_projects(self, auth_client, user):
        p1 = Project.objects.create(name='Mine', owner=user)
        Membership.objects.create(user=user, project=p1, role='admin')
        other = User.objects.create_user(email='other@example.com', name='Other', password='password123')
        p2 = Project.objects.create(name='Not Mine', owner=other)
        Membership.objects.create(user=other, project=p2, role='admin')

        response = auth_client.get('/api/projects')
        assert response.status_code == 200
        names = [p['name'] for p in response.data['projects']]
        assert 'Mine' in names
        assert 'Not Mine' not in names

    def test_get_project_detail(self, auth_client, user):
        project = Project.objects.create(name='My Project', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        response = auth_client.get(f'/api/projects/{project.id}')
        assert response.status_code == 200
        assert response.data['project']['name'] == 'My Project'

    def test_non_member_cannot_view_project(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='Private', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.get(f'/api/projects/{project.id}')
        assert response.status_code == 403


@pytest.mark.django_db
class TestTasks:
    def test_create_task(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        response = auth_client.post(f'/api/projects/{project.id}/tasks', {'title': 'Do a thing'}, format='json')
        assert response.status_code == 201
        assert response.data['task']['title'] == 'Do a thing'

    def test_viewers_cannot_create_tasks(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='viewer')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.post(f'/api/projects/{project.id}/tasks', {'title': 'A task'}, format='json')
        assert response.status_code == 403

    def test_delete_task_requires_membership(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.delete(f'/api/tasks/{task.id}')
        assert response.status_code == 403
    def test_search_filters_tasks_by_title_or_description(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Task.objects.create(project=project, title='Fix login button', description='ui polish', created_by=user)
        Task.objects.create(project=project, title='Write docs', description='covers authentication flow', created_by=user)
        Task.objects.create(project=project, title='Unrelated', description='other', created_by=user)

        by_title = auth_client.get(f'/api/projects/{project.id}/tasks', {'q': 'login'})
        assert by_title.status_code == 200
        assert [t['title'] for t in by_title.data['tasks']] == ['Fix login button']

        by_description = auth_client.get(f'/api/projects/{project.id}/tasks', {'q': 'authentication'})
        assert by_description.status_code == 200
        assert [t['title'] for t in by_description.data['tasks']] == ['Write docs']

    def test_search_treats_sql_payload_as_literal_text(self, auth_client, user):
        project = Project.objects.create(name='Mine', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Task.objects.create(project=project, title='Safe task', description='normal', created_by=user)

        other = User.objects.create_user(email='other@example.com', name='Other', password='password123')
        other_project = Project.objects.create(name='Theirs', owner=other)
        Membership.objects.create(user=other, project=other_project, role='admin')
        Task.objects.create(project=other_project, title='Secret task', description='should not leak', created_by=other)

        response = auth_client.get(
            f'/api/projects/{project.id}/tasks',
            {'q': "%' OR 1=1 --"},
        )
        assert response.status_code == 200
        titles = [t['title'] for t in response.data['tasks']]
        assert 'Secret task' not in titles
        assert titles == []

    def test_non_member_cannot_patch_task(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.patch(f'/api/tasks/{task.id}', {'title': 'Hacked'}, format='json')
        assert response.status_code == 403
        task.refresh_from_db()
        assert task.title == 'A task'

    def test_viewers_cannot_patch_tasks(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='viewer')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.patch(f'/api/tasks/{task.id}', {'title': 'Hacked'}, format='json')
        assert response.status_code == 403
        task.refresh_from_db()
        assert task.title == 'A task'

    def test_member_can_patch_task(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='member')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.patch(f'/api/tasks/{task.id}', {'title': 'Updated'}, format='json')
        assert response.status_code == 200
        assert response.data['task']['title'] == 'Updated'

    def test_admin_can_patch_task(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=user)

        response = auth_client.patch(f'/api/tasks/{task.id}', {'title': 'Updated'}, format='json')
        assert response.status_code == 200
        assert response.data['task']['title'] == 'Updated'

@pytest.mark.django_db
class TestComments:
    def test_admin_can_post_comment(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=user)

        response = auth_client.post(
            f'/api/tasks/{task.id}/comments',
            {'body': 'Looks good'},
            format='json',
        )
        assert response.status_code == 201
        assert response.data['comment']['body'] == 'Looks good'
        assert response.data['comment']['author']['id'] == str(user.id)

    def test_member_can_post_comment(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='member')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.post(
            f'/api/tasks/{task.id}/comments',
            {'body': 'Starting this'},
            format='json',
        )
        assert response.status_code == 201
        assert response.data['comment']['body'] == 'Starting this'

    def test_viewer_can_list_but_cannot_post_comment(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='viewer')
        task = Task.objects.create(project=project, title='A task', created_by=owner)
        TaskComment.objects.create(task=task, author=owner, body='Existing note')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        listed = client.get(f'/api/tasks/{task.id}/comments')
        assert listed.status_code == 200
        assert [c['body'] for c in listed.data['comments']] == ['Existing note']

        posted = client.post(
            f'/api/tasks/{task.id}/comments',
            {'body': 'Viewer should not post'},
            format='json',
        )
        assert posted.status_code == 403
        assert TaskComment.objects.filter(task=task).count() == 1

    def test_non_member_cannot_list_or_post_comments(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        listed = client.get(f'/api/tasks/{task.id}/comments')
        assert listed.status_code == 403

        posted = client.post(
            f'/api/tasks/{task.id}/comments',
            {'body': 'Hacked'},
            format='json',
        )
        assert posted.status_code == 403
        assert TaskComment.objects.filter(task=task).count() == 0

    def test_comments_listed_chronologically(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=user)
        TaskComment.objects.create(task=task, author=user, body='First')
        TaskComment.objects.create(task=task, author=user, body='Second')

        response = auth_client.get(f'/api/tasks/{task.id}/comments')
        assert response.status_code == 200
        assert [c['body'] for c in response.data['comments']] == ['First', 'Second']