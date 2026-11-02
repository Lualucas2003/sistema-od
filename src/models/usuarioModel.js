/**
 * Model de usuários e sessões.
 * O login é separado por escopo: administradores do sistema principal têm
 * empresa_id NULL; os usuários de uma empresa só existem dentro dela.
 */
const { consultar, consultarUm, transacao } = require('../config/db');
const { gerarHash, conferir, novoToken } = require('../config/senha');

const DIAS_SESSAO = 7;

const SELECT = `select u.id, u.empresa_id, u.nome, u.email, u.perfil, u.ativo,
                       u.criado_em, u.ultimo_acesso, e.nome as empresa, e.slug,
                       u.perfil_id, pa.nome as perfil_nome, pa.base as perfil_base,
                       coalesce((select json_agg(pp.permissao order by pp.permissao)
                                   from od.perfil_permissao pp
                                  where pp.perfil_id = u.perfil_id), '[]'::json) as permissoes,
                       coalesce((select json_agg(json_build_object('id', s.id, 'nome', s.nome)
                                                  order by s.nome)
                                   from od.usuario_sistema us
                                   join od.sistemas s on s.id = us.sistema_id
                                  where us.usuario_id = u.id), '[]'::json) as sistemas
                  from od.usuario u
                  left join od.empresa e on e.id = u.empresa_id
                  left join od.perfil_acesso pa on pa.id = u.perfil_id`;

/** Quantas contas ativas usam um perfil. */
async function contarDoPerfil(perfilId) {
  const { total } = await consultarUm(
    'select count(*)::int as total from od.usuario where perfil_id = $1', [perfilId]);
  return total;
}

/** Ids dos sistemas atribuídos — vazio significa "todos do escopo". */
async function sistemasDoUsuario(usuarioId) {
  const linhas = await consultar(
    'select sistema_id from od.usuario_sistema where usuario_id = $1', [usuarioId]);
  return linhas.map((l) => l.sistema_id);
}

/**
 * Define a restrição por sistema. Lista vazia (ou nula) remove a restrição.
 * Só aceita sistemas do escopo da própria conta.
 */
async function definirSistemas(usuarioId, ids) {
  return transacao(async (cliente) => {
    await cliente.query('delete from od.usuario_sistema where usuario_id = $1', [usuarioId]);
    if (!ids || !ids.length) return [];
    const { rows } = await cliente.query(
      `insert into od.usuario_sistema (usuario_id, sistema_id)
       select $1, s.id from od.sistemas s
        where s.id = any($2::int[])
          and s.empresa_id is not distinct from (select empresa_id from od.usuario where id = $1)
       returning sistema_id`, [usuarioId, ids]);
    return rows.map((r) => r.sistema_id);
  });
}

/** Usuários de uma empresa (ou os administradores, quando empresaId é null). */
async function listar(empresaId) {
  return consultar(
    `${SELECT} where u.empresa_id is not distinct from $1 order by u.nome`, [empresaId ?? null]);
}

async function buscarPorId(id) {
  return consultarUm(`${SELECT} where u.id = $1`, [id]);
}

async function criar(dados) {
  // o gatilho tg_usuario_perfil ajusta a coluna `perfil` a partir do perfil escolhido
  const linha = await consultarUm(
    `insert into od.usuario (empresa_id, nome, email, senha_hash, perfil, perfil_id)
     values ($1, $2, lower($3), $4, $5::od.perfil, $6) returning id`,
    [dados.empresaId ?? null, dados.nome, dados.email, gerarHash(dados.senha),
     dados.perfil || (dados.empresaId ? 'operador' : 'admin'), dados.perfilId ?? null]);
  if (dados.sistemaIds) await definirSistemas(linha.id, dados.sistemaIds);
  return buscarPorId(linha.id);
}

async function atualizar(id, dados) {
  const linha = await consultarUm(
    `update od.usuario
        set nome = coalesce($2, nome),
            perfil = coalesce($3::od.perfil, perfil),
            ativo = coalesce($4, ativo),
            senha_hash = case when $5::text is null then senha_hash else $5 end
      where id = $1 returning id`,
    [id, dados.nome || null, dados.perfil || null,
     typeof dados.ativo === 'boolean' ? dados.ativo : null,
     dados.senha ? gerarHash(dados.senha) : null]);
  if (!linha) return null;
  if (dados.sistemaIds !== undefined) await definirSistemas(id, dados.sistemaIds);
  if (dados.senha) await encerrarSessoes(id);   // troca de senha derruba as sessões
  return buscarPorId(id);
}

async function remover(id) {
  const linha = await consultarUm('delete from od.usuario where id = $1 returning nome', [id]);
  return linha ? linha.nome : null;
}

async function contarAdmins() {
  const { total } = await consultarUm(
    'select count(*)::int as total from od.usuario where empresa_id is null and ativo');
  return total;
}

/**
 * Autentica dentro de um escopo. empresaId null = sistema principal.
 * Sempre devolve a mesma mensagem de erro, para não revelar se o e-mail existe.
 */
async function autenticar(empresaId, email, senha) {
  const linha = await consultarUm(
    `select id, senha_hash, ativo from od.usuario
      where empresa_id is not distinct from $1 and lower(email) = lower($2)`,
    [empresaId ?? null, String(email || '')]);

  if (!linha || !linha.ativo || !conferir(senha, linha.senha_hash)) return null;
  await consultar('update od.usuario set ultimo_acesso = now() where id = $1', [linha.id]);
  return buscarPorId(linha.id);
}

/* ------------------------------ Sessões ------------------------------ */

async function abrirSessao(usuarioId, agente) {
  const token = novoToken();
  await consultar(
    `insert into od.sessao (token, usuario_id, expira_em, agente)
     values ($1, $2, now() + interval '${DIAS_SESSAO} days', $3)`,
    [token, usuarioId, String(agente || '').slice(0, 200)]);
  return { token, dias: DIAS_SESSAO };
}

async function usuarioDaSessao(token) {
  if (!token) return null;
  const linha = await consultarUm(
    `select usuario_id from od.sessao where token = $1 and expira_em > now()`, [token]);
  if (!linha) return null;
  const usuario = await buscarPorId(linha.usuario_id);
  return usuario && usuario.ativo ? usuario : null;
}

async function fecharSessao(token) {
  if (token) await consultar('delete from od.sessao where token = $1', [token]);
}

async function encerrarSessoes(usuarioId) {
  await consultar('delete from od.sessao where usuario_id = $1', [usuarioId]);
}

/** Higiene: remove sessões vencidas. */
async function limparSessoes() {
  await consultar('delete from od.sessao where expira_em < now()');
}

module.exports = {
  listar, buscarPorId, criar, atualizar, remover, contarAdmins, autenticar, contarDoPerfil,
  sistemasDoUsuario, definirSistemas,
  abrirSessao, usuarioDaSessao, fecharSessao, encerrarSessoes, limparSessoes, DIAS_SESSAO
};
