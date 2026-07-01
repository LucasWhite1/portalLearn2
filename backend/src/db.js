const { Pool } = require('pg');
require('./loadEnv');

const sslMode = String(process.env.DATABASE_SSL || 'disable').toLowerCase();
const ssl = sslMode === 'disable'
  ? false
  : { rejectUnauthorized: !['require', 'no-verify'].includes(sslMode) };

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'producao',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || '',
      ssl
    };

const pool = new Pool(poolConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  connect: () => pool.connect()
};
