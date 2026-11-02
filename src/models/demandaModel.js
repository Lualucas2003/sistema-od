/**
 * Model de demandas — só SQL. Nenhuma regra de HTTP aqui.
 *
 * Toda função recebe `escopo` ({ empresaId }) como primeiro argumento:
 *   empresaId null -> administrador, sem recorte
 *   empresaId N    -> só as demandas da empresa N
 * O recorte entra no SQL; nunca é aplicado depois, em memória.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const CAMPOS_ORDENACAO = {
  numero: 'd.numero',
  titulo: 'd.titulo',
  sistema: 'si.nome',
  responsavel: 're.nome',
  prioridade: "array_position(array['baixa','media','alta','urgente']::text[], d.prioridade::text)",
  situacao: "array_position(array['aberta','andamento','aguardando','concluida','cancelada']::text[], d.situacao::text)",
  criadaEm: 'd.criada_em'
};

const SELECT_BASE = `
  select d.id, d.numero, d.titulo, d.descricao,
         so.nome as solicitante, si.nome as sistema, ta.nome as tipo_acao,
         coalesce(re.nome, 'Não atribuído') as responsavel,
         d.solicitante_id, d.sistema_id, d.responsavel_id, d.tipo_acao_id, d.empresa_id,
         em.nome as empresa, d.projeto_id, pr.codigo as projeto_codigo, pr.nome as projeto,
         d.prioridade, d.situacao, d.criada_em, d.concluida_em,
         (current_date - d.criada_em::date) as dias_em_aberto,
         (select count(*)::int from od.demanda_anexo a where a.demanda_id = d.id) as anexos
    from od.demandas d
    join od.solicitantes so on so.id = d.solicitante_id
    join od.sistemas     si on si.id = d.sistema_id
    left join od.tipos_acao  ta on ta.id = d.tipo_acao_id
    left join od.responsaveis re on re.id = d.responsavel_id
    left join od.empresa em on em.id = d.empresa_id
    left join od.projeto pr on pr.id = d.projeto_id`;

/**
 * Recorte do escopo: empresa e, se o usuário estiver restrito, os sistemas dele.
 * Devolve '' para o administrador sem restrição.
 */
