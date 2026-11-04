/**
 * Anexos de imagem.
 * O navegador lê o arquivo, reduz quando for grande demais e converte para
 * base64; o servidor guarda essa base64 no banco. Para exibir, usamos
 * /api/anexos/:id/arquivo — assim a base64 não trafega em cada tela.
 */
import { api, urlApi } from './api.js';
import { $, esc, toast, tentar } from './ui.js';
import { confirmar } from './dialogo.js';

export const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TIPO_PDF = 'application/pdf';
const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LIMITE_DOCUMENTO = 6 * 1024 * 1024;
/** Aceita para o seletor de arquivos e o arrastar-e-soltar. */
export const ACCEPT_ANEXOS = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.docx';
const EXTENSOES = { pdf: TIPO_PDF, docx: TIPO_DOCX };

/** O tipo pelo MIME ou, se o navegador não souber, pela extensão. */
function tipoDoArquivo(arquivo) {
  if (TIPOS_ACEITOS.includes(arquivo.type) || arquivo.type === TIPO_PDF || arquivo.type === TIPO_DOCX) {
    return arquivo.type;
  }
  return EXTENSOES[(arquivo.name.split('.').pop() || '').toLowerCase()] || null;
}
export const ehDocumento = (tipo) => tipo === TIPO_PDF || tipo === TIPO_DOCX;
export const rotuloDocumento = (tipo) => (tipo === TIPO_PDF ? 'PDF' : 'DOCX');

/** Imagem é reduzida no navegador; PDF e DOCX seguem como estão, até 6 MB. */
export async function prepararArquivo(arquivo) {
  const tipo = tipoDoArquivo(arquivo);
  if (!tipo) throw new Error(`"${arquivo.name}": use PNG, JPEG, WEBP, GIF, PDF ou DOCX.`);
  if (!ehDocumento(tipo)) return prepararImagem(arquivo);
  if (arquivo.size > LIMITE_DOCUMENTO) {
    throw new Error(`"${arquivo.name}" passa de 6 MB.`);
  }
  const dataUrl = await lerComoDataURL(arquivo);
  return {
    nome: arquivo.name.slice(0, 120),
    tipo, dados: dataUrl.split(',')[1], tamanho: arquivo.size,
    largura: null, altura: null, previa: null
  };
}
const LADO_MAXIMO = 1600;          // px — acima disso a imagem é redimensionada
const ALVO_BYTES = 700 * 1024;     // acima disso tentamos recomprimir
const LIMITE_BYTES = 3 * 1024 * 1024;
export const LIMITE_POR_DEMANDA = 8;

export const tamanhoLegivel = (b) =>
  b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

const lerComoDataURL = (arquivo) => new Promise((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(leitor.result);
  leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
  leitor.readAsDataURL(arquivo);
});

const carregarImagem = (url) => new Promise((ok, falha) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => falha(new Error('Arquivo não é uma imagem válida.'));
  img.src = url;
});

/**
 * Converte o arquivo em { nome, tipo, dados(base64), largura, altura, tamanho, previa }.
 * GIF nunca é redesenhado (perderia a animação).
 */
export async function prepararImagem(arquivo) {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    throw new Error(`"${arquivo.name}": use PNG, JPEG, WEBP ou GIF.`);
  }
  const dataUrl = await lerComoDataURL(arquivo);
  const img = await carregarImagem(dataUrl);

  const precisaEncolher = arquivo.type !== 'image/gif'
    && (Math.max(img.width, img.height) > LADO_MAXIMO || arquivo.size > ALVO_BYTES);

  let saida = dataUrl;
  let tipo = arquivo.type;
  let largura = img.width;
  let altura = img.height;

  if (precisaEncolher) {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
    largura = Math.round(img.width * escala);
    altura = Math.round(img.height * escala);

    const tela = document.createElement('canvas');
    tela.width = largura;
    tela.height = altura;
    const ctx = tela.getContext('2d');
    // PNG com transparência continua PNG; o resto vira JPEG, que fica bem menor
    const manterPng = arquivo.type === 'image/png' && arquivo.size <= ALVO_BYTES;
    if (!manterPng) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, largura, altura);
    }
    ctx.drawImage(img, 0, 0, largura, altura);
    tipo = manterPng ? 'image/png' : 'image/jpeg';
    saida = tela.toDataURL(tipo, 0.82);
  }

  const base64 = saida.split(',')[1];
  const tamanho = Math.round(base64.length * 3 / 4);
  if (tamanho > LIMITE_BYTES) {
    throw new Error(`"${arquivo.name}" continua acima de 3 MB depois da redução.`);
  }

  return {
    nome: arquivo.name.slice(0, 120),
    tipo, dados: base64, largura, altura, tamanho, previa: saida
  };
}

/** Envia uma lista de imagens preparadas para a demanda. */
export async function enviarImagens(demandaId, imagens) {
  let enviadas = 0;
  for (const imagem of imagens) {
    const ok = await tentar(() => api.anexos.enviar(demandaId, imagem));
    if (ok) enviadas++;
  }
  return enviadas;
}

/* --------------------- Fila do formulário (antes de salvar) --------------------- */

export const filaForm = [];

export function limparFila() {
  filaForm.length = 0;
  renderFila();
}

