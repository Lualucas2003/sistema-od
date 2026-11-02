/**
 * Model das empresas (inquilinos). Cada empresa tem portal próprio em /p/<slug>.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const SELECT = `
  select e.id, e.nome, e.slug, e.documento, e.contato, e.ativo, e.criada_em,
         (select count(*)::int from od.demandas d where d.empresa_id = e.id) as demandas,
         (select count(*)::int from od.sistemas s where s.empresa_id = e.id) as sistemas,
         (select count(*)::int from od.usuario u where u.empresa_id = e.id and u.ativo) as usuarios
    from od.empresa e`;

async function listar() {
  return consultar(`${SELECT} order by e.nome`);
}

async function buscarPorId(id) {
  return consultarUm(`${SELECT} where e.id = $1`, [id]);
}

async function buscarPorSlug(slug) {
  return consultarUm(`${SELECT} where e.slug = $1`, [slug]);
}

/**
 * Empresas em que esse e-mail já tem conta, com os sistemas de cada uma.
 * Usado no cadastro para avisar que o cliente já existe.
 */
async function porEmail(email) {
  const alvo = String(email || '').trim();
  if (!alvo) return [];
  return consultar(
    `select e.id, e.nome, e.slug, e.ativo, u.nome as usuario, u.perfil, u.ativo as conta_ativa,
            coalesce((select json_agg(s.nome order by s.nome)
                        from od.sistemas s
                       where s.empresa_id = e.id and s.ativo), '[]'::json) as sistemas,
            (select count(*)::int from od.demandas d where d.empresa_id = e.id) as demandas
       from od.usuario u
       join od.empresa e on e.id = u.empresa_id
      where lower(u.email) = lower($1)
      order by e.nome`, [alvo]);
}

/** Sistemas cadastrados para uma empresa, com o uso de cada um. */
async function sistemas(empresaId) {
  return consultar(
    `select s.id, s.nome, s.ativo,
            (select count(*)::int from od.demandas d where d.sistema_id = s.id) as uso
       from od.sistemas s where s.empresa_id = $1 order by s.ativo desc, s.nome`, [empresaId]);
}

/** Acrescenta um sistema à empresa. */
async function adicionarSistema(empresaId, nome) {
  const repetido = await consultarUm(
    'select id from od.sistemas where empresa_id = $1 and lower(nome) = lower($2)',
    [empresaId, nome]);
  if (repetido) {
    const erro = new Error(`"${nome}" já está cadastrado nesta empresa.`);
    erro.status = 409;
    throw erro;
  }
  return consultarUm(
    `insert into od.sistemas (nome, empresa_id) values ($1, $2)
     returning id, nome, ativo, 0 as uso`, [nome, empresaId]);
}

/** Existe empresa com esse nome? Evita cadastro duplicado por engano. */
async function buscarPorNome(nome) {
  return consultarUm('select id, nome, slug, ativo from od.empresa where lower(nome) = lower($1)',
    [String(nome || '').trim()]);
}

/**
 * Cria a empresa com os sistemas dela e, quando informado, o gestor do
 * primeiro acesso — tudo numa transação só. Se qualquer passo falhar, nada
 * é gravado (nem a empresa). Solicitantes e responsáveis não são copiados:
 * esses catálogos são universais.
 */
async function criar(dados) {
  const id = await transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `insert into od.empresa (nome, slug, documento, contato)
       values ($1, $2, $3, $4) returning id`,
      [dados.nome, dados.slug, dados.documento || null, dados.contato || null]);
    const novoId = rows[0].id;

    // os sistemas do cliente são cadastrados aqui, junto da empresa
    const sistemas = (dados.sistemas && dados.sistemas.length)
      ? dados.sistemas : [`Sistema ${dados.nome}`];
    for (const nome of sistemas) {
      await cliente.query(
        `insert into od.sistemas (nome, empresa_id) values ($1, $2)`, [nome, novoId]);
    }
    // solicitantes e responsáveis são universais: o portal já nasce com o
    // catálogo do sistema, sem cópias com o nome da empresa

    if (dados.gestor) {
      await cliente.query(
        `insert into od.usuario (empresa_id, nome, email, senha_hash, perfil)
         values ($1, $2, lower($3), $4, 'gestor')`,
        [novoId, dados.gestor.nome, dados.gestor.email, dados.gestor.senhaHash]);
    }
    return novoId;
  });
  return buscarPorId(id);
}

async function atualizar(id, dados) {
  const atual = await buscarPorId(id);
  if (!atual) return null;

  const linha = await consultarUm(
    `update od.empresa
        set nome = coalesce($2, nome),
            slug = coalesce($3, slug),
            documento = coalesce($4, documento),
            contato = coalesce($5, contato),
            ativo = coalesce($6, ativo)
      where id = $1 returning id`,
    [id,
     dados.nome || null,
     dados.slug || null,
     dados.documento === undefined ? null : (dados.documento || ''),
     dados.contato === undefined ? null : (dados.contato || ''),
     typeof dados.ativo === 'boolean' ? dados.ativo : null]);
  return linha ? buscarPorId(id) : null;
}

/**
 * Exclusão da empresa. Desativar é a trava de segurança:
 *   - empresa ativa com demandas -> recusa e pede para desativar antes;
 *   - empresa desativada -> apaga tudo dela (demandas com histórico e imagens,
 *     listas auxiliares, contas de acesso e sessões), numa única transação.
 */
async function remover(id, opcoes = {}) {
  const empresa = await buscarPorId(id);
  if (!empresa) return null;

  if (empresa.ativo && empresa.demandas > 0) {
    const erro = new Error(
      `"${empresa.nome}" está ativa e tem ${empresa.demandas} demanda(s). `
      + 'Desative a empresa primeiro — aí a exclusão de tudo fica liberada.');
    erro.status = 409;
    throw erro;
  }
  if (empresa.demandas > 0 && !opcoes.cascata) {
    const erro = new Error(
      `"${empresa.nome}" tem ${empresa.demandas} demanda(s). Confirme a exclusão em cascata.`);
    erro.status = 409;
    erro.detalhe = { demandas: empresa.demandas };
    throw erro;
  }

  return transacao(async (cliente) => {
    // demandas levam histórico e anexos junto (on delete cascade)
    const dem = await cliente.query('delete from od.demandas where empresa_id = $1', [id]);
    const usu = await cliente.query('delete from od.usuario where empresa_id = $1', [id]);
    for (const tabela of ['od.sistemas', 'od.solicitantes', 'od.responsaveis']) {
      await cliente.query(`delete from ${tabela} where empresa_id = $1`, [id]);
    }
    await cliente.query('delete from od.empresa where id = $1', [id]);
    return { nome: empresa.nome, demandas: dem.rowCount, usuarios: usu.rowCount };
  });
}

module.exports = {
  listar, buscarPorId, buscarPorSlug, buscarPorNome, porEmail,
  sistemas, adicionarSistema, criar, atualizar, remover
};
