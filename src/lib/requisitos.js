/**
 * Lê o texto do documento de requisitos e devolve a lista de requisitos —
 * cada um vira um passo de execução do projeto.
 *
 *   extrairRequisitos(texto, formato) -> { itens, estrategia, aviso }
 *
 * A leitura é por marcação: linhas que começam com código de requisito
 * (RF01, RNF-2, US 3), numeração (1., 1.2), letra (a)) ou marcador (-, •)
 * são o começo de um requisito; o que vem depois sem marcação é continuação
 * do anterior. Não havendo marcação nenhuma, cai para uma leitura frouxa,
 * linha a linha, e avisa que foi assim.
 */

/** Início de requisito, da marcação mais específica para a mais genérica. */
const MARCACOES = [
  // RF01 · RNF-02 · REQ 3 · US 4 · HU-5 · CDU 6 — código de requisito
  { nome: 'codigo', re: /^\[?((?:RF|RNF|RNFU|REQ|REQU?I?S?|US|HU|CT|CDU|UC|R)[\s._-]?\d{1,3}(?:\.\d{1,3})*)\]?[\s.:)–—-]+(.{3,})$/i },
  // 1. · 1) · 1.2.3 - · 01 -
  { nome: 'numero', re: /^(\d{1,3}(?:\.\d{1,3})*)[.)\s][\s.:)–—-]*(.{3,})$/ },
  // a) · b.
  { nome: 'letra', re: /^([a-z])[).]\s+(.{3,})$/i },
  // - · • · * · – · ▪ · [ ] (lista de tarefas)
  { nome: 'marcador', re: /^[-–—*•▪◦·o]\s*(?:\[[ xX]\]\s*)?(.{3,})$/ },
  // ## Título (markdown)
  { nome: 'titulo', re: /^#{1,6}\s+(.{3,})$/ }
];

/** Cabeçalhos que indicam onde começa a parte que interessa. */
const SECAO_RELEVANTE =
  /^\s*(?:\d+[.)\s]*)?(requisitos?(\s+(funcionais?|n[aã]o[\s-]funcionais?|do\s+sistema|do\s+neg[oó]cio))?|escopo|funcionalidades?|entregas?|hist[oó]rias?(\s+de\s+usu[aá]rio)?|casos?\s+de\s+uso|atividades?|tarefas?|etapas?|passos?|backlog)\s*:?\s*$/i;

/** Cabeçalhos que encerram a parte que interessa. */
const SECAO_IRRELEVANTE =
  /^\s*(?:\d+[.)\s]*)?(introdu[cç][aã]o|objetivo\s+do\s+documento|glossário|gloss[aá]rio|refer[eê]ncias?|anexos?|hist[oó]rico\s+de\s+revis[oõ]es|aprova[cç][oõ]es?|assinaturas?|contatos?|cronograma|or[cç]amento|riscos?)\s*:?\s*$/i;

/** Linhas que são enfeite de documento, não requisito. */
const RUIDO = [
  /^p[aá]g(ina)?\.?\s*\d+(\s*(de|\/)\s*\d+)?$/i,
  /^\d{1,3}$/,
  /^[\W_]+$/,
  /^(sum[aá]rio|[ií]ndice|conte[uú]do)$/i,
  /^vers[aã]o\s|^data:|^autor:|^elaborado por|^documento de requisitos$/i,
  /^confidencial/i
];

const LIMITE_ITENS = 60;
const LIMITE_TITULO = 160;

const normalizar = (t) => String(t || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira os acentos
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const limpar = (t) => String(t || '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s.:)\]–—-]+/, '')
  .replace(/[\s;,]+$/, '')
  .trim();

/** Tira a marcação de título (markdown) para reconhecer o cabeçalho de seção. */
const semMarcacao = (linha) => String(linha)
  .replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/[:\s]+$/, '').trim();

/** O que essa linha é: cabeçalho da parte que interessa, da que não interessa, ou nada. */
function secao(linha) {
  const nu = semMarcacao(linha);
  if (SECAO_RELEVANTE.test(nu)) return 'relevante';
  if (SECAO_IRRELEVANTE.test(nu)) return 'irrelevante';
  return null;
}

/** Linha de sumário ("Requisitos funcionais ....... 7") não é requisito. */
const ehSumario = (linha) => /\.{4,}\s*\d{1,3}$/.test(linha) || /\s{3,}\d{1,3}$/.test(linha);

/** Corta o título num limite, sem partir palavra. */
function encurtar(texto, limite = LIMITE_TITULO) {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite);
  const espaco = corte.lastIndexOf(' ');
  return (espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,;.]+$/, '') + '…';
}

