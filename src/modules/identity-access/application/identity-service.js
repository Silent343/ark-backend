import { fail } from "../../../errors.js";
import { makeRecord } from "../../../shared/domain/record.js";
import { digest, hashPassword, safeUser, validateRegistration, verifyPassword } from "../domain/credentials.js";
import { createSession, currentUser, destroySession, requireUser } from "./session-service.js";

export async function handleIdentity(withTransaction, request, resource, invitationToken, options = {}) {
  const method = request.method;
  const input = request.body || {};
  if (resource === "sessions" && method === "GET") {
    return withTransaction(async (repo) => ({
      data: { user: await currentUser(repo, request), setup_required: (await repo.list("users")).length === 0 },
    }));
  }
  if (resource === "sessions" && method === "DELETE") {
    await withTransaction((repo) => destroySession(repo, request));
    return { data: null, clearCookie: true };
  }

  if (resource === "invitations") {
    return withTransaction(async (repo) => {
      const invite = await repo.findOneBy("invitations", "token_hash", digest(invitationToken || ""), method === "POST");
      if (!invite || invite.status !== "pending" || invite.expires_at <= new Date().toISOString())
        fail(404, "Invitation unavailable or expired.");
      const project = await repo.find("projects", invite.project_id);
      if (method === "GET") return { data: { project_name: project.name, role: invite.role } };
      if (method !== "POST") fail(405, "Method not allowed.");
      const user = await requireUser(repo, request);
      if (user.email !== invite.email) fail(403, "Sign in using the invited email.");
      if (!(await repo.list("members", invite.project_id)).some((row) => row.user_id === user.id))
        await repo.insert("members", makeRecord(invite.project_id, { user_id: user.id, name: user.name, email: user.email, role: invite.role }));
      await repo.update("invitations", { ...invite, status: "accepted", updated_at: new Date().toISOString() }, invite.updated_at);
      return { data: { project_id: invite.project_id } };
    });
  }

  if (method !== "POST") fail(405, "Method not allowed.");
  if (resource === "users") {
    const { name, email, password } = validateRegistration(input);
    const passwordHash = await hashPassword(password);
    return withTransaction(async (repo) => {
      // Serializes the initial owner claim across concurrent registrations.
      await repo.lockInitialRegistration();
      if (await repo.findOneBy("users", "email", email)) fail(409, "An account already exists for this email.");
      const first = (await repo.list("users")).length === 0;
      if (first) {
        if (!options.testMode && (!options.ownerEmail || email !== options.ownerEmail)) fail(403, "Initial owner email is not configured or does not match.");
      } else if (!options.testMode) {
        const invited = (await repo.list("invitations")).some((row) => row.email === email && row.status === "pending" && row.expires_at > new Date().toISOString());
        if (!invited) fail(403, "Registration requires a project invitation.");
      }
      const consentedAt = new Date().toISOString();
      const user = await repo.insert("users", makeRecord("", {
        name,
        email,
        password_hash: passwordHash,
        can_import_legacy: first,
        terms_accepted_at: consentedAt,
        terms_version: "2026-10-09",
        privacy_accepted_at: consentedAt,
        privacy_version: "2026-10-09",
      }));
      if (first)
        for (const project of await repo.list("projects"))
          await repo.insert("members", makeRecord(project.id, { user_id: user.id, name, email, role: "owner" }));
      const session = await createSession(repo, user);
      return { status: 201, data: { user: safeUser(user) }, sessionToken: session.secret, sessionMaxAge: session.maxAge };
    });
  }

  if (resource !== "sessions") fail(404, "Resource not found.");
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (password.length > 128) fail(422, "Invalid credentials.");
  await options.throttle.check(email);
  const user = await withTransaction((repo) => repo.findOneBy("users", "email", email));
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await options.throttle.failure(email);
    fail(401, "Invalid email or password.");
  }
  await options.throttle.clear(email);
  return withTransaction(async (repo) => {
    const session = await createSession(repo, user, { persistent: input.remember_me === true });
    return { data: { user: safeUser(user) }, sessionToken: session.secret, sessionMaxAge: session.maxAge };
  });
}
