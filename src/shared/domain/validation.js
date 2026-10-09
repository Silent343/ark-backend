import { fail } from "../../errors.js";

export function required(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(422, `${field}: required, maximum ${max} characters.`);
}

export function choice(value, values, field) {
  if (typeof value !== "string" || !values.includes(value)) fail(422, `${field}: invalid value.`);
}

export function date(value, field) {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value
  ) fail(422, `${field}: use a valid YYYY-MM-DD date.`);
}

export function amount(value, field, min = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > 1e12)
    fail(422, `${field}: invalid amount.`);
}

export function validateInput(input, definition, allowId = false) {
  if (Object.keys(input).some((key) => !definition.fields.includes(key) && !(allowId && key === "id")))
    fail(400, "Unknown or read-only field.");
  for (const value of Object.values(input))
    if (typeof value === "string" && value.length > 4000 && !value.startsWith("data:"))
      fail(400, "Text is too long.");
}

export function validateCandidate(value, definition) {
  for (const field of definition.fields) {
    const expected = definition.numeric?.includes(field) ? "number" : "string";
    if (typeof value[field] !== expected) fail(422, `${field}: expected ${expected === "number" ? "a number" : "text"}.`);
  }
  definition.validate(value);
}
