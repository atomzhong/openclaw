import * as crypto from "node:crypto";

/**
 * WxWork Bot message encryption/decryption.
 *
 * Based on the official WeCom callback encryption scheme:
 * - AES-256-CBC with PKCS#7 padding
 * - Key derived from EncodingAESKey (base64 encoded, 43 chars -> 32 bytes)
 * - IV = first 16 bytes of AES key
 * - receiveid is empty string for bot webhook scenario
 */

const BLOCK_SIZE = 32;

/**
 * Derive AES key and IV from EncodingAESKey.
 */
function deriveKeyAndIv(encodingAesKey: string): {
  key: Buffer;
  iv: Buffer;
} {
  const key = Buffer.from(encodingAesKey + "=", "base64");
  const iv = key.subarray(0, 16);
  return { key, iv };
}

/**
 * PKCS#7 padding.
 */
function pkcs7Pad(data: Buffer): Buffer {
  const padLen = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, pad]);
}

/**
 * PKCS#7 unpadding.
 */
function pkcs7Unpad(data: Buffer): Buffer {
  const padLen = data[data.length - 1];
  if (padLen === undefined || padLen < 1 || padLen > BLOCK_SIZE) {
    throw new Error("Invalid PKCS#7 padding");
  }
  return data.subarray(0, data.length - padLen);
}

/**
 * Generate a random string of given length.
 */
function randomStr(len: number): string {
  return crypto.randomBytes(len).toString("hex").slice(0, len);
}

/**
 * Compute msg_signature.
 * signature = SHA1(sort(token, timestamp, nonce, encrypt))
 */
export function computeMsgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const parts = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(parts.join("")).digest("hex");
}

/**
 * Verify msg_signature from the request.
 */
export function verifySignature(params: {
  msgSignature: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  token: string;
}): boolean {
  const { msgSignature, timestamp, nonce, encrypt, token } = params;
  const computed = computeMsgSignature(token, timestamp, nonce, encrypt);
  return computed === msgSignature;
}

/**
 * Decrypt an encrypted message.
 * The plaintext format: random(16B) + msgLen(4B, network order) + msg + receiveid
 * For bot webhook, receiveid is empty string.
 */
export function decryptMessage(
  encrypt: string,
  encodingAesKey: string,
): string {
  const { key, iv } = deriveKeyAndIv(encodingAesKey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);

  const encBuf = Buffer.from(encrypt, "base64");
  const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]);
  const unpadded = pkcs7Unpad(decrypted);

  // Skip 16 bytes random prefix
  // Next 4 bytes: msg length (network byte order / big endian)
  const msgLen = unpadded.readUInt32BE(16);
  const msg = unpadded.subarray(20, 20 + msgLen).toString("utf8");
  // Remaining bytes after msg is receiveid (empty for bot scenario)

  return msg;
}

/**
 * Encrypt a plaintext message for response.
 * Format: random(16B) + msgLen(4B, network order) + msg + receiveid
 * For bot webhook, receiveid is empty string.
 */
export function encryptMessage(
  plaintext: string,
  encodingAesKey: string,
): string {
  const { key, iv } = deriveKeyAndIv(encodingAesKey);

  const randomPrefix = Buffer.from(randomStr(16), "utf8");
  const msgBuf = Buffer.from(plaintext, "utf8");
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);
  // receiveid is empty string for bot scenario
  const receiveidBuf = Buffer.from("", "utf8");

  const rawData = Buffer.concat([randomPrefix, msgLenBuf, msgBuf, receiveidBuf]);
  const padded = pkcs7Pad(rawData);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  return encrypted.toString("base64");
}

/**
 * Build an encrypted response payload (JSON format).
 */
export function buildEncryptedJsonResponse(params: {
  plaintext: string;
  encodingAesKey: string;
  token: string;
}): {
  encrypt: string;
  msgsignature: string;
  timestamp: number;
  nonce: string;
} {
  const { plaintext, encodingAesKey, token } = params;
  const encrypt = encryptMessage(plaintext, encodingAesKey);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomStr(16);
  const msgsignature = computeMsgSignature(
    token,
    String(timestamp),
    nonce,
    encrypt,
  );
  return { encrypt, msgsignature, timestamp, nonce };
}

/**
 * Build an encrypted response payload (XML format).
 */
export function buildEncryptedXmlResponse(params: {
  plaintext: string;
  encodingAesKey: string;
  token: string;
}): string {
  const { plaintext, encodingAesKey, token } = params;
  const encrypt = encryptMessage(plaintext, encodingAesKey);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomStr(16);
  const msgSignature = computeMsgSignature(
    token,
    String(timestamp),
    nonce,
    encrypt,
  );
  return [
    "<xml>",
    `   <Encrypt><![CDATA[${encrypt}]]></Encrypt>`,
    `   <MsgSignature><![CDATA[${msgSignature}]]></MsgSignature>`,
    `   <TimeStamp>${timestamp}</TimeStamp>`,
    `   <Nonce><![CDATA[${nonce}]]></Nonce>`,
    "</xml>",
  ].join("\n");
}
