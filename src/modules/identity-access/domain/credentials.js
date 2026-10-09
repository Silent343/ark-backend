import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { fail } from "../../../errors.js";

const scrypt = promisify(derive);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function validateRegistration(input) {
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(422, "Enter a valid email.");
  if (password.length < 12 || password.length > 128) fail(422, "Use a password with 12–128 characters.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) fail(422, "Name is required.");
  return { name: input.name.trim(), email, password };
}

export const safeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  can_import_legacy: user.can_import_legacy === true,
});
