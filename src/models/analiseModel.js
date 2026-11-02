/**
 * Model de análise — agregações feitas no banco, não no navegador.
 * Todas as consultas partem da mesma CTE `base`, que já aplica os filtros
 * escolhidos na tela (sistema, situação, prioridade, responsável).
 */
const { consultar, consultarUm } = require('../config/db');

const ABERTOS = `('aberta','andamento','aguardando')`;

/** Indicadores do painel inicial (sempre sobre a base inteira). */
async function painel(escopo) {
  const vals = [];
  const onde = recorteSql(escopo, vals);
  const kpis = await consultarUm(`
    select count(*)::int as total,
           count(*) filter (where situacao = 'aberta')::int as abertas,
           count(*) filter (where situacao = 'andamento')::int as andamento,
           count(*) filter (where prioridade = 'urgente'
                              and situacao in ${ABERTOS})::int as urgentes,
           count(*) filter (where situacao = 'concluida'
                              and date_trunc('month', concluida_em) = date_trunc('month', now()))::int
             as concluidas_mes
      from od.demandas d where true ${onde}`, vals);

  const porSituacao = await consultar(`
    select situacao, count(*)::int as valor from od.demandas d where true ${onde} group by 1`, vals);

  const porSistema = await consultar(`
    select si.nome, count(*)::int as valor
      from od.demandas d join od.sistemas si on si.id = d.sistema_id
     where true ${onde} group by 1 having count(*) > 0 order by 2 desc limit 7`, vals);

  const porTipo = await consultar(`
    select coalesce(ta.nome, 'Sem classificação') as nome, count(*)::int as valor
      from od.demandas d left join od.tipos_acao ta on ta.id = d.tipo_acao_id
     where true ${onde} group by 1 order by 2 desc limit 7`, vals);

  return { kpis, porSituacao, porSistema, porTipo };
}

/** Recorte de empresa aplicado à tabela `od.demandas d`. */
function recorteSql(escopo, vals) {
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

/** Traduz os filtros da tela em condições parametrizadas. */
function condicoes(filtros = {}, escopo) {
  const cond = [];
  const vals = [];
  const juntar = (modelo, valor) => {
    vals.push(valor);
    cond.push(modelo.replace('@', '$' + vals.length));
  };
  if (filtros.sistema) juntar('si.nome = @', filtros.sistema);
  if (filtros.situacao) juntar('d.situacao = @::od.situacao', filtros.situacao);
  if (filtros.prioridade) juntar('d.prioridade = @::od.prioridade', filtros.prioridade);
  if (filtros.responsavel) juntar(`coalesce(re.nome, 'Não atribuído') = @`, filtros.responsavel);
  if (filtros.tipo) juntar('ta.nome = @', filtros.tipo);
  if (escopo && escopo.empresaId != null) juntar('d.empresa_id = @', escopo.empresaId);
  if (escopo && escopo.sistemasIds && escopo.sistemasIds.length) {
    juntar('d.sistema_id = any(@::int[])', escopo.sistemasIds);
  }
  return { onde: cond.length ? 'and ' + cond.join(' and ') : '', vals };
}

/** CTE com as demandas que passam pelos filtros (sem recorte de período). */
const cteBase = (onde) => `
  with base as (
    select d.id, d.situacao, d.prioridade, d.criada_em, d.concluida_em,
           si.nome as sistema, coalesce(ta.nome, 'Sem classificação') as tipo_acao,
           coalesce(re.nome, 'Não atribuído') as responsavel
      from od.demandas d
      join od.sistemas si on si.id = d.sistema_id
      left join od.tipos_acao ta on ta.id = d.tipo_acao_id
      left join od.responsaveis re on re.id = d.responsavel_id
     where true ${onde})`;

/** Primeiro dia do mês que abre a janela de N meses. */
function inicioDaJanela(meses) {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - (meses - 1));
  return d;
}

/** Quantos meses cobrir quando o usuário escolhe "todo o período". */
async function mesesDisponiveis(base, vals) {
  const linha = await consultarUm(`${base} select min(criada_em) as inicio from base`, vals);
  if (!linha || !linha.inicio) return 6;
  const inicio = new Date(linha.inicio);
  const hoje = new Date();
  const n = (hoje.getFullYear() - inicio.getFullYear()) * 12
    + (hoje.getMonth() - inicio.getMonth()) + 1;
  return Math.max(3, Math.min(24, n));
}

/**
 * Tudo que a aba Análise precisa.
 * @param {number} meses 0 = todo o período
 * @param {object} filtros { sistema, situacao, prioridade, responsavel }
 */
