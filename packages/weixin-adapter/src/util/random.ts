import crypto from "node:crypto";

/** Generate a random ID with the given prefix. */
export function generateId(prefix: string): string {
  const rand = crypto.randomBytes(8).toString("hex");
  return `${prefix}-${rand}`;
}
