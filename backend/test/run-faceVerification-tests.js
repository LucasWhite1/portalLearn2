const assert = require('node:assert/strict');
const path = require('node:path');

process.env.BIOMETRIC_DATA_KEY = '11'.repeat(32);

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    getClient: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  }
};

const {
  decryptBuffer,
  encryptBuffer,
  isFaceProtectedBuilderData,
  normalizeFaceSettings
} = require('../src/faceVerification');

const encrypted = encryptBuffer(Buffer.from('biometria-teste', 'utf8'));
assert.notEqual(encrypted.ciphertext.toString('hex'), Buffer.from('biometria-teste').toString('hex'));
assert.equal(decryptBuffer(encrypted).toString('utf8'), 'biometria-teste');

assert.deepEqual(normalizeFaceSettings({}), {
  enabled: false,
  verifyOnEntry: false,
  verifyDuringModule: false,
  verifyOnCompletion: false,
  schemaVersion: 1
});

const protectedSettings = normalizeFaceSettings({
  faceVerification: {
    enabled: true,
    verifyOnEntry: true,
    verifyDuringModule: true,
    verifyOnCompletion: true
  }
});
assert.equal(protectedSettings.enabled, true);
assert.equal(protectedSettings.verifyDuringModule, true);
assert.equal(isFaceProtectedBuilderData({ moduleSettings: { faceVerification: { enabled: true } } }), true);

const publicSettings = normalizeFaceSettings({
  isPublic: true,
  faceVerification: { enabled: true, verifyOnEntry: true }
});
assert.equal(publicSettings.enabled, false);
assert.equal(publicSettings.verifyOnEntry, false);

console.log('Face verification tests passed.');
