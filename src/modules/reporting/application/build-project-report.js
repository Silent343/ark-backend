const labels = {
  es: { overview: "Resumen", owner: "Responsable", phase: "Fase", completed: "Tareas completadas", planned: "Costo previsto", actual: "Costo real", tasks: "Tareas", milestones: "Hitos", budget: "Presupuesto", issues: "Incidencias", approvals: "Revisiones" },
  en: { overview: "Overview", owner: "Owner", phase: "Phase", completed: "Completed tasks", planned: "Planned cost", actual: "Actual cost", tasks: "Tasks", milestones: "Milestones", budget: "Budget", issues: "Issues", approvals: "Reviews" },
  pt: { overview: "Resumo", owner: "Responsável", phase: "Fase", completed: "Tarefas concluídas", planned: "Custo previsto", actual: "Custo real", tasks: "Tarefas", milestones: "Marcos", budget: "Orçamento", issues: "Ocorrências", approvals: "Revisões" },
};

export async function buildProjectReport(repo, project, requestedLocale) {
  const locale = ["es", "en", "pt"].includes(requestedLocale) ? requestedLocale : "es";
  const t = labels[locale];
  const [tasks, milestones, costs, issues, approvals] = await Promise.all([
    repo.list("tasks", project.id), repo.list("milestones", project.id),
    repo.list("budget_items", project.id), repo.list("issues", project.id),
    repo.list("approvals", project.id),
  ]);
  const money = (amount) => new Intl.NumberFormat(locale, { style: "currency", currency: String(project.currency) }).format(amount);
  return {
    name: String(project.name),
    location: String(project.location),
    currency: String(project.currency),
    generated_at: new Date().toISOString(),
    sections: [
      { title: t.overview, rows: [
        `${t.owner}: ${project.owner_name}`,
        `${t.phase}: ${project.phase}`,
        `${t.completed}: ${tasks.filter((task) => task.status === "done").length}/${tasks.length}`,
        `${t.planned}: ${money(costs.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unit_cost), 0))}`,
        `${t.actual}: ${money(costs.reduce((sum, row) => sum + Number(row.actual_cost), 0))}`,
      ] },
      { title: t.tasks, rows: tasks.map((row) => `${row.title} | ${row.assignee} | ${row.due_date} | ${row.status}`) },
      { title: t.milestones, rows: milestones.map((row) => `${row.title} | ${row.due_date} | ${row.status}`) },
      { title: t.budget, rows: costs.map((row) => `${row.title} | ${money(Number(row.quantity) * Number(row.unit_cost))} | ${row.supplier || ""} | ${row.stage || ""}`) },
      { title: t.issues, rows: issues.map((row) => `${row.title} | ${row.status} | ${row.assignee}`) },
      { title: t.approvals, rows: approvals.map((row) => `${row.title} | ${row.status} | ${row.reviewer}`) },
    ],
  };
}
