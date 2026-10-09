import { projectDefinition } from "./project-management/domain/project.js";
import { taskDefinition } from "./task-management/domain/task.js";
import { milestoneDefinition } from "./project-planning/domain/milestone.js";
import { documentDefinition } from "./document-management/domain/document.js";
import { issueDefinition } from "./issue-management/domain/issue.js";
import { budgetItemDefinition } from "./cost-management/domain/budget-item.js";
import { approvalDefinition } from "./client-approvals/domain/approval.js";

export const resourceDefinitions = new Map(
  [projectDefinition, taskDefinition, milestoneDefinition, documentDefinition, issueDefinition, budgetItemDefinition, approvalDefinition]
    .map((definition) => [definition.resource, definition]),
);