function recorte(escopo, vals) {
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

/** WHERE dos filtros da listagem, já com o recorte de empresa. */
function montarFiltros(escopo, filtros = {}) {
  const cond = [];
  const vals = [];
  if (filtros.situacao) { vals.push(filtros.situacao); cond.push(`d.situacao = $${vals.length}::od.situacao`); }
  if (filtros.prioridade) { vals.push(filtros.prioridade); cond.push(`d.prioridade = $${vals.length}::od.prioridade`); }
  if (filtros.sistema) { vals.push(filtros.sistema); cond.push(`si.nome = $${vals.length}`); }
  if (filtros.responsavel) { vals.push(filtros.responsavel); cond.push(`coalesce(re.nome,'Não atribuído') = $${vals.length}`); }
  if (filtros.tipo) { vals.push(filtros.tipo); cond.push(`ta.nome = $${vals.length}`); }
  if (filtros.busca) {
    vals.push('%' + filtros.busca + '%');
    cond.push(`(d.numero ilike $${vals.length} or d.titulo ilike $${vals.length}
                or d.descricao ilike $${vals.length} or so.nome ilike $${vals.length}
                or si.nome ilike $${vals.length} or coalesce(re.nome,'') ilike $${vals.length})`);
  }
  // o recorte vem como " and X and Y"; aqui vira uma condição da lista
  const doEscopo = recorte(escopo, vals).replace(/^ and /, '');
  if (doEscopo) cond.push(doEscopo);
  return { where: cond.length ? 'where ' + cond.join(' and ') : '', vals };
}

/** Listagem paginada e ordenada. */
async function listar(escopo, filtros = {}, ordem = {}, pagina = 1, porPagina = 10) {
  const { where, vals } = montarFiltros(escopo, filtros);
  const coluna = CAMPOS_ORDENACAO[ordem.campo] || CAMPOS_ORDENACAO.numero;
  const dir = ordem.desc ? 'desc' : 'asc';

  const [{ total }] = await consultar(
    `select count(*)::int as total from od.demandas d
       join od.solicitantes so on so.id = d.solicitante_id
       join od.sistemas si on si.id = d.sistema_id
       left join od.tipos_acao ta on ta.id = d.tipo_acao_id
       left join od.responsaveis re on re.id = d.responsavel_id ${where}`, vals);

  const limite = Math.max(1, Math.min(100, porPagina));
  const salto = (Math.max(1, pagina) - 1) * limite;
  const itens = await consultar(
    `${SELECT_BASE} ${where} order by ${coluna} ${dir}, d.id desc limit ${limite} offset ${salto}`, vals);

  return { itens, total, pagina: Math.max(1, pagina), porPagina: limite };
}

/** Todas as demandas do escopo (quadro, exportação). */
async function listarTudo(escopo) {
  const vals = [];
  const onde = recorte(escopo, vals).replace(/^ and /, 'where ');
  return consultar(`${SELECT_BASE} ${onde} order by d.criada_em desc`, vals);
}

async function buscarPorId(escopo, id) {
  const vals = [id];
  const demanda = await consultarUm(
    `${SELECT_BASE} where d.id = $1 ${recorte(escopo, vals)}`, vals);
  if (!demanda) return null;

  demanda.historico = await consultar(
    `select id, registrado_em, autor, texto from od.demanda_historico
      where demanda_id = $1 order by registrado_em, id`, [id]);
  demanda.imagens = await consultar(
    `select id, nome, tipo, tamanho, largura, altura, criado_em
       from od.demanda_anexo where demanda_id = $1 order by criado_em, id`, [id]);
  return demanda;
}

/** O sistema escolhido precisa pertencer ao escopo de quem está criando. */
async function sistemaPermitido(escopo, sistemaId) {
  const linha = await consultarUm('select empresa_id, fixo from od.sistemas where id = $1', [sistemaId]);
  if (!linha) return false;

  // usuário restrito a sistemas: só pode usar os dele
  if (escopo && escopo.sistemasIds && escopo.sistemasIds.length
      && !escopo.sistemasIds.includes(Number(sistemaId))) return false;

  if (!escopo || escopo.empresaId == null) return true;              // administrador
  // dentro de uma empresa: só os sistemas dela, mais o item fixo "Não se aplica"
  return linha.empresa_id === escopo.empresaId || linha.fixo === true;
}

async function criar(escopo, dados) {
  const linha = await consultarUm(
    `insert into od.demandas
       (titulo, descricao, solicitante_id, sistema_id, responsavel_id, tipo_acao_id,
        prioridade, situacao, empresa_id, projeto_id)
     values ($1, $2, $3, $4, $5, $6, $7::od.prioridade, $8::od.situacao, $9, $10)
     returning id`,
    [dados.titulo, dados.descricao, dados.solicitanteId, dados.sistemaId,
     dados.responsavelId || null, dados.tipoAcaoId || null, dados.prioridade, dados.situacao,
     escopo && escopo.empresaId != null ? escopo.empresaId : null, dados.projetoId || null]);
  if (dados.observacao) await registrarHistorico(linha.id, dados.observacao, dados.autor);
  return buscarPorId(escopo, linha.id);
}

async function atualizar(escopo, id, dados) {
  const atual = await buscarPorId(escopo, id);
  if (!atual) return null;

  await transacao(async (cliente) => {
    await cliente.query(
      `update od.demandas set titulo = $2, descricao = $3, solicitante_id = $4,
              sistema_id = $5, responsavel_id = $6, tipo_acao_id = $7,
              prioridade = $8::od.prioridade, situacao = $9::od.situacao, projeto_id = $10
         where id = $1`,
      [id, dados.titulo, dados.descricao, dados.solicitanteId, dados.sistemaId,
       dados.responsavelId || null, dados.tipoAcaoId || null, dados.prioridade, dados.situacao,
       dados.projetoId || null]);

    const mudou = [];
    if (atual.titulo !== dados.titulo) mudou.push('título');
    if (atual.descricao !== dados.descricao) mudou.push('descrição');
    if (atual.solicitante_id !== dados.solicitanteId) mudou.push('solicitante');
    if (atual.sistema_id !== dados.sistemaId) mudou.push('sistema');
    if ((atual.responsavel_id || null) !== (dados.responsavelId || null)) mudou.push('responsável');
    if ((atual.tipo_acao_id || null) !== (dados.tipoAcaoId || null)) mudou.push('tipo de ação');
    if ((atual.projeto_id || null) !== (dados.projetoId || null)) mudou.push('projeto');
    if (atual.prioridade !== dados.prioridade) mudou.push('prioridade');
    if (mudou.length) {
      await cliente.query(
        `insert into od.demanda_historico (demanda_id, autor, texto) values ($1, $2, $3)`,
        [id, dados.autor || null, `Demanda editada (${mudou.join(', ')}).`]);
    }
    if (dados.observacao) {
      await cliente.query(
        `insert into od.demanda_historico (demanda_id, autor, texto) values ($1, $2, $3)`,
        [id, dados.autor || null, dados.observacao]);
    }
  });
  return buscarPorId(escopo, id);
}

async function mudarSituacao(escopo, id, situacao) {
  const vals = [id, situacao];
  const linha = await consultarUm(
    `update od.demandas d set situacao = $2::od.situacao
      where d.id = $1 ${recorte(escopo, vals)} returning d.id`, vals);
  return linha ? buscarPorId(escopo, id) : null;
}

async function registrarHistorico(id, texto, autor) {
  return consultarUm(
    `insert into od.demanda_historico (demanda_id, autor, texto) values ($1, $2, $3)
     returning id, registrado_em, autor, texto`, [id, autor || null, texto]);
}

async function remover(escopo, id) {
  const vals = [id];
  const linha = await consultarUm(
    `delete from od.demandas d where d.id = $1 ${recorte(escopo, vals)} returning d.numero`, vals);
  return linha ? linha.numero : null;
}

/** Apagar tudo é do administrador; num portal, limpa só a empresa. */
async function removerTodas(escopo) {
  return transacao(async (cliente) => {
    if (escopo && escopo.empresaId != null) {
      const restrito = escopo.sistemasIds && escopo.sistemasIds.length;
      const { rows } = await cliente.query(
        `delete from od.demandas where empresa_id = $1
          ${restrito ? 'and sistema_id = any($2::int[])' : ''} returning id`,
        restrito ? [escopo.empresaId, escopo.sistemasIds] : [escopo.empresaId]);
      return rows.length;
    }
    const { rows } = await cliente.query('select count(*)::int as total from od.demandas');
    await cliente.query('truncate od.demanda_historico, od.demanda_anexo, od.demandas restart identity');
    await cliente.query('delete from od.numeracao');
    return rows[0].total;
  });
}

module.exports = {
  listar, listarTudo, buscarPorId, criar, atualizar, mudarSituacao,
  registrarHistorico, remover, removerTodas, sistemaPermitido
};
