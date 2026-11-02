/**
 * Aba Análise: indicadores e gráficos, e o quadro (kanban) com arrastar e soltar.
 * Os filtros do topo valem para tudo — quem recorta os dados é o banco.
 */
import { api } from './api.js';
import { $, $$, esc, estado, tentar, dataBR, etiquetaPrioridade, preencherSelect } from './ui.js';
import {
  graficoColunas, graficoRosca, graficoBarras, graficoEmpilhado, COR_SITUACAO
} from './graficos.js';
import { SITUACOES as SITUACOES_PROJETO } from './projetos.js';

export const filtros = { sistema: '', situacao: '', prioridade: '', responsavel: '', tipo: '' };

/** O quadro também acompanha os filtros; quem sabe redesenhá-lo é o app.js. */
let redesenharQuadro = async () => {};
export function aoFiltrar(fn) { redesenharQuadro = fn; }

const CAMPOS = [['aSistema', 'sistema'], ['aSituacao', 'situacao'],
  ['aPrioridade', 'prioridade'], ['aResponsavel', 'responsavel'], ['aTipo', 'tipo']];

/** Preenche os selects de filtro com as listas do banco. */
export function montarFiltros() {
  preencherSelect($('#aSistema'),
    estado.listas.sistemas.map((s) => ({
      valor: s.nome, nome: s.ativo === false ? s.nome + ' (inativo)' : s.nome })), true, 'Todos');
  preencherSelect($('#aSituacao'),
    estado.situacoes.map((s) => ({ valor: s.id, nome: s.nome })), true, 'Todas');
  preencherSelect($('#aPrioridade'),
    estado.prioridades.map((p) => ({ valor: p.id, nome: p.nome })), true, 'Todas');
  preencherSelect($('#aResponsavel'),
    estado.listas.responsaveis.map((r) => ({
      valor: r.nome, nome: r.ativo === false ? r.nome + ' (inativo)' : r.nome })), true, 'Todos');
  preencherSelect($('#aTipo'),
    (estado.listas.tipos || []).map((t) => ({ valor: t.nome, nome: t.nome })), true, 'Todos');
  CAMPOS.forEach(([id, chave]) => { $('#' + id).value = filtros[chave]; });
}

export function limparFiltros() {
  Object.keys(filtros).forEach((k) => { filtros[k] = ''; });
  CAMPOS.forEach(([id]) => { $('#' + id).value = ''; });
  return renderAnalise();
}

/** Usado pelo clique nos gráficos (ex.: clicar num sistema filtra por ele). */
export async function aplicarFiltro(chave, valor) {
  filtros[chave] = filtros[chave] === valor ? '' : valor;
  const campo = CAMPOS.find(([, c]) => c === chave);
  if (campo) $('#' + campo[0]).value = filtros[chave];
  await renderAnalise();
  await redesenharQuadro();
}

function lerFiltros() {
  CAMPOS.forEach(([id, chave]) => { filtros[chave] = $('#' + id).value; });
}

/** Aplica filtros vindos do endereço (#analise?sistema=Portal%20Web). */
export function definirFiltros(params) {
  CAMPOS.forEach(([id, chave]) => {
    filtros[chave] = params.get(chave) || '';
    const campo = $('#' + id);
    if (campo) campo.value = filtros[chave];
  });
  const periodo = params.get('meses');
  if (periodo !== null && $('#fPeriodo')) $('#fPeriodo').value = periodo;
}

/** Espelha o recorte atual no endereço, para poder compartilhar a visão. */
function guardarNoEndereco(meses) {
  const params = new URLSearchParams();
  if (meses !== 6) params.set('meses', meses);
  Object.entries(filtros).forEach(([k, v]) => { if (v) params.set(k, v); });
  const consulta = params.toString();
  history.replaceState(null, '', '#analise' + (consulta ? '?' + consulta : ''));
}

