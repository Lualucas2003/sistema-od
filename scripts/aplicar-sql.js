/**
 * Aplica arquivos .sql no banco configurado em DATABASE_URL.
 * Uso: node scripts/aplicar-sql.js db/01_schema.sql [db/02_seed.sql ...]
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('Informe ao menos um arquivo .sql.');
  process.exit(1);
}

(async () => {
  const cliente = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=require/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false
  });
  await cliente.connect();
  for (const arquivo of arquivos) {
    const caminho = path.resolve(arquivo);
    process.stdout.write(`-> ${arquivo} ... `);
    await cliente.query(fs.readFileSync(caminho, 'utf8'));
    console.log('ok');
  }
  await cliente.end();
  console.log('Concluído.');
})().catch((erro) => {
  console.error('\nERRO:', erro.message);
  if (erro.detail) console.error('detalhe:', erro.detail);
  process.exit(1);
});
