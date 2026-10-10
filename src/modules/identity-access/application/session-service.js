import { makeRecord } from "../../../shared/domain/record.js";
import { fail } from "../../../errors.js";
import { digest, safeUser, token } from "../domain/credentials.js";

export function cookieValue(request) {
  const cookies = String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim());
  const current = cookies.find((part) => part.startsWith("ark_session="));
  if (current) return current.slice("ark_session=".length);
  // Keep existing sessions valid while the product completes its Ark rename.
  return cookies
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

export async function createSession(repo, user, { persistent = false } = {}) {
  const secret = token();
  const durationSeconds = persistent ? 30 * 86400 : 12 * 3600;
  await repo.pruneExpiredSessions();
  await repo.insert("sessions", makeRecord("", {
    user_id: user.id,
    token_hash: digest(secret),
    expires_at: new Date(Date.now() + durationSeconds * 1000).toISOString(),
  }));
  // A null maxAge creates a browser-session cookie; its server record still expires.
  return { secret, maxAge: persistent ? durationSeconds : null };
}

export async function destroySession(repo, request) {
  const raw = cookieValue(request);
  if (!raw) return;
  const session = await repo.findOneBy("sessions", "token_hash", digest(raw));
  if (session) await repo.remove("sessions", session.id, session.updated_at);
}
