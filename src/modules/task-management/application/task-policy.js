import { fail } from "../../../errors.js";

export async function beforeSaveTask(repo, candidate) {
  if (candidate.assignee_id) {
    const member = (await repo.list("members", candidate.project_id)).find(
      (row) => row.user_id === candidate.assignee_id && row.role !== "client",
    );
    if (!member) fail(422, "Select a team member.");
    candidate.assignee = member.name;
  }
  if (["in_progress", "review", "done"].includes(candidate.status)) {
    const edges = await repo.list("task_dependencies", candidate.project_id);
    const tasks = await repo.list("tasks", candidate.project_id);
    if (edges.some((edge) => edge.successor_id === candidate.id && tasks.find((row) => row.id === edge.predecessor_id)?.status !== "done"))
      fail(409, "Complete predecessor tasks first.");
  }
}

export async function beforeDeleteTask(repo, current) {
  if ((await repo.list("task_dependencies", current.project_id)).some(
    (edge) => edge.predecessor_id === current.id || edge.successor_id === current.id,
  )) fail(409, "Remove task dependencies first.");
}
