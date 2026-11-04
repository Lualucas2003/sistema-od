/**
 * Aba Demandas: filtros, ordenação e paginação (tudo resolvido no servidor)
 * e o modal de detalhe da OD.
 */
import { api } from './api.js';
import {
  $, $$, esc, canhoto, estado, toast, tentar, dataBR, dataHoraBR, diasDesde,
  etiquetaSituacao, etiquetaPrioridade, celulaAbertura, ABERTOS, preencherSelect
} from './ui.js';
import { htmlGaleria, ligarGaleria } from './anexos.js';
import { confirmar } from './dialogo.js';

export const filtros = { busca: '', situacao: '', prioridade: '', sistema: '', responsavel: '', tipo: '' };
export const ordem = { campo: 'numero', desc: true };
export let pagina = 1;
export let idAberto = null;

const PROXIMA = { aberta: 'andamento', andamento: 'concluida', aguardando: 'andamento' };
const POR_PAGINA = 10;

let aoMudarDados = () => {};
export function aoAtualizar(fn) { aoMudarDados = fn; }

/* ------------------------------ Tabela ------------------------------ */

export async function renderTabela() {
  const dados = await tentar(() => api.demandas.listar(filtros, ordem, pagina, POR_PAGINA));
  if (!dados) return;

  const { itens, total } = dados;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (pagina > totalPaginas) { pagina = totalPaginas; return renderTabela(); }

  const corpo = $('#tabela').querySelector('tbody');
  if (!itens.length) {
    const temFiltro = Object.values(filtros).some(Boolean);
    corpo.innerHTML = `<tr><td colspan="7" class="vazio"><div class="big">🔎</div>${
      temFiltro ? 'Nenhuma demanda corresponde aos filtros.'
                : 'Nenhuma demanda registrada. Crie a primeira OD.'}</td></tr>`;
  } else {
    corpo.innerHTML = itens.map((d) => `
      <tr data-id="${d.id}" data-st="${esc(d.situacao)}">
        <td class="num">${canhoto(d.numero)}</td>
        <td class="titulo-cel"><b>${esc(d.titulo)}</b>${d.anexos
          ? `<i class="clipe" title="${d.anexos} imagem(ns)">📎 ${d.anexos}</i>` : ''}
          <span>${esc(String(d.descricao).slice(0, 90))}</span></td>
        <td data-rotulo="Sistema">${esc(d.sistema)}</td>
        <td data-rotulo="Responsável">${esc(d.responsavel)}</td>
        <td data-rotulo="Prioridade">${etiquetaPrioridade(d)}</td>
        <td data-rotulo="Situação">${etiquetaSituacao(d)}</td>
        <td data-rotulo="Abertura">${celulaAbertura(d)}</td></tr>`).join('');
    corpo.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => abrirModal(tr.dataset.id));
    });
  }

  $('#contagem').textContent = total
    ? `Exibindo ${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, total)} de ${total} demanda(s)`
    : '0 demanda(s)';

  let html = `<button ${pagina === 1 ? 'disabled' : ''} data-p="${pagina - 1}">‹</button>`;
  for (let i = 1; i <= totalPaginas; i++) {
    if (totalPaginas > 7 && i > 2 && i < totalPaginas - 1 && Math.abs(i - pagina) > 1) {
      if (i === 3) html += '<span style="padding:0 4px">…</span>';
      continue;
    }
    html += `<button class="${i === pagina ? 'atual' : ''}" data-p="${i}">${i}</button>`;
  }
  html += `<button ${pagina === totalPaginas ? 'disabled' : ''} data-p="${pagina + 1}">›</button>`;
  $('#paginacao').innerHTML = html;
  $$('#paginacao button[data-p]').forEach((b) => b.addEventListener('click', () => {
    const p = parseInt(b.dataset.p, 10);
    if (p >= 1 && p <= totalPaginas) { pagina = p; renderTabela(); }
  }));

  $$('#tabela th').forEach((th) => {
    const seta = th.querySelector('.seta');
    if (seta) seta.textContent = th.dataset.ord === ordem.campo ? (ordem.desc ? '▼' : '▲') : '';
  });
}

export function irParaPagina(p) { pagina = p; }

/* ------------------------------ Modal ------------------------------ */

