/**
 * Model das configurações (chave/valor) e da numeração das OD.
 */
const { consultar, consultarUm } = require('../config/db');

const PADRAO = { org: 'HeuCode', prefixo: 'OD' };

async function obter() {
  const linhas = await consultar('select chave, valor from od.configuracao');
  const config = { ...PADRAO };
  linhas.forEach((l) => { config[l.chave] = l.valor; });
  return config;
}

async function salvar(chave, valor) {
  await consultar(
    `insert into od.configuracao (chave, valor, atualizado_em) values ($1, $2, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [chave, String(valor)]);
  return obter();
}

/** Prévia do próximo número, sem consumir a sequência. */
async function proximoNumero() {
  const { prefixo } = await obter();
  const ano = new Date().getFullYear();
  const linha = await consultarUm('select ultimo from od.numeracao where ano = $1', [ano]);
  const proximo = String((linha ? linha.ultimo : 0) + 1).padStart(4, '0');
  return `${prefixo}-${ano}-${proximo}`;
}

module.exports = { obter, salvar, proximoNumero };
