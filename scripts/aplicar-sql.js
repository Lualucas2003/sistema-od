/**
 * Aplica arquivos .sql no banco configurado em DATABASE_URL.
 * Uso:
 *   node scripts/aplicar-sql.js --schema            todas as tabelas (src/config/migracoes.js)
 *   node scripts/aplicar-sql.js --seed              demandas de exemplo
 *   node scripts/aplicar-sql.js db/12_atividades.sql [outro.sql ...]
 */
require('dotenv').config();

const path = require('path');
const { pool } = require('../src/config/db');
const migracoes = require('../src/config/migracoes');

const arquivos = process.argv.slice(2).flatMap((arg) => {
  if (arg === '--schema') return migracoes.SCHEMA;
  if (arg === '--seed') return [migracoes.SEED];
  return [path.resolve(arg)];
});
if (!arquivos.length) {
  console.error('Informe --schema, --seed ou ao menos um arquivo .sql.');
  process.exit(1);
}

(async () => {
  for (const arquivo of arquivos) {
    process.stdout.write(`-> ${path.relative(process.cwd(), arquivo)} ... `);
    await migracoes.aplicar([arquivo]);
    console.log('ok');
  }
  await pool.end();
  console.log('Concluído.');
})().catch((erro) => {
  console.error('\nERRO:', erro.message);
  if (erro.detail) console.error('detalhe:', erro.detail);
  process.exit(1);
});
