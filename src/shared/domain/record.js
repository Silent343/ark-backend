import { randomUUID } from "node:crypto";

export function makeRecord(projectId, values = {}) {
  const now = new Date().toISOString();
  return { ...values, id: randomUUID(), project_id: projectId, created_at: now, updated_at: now };
}
