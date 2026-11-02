/**
 * Model das listas auxiliares: sistemas, solicitantes e responsáveis.
 * As três tabelas têm a mesma forma, então compartilham as operações.
 *
 * Recorte: quem está numa empresa vê os itens dela mais os compartilhados
 * (empresa_id null, como "Não se aplica"), mas só altera os próprios.
 *
 * Solicitantes, responsáveis e tipos de ação são **universais** — um único
 * catálogo para todos os portais, mantido pelo administrador. Só os sistemas
 * pertencem a uma empresa, porque são eles que separam as demandas.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const TABELAS = {
  sistemas: { tabela: 'od.sistemas', vinculo: 'sistema_id', rotulo: 'sistema' },
  // solicitantes e responsáveis são as contas de usuário de cada empresa: o
  // gatilho de od.usuario cria e mantém os itens (db/14_usuarios_como_listas.sql)
  solicitantes: {
    tabela: 'od.solicitantes', vinculo: 'solicitante_id', rotulo: 'solicitante',
    deUsuarios: true
  },
  responsaveis: {
    tabela: 'od.responsaveis', vinculo: 'responsavel_id', rotulo: 'responsável',
    deUsuarios: true
  },
  // o catálogo de tipos de ação é compartilhado: os itens sem empresa valem
  // para todos os portais, e cada empresa pode acrescentar os seus
  tipos: {
    tabela: 'od.tipos_acao', vinculo: 'tipo_acao_id', rotulo: 'tipo de ação',
    compartilhada: true, ordenacao: 'ordem, id'
  }
};

function meta(tipo) {
  const m = TABELAS[tipo];
  if (!m) {
    const erro = new Error(`Lista desconhecida: ${tipo}`);
    erro.status = 404;
    throw erro;
  }
  return m;
}

/** Solicitantes e responsáveis vêm das contas: a lista não é editada aqui. */
function exigirEditavel(m) {
  if (m.deUsuarios) {
    const erro = new Error(
      'Esta lista é formada pelas contas de usuário da empresa. '
      + 'Para incluir, renomear ou desativar alguém, edite a conta em Usuários.');
    erro.status = 409;
    throw erro;
  }
}

const negado = (mensagem) => {
  const erro = new Error(mensagem);
  erro.status = 403;
  throw erro;
};

/**
 * Itens visíveis no escopo, com quantas demandas usam cada um.
 *
 * Dentro de uma empresa aparecem só os itens dela — os cadastros internos do
 * administrador (empresa_id nulo) ficam fora, para não vazar nomes de clientes
 * entre portais. A única exceção é o item fixo "Não se aplica".
 */
async function listar(tipo, escopo) {
  const { tabela, vinculo, compartilhada, deUsuarios, ordenacao } = meta(tipo);
  const empresaId = escopo && escopo.empresaId != null ? escopo.empresaId : null;

  let onde = deUsuarios ? 'and t.usuario_id is not null ' : '';
  if (empresaId !== null) {                         // administrador vê todos
    if (compartilhada) onde += 'and (t.empresa_id = $1 or t.empresa_id is null)';
    else if (tipo === 'sistemas') onde += 'and (t.empresa_id = $1 or t.fixo)';
    else onde += 'and t.empresa_id = $1';
  }
  const vals = empresaId === null ? [] : [empresaId];

  // usuário restrito a sistemas só enxerga os dele (mais o item fixo)
  let restricao = '';
  if (tipo === 'sistemas' && escopo && escopo.sistemasIds && escopo.sistemasIds.length) {
    vals.push(escopo.sistemasIds);
    restricao = ` and (t.id = any($${vals.length}::int[]) or t.fixo)`;
  }

  // inclui os desativados: eles somem dos formulários, mas continuam
  // aparecendo aqui para poderem ser reativados
  return consultar(
    `select t.id, t.nome, t.ativo,
            ${tipo === 'sistemas' ? 't.fixo' : 'false as fixo'},
            ${tipo === 'tipos' ? 't.descricao' : 'null::text as descricao'},
            t.empresa_id,
            ${compartilhada ? '(t.empresa_id is null)'
                            : (tipo === 'sistemas' ? 't.fixo' : 'false')} as compartilhado,
            e.nome as empresa,
            (select count(*)::int from od.demandas d where d.${vinculo} = t.id
              ${empresaId === null ? '' : 'and d.empresa_id = $1'}) as uso
       from ${tabela} t
       left join od.empresa e on e.id = t.empresa_id
      where true ${onde} ${restricao}
      order by t.ativo desc, ${ordenacao || 't.empresa_id nulls first, t.id'}`, vals);
}

/** Todas as listas de uma vez, na chave de cada tipo. */
async function listarTodas(escopo) {
  const tipos = Object.keys(TABELAS);
  const resultados = await Promise.all(tipos.map((t) => listar(t, escopo)));
  return Object.fromEntries(tipos.map((t, i) => [t, resultados[i]]));
}