/** Liga o clique nas marcas de um gráfico a um filtro. */
function ligarCliques(container, chave) {
  $$('[data-clique]', container).forEach((marca) => {
    marca.addEventListener('click', () => aplicarFiltro(chave, marca.dataset.clique));
  });
}

function descreverFiltros(kpis, meses) {
  const ativos = [];
  if (filtros.sistema) ativos.push(`sistema “${filtros.sistema}”`);
  if (filtros.situacao) ativos.push(`situação “${estado.situacoes.find((s) => s.id === filtros.situacao).nome}”`);
  if (filtros.prioridade) ativos.push(`prioridade “${estado.prioridades.find((p) => p.id === filtros.prioridade).nome}”`);
  if (filtros.responsavel) ativos.push(`responsável “${filtros.responsavel}”`);
  if (filtros.tipo) ativos.push(`tipo “${filtros.tipo}”`);

  const janela = meses ? `últimos ${meses} meses` : 'todo o período';
  $('#resumoFiltro').textContent = ativos.length
    ? `Mostrando ${kpis.total} de ${kpis.total_geral} demandas — ${janela}, filtrando por ${ativos.join(' e ')}. Clique numa barra para alternar o filtro.`
    : `Mostrando ${kpis.total} demanda(s) nos ${janela}. Clique numa barra ou fatia para filtrar.`;
}

export async function renderAnalise() {
  lerFiltros();
  const meses = parseInt($('#fPeriodo').value, 10);
  const dados = await tentar(() => api.analise(meses, filtros));
  if (!dados) return;

  const { kpis, serie, porSituacao, porPrioridade, porSistema, porTipo, porResponsavel } = dados;
  descreverFiltros(kpis, meses);
  guardarNoEndereco(meses);

  const cartoes = [
    { rot: 'Taxa de conclusão', val: (kpis.taxa || 0) + '%',
      sub: `${kpis.concluidas} de ${kpis.total} no recorte`, cor: 'var(--g-concluida)' },
    { rot: 'Tempo médio', val: kpis.dias_medios == null ? '—' : Number(kpis.dias_medios).toFixed(1),
      sub: 'dias até a conclusão', cor: 'var(--primary)' },
    { rot: 'Média mensal', val: (kpis.total / Math.max(1, serie.length)).toFixed(1),
      sub: 'aberturas por mês', cor: 'var(--g-andamento)' },
    { rot: 'Em aberto', val: kpis.backlog,
      sub: 'demandas do recorte ainda abertas', cor: 'var(--g-aberta)' }
  ];
  $('#kpisAnalise').innerHTML = cartoes.map((k) => `
    <div class="kpi" style="--cor:${k.cor}"><div class="rot">${esc(k.rot)}</div>
      <div class="val">${esc(k.val)}</div><div class="sub">${esc(k.sub)}</div></div>`).join('');

  graficoColunas($('#grafMeses'), serie);

  graficoRosca($('#grafRosca'), $('#legRosca'), estado.situacoes.map((s) => {
    const linha = porSituacao.find((x) => x.situacao === s.id);
    return { nome: s.nome, valor: linha ? linha.valor : 0, cor: COR_SITUACAO[s.id], chave: s.id };
  }).filter((f) => f.valor > 0));
  ligarCliques($('#grafRosca'), 'situacao');

  graficoBarras($('#grafPrioridade'), estado.prioridades.slice().reverse().map((p) => {
    const linha = porPrioridade.find((x) => x.prioridade === p.id);
    return { nome: p.nome, valor: linha ? linha.valor : 0, chave: p.id };
  }), 'var(--primary)', 'demanda(s)');
  ligarCliques($('#grafPrioridade'), 'prioridade');

  graficoBarras($('#grafTipo'),
    (porTipo || []).map((t) => ({ ...t, chave: t.nome })), 'var(--roxo)', 'demanda(s)');
  ligarCliques($('#grafTipo'), 'tipo');

  graficoBarras($('#grafSistemas'),
    porSistema.map((s) => ({ ...s, chave: s.nome })), 'var(--primary)', 'demanda(s)');
  ligarCliques($('#grafSistemas'), 'sistema');

  graficoEmpilhado($('#grafResponsaveis'),
    porResponsavel.map((r) => ({ ...r, chave: r.nome })));
  ligarCliques($('#grafResponsaveis'), 'responsavel');

  await renderProjetos();
}

