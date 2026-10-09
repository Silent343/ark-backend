import { amount, required } from "../../../shared/domain/validation.js";

export const budgetItemDefinition = {
  resource: "budget-items",
  table: "budget_items",
  fields: ["title", "category", "quantity", "unit", "unit_cost", "actual_cost", "supplier", "stage"],
  numeric: ["quantity", "unit_cost", "actual_cost"],
  validate(value) {
    required(value.title, "title"); required(value.category, "category"); required(value.unit, "unit");
    amount(value.quantity, "quantity"); amount(value.unit_cost, "unit_cost"); amount(value.actual_cost, "actual_cost");
  },
};
