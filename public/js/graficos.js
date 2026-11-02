/**
 * Gráficos em SVG puro. A paleta foi validada para daltonismo
 * (bandas de luminosidade, separação CVD e contraste) nos temas claro e escuro.
 */
import { esc } from './ui.js';

export const PALETA_GRAF = ['var(--vermelho)', 'var(--rosa)', 'var(--roxo)', 'var(--azul)',
  'var(--ciano)', 'var(--verde)', 'var(--amarelo)', 'var(--laranja)'];

export const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const COR_SITUACAO = {
  aberta: 'var(--g-aberta)', andamento: 'var(--g-andamento)', aguardando: 'var(--g-aguardando)',
  concluida: 'var(--g-concluida)', cancelada: 'var(--g-cancelada)'
};

/** Barra vertical com as duas pontas do dado arredondadas; base reta. */
function barraV(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},-${r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${y + h} Z`;
}

function barraH(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} H${x} Z`;
}

function escalaBonita(max) {
  if (max <= 4) return { topo: Math.max(1, max), passo: 1 };
  const bruto = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  let passo = [1, 2, 5, 10].map((m) => m * mag).find((p) => p >= bruto) || 10 * mag;
  passo = Math.max(1, Math.round(passo));
  return { topo: Math.ceil(max / passo) * passo, passo };
}

const semDados = (alvo, texto) => { alvo.innerHTML = `<p class="graf-vazio">${esc(texto)}</p>`; };

/** Barras horizontais simples usadas no painel inicial. */
export function desenharBarras(alvo, itens) {
  if (!itens.length) { alvo.innerHTML = '<p style="color:var(--muted);margin:0">Sem dados.</p>'; return; }
  const max = itens.reduce((m, i) => Math.max(m, i.valor), 0) || 1;
  alvo.innerHTML = itens.map((i) => `
    <div class="barra-item"><span>${esc(i.nome)}</span>
      <div class="trilho"><div class="preenche" style="--cor:${i.cor};width:${i.valor / max * 100}%"></div></div>
      <b>${i.valor}</b></div>`).join('');
}

