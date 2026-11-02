/**
 * Utilidades de interface: seletores, formatação, etiquetas, avisos e estado global.
 */

export const $ = (s, raiz = document) => raiz.querySelector(s);
export const $$ = (s, raiz = document) => Array.from(raiz.querySelectorAll(s));

/** Dados injetados pelo servidor no HTML. */
export const inicial = JSON.parse(document.getElementById('dados-iniciais').textContent);

export const estado = {
  config: inicial.config,
  listas: inicial.listas,
  situacoes: inicial.situacoes,
  prioridades: inicial.prioridades,
  base: inicial.base || '',
  portal: inicial.portal || null,
  usuario: inicial.usuario,
  pode: inicial.pode
};

export const ABERTOS = ['aberta', 'andamento', 'aguardando'];

export function esc(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export const situacaoDe = (id) => estado.situacoes.find((s) => s.id === id) || estado.situacoes[0];
export const prioridadeDe = (id) => estado.prioridades.find((p) => p.id === id) || estado.prioridades[1];

export function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : '—';
}

export function dataHoraBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} às ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function diasDesde(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((hoje - d) / 86400000);
}

export function etiquetaSituacao(d) {
  const s = situacaoDe(d.situacao);
  return `<span class="tag ${s.classe}">${esc(s.nome)}</span>`;
}

export function etiquetaPrioridade(d) {
  const p = prioridadeDe(d.prioridade);
  return `<span class="tag ${p.classe}">${esc(p.nome)}</span>`;
}

export function celulaAbertura(d) {
  const n = d.dias_em_aberto != null ? d.dias_em_aberto : diasDesde(d.criada_em);
  const txt = dataBR(d.criada_em);
  if (ABERTOS.includes(d.situacao) && n >= 30) {
    return `<span class="tag selo-atraso">${txt} • ${n}d em aberto</span>`;
  }
  return txt + (n > 0 ? ` <span style="color:var(--muted)">• ${n}d</span>` : '');
}

export function toast(mensagem, tipo) {
  const el = document.createElement('div');
  el.className = 'toast' + (tipo === 'erro' ? ' erro' : '');
  el.textContent = mensagem;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

/** Executa uma chamada de API mostrando o erro em toast se falhar. */
export async function tentar(fn, mensagemErro) {
  try {
    return await fn();
  } catch (erro) {
    toast(mensagemErro ? `${mensagemErro} ${erro.message}` : erro.message, 'erro');
    return null;
  }
}

export function preencherSelect(sel, itens, incluirTodos, rotuloTodos) {
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = (incluirTodos ? `<option value="">${esc(rotuloTodos || 'Todos')}</option>` : '')
    + itens.map((i) => `<option value="${esc(i.valor)}">${esc(i.nome)}</option>`).join('');
  if (atual && Array.from(sel.options).some((o) => o.value === atual)) sel.value = atual;
}

/** Recarrega as listas auxiliares e reflete nos selects. */
export async function recarregarListas(api) {
  estado.listas = await api.listas.todas();
  return estado.listas;
}