/* ----------------------------- Projetos ----------------------------- */

/** Cores da rosca de situação do projeto, no mesmo tom das etiquetas. */
const COR_PROJETO = {
  planejamento: 'var(--g-aberta)', andamento: 'var(--g-andamento)',
  pausado: 'var(--g-aguardando)', concluido: 'var(--g-concluida)',
  cancelado: 'var(--g-cancelada)'
};

const SITUACOES_PASSO = [
  { id: 'concluida', nome: 'Concluídos' }, { id: 'andamento', nome: 'Em andamento' },
  { id: 'pendente', nome: 'Pendentes' }, { id: 'bloqueada', nome: 'Bloqueados' }
];

const nomeSituacaoProjeto = (id) => {
  const s = SITUACOES_PROJETO.find((x) => x.id === id);
  return s ? s.nome : id;
};

/** Quanto falta (ou passou) do prazo, como etiqueta. */
function selaPrazo(p) {
  if (p.dias_para_prazo == null) return '';
  if (p.dias_para_prazo < 0) {
    return `<span class="tag selo-atraso">${Math.abs(p.dias_para_prazo)}d de atraso</span>`;
  }
  if (p.dias_para_prazo <= 7) {
    return `<span class="tag pr-alta">faltam ${p.dias_para_prazo}d</span>`;
  }
  return `<span class="dica">entrega ${dataBR(p.fim_previsto)}</span>`;
}

/**
 * Área de projetos da aba Análise. Recorta por período, sistema e responsável —
 * os demais filtros são da demanda e não se aplicam ao projeto.
 */
export async function renderProjetos() {
  const meses = parseInt($('#fPeriodo').value, 10);
  const dados = await tentar(() => api.analiseProjetos(meses, {
    sistema: filtros.sistema, responsavel: filtros.responsavel
  }));
  if (!dados) return;

  const { kpis, porSituacao, porPasso, andamento } = dados;

  const cartoes = [
    { rot: 'Projetos ativos', val: kpis.ativos,
      sub: `${kpis.total} no recorte · ${kpis.concluidos} concluído(s)`, cor: 'var(--g-andamento)' },
    { rot: 'Progresso médio', val: kpis.progresso_medio + '%',
      sub: `${kpis.passos_concluidos} de ${kpis.passos} atividade(s) concluída(s)`, cor: 'var(--primary)' },
    { rot: 'Atrasados', val: kpis.atrasados,
      sub: 'passaram da entrega prevista', cor: kpis.atrasados ? 'var(--danger)' : 'var(--g-cancelada)' },
    { rot: 'Com requisitos', val: `${kpis.com_requisitos}/${kpis.total}`,
      sub: 'têm o documento anexado', cor: 'var(--info)' },
    { rot: 'OD ligadas', val: kpis.demandas,
      sub: 'demandas abertas dentro de projetos', cor: 'var(--roxo)' }
  ];
  $('#kpisProjetos').innerHTML = cartoes.map((k) => `
    <div class="kpi" style="--cor:${k.cor}"><div class="rot">${esc(k.rot)}</div>
      <div class="val">${esc(String(k.val))}</div><div class="sub">${esc(k.sub)}</div></div>`).join('');

  graficoRosca($('#grafRoscaProjetos'), $('#legRoscaProjetos'),
    SITUACOES_PROJETO.map((s) => {
      const linha = porSituacao.find((x) => x.situacao === s.id);
      return { nome: s.nome, valor: linha ? linha.valor : 0, cor: COR_PROJETO[s.id] };
    }).filter((f) => f.valor > 0), 'projetos');

  graficoBarras($('#grafPassos'), SITUACOES_PASSO.map((s) => {
    const linha = (porPasso || []).find((x) => x.situacao === s.id);
    return { nome: s.nome, valor: linha ? linha.valor : 0 };
  }), 'var(--roxo)', 'atividade(s)');

  const alvo = $('#andamentoProjetos');
  if (!andamento.length) {
    alvo.innerHTML = '<p class="graf-vazio">Nenhum projeto no recorte. '
      + 'Cadastre o primeiro na aba Projetos.</p>';
    return;
  }
  alvo.innerHTML = `<div class="lista-andamento">${andamento.map((p) => `
    <div class="linha-projeto" data-projeto="${p.id}" role="button" tabindex="0"
         title="Abrir o perfil de ${esc(p.codigo)}">
      <div class="lp-id"><b>${esc(p.codigo)}</b><span>${esc(p.nome)}</span></div>
      <div class="trilho"><div class="preenche" style="width:${p.progresso}%;
        --cor:${p.situacao === 'concluido' ? 'var(--ok)' : COR_PROJETO[p.situacao]}"></div></div>
      <b class="lp-num">${p.progresso}%</b>
      <div class="lp-meta">
        <span class="tag ${(SITUACOES_PROJETO.find((s) => s.id === p.situacao) || {}).classe}"
          >${esc(nomeSituacaoProjeto(p.situacao))}</span>
        <span>✓ ${p.etapas_concluidas}/${p.etapas}</span>
        ${p.demandas ? `<span>🧾 ${p.demandas}</span>` : ''}
        ${selaPrazo(p)}
      </div>
    </div>`).join('')}</div>`;

  $$('#andamentoProjetos [data-projeto]').forEach((linha) => {
    const abrir = () => { location.hash = '#projeto/' + linha.dataset.projeto; };
    linha.addEventListener('click', abrir);
    linha.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });
}

