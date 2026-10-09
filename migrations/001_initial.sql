-- Private schema: do not add "teluria" to Supabase's exposed Data API schemas.
CREATE SCHEMA IF NOT EXISTS teluria;
REVOKE ALL ON SCHEMA teluria FROM PUBLIC;

CREATE TABLE IF NOT EXISTS teluria.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teluria.projects (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT projects_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = id)
);

CREATE TABLE teluria.users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT users_payload_identity CHECK (data->>'id' = id AND data->>'email' = email)
);

CREATE TABLE teluria.sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES teluria.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT sessions_payload_identity CHECK (data->>'id' = id AND data->>'user_id' = user_id AND data->>'token_hash' = token_hash)
);
CREATE INDEX sessions_user_id_idx ON teluria.sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON teluria.sessions(expires_at);

CREATE TABLE teluria.members (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  user_id text NOT NULL REFERENCES teluria.users(id),
  role text NOT NULL CHECK (role IN ('owner', 'architect', 'collaborator', 'client')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT members_unique_user UNIQUE (project_id, user_id),
  CONSTRAINT members_project_id_id UNIQUE (project_id, id),
  CONSTRAINT members_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'user_id' = user_id AND data->>'role' = role)
);
CREATE UNIQUE INDEX members_one_owner_idx ON teluria.members(project_id) WHERE role = 'owner';

CREATE TABLE teluria.invitations (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT invitations_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'token_hash' = token_hash)
);
CREATE INDEX invitations_project_id_idx ON teluria.invitations(project_id);

CREATE TABLE teluria.tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  assignee_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT tasks_project_id_id UNIQUE (project_id, id),
  CONSTRAINT tasks_assignee_fk FOREIGN KEY (project_id, assignee_id) REFERENCES teluria.members(project_id, user_id),
  CONSTRAINT tasks_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND nullif(data->>'assignee_id','') IS NOT DISTINCT FROM assignee_id)
);
CREATE INDEX tasks_project_id_idx ON teluria.tasks(project_id);

CREATE TABLE teluria.milestones (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT milestones_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX milestones_project_id_idx ON teluria.milestones(project_id);

CREATE TABLE teluria.documents (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  previous_version_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT documents_project_id_id UNIQUE (project_id, id),
  CONSTRAINT documents_predecessor_fk FOREIGN KEY (project_id, previous_version_id) REFERENCES teluria.documents(project_id, id),
  CONSTRAINT documents_predecessor_unique UNIQUE (previous_version_id),
  CONSTRAINT documents_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND nullif(data->>'previous_version_id','') IS NOT DISTINCT FROM previous_version_id)
);
CREATE INDEX documents_project_id_idx ON teluria.documents(project_id);

CREATE TABLE teluria.issues (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT issues_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX issues_project_id_idx ON teluria.issues(project_id);

CREATE TABLE teluria.budget_items (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT budget_items_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX budget_items_project_id_idx ON teluria.budget_items(project_id);

CREATE TABLE teluria.approvals (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  document_id text NOT NULL,
  reviewer_id text,
  decided_by text REFERENCES teluria.users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT approvals_document_fk FOREIGN KEY (project_id, document_id) REFERENCES teluria.documents(project_id, id),
  CONSTRAINT approvals_reviewer_fk FOREIGN KEY (project_id, reviewer_id) REFERENCES teluria.members(project_id, user_id),
  CONSTRAINT approvals_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'document_id' = document_id AND nullif(data->>'reviewer_id','') IS NOT DISTINCT FROM reviewer_id)
);
CREATE INDEX approvals_project_id_idx ON teluria.approvals(project_id);

CREATE TABLE teluria.calendar_events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT calendar_events_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX calendar_events_project_id_idx ON teluria.calendar_events(project_id);

CREATE TABLE teluria.task_dependencies (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  predecessor_id text NOT NULL,
  successor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT task_dependencies_predecessor_fk FOREIGN KEY (project_id, predecessor_id) REFERENCES teluria.tasks(project_id, id),
  CONSTRAINT task_dependencies_successor_fk FOREIGN KEY (project_id, successor_id) REFERENCES teluria.tasks(project_id, id),
  CONSTRAINT task_dependencies_distinct CHECK (predecessor_id <> successor_id),
  CONSTRAINT task_dependencies_pair_unique UNIQUE (project_id, predecessor_id, successor_id),
  CONSTRAINT task_dependencies_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'predecessor_id' = predecessor_id AND data->>'successor_id' = successor_id)
);
CREATE INDEX task_dependencies_project_id_idx ON teluria.task_dependencies(project_id);

CREATE TABLE teluria.deliverable_packages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT deliverable_packages_project_id_id UNIQUE (project_id, id),
  CONSTRAINT deliverable_packages_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX deliverable_packages_project_id_idx ON teluria.deliverable_packages(project_id);

CREATE TABLE teluria.deliverable_package_documents (
  project_id text NOT NULL REFERENCES teluria.projects(id),
  package_id text NOT NULL,
  document_id text NOT NULL,
  PRIMARY KEY (package_id, document_id),
  CONSTRAINT package_documents_package_fk FOREIGN KEY (project_id, package_id) REFERENCES teluria.deliverable_packages(project_id, id) ON DELETE CASCADE,
  CONSTRAINT package_documents_document_fk FOREIGN KEY (project_id, document_id) REFERENCES teluria.documents(project_id, id)
);
CREATE INDEX package_documents_document_id_idx ON teluria.deliverable_package_documents(document_id);

CREATE TABLE teluria.comments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  author_id text NOT NULL REFERENCES teluria.users(id),
  target_task_id text,
  target_document_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT comments_task_fk FOREIGN KEY (project_id, target_task_id) REFERENCES teluria.tasks(project_id, id),
  CONSTRAINT comments_document_fk FOREIGN KEY (project_id, target_document_id) REFERENCES teluria.documents(project_id, id),
  CONSTRAINT comments_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'author_id' = author_id)
);
CREATE INDEX comments_project_id_idx ON teluria.comments(project_id);

CREATE TABLE teluria.blueprints (
  id text PRIMARY KEY,
  project_id text NOT NULL UNIQUE REFERENCES teluria.projects(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT blueprints_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);

CREATE TABLE teluria.activities (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  actor_id text REFERENCES teluria.users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT activities_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id)
);
CREATE INDEX activities_project_created_idx ON teluria.activities(project_id, created_at DESC);

CREATE TABLE teluria.notifications (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES teluria.projects(id),
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  CONSTRAINT notifications_recipient_fk FOREIGN KEY (project_id, user_id) REFERENCES teluria.members(project_id, user_id) ON DELETE CASCADE,
  CONSTRAINT notifications_payload_identity CHECK (data->>'id' = id AND data->>'project_id' = project_id AND data->>'user_id' = user_id)
);
CREATE INDEX notifications_recipient_idx ON teluria.notifications(user_id, project_id, created_at DESC);