export async function abrirModal(id) {
  const d = await tentar(() => api.demandas.buscar(id));
  if (!d) return;
  idAberto = d.id;

  $('#modalNumero').textContent = d.numero;
  $('#modalTitulo').textContent = d.titulo;

  const dias = d.dias_em_aberto != null ? d.dias_em_aberto : diasDesde(d.criada_em);
  const aviso = (ABERTOS.includes(d.situacao) && dias >= 30)
    ? `<div class="aviso"><span>⚠</span><div>Demanda em aberto há ${dias} dias,
        desde ${dataBR(d.criada_em)}.</div></div>` : '';

  const ficha = [
    ['Situação', etiquetaSituacao(d)],
    ['Prioridade', etiquetaPrioridade(d)],
    ['Sistema', esc(d.sistema)],
    ['Tipo de ação', d.tipo_acao
      ? esc(d.tipo_acao) : '<span style="color:var(--muted)">não classificado</span>'],
    ['Projeto', d.projeto_id
      ? `<a href="#projeto/${d.projeto_id}" style="color:var(--primary);text-decoration:none"
           title="${esc(d.projeto)}">${esc(d.projeto_codigo)}</a>`
      : '<span style="color:var(--muted)">nenhum</span>'],
    ['Responsável', esc(d.responsavel)],
    ['Solicitante', esc(d.solicitante)],
    ['Abertura', dataBR(d.criada_em)],
    ['Tempo em aberto', dias == null ? '—' : `${dias} dia(s)`],
    ['Conclusão', d.concluida_em ? dataBR(d.concluida_em) : '—']
  ].map(([r, v]) => `<div><span>${r}</span><b>${v}</b></div>`).join('');

  const historico = (d.historico || []).slice().reverse().map((h) => `
    <li><time>${dataHoraBR(h.registrado_em)}${h.autor ? ' · ' + esc(h.autor) : ''}</time>
      ${esc(h.texto)}</li>`).join('');

  $('#modalCorpo').innerHTML = aviso
    + `<div class="ficha">${ficha}</div>`
    + `<h2 class="sec">Descrição</h2><div class="bloco-desc">${esc(d.descricao)}</div>`
    + htmlGaleria(d)
    + `<h2 class="sec">Registrar andamento</h2>
       <div class="barra-acoes" style="margin-bottom:18px">
         <input type="text" id="novoAndamento" placeholder="Descreva o andamento..."
                style="flex:1;min-width:200px">
         <button class="btn" id="btnAndamento">Registrar</button></div>`
    + `<h2 class="sec">Histórico</h2>
       <ul class="historico">${historico || '<li>Sem registros.</li>'}</ul>`;

  $('#btnAndamento').addEventListener('click', async () => {
    const texto = $('#novoAndamento').value.trim();
    if (!texto) return toast('Escreva o andamento antes de registrar.', 'erro');
    const ok = await tentar(() => api.demandas.andamento(d.id, texto));
    if (ok) { toast('Andamento registrado.'); abrirModal(d.id); }
  });

  ligarGaleria(d.id, () => abrirModal(d.id));

  const proxima = PROXIMA[d.situacao];
  const btn = $('#btnAvancar');
  btn.style.display = proxima ? '' : 'none';
  if (proxima) {
    btn.textContent = 'Marcar como ' + estado.situacoes.find((s) => s.id === proxima).nome;
  }

  $('#modal').classList.add('aberto');
  document.body.style.overflow = 'hidden';
}

export function fecharModal() {
  if (location.hash.startsWith('#od/')) history.replaceState(null, '', '#demandas');
  $('#modal').classList.remove('aberto');
  document.body.style.overflow = '';
  idAberto = null;
}

export async function mudarSituacao(id, situacao) {
  const d = await tentar(() => api.demandas.mudarSituacao(id, situacao));
  if (!d) return;
  toast(`${d.numero} → ${estado.situacoes.find((s) => s.id === situacao).nome}`);
  if (idAberto == id) abrirModal(id);
  aoMudarDados();
}

export async function avancar() {
  if (!idAberto) return;
  const d = await tentar(() => api.demandas.avancar(idAberto));
  if (!d) return;
  toast(`${d.numero} → ${estado.situacoes.find((s) => s.id === d.situacao).nome}`);
  abrirModal(d.id);
  aoMudarDados();
}

export async function excluir() {
  if (!idAberto) return;
  const numero = $('#modalNumero').textContent;
  const titulo = $('#modalTitulo').textContent;
  const ok = await confirmar({
    titulo: `Excluir a ${numero}?`,
    texto: titulo,
    itens: [
      { marca: 'Apaga', texto: 'A demanda, todo o histórico e as imagens anexadas.' },
      { marca: 'Atenção', texto: 'Não há como desfazer. Para tirar de circulação sem perder o registro, cancele a demanda.' }
    ],
    ok: 'Excluir', perigo: true
  });
  if (!ok) return;
  const r = await tentar(() => api.demandas.remover(idAberto));
  if (!r) return;
  toast(r.mensagem);
  fecharModal();
  aoMudarDados();
}

/* --------------------------- Filtros / CSV --------------------------- */

export function montarFiltros() {
  preencherSelect($('#fStatus'), estado.situacoes.map((s) => ({ valor: s.id, nome: s.nome })), true);
  preencherSelect($('#fPrioridade'), estado.prioridades.map((p) => ({ valor: p.id, nome: p.nome })), true);
  preencherSelect($('#fSistema'), estado.listas.sistemas.map((s) => ({
    valor: s.nome, nome: s.ativo === false ? s.nome + ' (inativo)' : s.nome })), true);
  preencherSelect($('#fResponsavel'), estado.listas.responsaveis.map((r) => ({
    valor: r.nome, nome: r.ativo === false ? r.nome + ' (inativo)' : r.nome })), true);
  preencherSelect($('#fTipo'), (estado.listas.tipos || []).map((t) => ({
    valor: t.nome, nome: t.ativo === false ? t.nome + ' (inativo)' : t.nome })), true);
}

export async function exportarCsv() {
  const itens = await tentar(() => api.demandas.todas());
  if (!itens || !itens.length) return toast('Não há demandas para exportar.', 'erro');

  const cab = ['Numero', 'Titulo', 'Descricao', 'Solicitante', 'Sistema relacionado', 'Tipo de acao',
    'Responsavel', 'Prioridade', 'Situacao', 'Abertura', 'Dias em aberto', 'Conclusao'];
  const cel = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const linhas = itens.map((d) => [
    d.numero, d.titulo, d.descricao, d.solicitante, d.sistema, d.tipo_acao || '', d.responsavel,
    estado.prioridades.find((p) => p.id === d.prioridade).nome,
    estado.situacoes.find((s) => s.id === d.situacao).nome,
    dataBR(d.criada_em), d.dias_em_aberto, d.concluida_em ? dataBR(d.concluida_em) : ''
  ].map(cel).join(';'));

  const blob = new Blob(['﻿' + cab.join(';') + '\n' + linhas.join('\n')],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ordens-de-demanda.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${itens.length} demanda(s) exportada(s).`);
}
