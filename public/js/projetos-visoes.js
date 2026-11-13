/**
 * Formas de ver a lista de projetos: tabela (projeto → atividades), cartões,
 * quadro por situação e cronograma. Só desenha — dados, filtros e a abertura
 * do projeto continuam em projetos.js, que passa o que precisa em `ctx`.
 */
import { esc } from './ui.js';

export const MODOS = [
  { id: 'tabela', nome: 'Tabela', icone: '☰' },
  { id: 'cartoes', nome: 'Cartões', icone: '▦' },
  { id: 'quadro', nome: 'Quadro', icone: '▥' },
  { id: 'cronograma', nome: 'Cronograma', icone: '▤' }
];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIA = 86400000;

const paraData = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : null);
const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const curta = (iso) => { const d = paraData(iso); return d ? `${d.getDate()} ${MESES[d.getMonth()]}` : ''; };

function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length || nome === 'Não atribuído') return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

const CORES = ['#8b30e8', '#2f6bff', '#00a7b8', '#e6273c', '#e08a00', '#1aa63a', '#d4106a'];
function corDe(nome) {
  let h = 0;
  for (const c of String(nome || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

const avatar = (nome) => `<span class="vt-avatar" style="--c:${corDe(nome)}"
  title="${esc(nome || 'Não atribuído')}">${esc(iniciais(nome))}</span>`;

function haQuanto(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const dias = Math.floor((Date.now() - d) / DIA);
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) return `${dias} dias atrás`;
  const sem = Math.floor(dias / 7);
  if (sem < 5) return `${sem} ${sem === 1 ? 'semana' : 'semanas'} atrás`;
  const mes = Math.floor(dias / 30);
  if (mes < 12) return `${mes} ${mes === 1 ? 'mês' : 'meses'} atrás`;
  const ano = Math.floor(dias / 365);
  return `${ano} ${ano === 1 ? 'ano' : 'anos'} atrás`;
}

/** Situação do projeto → cor do bloco de status da tabela. */
const COR_SITUACAO = {
  planejamento: 'info', andamento: 'roxo', pausado: 'warn', concluido: 'ok', cancelado: 'mudo'
};
const COR_ETAPA = { pendente: 'mudo', andamento: 'warn', concluida: 'ok', bloqueada: 'danger' };

/* ------------------------------- Tabela ------------------------------- */

/** Barra do projeto: um trecho para cada situação dos seus itens (como no print). */
function barraStatus(p) {
  const lista = p.etapas_lista || [];
  if (!lista.length) {
    return `<span class="vt-status vt-${COR_SITUACAO[p.situacao] || 'mudo'}">${esc(p.situacaoNome)}</span>`;
  }
  const conta = (s) => lista.filter((e) => e.situacao === s).length;
  const trechos = ['concluida', 'andamento', 'bloqueada', 'pendente']
    .map((s) => ({ s, n: conta(s) })).filter((t) => t.n);
  return `<div class="vt-barra" title="${esc(trechos.map((t) => `${t.n} ${t.s}`).join(' · '))}">
    ${trechos.map((t) => `<i class="vt-${COR_ETAPA[t.s]}" style="flex:${t.n}"></i>`).join('')}</div>`;
}

/** Pílula de cronograma do projeto: "1 jul – 31 out". */
function pilulaProjeto(p) {
  if (!p.inicio_previsto && !p.fim_previsto) return '<span class="vt-pilula vt-vazio">sem datas</span>';
  const texto = [curta(p.inicio_previsto), curta(p.fim_previsto)].filter(Boolean).join(' – ');
  const classe = p.situacao === 'concluido' ? 'ok'
    : (p.dias_para_prazo != null && p.dias_para_prazo < 0 ? 'danger'
      : (p.situacao === 'planejamento' || p.situacao === 'pausado' ? 'mudo' : 'rosa'));
  return `<span class="vt-pilula vt-${classe}">${p.situacao === 'concluido' ? '✓ ' : ''}${texto}</span>`;
}

/** Pílula do prazo de uma atividade: verde se concluída, vermelha se atrasada. */
function pilulaEtapa(e) {
  if (!e.prazo) return '<span class="vt-pilula vt-vazio">—</span>';
  const atrasada = e.situacao !== 'concluida' && paraData(e.prazo) < hoje();
  if (e.situacao === 'concluida') return `<span class="vt-pilula vt-ok">✓ ${curta(e.prazo)}</span>`;
  return `<span class="vt-pilula ${atrasada ? 'vt-danger' : 'vt-escuro'}">${atrasada ? '! ' : ''}${curta(e.prazo)}</span>`;
}

/** Próximo passo do projeto: a primeira atividade ainda não concluída. */
function proximoPasso(p) {
  const e = (p.etapas_lista || []).find((i) => i.situacao !== 'concluida');
  return e ? e.titulo : '';
}

function linhaProjeto(p, ctx, aberto) {
  const lista = p.etapas_lista || [];
  return `
    <div class="vt-linha vt-grupo" data-projeto="${p.id}">
      <div class="vt-c vt-nome">
        <button type="button" class="vt-seta ${aberto ? 'aberto' : ''}" data-recolher="${p.id}"
                aria-label="${aberto ? 'Recolher' : 'Expandir'} atividades" ${lista.length ? '' : 'disabled'}>▾</button>
        <a href="#projeto/${p.id}" class="vt-titulo" title="${esc(p.codigo)} — ${esc(p.nome)}">${esc(p.nome)}</a>
        ${lista.length ? `<span class="vt-conta" title="${p.etapas_concluidas} de ${p.etapas} concluídos">${lista.length}</span>` : ''}
      </div>
      <div class="vt-c vt-resp">${avatar(p.responsavel)}</div>
      <div class="vt-c">${barraStatus(p)}</div>
      <div class="vt-c">${pilulaProjeto(p)}</div>
      <div class="vt-c vt-atual">${avatar(p.responsavel)}<span>${haQuanto(p.atualizado_em)}</span></div>
      <div class="vt-c vt-passos" title="${esc(proximoPasso(p))}">${esc(proximoPasso(p))}</div>
    </div>`;
}

function linhaEtapa(e, ctx) {
  const s = ctx.situacaoEtapa(e.situacao);
  const feita = e.situacao === 'concluida';
  const ultima = e.concluida_em || e.criada_em;
  const opcoes = ctx.SITUACOES_ETAPA.map((o) =>
    `<option value="${o.id}" ${o.id === e.situacao ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  return `
    <div class="vt-linha vt-filha" data-projeto-filho="${e.projeto_id}">
      <div class="vt-c vt-nome vt-sub">
        <input type="checkbox" class="vt-check" data-etapa-feita="${e.id}" ${feita ? 'checked' : ''}
               ${ctx.pode ? '' : 'disabled'} aria-label="Marcar como concluído">
        <span class="vt-tipo" title="${esc(e.tipo)}">${e.tipo === 'requisito' ? 'RF' : (e.tipo === 'atividade' ? 'AT' : 'PS')}</span>
        <span class="vt-titulo ${feita ? 'feito' : ''}" title="${esc(e.titulo)}">${esc(e.titulo)}</span>
      </div>
      <div class="vt-c vt-resp">${avatar(e.responsavel)}</div>
      <div class="vt-c vt-cel-status">
        <select class="vt-sel vt-${COR_ETAPA[e.situacao]}" data-etapa-status="${e.id}"
                ${ctx.pode ? '' : 'disabled'} aria-label="Situação">${opcoes}</select>
      </div>
      <div class="vt-c">${pilulaEtapa(e)}</div>
      <div class="vt-c vt-atual">${avatar(e.responsavel)}<span>${haQuanto(ultima)}</span></div>
      <div class="vt-c vt-passos" title="${esc(e.descricao || '')}">${esc((e.descricao || '').split('\n')[0])}</div>
    </div>`;
}

function tabela(itens, ctx) {
  const recolhidos = ctx.recolhidos;
  const cabecalho = ['Projeto', 'Responsável', 'Status', 'Cronograma', 'Última atualização', 'Próximos passos']
    .map((t) => `<div class="vt-c">${t}</div>`).join('');
  const corpo = itens.map((p) => {
    p.situacaoNome = ctx.situacao(p.situacao).nome;
    const aberto = !recolhidos.has(String(p.id));
    return `<div class="vt-bloco" data-bloco="${p.id}">
      ${linhaProjeto(p, ctx, aberto)}
      <div class="vt-filhas" ${aberto ? '' : 'hidden'}>${(p.etapas_lista || []).map((e) => linhaEtapa(e, ctx)).join('')}</div>
    </div>`;
  }).join('');
  return `
    <div class="vt-barra-acoes">
      <button class="btn btn-sm" type="button" data-vt-todos="abrir">Expandir todos</button>
      <button class="btn btn-sm" type="button" data-vt-todos="fechar">Recolher todos</button>
    </div>
    <div class="vt-tabela cartao" role="table">
      <div class="vt-linha vt-cab" role="row">${cabecalho}</div>
      ${corpo}
    </div>`;
}

/* ------------------------------- Quadro ------------------------------- */

function quadro(itens, ctx) {
  const colunas = ctx.SITUACOES.map((s) => {
    const doGrupo = itens.filter((p) => p.situacao === s.id);
    return `<section class="vq-coluna">
      <header><span class="tag ${s.classe}">${esc(s.nome)}</span><b>${doGrupo.length}</b></header>
      <div class="vq-lista">${doGrupo.length
        ? doGrupo.map(ctx.cartao).join('') : '<p class="dica vq-vazio">Nenhum projeto.</p>'}</div>
    </section>`;
  }).join('');
  return `<div class="vq">${colunas}</div>`;
}

/* ----------------------------- Cronograma ----------------------------- */

function cronograma(itens, ctx) {
  const comDatas = itens.filter((p) => p.inicio_previsto || p.fim_previsto);
  const semDatas = itens.filter((p) => !(p.inicio_previsto || p.fim_previsto));
  if (!comDatas.length) {
    return '<div class="cartao vazio"><div class="big">📅</div>Nenhum projeto tem datas previstas para o cronograma.</div>';
  }
  const ini = (p) => paraData(p.inicio_previsto || p.fim_previsto);
  const fim = (p) => paraData(p.fim_previsto || p.inicio_previsto);
  let min = new Date(Math.min(...comDatas.map(ini), hoje()));
  let max = new Date(Math.max(...comDatas.map(fim), hoje()));
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const total = (max - min) / DIA + 1;
  const pct = (d) => ((d - min) / DIA / total) * 100;

  const meses = [];
  for (let d = new Date(min); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const prox = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    meses.push(`<div class="vc-mes" style="left:${pct(d)}%;width:${pct(prox > max ? new Date(max.getTime() + DIA) : prox) - pct(d)}%">
      ${MESES[d.getMonth()]}${d.getMonth() === 0 || d === min ? ' ' + d.getFullYear() : ''}</div>`);
  }
  const hojePct = pct(hoje());

  const linhas = comDatas.map((p) => {
    const a = pct(ini(p));
    const l = Math.max(pct(new Date(fim(p).getTime() + DIA)) - a, 0.8);
    const cor = COR_SITUACAO[p.situacao] || 'mudo';
    return `<div class="vc-linha" data-projeto="${p.id}">
      <a href="#projeto/${p.id}" class="vc-nome" title="${esc(p.nome)}">${esc(p.nome)}</a>
      <div class="vc-pista">
        <div class="vc-barra vt-${cor}" style="left:${a}%;width:${l}%"
             title="${esc(p.nome)} · ${esc([curta(p.inicio_previsto), curta(p.fim_previsto)].filter(Boolean).join(' – '))} · ${p.progresso}%">
          <i style="width:${p.progresso}%"></i><span>${p.progresso}%</span>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="vc cartao">
      <div class="vc-linha vc-cab"><div class="vc-nome">Projeto</div>
        <div class="vc-pista">${meses.join('')}</div></div>
      <div class="vc-corpo">
        <div class="vc-hoje" style="left:calc(var(--vc-nome) + (100% - var(--vc-nome)) * ${hojePct / 100})" title="Hoje"></div>
        ${linhas}
      </div>
    </div>
    ${semDatas.length ? `<p class="dica" style="margin-top:10px">Sem datas previstas (fora do cronograma):
      ${semDatas.map((p) => `<a href="#projeto/${p.id}">${esc(p.nome)}</a>`).join(' · ')}</p>` : ''}`;
}

/* ------------------------------- Entrada ------------------------------- */

/**
 * Desenha `itens` em `alvo` no modo pedido.
 * ctx: { SITUACOES, SITUACOES_ETAPA, situacao(id), situacaoEtapa(id), cartao(p), pode, recolhidos:Set }
 */
export function desenharVisao(modo, itens, alvo, ctx) {
  if (modo === 'cartoes') {
    alvo.innerHTML = `<div class="grade-projetos">${itens.map(ctx.cartao).join('')}</div>`;
  } else if (modo === 'quadro') {
    alvo.innerHTML = quadro(itens, ctx);
  } else if (modo === 'cronograma') {
    alvo.innerHTML = cronograma(itens, ctx);
  } else {
    alvo.innerHTML = tabela(itens, ctx);
  }
}