export function renderFila() {
  const alvo = $('#previasForm');
  if (!alvo) return;
  alvo.innerHTML = filaForm.map((img, i) => `
    <figure class="miniatura${ehDocumento(img.tipo) ? ' documento' : ''}">
      ${ehDocumento(img.tipo)
        ? `<span class="doc-abrir"><span>${rotuloDocumento(img.tipo)}</span></span>`
        : `<img src="${img.previa}" alt="${esc(img.nome)}">`}
      <button type="button" class="remover" data-i="${i}" title="Remover">&times;</button>
      <figcaption>${esc(img.nome)}<span>${img.largura}×${img.altura} · ${tamanhoLegivel(img.tamanho)}</span></figcaption>
    </figure>`).join('');
  alvo.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
    filaForm.splice(Number(b.dataset.i), 1);
    renderFila();
  }));
  const contador = $('#contadorAnexos');
  if (contador) {
    contador.textContent = filaForm.length
      ? `${filaForm.length} de ${LIMITE_POR_DEMANDA} anexo(s) selecionado(s)` : '';
  }
}

export async function adicionarNaFila(arquivos) {
  for (const arquivo of arquivos) {
    if (filaForm.length >= LIMITE_POR_DEMANDA) {
      toast(`Limite de ${LIMITE_POR_DEMANDA} anexos por demanda.`, 'erro');
      break;
    }
    try {
      filaForm.push(await prepararArquivo(arquivo));
    } catch (erro) {
      toast(erro.message, 'erro');
    }
  }
  renderFila();
}

/* ------------------------- Galeria do detalhe (modal) ------------------------- */

export function htmlGaleria(demanda) {
  const anexos = demanda.imagens || [];
  const cartoes = anexos.map((img) => (ehDocumento(img.tipo)
    ? `<figure class="miniatura documento" data-nome="${esc(img.nome)}">
        <a class="doc-abrir" href="${urlApi(`/anexos/${img.id}/arquivo`)}" target="_blank" rel="noopener"
           title="Abrir ${esc(img.nome)}"><span>${rotuloDocumento(img.tipo)}</span></a>
        <button type="button" class="remover" data-remove-anexo="${img.id}" title="Remover">&times;</button>
        <figcaption>${esc(img.nome)}<span>${tamanhoLegivel(img.tamanho)} ·
          <a href="${urlApi(`/anexos/${img.id}/arquivo?download=1`)}" download>baixar</a></span></figcaption>
      </figure>`
    : `<figure class="miniatura" data-ver="${img.id}" data-nome="${esc(img.nome)}">
        <img src="${urlApi(`/anexos/${img.id}/arquivo`)}" alt="${esc(img.nome)}" loading="lazy">
        <button type="button" class="remover" data-remove-anexo="${img.id}" title="Remover">&times;</button>
        <figcaption>${esc(img.nome)}<span>${tamanhoLegivel(img.tamanho)}</span></figcaption>
      </figure>`)).join('');

  return `<h2 class="sec">Anexos ${anexos.length ? `(${anexos.length})` : ''}</h2>
    <div class="galeria">${cartoes
      || '<p class="dica" style="margin:0">Nenhum anexo.</p>'}</div>
    <div class="barra-acoes" style="margin:12px 0 18px">
      <label class="btn btn-sm" for="anexoModal">+ Anexar arquivo</label>
      <input type="file" id="anexoModal" accept="${ACCEPT_ANEXOS}" multiple hidden>
      <span class="dica" id="statusAnexo"></span>
    </div>`;
}

/** Liga os eventos da galeria dentro do modal. */
export function ligarGaleria(demandaId, recarregar) {
  const entrada = $('#anexoModal');
  if (entrada) {
    entrada.addEventListener('change', async (e) => {
      const arquivos = Array.from(e.target.files || []);
      e.target.value = '';
      if (!arquivos.length) return;
      $('#statusAnexo').textContent = 'Enviando...';
      const preparadas = [];
      for (const arquivo of arquivos) {
        try { preparadas.push(await prepararArquivo(arquivo)); }
        catch (erro) { toast(erro.message, 'erro'); }
      }
      const n = await enviarImagens(demandaId, preparadas);
      if (n) toast(`${n} imagem(ns) anexada(s).`);
      recarregar();
    });
  }
  document.querySelectorAll('[data-remove-anexo]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nome = b.closest('figure').dataset.nome || 'esta imagem';
      const ok = await confirmar({
        titulo: 'Remover a imagem?',
        texto: nome,
        itens: [{ marca: 'Atenção', texto: 'A imagem é apagada do banco e o histórico registra a remoção.' }],
        ok: 'Remover', perigo: true
      });
      if (!ok) return;
      const r = await tentar(() => api.anexos.remover(b.dataset.removeAnexo));
      if (r) { toast(r.mensagem); recarregar(); }
    });
  });
  document.querySelectorAll('[data-ver]').forEach((fig) => {
    fig.addEventListener('click', () => abrirVisor(fig.dataset.ver, fig.dataset.nome));
  });
}

/* --------------------------------- Visor --------------------------------- */

export function abrirVisor(id, nome) {
  const visor = $('#visorImagem');
  $('#visorFoto').src = urlApi(`/anexos/${id}/arquivo`);
  $('#visorNome').textContent = nome || '';
  $('#visorBaixar').href = urlApi(`/anexos/${id}/arquivo?download=1`);
  visor.classList.add('aberto');
}

export function fecharVisor() {
  $('#visorImagem').classList.remove('aberto');
  $('#visorFoto').removeAttribute('src');
}