async function analise(meses, filtros = {}, escopo) {
  const { onde, vals } = condicoes(filtros, escopo);
  const base = cteBase(onde);

  const n = meses > 0 ? meses : await mesesDisponiveis(base, vals);
  const inicio = inicioDaJanela(n);
  const p = vals.length + 1;              // posição do parâmetro da data
  const args = [...vals, inicio];

  const kpis = await consultarUm(`${base}
    select count(*)::int as total,
           count(*) filter (where situacao = 'concluida')::int as concluidas,
           round(100.0 * count(*) filter (where situacao = 'concluida')
                 / nullif(count(*), 0))::int as taxa,
           round(avg(concluida_em::date - criada_em::date)
                 filter (where concluida_em is not null), 1) as dias_medios,
           count(*) filter (where situacao in ${ABERTOS})::int as backlog,
           (select count(*)::int from base) as total_geral
      from base where criada_em >= $${p}`, args);

  const serie = await consultar(`${base}, meses as (
      select generate_series(date_trunc('month', now()) - interval '${n - 1} months',
                             date_trunc('month', now()), interval '1 month') as mes)
    select to_char(m.mes, 'YYYY-MM') as mes,
           extract(month from m.mes)::int as num_mes,
           extract(year from m.mes)::int as ano,
           (select count(*)::int from base b
             where date_trunc('month', b.criada_em) = m.mes) as abertas,
           (select count(*)::int from base b
             where date_trunc('month', b.concluida_em) = m.mes) as concluidas
      from meses m order by m.mes`, vals);

  const porSituacao = await consultar(`${base}
    select situacao, count(*)::int as valor from base
     where criada_em >= $${p} group by 1`, args);

  const porPrioridade = await consultar(`${base}
    select prioridade, count(*)::int as valor from base
     where criada_em >= $${p} group by 1`, args);

  const porSistema = await consultar(`${base}
    select sistema as nome, count(*)::int as valor from base
     where criada_em >= $${p} group by 1 order by 2 desc limit 8`, args);

  const porTipo = await consultar(`${base}
    select tipo_acao as nome, count(*)::int as valor from base
     where criada_em >= $${p} group by 1 order by 2 desc limit 8`, args);

  const porResponsavel = await consultar(`${base}
    select responsavel as nome,
           count(*) filter (where situacao in ${ABERTOS})::int as aberto,
           count(*) filter (where situacao = 'concluida')::int as concluida
      from base
     where criada_em >= $${p} and situacao <> 'cancelada'
     group by 1 order by count(*) desc limit 8`, args);

  return { meses: n, kpis, serie, porSituacao, porPrioridade, porSistema, porTipo, porResponsavel };
}

/* ----------------------------- Projetos ----------------------------- */

const ABERTOS_PROJETO = `('planejamento','andamento','pausado')`;

/**
 * Filtros da aba Análise que fazem sentido para projeto: sistema e responsável.
 * Situação, prioridade e tipo de ação são da demanda, não do projeto.
 */
function condicoesProjeto(filtros = {}, escopo, vals) {
  const cond = [];
  const juntar = (modelo, valor) => {
    vals.push(valor);
    cond.push(modelo.replace('@', '$' + vals.length));
  };
  if (filtros.sistema) juntar('p.sistema = @', filtros.sistema);
  if (filtros.responsavel) juntar('p.responsavel = @', filtros.responsavel);
  if (escopo && escopo.empresaId != null) juntar('p.empresa_id = @', escopo.empresaId);
  if (escopo && escopo.sistemasIds && escopo.sistemasIds.length) {
    juntar('(p.sistema_id is null or p.sistema_id = any(@::int[]))', escopo.sistemasIds);
  }
  return cond.length ? 'and ' + cond.join(' and ') : '';
}

/**
 * Indicadores dos projetos para a aba Análise.
 *
 * A janela de período conta os projetos abertos dentro dela **mais** todos os
 * que ainda estão em aberto — um projeto de um ano atrás que continua rodando
 * precisa aparecer no acompanhamento.
 */
async function projetos(meses, filtros = {}, escopo) {
  const vals = [];
  const onde = condicoesProjeto(filtros, escopo, vals);

  const n = meses > 0 ? meses : 24;
  vals.push(inicioDaJanela(n));
  const janela = `and (p.criado_em >= $${vals.length} or p.situacao in ${ABERTOS_PROJETO})`;
  const recorte = `from od.vw_projetos p where true ${onde} ${janela}`;

  const kpis = await consultarUm(`
    select count(*)::int as total,
           count(*) filter (where situacao in ${ABERTOS_PROJETO})::int as ativos,
           count(*) filter (where situacao = 'concluido')::int as concluidos,
           count(*) filter (where situacao not in ('concluido','cancelado')
                              and fim_previsto is not null
                              and fim_previsto < current_date)::int as atrasados,
           coalesce(round(avg(progresso) filter (where situacao <> 'cancelado'))::int, 0)
             as progresso_medio,
           coalesce(sum(etapas), 0)::int as passos,
           coalesce(sum(etapas_concluidas), 0)::int as passos_concluidos,
           count(*) filter (where tem_requisitos)::int as com_requisitos,
           coalesce(sum(demandas), 0)::int as demandas
      ${recorte}`, vals);

  const porSituacao = await consultar(
    `select situacao, count(*)::int as valor ${recorte} group by 1`, vals);

  // passos dos projetos do recorte, agrupados pela situação de cada passo
  const porPasso = await consultar(`
    select e.situacao, count(*)::int as valor
      from od.projeto_etapa e
      join od.vw_projetos p on p.id = e.projeto_id
     where true ${onde} ${janela}
     group by 1`, vals);

  const andamento = await consultar(`
    select p.id, p.codigo, p.nome, p.situacao, p.prioridade, p.progresso,
           p.etapas, p.etapas_concluidas, p.responsavel, p.sistema,
           p.fim_previsto, p.dias_para_prazo, p.documentos, p.tem_requisitos, p.demandas
      ${recorte}
     order by array_position(array['andamento','planejamento','pausado','concluido','cancelado']::text[],
                             p.situacao::text),
              (p.dias_para_prazo is not null and p.dias_para_prazo < 0) desc,
              p.progresso desc, p.criado_em desc
     limit 12`, vals);

  return { meses: n, kpis, porSituacao, porPasso, andamento };
}

module.exports = { painel, analise, projetos };
