/**
 * Arquivos SQL do banco, na ordem em que precisam rodar.
 * É a única lista: os scripts npm (db:schema, db:reset) e a inicialização
 * automática do servidor (INICIALIZAR_BANCO) leem daqui.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const PASTA = path.join(__dirname, '..', '..', 'db');

const SCHEMA = [
  '01_schema.sql', '03_configuracao.sql', '04_anexos.sql', '05_multiempresa.sql',
  '06_usuario_sistema.sql', '07_tipo_acao.sql', '08_projetos.sql',
  '09_catalogos_universais.sql', '10_permissoes.sql', '11_requisitos.sql',
  '12_atividades.sql', '13_unifica_atividades.sql', '14_usuarios_como_listas.sql',
  '15_anexos_documentos.sql'
].map((nome) => path.join(PASTA, nome));

// recria as demandas de exemplo (apaga as que existirem)
const SEED = path.join(PASTA, '02_seed.sql');

/** Roda os arquivos em sequência; `aoIniciar(arquivo)` permite mostrar o progresso. */
async function aplicar(arquivos, aoIniciar = () => {}) {
  for (const arquivo of arquivos) {
    aoIniciar(arquivo);
    await pool.query(fs.readFileSync(arquivo, 'utf8'));
  }
}

module.exports = { SCHEMA, SEED, aplicar };
