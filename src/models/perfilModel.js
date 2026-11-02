/**
 * Model dos perfis de acesso e das permissões — só SQL.
 *
 * Um perfil é um nome com um conjunto de permissões. `empresa_id` nulo torna
 * o perfil disponível em todos os portais; preenchido, ele é só daquela
 * empresa. `base` é a classe de escopo que a conta herda (admin, gestor,
 * operador, leitor) e mantém `od.usuario.perfil` em dia, por gatilho.
 *
 * Perfis com `sistema = true` são os quatro de fábrica: podem ser ajustados
 * (menos o de administrador), mas nunca excluídos.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const SELECT = 'select * from od.vw_perfis p';

/** Catálogo do que existe para permitir, já agrupado para a tela. */
async function catalogo() {
  return consultar(
    `select chave, grupo, nome, descricao, ordem, exige_admin
       from od.permissao order by ordem, chave`);
}

/** Recorte: quem está numa empresa vê os perfis dela mais os compartilhados. */
function recorte(escopo, vals) {
  if (!escopo || escopo.empresaId == null) return '';
  vals.push(escopo.empresaId);
  return ` and (p.empresa_id = $${vals.length} or p.empresa_id is null)`;
}

async function listar(escopo) {
  const vals = [];
  const onde = recorte(escopo, vals).replace(/^ and /, 'where ');
  return consultar(
    `${SELECT} ${onde}
      order by p.empresa_id nulls first,
               array_position(array['admin','gestor','operador','leitor']::text[], p.base::text),
               p.nome`, vals);
}

async function buscarPorId(id) {
  return consultarUm(`${SELECT} where p.id = $1`, [id]);
}

/**
 * Perfis que podem ser atribuídos a uma conta daquele destino.
 *   empresaId null -> conta do sistema principal: só perfis de base admin
 *   empresaId N    -> conta da empresa N: perfis dela e os compartilhados,
 *                     sem os de base admin
 */
async function atribuiveis(empresaId) {
  if (empresaId == null) {
    return consultar(`${SELECT} where p.base = 'admin' and p.ativo order by p.nome`);
  }
  return consultar(
    `${SELECT} where p.ativo and p.base <> 'admin'
       and (p.empresa_id is null or p.empresa_id = $1)
      order by p.empresa_id nulls first,
               array_position(array['gestor','operador','leitor']::text[], p.base::text), p.nome`,
    [empresaId]);
}

/** As permissões que uma conta tem, pelo perfil dela. */
async function permissoesDoUsuario(usuarioId) {
  const linhas = await consultar(
    `select pp.permissao from od.usuario u
       join od.perfil_permissao pp on pp.perfil_id = u.perfil_id
      where u.id = $1`, [usuarioId]);
  return linhas.map((l) => l.permissao);
}

/** Existe perfil de fábrica com essa base? Usado para converter o perfil antigo. */
async function deFabrica(base) {
  return consultarUm(
    'select id, nome, base from od.perfil_acesso where sistema and base = $1::od.perfil', [base]);
}

async function criar(dados) {
  const id = await transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `insert into od.perfil_acesso (nome, descricao, base, empresa_id)
       values ($1, $2, $3::od.perfil, $4) returning id`,
      [dados.nome, dados.descricao || null, dados.base, dados.empresaId ?? null]);
    await gravarPermissoes(cliente, rows[0].id, dados.permissoes || []);
    return rows[0].id;
  });
  return buscarPorId(id);
}

async function atualizar(id, dados) {
  const atual = await buscarPorId(id);
  if (!atual) return null;

  await transacao(async (cliente) => {
    await cliente.query(
      `update od.perfil_acesso
          set nome = coalesce($2, nome),
              descricao = coalesce($3, descricao),
              base = coalesce($4::od.perfil, base),
              ativo = coalesce($5, ativo)
        where id = $1`,
      [id, dados.nome || null,
       dados.descricao === undefined ? null : (dados.descricao || ''),
       // o perfil de fábrica não troca de base: contas dependem dela
       atual.sistema ? null : (dados.base || null),
       typeof dados.ativo === 'boolean' ? dados.ativo : null]);

    if (dados.permissoes !== undefined) {
      await cliente.query('delete from od.perfil_permissao where perfil_id = $1', [id]);
      await gravarPermissoes(cliente, id, dados.permissoes);
    }
  });
  return buscarPorId(id);
}

/** Grava o conjunto de permissões ignorando chaves que não existem. */
async function gravarPermissoes(cliente, perfilId, chaves) {
  if (!chaves || !chaves.length) return;
  await cliente.query(
    `insert into od.perfil_permissao (perfil_id, permissao)
     select $1, pe.chave from od.permissao pe where pe.chave = any($2::text[])
     on conflict do nothing`, [perfilId, chaves]);
}

/**
 * Exclusão. Como nas listas auxiliares, desativar é a trava: perfil de
 * fábrica nunca sai, e perfil em uso só sai depois que as contas mudarem.
 */
async function remover(id) {
  const perfil = await buscarPorId(id);
  if (!perfil) return null;

  if (perfil.sistema) {
    const erro = new Error(`"${perfil.nome}" é um perfil do sistema e não pode ser excluído.`);
    erro.status = 409;
    throw erro;
  }
  if (perfil.contas > 0) {
    const erro = new Error(
      `"${perfil.nome}" está em ${perfil.contas} conta(s). Mude o perfil delas antes de excluir.`);
    erro.status = 409;
    erro.detalhe = { contas: perfil.contas };
    throw erro;
  }
  await consultar('delete from od.perfil_acesso where id = $1', [id]);
  return perfil.nome;
}

/** Contas que usam o perfil — para avisar o que a mudança vai atingir. */
async function contasDoPerfil(id) {
  return consultar(
    `select u.id, u.nome, u.email, e.nome as empresa from od.usuario u
       left join od.empresa e on e.id = u.empresa_id
      where u.perfil_id = $1 order by u.nome`, [id]);
}

module.exports = {
  catalogo, listar, buscarPorId, atribuiveis, permissoesDoUsuario, deFabrica,
  criar, atualizar, remover, contasDoPerfil
};
