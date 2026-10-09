import { amount, choice, date, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export const projectDefinition = {
  resource: "projects",
  table: "projects",
  fields: ["name", "location", "floors", "floor_height", "structure_type", "soil_type", "status", "thumbnail_variant", "cover_image", "progress", "phase", "client_name", "owner_name", "target_date", "budget_total", "currency"],
  numeric: ["floors", "floor_height", "progress", "budget_total"],
  validate(value) {
    required(value.name, "name"); required(value.location, "location");
    amount(value.floors, "floors", 1);
    if (!Number.isInteger(value.floors) || value.floors > 100) fail(422, "floors: 1–100.");
    amount(value.floor_height, "floor_height", 1);
    required(value.structure_type, "structure_type"); required(value.soil_type, "soil_type");
    choice(value.phase, ["proposal", "design", "review", "construction", "delivered"], "phase");
    amount(value.budget_total, "budget_total"); choice(value.currency, ["PEN", "USD", "EUR"], "currency");
    if (value.target_date) date(value.target_date, "target_date");
    choice(value.status, ["Ready", "Processing", "Draft"], "status");
    choice(value.thumbnail_variant, ["blueprint", "tower", "house"], "thumbnail_variant");
    if (typeof value.cover_image !== "string" || (value.cover_image && (!/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value.cover_image) || value.cover_image.length > 2_900_000)))
      fail(422, "cover_image: use a PNG, JPEG or WebP image up to 2 MB.");
    amount(value.progress, "progress");
    if (value.progress > 100) fail(422, "progress: maximum 100.");
  },
};
