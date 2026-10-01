import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { configuration } from "./config";

export function seal(value: string, binding: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(configuration().secretKey, "hex"),
    iv,
  );
  cipher.setAAD(Buffer.from(binding));
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function unseal(value: string, binding: string) {
  const [iv, tag, bytes] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(configuration().secretKey, "hex"),
    iv,
  );
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes), decipher.final()]).toString(
    "utf8",
  );
}
