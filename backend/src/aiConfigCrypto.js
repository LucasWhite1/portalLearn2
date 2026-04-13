const crypto = require('crypto');

const DEFAULT_SECRET = 'curso-platform-ai-secret-change-me';
const rawSecret = process.env.AI_CONFIG_SECRET || process.env.SESSION_SECRET || DEFAULT_SECRET;
const secretKey = crypto.createHash('sha256').update(String(rawSecret)).digest();

function encryptApiKey(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptApiKey(payload) {
  if (!payload) {
    return '';
  }
  const [ivHex, tagHex, encryptedHex] = String(payload).split(':');
  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('Formato inválido da chave criptografada.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

module.exports = {
  encryptApiKey,
  decryptApiKey
};
