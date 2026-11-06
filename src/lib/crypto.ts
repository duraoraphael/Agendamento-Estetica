import crypto from "node:crypto";

// Criptografia simétrica (AES-256-GCM) usada apenas para guardar em repouso
// os tokens OAuth do Google Agenda. A chave vem de TOKEN_ENCRYPTION_KEY
// (base64, 32 bytes) definida no .env.
function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY não configurada. Defina-a no .env (ex: openssl rand -base64 32)."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ter 32 bytes (base64).");
  }
  return key;
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Payload criptografado inválido.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
