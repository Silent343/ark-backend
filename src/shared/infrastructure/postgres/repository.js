import { fail } from "../../../errors.js";

// SQL identifiers are exclusively selected from this server-owned allowlist.
const relationships = Object.freeze({
  projects: {},
  users: { email: (row) => row.email },
  sessions: { user_id: (row) => row.user_id, token_hash: (row) => row.token_hash, expires_at: (row) => row.expires_at },
  members: { user_id: (row) => row.user_id, role: (row) => row.role },
  invitations: { email: (row) => row.email, token_hash: (row) => row.token_hash, status: (row) => row.status, expires_at: (row) => row.expires_at },
  tasks: { assignee_id: (row) => row.assignee_id || null },
  milestones: {},
  documents: { previous_version_id: (row) => row.previous_version_id || null },
  issues: {},
  budget_items: {},
  approvals: { document_id: (row) => row.document_id, reviewer_id: (row) => row.reviewer_id || null, decided_by: (row) => row.decided_by || null },
  calendar_events: {},
  task_dependencies: { predecessor_id: (row) => row.predecessor_id, successor_id: (row) => row.successor_id },
  deliverable_packages: {},
  comments: { author_id: (row) => row.author_id, target_task_id: (row) => row.target_type === "task" ? row.target_id : null, target_document_id: (row) => row.target_type === "document" ? row.target_id : null },
  blueprints: {},
  activities: { actor_id: (row) => row.actor_id || null },
  notifications: { user_id: (row) => row.user_id },
});

const globalTables = new Set(["users", "sessions"]);
const searchable = Object.freeze({ users: ["email"], sessions: ["token_hash"], invitations: ["token_hash"] });
const tableName = (name) => {
  if (!(name in relationships)) throw new Error(`Unknown repository: ${name}`);
  return `teluria.${name}`;
};

export class Repository {
  constructor(queryable) {
    this.db = queryable;
  }

  async list(name, projectId) {
    const sql = projectId && !globalTables.has(name)
      ? `SELECT data FROM ${tableName(name)} WHERE project_id=$1 ORDER BY created_at,id`
      : `SELECT data FROM ${tableName(name)} ORDER BY created_at,id`;
    const result = await this.db.query(sql, projectId && !globalTables.has(name) ? [projectId] : []);
    return result.rows.map((row) => row.data);
  }

  async find(name, id, projectId, lock = false) {
    const scoped = projectId && !globalTables.has(name);
    const result = await this.db.query(
      `SELECT data FROM ${tableName(name)} WHERE id=$1${scoped ? " AND project_id=$2" : ""}${lock ? " FOR UPDATE" : ""}`,
      scoped ? [id, projectId] : [id],
    );
    return result.rows[0]?.data || null;
  }

  async findOneBy(name, column, value, lock = false) {
    if (!searchable[name]?.includes(column)) throw new Error("Unsupported repository lookup.");
    const result = await this.db.query(
      `SELECT data FROM ${tableName(name)} WHERE ${column}=$1${lock ? " FOR UPDATE" : ""}`,
      [value],
    );
    return result.rows[0]?.data || null;
  }

  async pruneExpiredSessions() {
    await this.db.query("DELETE FROM teluria.sessions WHERE expires_at < now()");
  }

  async lockInitialRegistration() {
    await this.db.query("SELECT version FROM teluria.schema_migrations WHERE version=1 FOR UPDATE");
  }

  async insert(name, row) {
    const relation = relationships[name];
    tableName(name);
    const columns = ["id", ...(!globalTables.has(name) && name !== "projects" ? ["project_id"] : []), "created_at", "updated_at", ...Object.keys(relation), "data"];
    const values = [row.id, ...(!globalTables.has(name) && name !== "projects" ? [row.project_id] : []), row.created_at, row.updated_at, ...Object.values(relation).map((get) => get(row)), JSON.stringify(row)];
    await this.db.query(
      `INSERT INTO ${tableName(name)}(${columns.join(",")}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(",")})`,
      values,
    );
    if (name === "deliverable_packages") await this.syncPackageDocuments(row);
    return row;
  }

  async update(name, row, expectedRevision) {
    const relation = relationships[name];
    tableName(name);
    const columns = ["updated_at", ...Object.keys(relation), "data"];
    const values = [row.updated_at, ...Object.values(relation).map((get) => get(row)), JSON.stringify(row), row.id, expectedRevision];
    const result = await this.db.query(
      `UPDATE ${tableName(name)} SET ${columns.map((column, index) => `${column}=$${index + 1}`).join(",")} WHERE id=$${columns.length + 1} AND updated_at=$${columns.length + 2}`,
      values,
    );
    if (!(result.rowCount ?? result.affectedRows)) fail(409, "This item has changed. Reload before saving again.");
    if (name === "deliverable_packages") await this.syncPackageDocuments(row);
    return row;
  }

  async remove(name, id, expectedRevision) {
    const result = await this.db.query(
      `DELETE FROM ${tableName(name)} WHERE id=$1 AND updated_at=$2`,
      [id, expectedRevision],
    );
    if (!(result.rowCount ?? result.affectedRows)) fail(409, "This item has changed. Reload before saving again.");
  }

  async syncPackageDocuments(row) {
    await this.db.query("DELETE FROM teluria.deliverable_package_documents WHERE package_id=$1", [row.id]);
    for (const documentId of row.document_ids) {
      await this.db.query(
        "INSERT INTO teluria.deliverable_package_documents(project_id,package_id,document_id) VALUES($1,$2,$3)",
        [row.project_id, row.id, documentId],
      );
    }
  }
}

export async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(new Repository(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
