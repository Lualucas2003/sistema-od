/**
 * Conexão única com o PostgreSQL (pool compartilhado).
 * Todo acesso ao banco passa pelos models — nunca pelos controllers.
 */
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n[OD] DATABASE_URL não definida. Copie .env.example para .env e preencha.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /sslmode=require/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 10,
  // o banco remoto derruba conexões ociosas; soltamos antes para não pegar socket morto
  idleTimeoutMillis: 10000,
  // banco remoto: mantém o socket vivo e dá folga para a primeira conexão
  connectionTimeoutMillis: 20000,
  keepAlive: true
});

pool.on('error', (erro) => console.error('[OD] Erro no pool do Postgres:', erro.message));

/** Executa uma consulta e devolve as linhas. */
async function consultar(sql, valores = []) {
  const { rows } = await pool.query(sql, valores);
  return rows;
}

/** Executa e devolve apenas a primeira linha (ou null). */
async function consultarUm(sql, valores = []) {
  const linhas = await consultar(sql, valores);
  return linhas[0] || null;
}

/** Roda várias operações numa transação. */
async function transacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    const saida = await fn(cliente);
    await cliente.query('commit');
    return saida;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consultar, consultarUm, transacao };