/** Colunas agrupadas: aberturas x conclusões por mês. */
export function graficoColunas(alvo, itens) {
  const total = itens.reduce((a, b) => a + b.abertas + b.concluidas, 0);
  if (!total) return semDados(alvo, 'Nenhuma demanda registrada no período.');

  const W = 760, H = 250, ml = 34, mr = 8, mt = 14, mb = 30;
  const larg = W - ml - mr, alt = H - mt - mb;
  const escala = escalaBonita(itens.reduce((m, i) => Math.max(m, i.abertas, i.concluidas), 0));
  const passo = larg / itens.length;
  const bw = Math.min(26, Math.max(4, passo / 2 - 6));

  let s = `<svg class="svg-graf" viewBox="0 0 ${W} ${H}" role="img"
             aria-label="Aberturas e conclusões por mês">`;
  for (let v = 0; v <= escala.topo; v += escala.passo) {
    const y = mt + alt - (v / escala.topo) * alt;
    s += `<line class="grade" x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}"/>
          <text x="${ml - 8}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  itens.forEach((it, i) => {
    const cx = ml + passo * i + passo / 2;
    const rot = MES_CURTO[it.num_mes - 1];
    [['abertas', 'var(--s-criadas)', 'Abertas'], ['concluidas', 'var(--s-concluidas)', 'Concluídas']]
      .forEach((serie, k) => {
        const val = it[serie[0]];
        if (!val) return;
        const h = Math.max(3, (val / escala.topo) * alt);
        const x = cx - bw - 1 + k * (bw + 2);
        s += `<path class="marca" d="${barraV(x, mt + alt - h, bw, h, 4)}" fill="${serie[1]}"
                data-tip="${esc(`${rot}/${String(it.ano).slice(2)} — ${serie[2]}: ${val}`)}"/>`;
      });
    const rotEixo = (i === 0 || it.num_mes === 1) ? `${rot}/${String(it.ano).slice(2)}` : rot;
    s += `<text x="${cx}" y="${H - 10}" text-anchor="middle">${rotEixo}</text>`;
  });
  s += `<line class="base" x1="${ml}" y1="${mt + alt}" x2="${W - mr}" y2="${mt + alt}"/></svg>`;
  alvo.innerHTML = s;
}

/** Rosca com legenda rotulada — identidade nunca só pela cor. */
export function graficoRosca(alvo, alvoLegenda, fatias, unidade = 'demandas') {
  const total = fatias.reduce((a, f) => a + f.valor, 0);
  if (!total) { semDados(alvo, `Sem ${unidade} no período.`); alvoLegenda.innerHTML = ''; return; }

  const R = 62, L = 20, C = 2 * Math.PI * R;
  let off = 0;
  let s = `<svg class="svg-graf" viewBox="0 0 160 160" style="max-width:170px" role="img"
             aria-label="Distribuição por situação"><g transform="translate(80,80) rotate(-90)">`;
  fatias.forEach((f) => {
    const comp = (f.valor / total) * C;
    const vao = fatias.length > 1 ? 2 : 0;
    s += `<circle class="marca" r="${R}" fill="none" stroke="${f.cor}" stroke-width="${L}"
            stroke-dasharray="${Math.max(0.5, comp - vao)} ${C - comp + vao}" stroke-dashoffset="${-off}"
            data-tip="${esc(`${f.nome}: ${f.valor} (${Math.round(f.valor / total * 100)}%)`)}"
            ${f.chave ? `data-clique="${esc(f.chave)}"` : ''}/>`;
    off += comp;
  });
  s += `</g><text x="80" y="76" text-anchor="middle" class="valor" style="font-size:22px">${total}</text>
        <text x="80" y="94" text-anchor="middle">${esc(unidade)}</text></svg>`;
  alvo.innerHTML = s;
  alvoLegenda.innerHTML = fatias.map((f) => `
    <div class="rosca-item"><i style="background:${f.cor}"></i><span>${esc(f.nome)}</span>
      <b>${f.valor}</b><em>${Math.round(f.valor / total * 100)}%</em></div>`).join('');
}

/** Barras horizontais de série única. */
export function graficoBarras(alvo, itens, cor, unidade) {
  itens = itens.filter((i) => i.valor > 0);
  if (!itens.length) return semDados(alvo, 'Sem dados no período.');

  const rotL = 118, valL = 34, W = 520, lin = 30, H = itens.length * lin + 6;
  const max = itens.reduce((m, i) => Math.max(m, i.valor), 0) || 1;
  const larg = W - rotL - valL;

  let s = `<svg class="svg-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Barras horizontais">`;
  itens.forEach((it, i) => {
    const y = i * lin + 5, h = 14;
    const w = Math.max(3, (it.valor / max) * larg);
    const nome = it.nome.length > 18 ? it.nome.slice(0, 17) + '…' : it.nome;
    s += `<text x="0" y="${y + h - 2}">${esc(nome)}</text>
          <path class="marca" d="${barraH(rotL, y, w, h, 4)}" fill="${cor}"
                data-tip="${esc(`${it.nome}: ${it.valor} ${unidade}`)}"
                ${it.chave ? `data-clique="${esc(it.chave)}"` : ''}/>
          <text class="valor" x="${rotL + w + 8}" y="${y + h - 2}">${it.valor}</text>`;
  });
  alvo.innerHTML = s + '</svg>';
}

/** Barras empilhadas: em aberto + concluídas por responsável. */
export function graficoEmpilhado(alvo, itens) {
  if (!itens.length) return semDados(alvo, 'Sem dados no período.');

  const rotL = 118, valL = 34, W = 520, lin = 30, H = itens.length * lin + 6;
  const max = itens.reduce((m, i) => Math.max(m, i.aberto + i.concluida), 0) || 1;
  const larg = W - rotL - valL;

  let s = `<svg class="svg-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carga por responsável">`;
  itens.forEach((it, i) => {
    const y = i * lin + 5, h = 14;
    let x = rotL;
    const nome = it.nome.length > 18 ? it.nome.slice(0, 17) + '…' : it.nome;
    s += `<text x="0" y="${y + h - 2}">${esc(nome)}</text>`;
    [['aberto', 'var(--s-criadas)', 'em aberto'], ['concluida', 'var(--s-concluidas)', 'concluída(s)']]
      .forEach((p) => {
        if (!it[p[0]]) return;
        const w = Math.max(3, (it[p[0]] / max) * larg);
        s += `<path class="marca" d="${barraH(x, y, w, h, 4)}" fill="${p[1]}"
                data-tip="${esc(`${it.nome}: ${it[p[0]]} ${p[2]}`)}"
                ${it.chave ? `data-clique="${esc(it.chave)}"` : ''}/>`;
        x += w + 2; // 2px de respiro entre segmentos
      });
    s += `<text class="valor" x="${x + 6}" y="${y + h - 2}">${it.aberto + it.concluida}</text>`;
  });
  alvo.innerHTML = s + '</svg>';
}

/** Camada de hover compartilhada pelos gráficos. */
export function ligarDicas(raiz) {
  const tip = document.createElement('div');
  tip.id = 'tipGraf';
  document.body.appendChild(tip);

  raiz.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest && e.target.closest('[data-tip]');
    if (!alvo) return;
    tip.textContent = alvo.getAttribute('data-tip');
    tip.classList.add('on');
  });
  raiz.addEventListener('mousemove', (e) => {
    if (!tip.classList.contains('on')) return;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10) + 'px';
    tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px';
  });
  raiz.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('[data-tip]')) tip.classList.remove('on');
  });
}
