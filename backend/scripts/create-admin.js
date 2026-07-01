require('../src/loadEnv');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../src/db');
const { sanitizeEmail, sanitizeText, getPasswordValidationError } = require('../src/security');

async function main() {
  const email = sanitizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || '');
  const fullName = sanitizeText(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador Criatyve', 160);
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const passwordError = getPasswordValidationError(password);
  if (!email || passwordError) {
    throw new Error(passwordError || 'BOOTSTRAP_ADMIN_EMAIL e obrigatorio.');
  }
  const { rows: admins } = await db.query("SELECT id, email FROM users WHERE role = 'admin' LIMIT 2");
  if (admins.length && !admins.some((admin) => admin.email === email)) {
    throw new Error('Ja existe outro administrador. A criacao automatica foi recusada.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, class_name, is_active)
     VALUES ($1, $2, $3, $4, 'admin', 'Administracao', TRUE)
     ON CONFLICT (email)
     DO UPDATE SET full_name = EXCLUDED.full_name,
                   password_hash = EXCLUDED.password_hash,
                   role = 'admin',
                   is_active = TRUE`,
    [crypto.randomUUID(), fullName, email, passwordHash]
  );
  console.log('Administrador criado ou atualizado com sucesso. Remova BOOTSTRAP_ADMIN_PASSWORD do ambiente.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