/** Remove cabeçalho/rodapé que se repete em todas as páginas. */
function tirarRepetidas(linhas) {
  const contagem = new Map();
  linhas.forEach((l) => {
    if (l.length <= 70) contagem.set(l, (contagem.get(l) || 0) + 1);
  });
  return linhas.filter((l) => (contagem.get(l) || 0) < 4);
}

/* ------------------------------- CSV ------------------------------- */

/** Quebra a linha do CSV respeitando aspas. */
function celulas(linha) {
  const saida = [];
  let atual = '';
  let aspas = false;
  const separador = (linha.match(/;/g) || []).length >= (linha.match(/,/g) || []).length ? ';' : ',';
  for (const c of linha) {
    if (c === '"') { aspas = !aspas; continue; }
    if (c === separador && !aspas) { saida.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  saida.push(atual.trim());
  return saida;
}

/** Numa planilha/CSV, o requisito é a célula mais descritiva de cada linha. */
function requisitosDeTabela(linhas) {
  const itens = [];
  linhas.forEach((linha, indice) => {
    const cols = celulas(linha).filter(Boolean);
    if (cols.length < 2) return;
    if (indice === 0 && /requisit|descri|item|t[ií]tulo|id\b/i.test(linha)) return;   // cabeçalho
    const descricao = cols.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (descricao.length < 6) return;
    const codigo = cols.find((c) => c !== descricao && /^[A-Z]{1,4}[\s._-]?\d{1,3}(\.\d{1,3})*$/i.test(c));
    itens.push({ codigo: codigo ? codigo.toUpperCase() : null, texto: limpar(descricao), detalhe: '' });
  });
  return itens;
}

/* ----------------------------- Leitura ----------------------------- */

function casar(linha) {
  for (const { nome, re } of MARCACOES) {
    const casa = linha.match(re);
    if (!casa) continue;
    return nome === 'codigo'
      ? { codigo: casa[1].toUpperCase().replace(/[\s._-]+/, '-'), texto: limpar(casa[2]) }
      : { codigo: null, texto: limpar(casa[casa.length - 1]) };
  }
  return null;
}

/** A linha continua o requisito anterior (quebra de linha do editor)? */
function ehContinuacao(linha, atual) {
  if (!atual || !linha) return false;
  if (linha.length > 180) return false;
  if (secao(linha)) return false;
  // começou em minúscula, ou o anterior ficou sem terminar a frase
  return /^[a-zà-ÿ(]/.test(linha) || !/[.;:!?]$/.test(atual.texto + (atual.detalhe || ''));
}

/**
 * @param {string} texto    conteúdo do documento
 * @param {string} formato  extensão, para tratar CSV/planilha como tabela
 * @returns {{itens: Array, estrategia: string, aviso: string|null}}
 */
function extrairRequisitos(texto, formato) {
  const cru = String(texto || '').replace(/\r\n?/g, '\n');
  if (!cru.trim()) return { itens: [], estrategia: 'vazio', aviso: 'O documento não tem texto.' };

  const uteis = cru.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !RUIDO.some((r) => r.test(semMarcacao(l))) && !ehSumario(l));
  const linhas = tirarRepetidas(uteis);

  // planilha e CSV: cada linha é um requisito, na coluna mais descritiva
  if (['csv', 'xlsx', 'ods'].includes(formato)) {
    const daTabela = requisitosDeTabela(linhas);
    if (daTabela.length >= 2) return finalizar(daTabela, 'tabela', null);
  }

  // documento no padrão "[RF01] Título / Prioridade / descrição": cada bloco é um passo
  // (sem tirar as repetidas: "Prioridade: ☒ Essencial" se repete em todo bloco)
  const estruturado = requisitosEstruturados(uteis);
  if (estruturado.length >= 2) return finalizar(estruturado, 'estruturado', null);

  // recorta a partir do cabeçalho de requisitos, se houver
  const inicio = linhas.findIndex((l) => secao(l) === 'relevante');
  let recorte = linhas;
  let estrategia = 'marcacao';
  if (inicio >= 0) {
    const resto = linhas.slice(inicio + 1);
    const fim = resto.findIndex((l) => secao(l) === 'irrelevante');
    const trecho = fim >= 0 ? resto.slice(0, fim) : resto;
    if (trecho.filter((l) => casar(l)).length >= 2) {
      recorte = trecho;
      estrategia = 'secao';
    }
  }

  const itens = [];
  let atual = null;
  for (const linha of recorte) {
    if (secao(linha)) { atual = null; continue; }     // cabeçalho de seção não é requisito
    const casa = casar(linha);
    if (casa && casa.texto.length >= 4) {
      atual = { codigo: casa.codigo, texto: casa.texto, detalhe: '' };
      itens.push(atual);
      continue;
    }
    if (ehContinuacao(linha, atual)) {
      // continuação curta emenda no título; o resto vira detalhe
      if (atual.texto.length < LIMITE_TITULO && !atual.detalhe) atual.texto = limpar(atual.texto + ' ' + linha);
      else atual.detalhe = limpar((atual.detalhe + ' ' + linha));
      continue;
    }
    atual = null;
  }

  if (itens.length) return finalizar(itens, estrategia, null);

  // sem marcação nenhuma: cada linha com cara de frase vira um passo
  const frouxo = recorte
    .filter((l) => !secao(l) && l.length >= 8 && l.length <= 400 && /[a-zà-ÿ]{3,}/i.test(l))
    .map((l) => ({ codigo: null, texto: limpar(l), detalhe: '' }));
  if (!frouxo.length) {
    return { itens: [], estrategia: 'nenhum', aviso: 'Não encontrei requisitos no documento.' };
  }
  return finalizar(frouxo, 'linhas',
    'O documento não tem lista numerada nem marcadores, então cada linha virou um item. '
    + 'Confira e desmarque o que não for requisito.');
}

/* ------------------------- Documento estruturado ------------------------- */

/** "[RF01] Autenticação e Sessão" — código do requisito no começo da linha. */
const CABECALHO_REQUISITO = /^\[?((RNF|RF|REQ|UC|CDU|US|HU)[\s._-]?(\d{1,3}(?:\.\d{1,3})*))\]?\s*[–—:.-]?\s+(\S.{2,})$/i;

/** Título de seção numerada: "3. Requisitos Funcionais (RF)", "3.2 Base de conhecimento". */
const ehTituloNumerado = (linha) => linha.length <= 90
  && /^\d{1,2}(\.\d{1,2})*\.?\s+[A-ZÀ-Ú]/.test(linha) && !/[.;:!?]$/.test(linha);

/** Caixas de seleção marcadas: "Prioridade: ☒ Essencial ☐ Importante". */
function prioridadeMarcada(linha) {
  const casa = linha.match(/(?:☒|☑|✔|✓|\[[xX]\]|\(x\))\s*([A-Za-zÀ-ÿ]+)/);
  return casa ? casa[1] : null;
}

/** Linha de tabela ("célula | célula") vira "célula: célula". */
const linhaDeTabela = (linha) => (linha.includes(' | ')
  ? linha.split(' | ').map((c) => c.trim()).filter(Boolean).join(': ')
  : linha);

/**
 * Lê os blocos que começam por código de requisito. Quando o documento tem
 * requisitos funcionais/não funcionais (RF/RNF), só eles viram passos — os
 * casos de uso (UC) ficam de fora, citados dentro da descrição do RF.
 */
function requisitosEstruturados(linhas) {
  const blocos = [];
  let atual = null;
  for (const linha of linhas) {
    const casa = linha.match(CABECALHO_REQUISITO);
    if (casa && linha.length <= 160 && !/[.;]$/.test(linha)) {
      atual = {
        tipo: casa[2].toUpperCase(),
        codigo: `${casa[2].toUpperCase()}${casa[3].padStart(2, '0')}`,
        texto: limpar(casa[4]),
        linhas: []
      };
      blocos.push(atual);
      continue;
    }
    if (ehTituloNumerado(linha)) { atual = null; continue; }
    if (atual) atual.linhas.push(linha);
  }

  const temRequisitos = blocos.some((b) => b.tipo === 'RF' || b.tipo === 'RNF');
  return blocos
    .filter((b) => !temRequisitos || b.tipo === 'RF' || b.tipo === 'RNF')
    .map((b) => {
      let prioridade = null;
      const casos = [];
      const corpo = [];
      for (const l of b.linhas) {
        if (/^prioridade\s*:/i.test(l)) { prioridade = prioridadeMarcada(l) || prioridade; continue; }
        const caso = l.match(/^casos?\s+de\s+uso\s+relacionados?\s*:\s*(.+)$/i);
        if (caso) { casos.push(caso[1].trim()); continue; }
        corpo.push(linhaDeTabela(l));
      }
      const detalhe = [
        prioridade ? `Prioridade: ${prioridade}` : '',
        corpo.join('\n'),
        casos.length ? `Casos de uso relacionados: ${casos.join('; ')}` : ''
      ].filter(Boolean).join('\n\n');
      return { codigo: b.codigo, texto: b.texto, detalhe, prioridade };
    });
}

/**
 * Ficha do projeto tirada do documento: nome (do título) e objetivo
 * (subtítulo + seções de escopo/visão geral/objetivo do sistema).
 */
function extrairFicha(texto, tituloArquivo) {
  const linhas = String(texto || '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!linhas.length) return { nome: null, objetivo: null };

  const semPrefixo = (t) => String(t || '')
    .replace(/^(documento\s+de\s+)?(especifica[cç][aã]o\s+de\s+)?requisitos?(\s+(funcionais|de\s+software))?\s*(d[oae]s?\s+)?/i, '')
    .replace(/^projeto\s*[:–—-]\s*/i, '')
    .trim();
  const titulo = [tituloArquivo, linhas[0]]
    .map((t) => String(t || '').trim())
    .find((t) => t.length >= 3 && t.length <= 160 && !ehTituloNumerado(t));
  const nome = titulo ? (semPrefixo(titulo) || titulo).slice(0, 120) : null;

  // subtítulo: a linha logo abaixo do título, se não for seção nem tabela
  const sub = linhas[1] && !ehTituloNumerado(linhas[1]) && !linhas[1].includes(' | ')
    && linhas[1].length <= 240 && !/^hist[oó]rico/i.test(linhas[1]) ? linhas[1] : '';

  // parágrafos das seções que descrevem o sistema
  const SECOES = /^(\d{1,2}(\.\d{1,2})*\.?\s+)?(escopo(\s+do\s+(sistema|projeto))?|vis[aã]o\s+geral(\s+do\s+(sistema|projeto))?|objetivo\s+do\s+(sistema|projeto)|descri[cç][aã]o\s+(geral|do\s+(sistema|projeto)))$/i;
  const paragrafos = [];
  let dentro = false;
  for (const linha of linhas) {
    if (ehTituloNumerado(linha) || SECOES.test(linha)) {
      dentro = SECOES.test(linha);
      continue;
    }
    if (dentro && !linha.includes(' | ')) paragrafos.push(linha);
  }
  const objetivo = [sub, ...paragrafos].filter(Boolean).join('\n\n').slice(0, 4000) || null;
  return { nome, objetivo };
}

/** Tira repetidos, corta títulos longos e limita a quantidade. */
function finalizar(itens, estrategia, aviso) {
  const vistos = new Set();
  const saida = [];
  for (const item of itens) {
    const texto = limpar(item.texto);
    if (texto.length < 4) continue;
    const chave = normalizar((item.codigo || '') + ' ' + texto);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);

    const completo = item.codigo ? `${item.codigo} — ${texto}` : texto;
    const titulo = encurtar(completo);
    const detalhe = [titulo.endsWith('…') ? completo : '', item.detalhe]
      .filter(Boolean).join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    saida.push({ codigo: item.codigo, titulo, descricao: detalhe || null, prioridade: item.prioridade || null });
    if (saida.length >= LIMITE_ITENS) break;
  }
  return {
    itens: saida,
    estrategia,
    aviso: saida.length ? aviso : 'Não encontrei requisitos no documento.'
  };
}

module.exports = { extrairRequisitos, extrairFicha };
