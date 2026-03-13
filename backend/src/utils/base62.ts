import crypto from "crypto";

const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 8;

export function generateBase62Id(): string {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let result = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    result += BASE62_CHARS[bytes[i] % 62];
  }
  return result;
}
