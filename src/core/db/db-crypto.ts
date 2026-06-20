import crypto from "node:crypto";
import os from "node:os";

const ENCRYPTION_PREFIX = "enc:";

/**
 * Derive a stable 256-bit key bound to the current user + machine. The key is
 * never persisted; it is recomputed on demand. Cache files copied to another
 * machine therefore cannot be decrypted, which is the intended behaviour.
 */
function deriveLocalKey(): Buffer {
  const seed = `${os.userInfo().username}|${os.hostname()}|simplemdg-db`;
  return crypto.createHash("sha256").update(seed).digest();
}

export function encryptSecret(plainValue: string): string {
  if (plainValue.startsWith(ENCRYPTION_PREFIX)) {
    return plainValue;
  }

  const key = deriveLocalKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`;
}

export function decryptSecret(storedValue: string): string {
  if (!storedValue.startsWith(ENCRYPTION_PREFIX)) {
    // Backward compatibility: tolerate legacy plain values already on disk.
    return storedValue;
  }

  try {
    const key = deriveLocalKey();
    const raw = Buffer.from(storedValue.slice(ENCRYPTION_PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Cannot decrypt cached credential. It may have been created on another machine or user account. Re-import the connection.");
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}
