/**
 * Diálogos da aplicação — substituem confirm() e prompt() do navegador,
 * que abrem uma caixa do sistema, fora do visual do OD.
 *
 *   await confirmar({ titulo, texto, itens, ok, perigo })  -> true | false
 *   await perguntar({ titulo, campos })                    -> { id: valor } | null
 */
import { esc } from './ui.js';

let aberto = null;

function fechar(resposta) {
  if (!aberto) return;
  const { fundo, resolver, aoTeclar } = aberto;
  document.removeEventListener('keydown', aoTeclar, true);
  fundo.remove();
  aberto = null;
  resolver(resposta);
}

/** Monta a caixa e devolve a promessa da resposta. */
function abrir(html, aoMontar, valorCancelado) {
  if (aberto) fechar(valorCancelado);

  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal aberto dialogo-fundo';
  fundo.innerHTML = `<div class="modal dialogo" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(fundo);

  return new Promise((resolver) => {
    const aoTeclar = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();          // não deixa fechar o modal que está atrás
        fechar(valorCancelado);
      }
    };
    document.addEventListener('keydown', aoTeclar, true);
    aberto = { fundo, resolver, aoTeclar };

    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(valorCancelado); });
    fundo.querySelectorAll('[data-fechar]').forEach((b) =>
      b.addEventListener('click', () => fechar(valorCancelado)));

    aoMontar(fundo, (resposta) => fechar(resposta));
  });
}

/**
 * Confirmação com contexto: título, explicação, lista do que vai acontecer.
 * @param {{titulo, texto, itens?, ok?, cancelar?, perigo?, icone?}} opcoes
 */
export function confirmar(opcoes) {
  const {
    titulo, texto, itens = [], ok = 'Confirmar', cancelar = 'Cancelar',
    perigo = false, icone = perigo ? '⚠' : '❓'
  } = opcoes;

  const html = `
    <div class="dialogo-topo">
      <span class="dialogo-icone${perigo ? ' perigo' : ''}">${icone}</span>
      <div>
        <h2>${esc(titulo)}</h2>
        ${texto ? `<p>${esc(texto)}</p>` : ''}
      </div>
      <button class="fechar" data-fechar aria-label="Fechar">&times;</button>
    </div>
    ${itens.length ? `<ul class="dialogo-itens">${itens.map((i) =>
      `<li><b>${esc(i.marca || '•')}</b><span>${esc(i.texto)}</span></li>`).join('')}</ul>` : ''}
    <div class="modal-rodape">
      <button class="btn btn-sm" data-fechar>${esc(cancelar)}</button>
      <button class="btn btn-sm ${perigo ? 'btn-perigo' : 'btn-primario'}" data-ok>${esc(ok)}</button>
    </div>`;

  return abrir(html, (fundo, responder) => {
    const botao = fundo.querySelector('[data-ok]');
    botao.addEventListener('click', () => responder(true));
    botao.focus();
  }, false);
}

/** Senha aleatória fácil de ditar: sem caracteres ambíguos. */
export function senhaAleatoria(tamanho = 12) {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const simbolos = '!@#$%&*';
  const todos = letras + maiusculas + numeros + simbolos;
  const sorteia = (fonte) => fonte[Math.floor(Math.random() * fonte.length)];

  const base = [sorteia(maiusculas), sorteia(numeros), sorteia(simbolos)];
  while (base.length < tamanho) base.push(sorteia(todos));
  return base.sort(() => Math.random() - 0.5).join('');
}

function campoHtml(c) {
  const id = `dlg-${esc(c.id)}`;
  const obrigatorio = c.obrigatorio === false ? '' : 'required';

  if (c.tipo === 'select') {
    return `<div class="campo">
      <label for="${id}">${esc(c.rotulo)}</label>
      <select id="${id}" name="${esc(c.id)}">${(c.opcoes || []).map((o) =>
        `<option value="${esc(o.valor)}" ${o.valor === c.valor ? 'selected' : ''}>${esc(o.nome)}</option>`
      ).join('')}</select>
      ${c.ajuda ? `<div class="dica">${esc(c.ajuda)}</div>` : ''}
    </div>`;
  }

  if (c.tipo === 'textarea') {
    return `<div class="campo">
      <label for="${id}">${esc(c.rotulo)}</label>
      <textarea id="${id}" name="${esc(c.id)}" rows="${Number(c.linhas) || 8}"
                placeholder="${esc(c.dica || '')}">${esc(c.valor || '')}</textarea>
      ${c.ajuda ? `<div class="dica">${esc(c.ajuda)}</div>` : ''}
    </div>`;
  }

  if (c.tipo === 'checks') {
    const marcados = c.valor || [];
    return `<div class="campo">
      <label>${esc(c.rotulo)}</label>
      ${c.opcoes.length ? `<div class="lista-checks" id="${id}">
        ${c.opcoes.map((o) => `
          <label class="check-item${o.desabilitado ? ' desativado' : ''}">
            <input type="checkbox" value="${esc(o.valor)}"
                   ${marcados.includes(o.valor) ? 'checked' : ''}
                   ${o.desabilitado ? 'disabled' : ''}>
            <span>${esc(o.nome)}</span>
            ${o.detalhe ? `<em>${esc(o.detalhe)}</em>` : ''}
          </label>`).join('')}
      </div>` : `<div class="dica">${esc(c.vazio || 'Nenhuma opção disponível.')}</div>`}
      ${c.ajuda ? `<div class="dica">${esc(c.ajuda)}</div>` : ''}
    </div>`;
  }

  return `<div class="campo">
    <label for="${id}">${esc(c.rotulo)}</label>
    <div class="${c.gerar ? 'campo-com-acao' : ''}">
      <input type="${esc(c.tipo || 'text')}" id="${id}" name="${esc(c.id)}"
             value="${esc(c.valor || '')}" placeholder="${esc(c.dica || '')}"
             autocomplete="${esc(c.autocomplete || 'off')}" ${obrigatorio}>
      ${c.gerar ? '<button type="button" class="btn btn-sm" data-gerar>Gerar</button>' : ''}
    </div>
    ${c.ajuda ? `<div class="dica">${esc(c.ajuda)}</div>` : ''}
  </div>`;
}

/**
 * Formulário em diálogo. Campos aceitam tipo text/email/password/date/select,
 * textarea (texto longo) e checks (seleção múltipla), validação por `minimo`
 * e `padrao`, e um botão "Gerar" para senhas.
 * @param {{titulo, texto?, icone?, campos:Array, ok?}} opcoes
 */
export function perguntar(opcoes) {
  const { titulo, texto, campos, ok = 'Salvar', cancelar = 'Cancelar', icone = '✎' } = opcoes;

  const html = `
    <div class="dialogo-topo">
      <span class="dialogo-icone">${icone}</span>
      <div>
        <h2>${esc(titulo)}</h2>
        ${texto ? `<p>${esc(texto)}</p>` : ''}
      </div>
      <button class="fechar" data-fechar aria-label="Fechar">&times;</button>
    </div>
    <form class="dialogo-form">
      ${campos.map(campoHtml).join('')}
      <div class="dialogo-erro" hidden></div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-sm" data-fechar>${esc(cancelar)}</button>
        <button type="submit" class="btn btn-sm btn-primario">${esc(ok)}</button>
      </div>
    </form>`;

  return abrir(html, (fundo, responder) => {
    const form = fundo.querySelector('form');
    const erro = fundo.querySelector('.dialogo-erro');
    const primeiro = form.querySelector('input, select, textarea');
    if (primeiro) primeiro.focus();

    form.querySelectorAll('[data-gerar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const campo = botao.previousElementSibling;
        campo.type = 'text';                 // mostra para poder anotar/copiar
        campo.value = senhaAleatoria();
        campo.focus();
        campo.select();
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const valores = {};
      for (const campo of campos) {
        const el = form.querySelector(`#dlg-${campo.id}`);

        if (campo.tipo === 'checks') {
          // id numerico vira numero; chave de texto ('demanda.ver') fica como esta
          valores[campo.id] = el
            ? Array.from(el.querySelectorAll('input:checked'))
              .map((i) => (/^-?\d+$/.test(i.value) ? Number(i.value) : i.value))
            : [];
          continue;
        }

        const valor = el.value.trim();
        valores[campo.id] = valor;

        const falha = (msg) => {
          erro.textContent = msg;
          erro.hidden = false;
          el.focus();
        };
        if (campo.obrigatorio !== false && !valor) { falha(`Preencha ${campo.rotulo.toLowerCase()}.`); return; }
        if (campo.minimo && valor.length < campo.minimo) {
          falha(`${campo.rotulo}: mínimo de ${campo.minimo} caracteres.`); return;
        }
        if (campo.padrao && valor && !campo.padrao.test(valor)) {
          falha(campo.erro || `${campo.rotulo} inválido.`); return;
        }
      }
      responder(valores);
    });
  }, null);
}