/* ------------------------------ Quadro ------------------------------ */

export async function renderKanban(aoAbrir, aoSoltar) {
  const itens = await tentar(() => api.demandas.todas());
  if (!itens) return;

  // o quadro respeita os mesmos filtros da análise (menos o de situação, que é o eixo)
  const visiveis = itens.filter((d) =>
    (!filtros.sistema || d.sistema === filtros.sistema)
    && (!filtros.prioridade || d.prioridade === filtros.prioridade)
    && (!filtros.responsavel || d.responsavel === filtros.responsavel));

  $('#kanban').innerHTML = estado.situacoes.map((s) => {
    const daColuna = visiveis
      .filter((d) => d.situacao === s.id)
      .sort((a, b) => {
        const peso = (p) => estado.prioridades.findIndex((x) => x.id === p);
        return peso(b.prioridade) - peso(a.prioridade);
      });
    const cartoes = daColuna.map((d) => `
      <div class="mini" draggable="true" data-id="${d.id}">
        <div class="n">${esc(d.numero)}${d.anexos ? ' 📎' : ''}</div>
        <div class="t">${esc(d.titulo)}</div>
        <div class="m">${etiquetaPrioridade(d)}<span>${esc(d.sistema)}</span></div>
      </div>`).join('');
    return `<div class="coluna" data-situacao="${s.id}">
      <h3><span style="color:${s.cor}">${esc(s.nome)}</span><b>${daColuna.length}</b></h3>
      <div class="lista">${cartoes
        || '<p style="color:var(--muted);font-size:12.5px;margin:6px 2px">Vazio</p>'}</div></div>`;
  }).join('');

  $$('#kanban .mini').forEach((el) => {
    el.addEventListener('click', () => aoAbrir(el.dataset.id));
    el.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', el.dataset.id);
      ev.dataTransfer.effectAllowed = 'move';
    });
  });
  $$('#kanban .coluna').forEach((col) => {
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('alvo'); });
    col.addEventListener('dragleave', () => col.classList.remove('alvo'));
    col.addEventListener('drop', (ev) => {
      ev.preventDefault();
      col.classList.remove('alvo');
      aoSoltar(ev.dataTransfer.getData('text/plain'), col.dataset.situacao);
    });
  });
}
