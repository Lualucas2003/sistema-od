/**
 * Tela inicial: indicadores, demandas recentes e dois gráficos de apoio.
 */
import { api } from './api.js';
import { $, esc, canhoto, etiquetaSituacao, etiquetaPrioridade, estado, tentar } from './ui.js';
import { desenharBarras, PALETA_GRAF, COR_SITUACAO } from './graficos.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export async function renderPainel(aoAbrirDemanda) {
  const dados = await tentar(() => api.painel());
  if (!dados) return;

  const { kpis, porSituacao, porSistema, recentes } = dados;
  const cartoes = [
    { rot: 'Total de OD', val: kpis.total, sub: 'registradas no sistema', cor: 'var(--primary)' },
    { rot: 'Abertas', val: kpis.abertas, sub: 'aguardando início', cor: 'var(--g-aberta)' },
    { rot: 'Em andamento', val: kpis.andamento, sub: 'sendo atendidas', cor: 'var(--g-andamento)' },
    { rot: 'Urgentes', val: kpis.urgentes, sub: 'prioridade máxima em aberto', cor: 'var(--danger)' },
    { rot: 'Concluídas no mês', val: kpis.concluidas_mes, sub: 'finalizadas', cor: 'var(--g-concluida)' }
  ];
  $('#kpis').innerHTML = cartoes.map((k) => `
    <div class="kpi" style="--cor:${k.cor}"><div class="rot">${esc(k.rot)}</div>
      <div class="val">${k.val}</div><div class="sub">${esc(k.sub)}</div></div>`).join('');

  const hoje = new Date();
  $('#resumoData').textContent =
    `Situação em ${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`;

  const corpo = $('#tabelaRecentes').querySelector('tbody');
  if (!recentes.length) {
    corpo.innerHTML = `<tr><td class="vazio"><div class="big">📋</div>
      Nenhuma demanda registrada ainda.</td></tr>`;
  } else {
    corpo.innerHTML = recentes.map((d) => `
      <tr data-id="${d.id}" data-st="${esc(d.situacao)}">
        <td class="num">${canhoto(d.numero)}</td>
        <td class="titulo-cel"><b>${esc(d.titulo)}</b>
          <span>${esc(d.sistema)} • ${esc(d.solicitante)}</span></td>
        <td>${etiquetaPrioridade(d)}</td>
        <td>${etiquetaSituacao(d)}</td></tr>`).join('');
    corpo.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => aoAbrirDemanda(tr.dataset.id));
    });
  }

  desenharBarras($('#graficoStatus'), estado.situacoes.map((s) => {
    const linha = porSituacao.find((x) => x.situacao === s.id);
    return { nome: s.nome, valor: linha ? linha.valor : 0, cor: COR_SITUACAO[s.id] };
  }));

  desenharBarras($('#graficoSistema'), porSistema.map((s, i) => ({
    nome: s.nome, valor: s.valor, cor: PALETA_GRAF[i % PALETA_GRAF.length]
  })));
}
