import { makeRecord } from "../../../shared/domain/record.js";

const omitted = new Set(["file_data", "geometry", "token_hash", "password_hash", "updated_at"]);

/** Synchronous domain event recording: audit and notifications commit with the aggregate. */
export async function recordChange(repo, user, resource, action, row, previous) {
  const changes = Object.fromEntries(
    Object.keys(row)
      .filter((key) => !omitted.has(key) && JSON.stringify(row[key]) !== JSON.stringify(previous?.[key]))
      .map((key) => [key, { before: previous?.[key] ?? null, after: row[key] }]),
  );
  await repo.insert("activities", makeRecord(row.project_id, {
    title: String(row.title ?? row.name ?? row.content ?? resource).slice(0, 200),
    action,
    actor_id: user.id,
    actor_name: user.name,
    resource,
    resource_id: row.id,
    changes,
  }));
  if (["notifications", "invitations", "members", "blueprints"].includes(resource)) return;
  for (const member of (await repo.list("members", row.project_id)).filter((item) => item.user_id !== user.id)) {
    if (member.role === "client" && !(
      (resource === "approvals" && row.reviewer_id === member.user_id) ||
      (resource === "comments" && row.visibility === "client") ||
      (resource === "deliverable-packages" && row.status !== "draft")
    )) continue;
    await repo.insert("notifications", makeRecord(row.project_id, {
      user_id: member.user_id,
      title: String(row.title ?? row.content ?? resource).slice(0, 200),
      resource,
      resource_id: row.id,
      read_at: "",
      actor_name: user.name,
    }));
  }
}
