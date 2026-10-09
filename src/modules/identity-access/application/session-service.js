import { makeRecord } from "../../../shared/domain/record.js";
import { fail } from "../../../errors.js";
import { digest, safeUser, token } from "../domain/credentials.js";

export function cookieValue(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("teluria_session="))
    ?.slice("teluria_session=".length);
}

export async function currentUser(repo, request) {
  const raw = cookieValue(request);
  if (!raw) return null;
  const session = await repo.findOneBy("sessions", "token_hash", digest(raw));
  if (!session || session.expires_at <= new Date().toISOString()) return null;
  const user = await repo.find("users", session.user_id);
  return user ? safeUser(user) : null;
}

export async function requireUser(repo, request) {
  return (await currentUser(repo, request)) || fail(401, "Please sign in to continue.");
}

export async function projectRole(repo, projectId, userId) {
  const member = (await repo.list("members", projectId)).find((row) => row.user_id === userId);
  return member?.role || fail(404, "Project not found.");
}

export async function createSession(repo, user) {
  const secret = token();
  await repo.pruneExpiredSessions();
  await repo.insert("sessions", makeRecord("", {
    user_id: user.id,
    token_hash: digest(secret),
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }));
  return secret;
}

export async function destroySession(repo, request) {
  const raw = cookieValue(request);
  if (!raw) return;
  const session = await repo.findOneBy("sessions", "token_hash", digest(raw));
  if (session) await repo.remove("sessions", session.id, session.updated_at);
}