async function criar(tipo, nome, escopo) {
  const m = meta(tipo);
  exigirEditavel(m);
  const { tabela } = m;
  const empresaId = escopo && escopo.empresaId != null ? escopo.empresaId : null;

  const existente = await consultarUm(
    `select id, ativo from ${tabela}
      where lower(nome) = lower($1) and empresa_id is not distinct from $2`, [nome, empresaId]);
  if (existente && existente.ativo) {
    const erro = new Error('Esse item já existe.');
    erro.status = 409;
    throw erro;
  }
  if (existente) {
    return consultarUm(`update ${tabela} set ativo = true, nome = $2 where id = $1
                        returning id, nome, false as fixo, 0 as uso`, [existente.id, nome]);
  }
  return consultarUm(
    `insert into ${tabela} (nome, empresa_id) values ($1, $2)
     returning id, nome, ${tipo === 'sistemas' ? 'fixo' : 'false as fixo'}, 0 as uso`,
    [nome, empresaId]);
}

/** Garante que o item pertence ao escopo antes de alterar. */
async function carregarProprio(tabela, id, escopo) {
  const alvo = await consultarUm(`select * from ${tabela} where id = $1`, [id]);
  if (!alvo) return null;
  const empresaId = escopo && escopo.empresaId != null ? escopo.empresaId : null;
  if (empresaId !== null && alvo.empresa_id !== empresaId) {
    negado('Este item é compartilhado e só o administrador pode alterá-lo.');
  }
  return alvo;
}

async function renomear(tipo, id, nome, escopo) {
  const m = meta(tipo);
  exigirEditavel(m);
  const { tabela } = m;
  const alvo = await carregarProprio(tabela, id, escopo);
  if (!alvo) return null;
  if (tipo === 'sistemas' && alvo.fixo) negado('Esse item é fixo e não pode ser renomeado.');

  const conflito = await consultarUm(
    `select id from ${tabela}
      where lower(nome) = lower($1) and id <> $2 and empresa_id is not distinct from $3`,
    [nome, id, alvo.empresa_id]);
  if (conflito) {
    const erro = new Error('Já existe um item com esse nome.');
    erro.status = 409;
    throw erro;
  }
  // o vínculo é por id, então renomear já reflete em todas as demandas
  return consultarUm(`update ${tabela} set nome = $2 where id = $1 returning id, nome`, [id, nome]);
}

/**
 * Desativa ou reativa um item.
 * Desativar é o caminho normal: o item some dos formulários, mas as demandas
 * que já o usam continuam mostrando o nome — o histórico não se perde.
 */
async function alternarAtivo(tipo, id, ativo, escopo) {
  const m = meta(tipo);
  exigirEditavel(m);
  const { tabela, rotulo } = m;
  const alvo = await carregarProprio(tabela, id, escopo);
  if (!alvo) return null;
  if (tipo === 'sistemas' && alvo.fixo) negado('Esse item é fixo e fica sempre disponível.');

  if (!ativo) {
    const { ativos } = await consultarUm(
      `select count(*)::int as ativos from ${tabela}
        where ativo and id <> $1 and empresa_id is not distinct from $2`, [id, alvo.empresa_id]);
    if (ativos < 1) {
      const erro = new Error(`Mantenha ao menos um ${rotulo} ativo para abrir demandas.`);
      erro.status = 409;
      throw erro;
    }
  }
  return consultarUm(
    `update ${tabela} set ativo = $2 where id = $1 returning id, nome, ativo`, [id, ativo]);
}

/**
 * Exclusão definitiva. Desativar é a trava: só item já desativado pode ser
 * excluído. Se ele ainda estiver em uso, a exclusão leva junto as demandas
 * vinculadas — mas só quando quem chamou pediu isso explicitamente (cascata).
 */
async function remover(tipo, id, escopo, opcoes = {}) {
  const m = meta(tipo);
  exigirEditavel(m);
  const { tabela, vinculo } = m;
  const alvo = await carregarProprio(tabela, id, escopo);
  if (!alvo) return null;
  if (tipo === 'sistemas' && alvo.fixo) negado('Esse item é fixo e não pode ser removido.');

  if (alvo.ativo) {
    const erro = new Error(`Desative "${alvo.nome}" antes de excluir definitivamente.`);
    erro.status = 409;
    throw erro;
  }

  const { uso } = await consultarUm(
    `select count(*)::int as uso from od.demandas where ${vinculo} = $1`, [id]);

  if (uso > 0 && !opcoes.cascata) {
    const erro = new Error(
      `"${alvo.nome}" está em ${uso} demanda(s). Confirme a exclusão em cascata para apagar tudo.`);
    erro.status = 409;
    erro.detalhe = { uso };
    throw erro;
  }

  return transacao(async (cliente) => {
    // as demandas levam junto histórico e anexos (on delete cascade)
    const { rowCount } = uso > 0
      ? await cliente.query(`delete from od.demandas where ${vinculo} = $1`, [id])
      : { rowCount: 0 };
    await cliente.query(`delete from ${tabela} where id = $1`, [id]);
    return { nome: alvo.nome, demandas: rowCount };
  });
}

module.exports = { listar, listarTodas, criar, renomear, alternarAtivo, remover, TABELAS };
