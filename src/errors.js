export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "Expected a JSON object.");
  return value;
}
