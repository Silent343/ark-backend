import { fail } from "../../errors.js";
import { transaction } from "../../shared/infrastructure/postgres/repository.js";
import { resourceDefinitions } from "../../modules/index.js";
import { requireUser, projectRole } from "../../modules/identity-access/application/session-service.js";
import { authorize } from "../../modules/identity-access/application/authorization.js";
import { createProject, getProject, listProjects, requireProject, updateProject } from "../../modules/project-management/application/project-service.js";
import { handleResource } from "../../shared/application/resource-service.js";
import { handleCollaboration, isCollaborationResource } from "./collaboration-service.js";

/** Cross-context orchestration owns transaction, identity and project scope. */
export async function handleWorkspace(pool, request, params) {
  const { projectId, resource, resourceId } = params;
  const method = request.method;
  return transaction(pool, async (repo) => {
    const user = await requireUser(repo, request);
    const role = projectId ? await projectRole(repo, projectId, user.id) : undefined;
    if (role) authorize(role, resource || "projects", method);
    if (!resource) {
      if (method === "GET") return projectId
        ? getProject(repo, projectId, user, role)
        : listProjects(repo, user);
      if (method === "POST" && !projectId) return createProject(repo, request.body || {}, user);
      if (method === "PATCH" && projectId) return updateProject(repo, projectId, request, request.body || {}, user);
      fail(405, "Method not allowed.");
    }
    if (!projectId) fail(400, "Project id required.");
    await requireProject(repo, projectId);
    if (resource === "activities") {
      if (method !== "GET" || resourceId) fail(405, "Activities are read-only.");
      return { data: (await repo.list("activities", projectId)).slice(-12).reverse() };
    }
    const context = { projectId, resource, resourceId, user, role };
    if (isCollaborationResource(resource)) return handleCollaboration(repo, request, context);
    const definition = resourceDefinitions.get(resource);
    if (!definition) fail(404, "Resource not found.");
    return handleResource(repo, request, { ...context, definition });
  });
}
