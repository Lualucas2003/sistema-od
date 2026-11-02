/**
 * Model dos anexos de imagem. O conteúdo fica em base64 na coluna `dados`;
 * as consultas de listagem nunca trazem essa coluna.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const CAMPOS = `id, demanda_id, nome, tipo, tamanho, largura, altura, criado_em`;

/** Metadados dos anexos de uma demanda (sem a base64). */
async function listarDaDemanda(demandaId) {
  return consultar(
    `select ${CAMPOS} from od.demanda_anexo where demanda_id = $1 order by criado_em, id`,
    [demandaId]);
}

/** Conteúdo (base64) para servir o arquivo, respeitando o escopo. */
function recorteDemanda(escopo, vals) {
  if (!escopo) return '';
  let sql = '';
  if (escopo.empresaId != null) {
    vals.push(escopo.empresaId);
    sql += ` and d.empresa_id = $${vals.length}`;
  }
  if (escopo.sistemasIds && escopo.sistemasIds.length) {
    vals.push(escopo.sistemasIds);
    sql += ` and d.sistema_id = any($${vals.length}::int[])`;
  }
  return sql;
}

async function obterConteudo(id, escopo) {
  const vals = [id];
  const recorte = recorteDemanda(escopo, vals);
  return consultarUm(
    `select a.nome, a.tipo, a.dados from od.demanda_anexo a
       join od.demandas d on d.id = a.demanda_id
      where a.id = $1 ${recorte}`, vals);
}

/** Confere se o anexo pertence ao escopo antes de remover. */
async function pertenceAoEscopo(id, escopo) {
  const vals = [id];
  const recorte = recorteDemanda(escopo, vals);
  if (!recorte) return true;
  const linha = await consultarUm(
    `select 1 from od.demanda_anexo a join od.demandas d on d.id = a.demanda_id
       where a.id = $1 ${recorte}`, vals);
  return !!linha;
}

async function contar(demandaId) {
  const { total } = await consultarUm(
    'select count(*)::int as total from od.demanda_anexo where demanda_id = $1', [demandaId]);
  return total;
}

/** Grava a imagem e registra o anexo no histórico da demanda. */
async function criar(demandaId, imagem) {
  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `insert into od.demanda_anexo (demanda_id, nome, tipo, tamanho, largura, altura, dados)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning ${CAMPOS}`,
      [demandaId, imagem.nome, imagem.tipo, imagem.tamanho,
       imagem.largura || null, imagem.altura || null, imagem.dados]);

    await cliente.query(
      `insert into od.demanda_historico (demanda_id, autor, texto) values ($1, $2, $3)`,
      [demandaId, imagem.autor || null, `Imagem anexada: ${imagem.nome}.`]);

    return rows[0];
  });
}

async function remover(id) {
  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      'delete from od.demanda_anexo where id = $1 returning demanda_id, nome', [id]);
    if (!rows.length) return null;
    await cliente.query(
      `insert into od.demanda_historico (demanda_id, texto) values ($1, $2)`,
      [rows[0].demanda_id, `Imagem removida: ${rows[0].nome}.`]);
    return rows[0].nome;
  });
}

module.exports = { listarDaDemanda, obterConteudo, contar, criar, remover, pertenceAoEscopo };
