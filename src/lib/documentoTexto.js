/**
 * Extrai o texto de um documento anexado, para dele tirar os requisitos.
 *
 * Sem dependência nova: os formatos do Office/LibreOffice são arquivos ZIP
 * com XML dentro (o `zlib` do Node dá conta), e o PDF é lido pelos operadores
 * de texto dos seus fluxos comprimidos.
 *
 *   extrairTexto(buffer, nome, tipo) -> { texto, formato, aviso }
 *
 * `aviso` explica quando o arquivo até foi aberto, mas o texto não veio —
 * PDF de imagem escaneada, por exemplo. Quem chama decide o que dizer ao usuário.
 */
const zlib = require('node:zlib');

/* ------------------------------ ZIP ------------------------------ */

/** Lê o diretório central do ZIP e indexa os arquivos pelo nome. */
function abrirZip(buffer) {
  let eocd = -1;
  const limite = Math.max(0, buffer.length - 66000);   // comentário final cabe em 64 KB
  for (let i = buffer.length - 22; i >= limite; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const total = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const arquivos = new Map();
  for (let n = 0; n < total && p + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const tamanhoNome = buffer.readUInt16LE(p + 28);
    arquivos.set(buffer.toString('utf8', p + 46, p + 46 + tamanhoNome), {
      metodo: buffer.readUInt16LE(p + 10),
      comprimido: buffer.readUInt32LE(p + 20),
      offset: buffer.readUInt32LE(p + 42)
    });
    p += 46 + tamanhoNome + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return arquivos.size ? { buffer, arquivos } : null;
}

/** Devolve o conteúdo já descomprimido de um arquivo de dentro do ZIP. */
function lerDoZip(zip, nome) {
  const item = zip.arquivos.get(nome);
  if (!item) return null;
  const b = zip.buffer;
  if (item.offset + 30 > b.length || b.readUInt32LE(item.offset) !== 0x04034b50) return null;

  // os tamanhos do cabeçalho local podem vir zerados; os do diretório central valem
  const inicio = item.offset + 30
    + b.readUInt16LE(item.offset + 26) + b.readUInt16LE(item.offset + 28);
  const dados = b.subarray(inicio, inicio + item.comprimido);
  try {
    if (item.metodo === 0) return dados;
    if (item.metodo === 8) return zlib.inflateRawSync(dados);
  } catch (e) { /* entrada corrompida: segue sem ela */ }
  return null;
}

const nomesDoZip = (zip, padrao) =>
  Array.from(zip.arquivos.keys()).filter((n) => padrao.test(n)).sort();

/* ------------------------------ XML ------------------------------ */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodificarXml(texto) {
  return texto.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (inteiro, corpo) => {
    if (corpo[0] === '#') {
      const codigo = corpo[1] === 'x' || corpo[1] === 'X'
        ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteiro;
    }
    return ENTIDADES[corpo.toLowerCase()] !== undefined ? ENTIDADES[corpo.toLowerCase()] : inteiro;
  });
}

/**
 * XML de documento -> texto puro, uma linha por parágrafo.
 * As tags de fim de parágrafo/linha/célula de cada formato viram quebra de linha.
 */
function textoDoXml(xml) {
  return decodificarXml(String(xml)
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<(w:br|text:line-break|a:br)\b[^>]*\/?>/g, '\n')
    // parágrafos: Word, ODF, planilhas (célula/linha) e slides
    .replace(/<\/(w:p|text:p|text:h|text:list-item|a:p|si|t|table:table-row)>/g, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Tabelas do Word: cada linha da tabela vira uma linha de texto, com as
 * células separadas por " | " — sem isso, cada célula viraria um parágrafo
 * solto e o conteúdo da tabela se misturaria com o texto em volta.
 */
function achatarTabelasDocx(xml) {
  return String(xml).replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (celula) =>
    celula.replace(/<\/w:p>/g, ' ').replace(/<w:br\b[^>]*\/?>/g, ' ') + ' | ')
    .replace(/<\/w:tr>/g, '</w:p>');
}

/** Título gravado nas propriedades do arquivo (Arquivo → Informações). */
function tituloDasPropriedades(zip) {
  const core = lerDoZip(zip, 'docProps/core.xml') || lerDoZip(zip, 'meta.xml');
  if (!core) return null;
  const casa = String(core).match(/<dc:title>([\s\S]*?)<\/dc:title>/);
  const titulo = casa ? decodificarXml(casa[1]).trim() : '';
  return titulo || null;
}

/* ------------------------------ PDF ------------------------------ */

// 0x80–0x9F do WinAnsi não batem com o Latin-1; são os caracteres "de máquina de escrever"
const WINANSI = {
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x85: '…', 0x80: '€', 0x8a: 'Š'
};

const deLatin1 = (bruto) => bruto.replace(/[\x80-\x9f]/g,
  (c) => WINANSI[c.charCodeAt(0)] || c);

/** Lê uma string literal do PDF — "(texto \(com\) escapes)". */
function lerLiteralPdf(conteudo, inicio) {
  let i = inicio + 1;
  let nivel = 1;
  let saida = '';
  while (i < conteudo.length) {
    const c = conteudo[i];
    if (c === '\\') {
      const proximo = conteudo[i + 1];
      const octal = conteudo.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
      if (octal) {
        saida += String.fromCharCode(parseInt(octal[0], 8));
        i += 1 + octal[0].length;
        continue;
      }
      saida += { n: '\n', r: '\n', t: '\t', b: '', f: '' }[proximo] !== undefined
        ? { n: '\n', r: '\n', t: '\t', b: '', f: '' }[proximo] : proximo;
      i += 2;
      continue;
    }
    if (c === '(') nivel++;
    if (c === ')') { nivel--; if (!nivel) { i++; break; } }
    saida += c;
    i++;
  }
  return { texto: deLatin1(saida), fim: i };
}

/** String hexadecimal do PDF — "<48656C6C6F>"; com BOM, é UTF-16BE. */
function lerHexPdf(hex) {
  const limpo = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = Buffer.from(limpo.length % 2 ? limpo + '0' : limpo, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return bytes.subarray(2).swap16().toString('utf16le');
  }
  return deLatin1(bytes.toString('latin1'));
}

/**
 * Percorre um fluxo de conteúdo do PDF juntando o que os operadores de texto
 * desenham. A quebra de linha vem do reposicionamento vertical (Td/TD/Tm/T*).
 */
function textoDoFluxoPdf(conteudo) {
  const linhas = [];
  let atual = '';
  let ultimoY = null;
  let numeros = [];
  let emArray = 0;
  const quebrar = () => { if (atual.trim()) linhas.push(atual.trim()); atual = ''; };

  let i = 0;
  while (i < conteudo.length) {
    const c = conteudo[i];

    if (c === '%') { while (i < conteudo.length && conteudo[i] !== '\n') i++; continue; }
    if (c === '(') { const r = lerLiteralPdf(conteudo, i); atual += r.texto; i = r.fim; continue; }
    if (c === '<' && conteudo[i + 1] === '<') { i += 2; continue; }          // dicionário
    if (c === '<') {
      const fim = conteudo.indexOf('>', i);
      if (fim < 0) break;
      atual += lerHexPdf(conteudo.slice(i + 1, fim));
      i = fim + 1;
      continue;
    }
    if (c === '[') { emArray++; i++; continue; }
    if (c === ']') { if (emArray) emArray--; i++; continue; }
    if (c === '>' || c === '/' ) {                                            // nome ou fim de dicionário
      if (c === '/') { i++; while (i < conteudo.length && /[^\s/[\]()<>]/.test(conteudo[i])) i++; }
      else i++;
      continue;
    }
    if (/[-+.\d]/.test(c)) {
      let j = i;
      while (j < conteudo.length && /[-+.\dEe]/.test(conteudo[j])) j++;
      const valor = parseFloat(conteudo.slice(i, j));
      // dentro de [ ] do TJ, deslocamento bem negativo é espaço entre palavras
      if (emArray && valor < -170 && atual && !atual.endsWith(' ')) atual += ' ';
      numeros.push(valor);
      i = j;
      continue;
    }
    if (/[A-Za-z'"*]/.test(c)) {
      let j = i;
      while (j < conteudo.length && /[A-Za-z0-9*'"]/.test(conteudo[j])) j++;
      const op = conteudo.slice(i, j);
      i = j;

      if (op === 'Td' || op === 'TD') {
        if (numeros.length >= 1 && numeros[numeros.length - 1] !== 0) quebrar();
        else if (atual && !atual.endsWith(' ')) atual += ' ';
      } else if (op === 'Tm') {
        const y = numeros[numeros.length - 1];
        if (ultimoY !== null && Math.abs(y - ultimoY) > 0.5) quebrar();
        ultimoY = y;
      } else if (op === 'T*' || op === "'" || op === '"' || op === 'ET') {
        quebrar();
      }
      numeros = [];
      continue;
    }
    i++;
  }
  quebrar();
  return linhas.join('\n');
}

/** Junta o texto de todos os fluxos de conteúdo do PDF. */
function textoDoPdf(buffer) {
  const bruto = buffer.toString('latin1');
  const partes = [];
  let pos = 0;

  while (partes.length < 4000) {
    const ini = bruto.indexOf('stream', pos);
    if (ini < 0) break;
    if (bruto.slice(ini - 3, ini) === 'end') { pos = ini + 6; continue; }
    const fim = bruto.indexOf('endstream', ini);
    if (fim < 0) break;

    let d = ini + 6;
    if (bruto[d] === '\r') d++;
    if (bruto[d] === '\n') d++;
    const dados = buffer.subarray(d, fim);

    let conteudo = null;
    try { conteudo = zlib.inflateSync(dados).toString('latin1'); }
    catch (e) {
      const cru = dados.toString('latin1');
      if (/\bBT\b/.test(cru) && /T[Jj]/.test(cru)) conteudo = cru;   // fluxo sem compressão
    }
    if (conteudo && /T[Jj]|\bTf\b/.test(conteudo)) partes.push(textoDoFluxoPdf(conteudo));
    pos = fim + 9;
  }

  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** O texto saiu legível ou virou sopa de letrinhas (fonte sem mapa Unicode)? */
function pareceTexto(texto) {
  if (!texto || texto.length < 12) return false;
  const legiveis = (texto.match(/[A-Za-zÀ-ÿ0-9 .,;:()[\]\-–—/%$@#'"!?\n\t]/g) || []).length;
  return legiveis / texto.length > 0.72 && /[A-Za-zÀ-ÿ]{3,}/.test(texto);
}

/* --------------------------- Porta de entrada --------------------------- */

const TEXTO_PURO = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'html', 'htm', 'xml', 'rtf'];

/** Extrai as marcações do RTF, que é texto puro com comandos entre chaves. */
function textoDoRtf(bruto) {
  return bruto
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (t, h) => deLatin1(String.fromCharCode(parseInt(h, 16))))
    .replace(/\\u(-?\d+)\s?\??/g, (t, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {Buffer} buffer   conteúdo do arquivo já decodificado
 * @param {string} nome     nome original (a extensão define o formato)
 * @returns {{texto: string, formato: string, aviso: string|null}}
 */
function extrairTexto(buffer, nome) {
  const formato = (String(nome || '').split('.').pop() || '').toLowerCase();

  if (formato === 'rtf') {
    return { texto: textoDoRtf(buffer.toString('latin1')), formato, aviso: null };
  }
  if (TEXTO_PURO.includes(formato)) {
    let texto = buffer.toString('utf8');
    if (texto.includes('�')) texto = deLatin1(buffer.toString('latin1'));  // arquivo em ANSI
    if (formato === 'html' || formato === 'htm' || formato === 'xml') texto = textoDoXml(texto);
    return { texto: texto.replace(/\r\n?/g, '\n').trim(), formato, aviso: null };
  }

  if (['docx', 'odt', 'ods', 'xlsx', 'pptx', 'odp'].includes(formato)) {
    const zip = abrirZip(buffer);
    if (!zip) {
      return { texto: '', formato, aviso: 'Não consegui abrir o arquivo — ele parece corrompido.' };
    }
    const alvos = {
      docx: ['word/document.xml'],
      odt: ['content.xml'],
      ods: ['content.xml'],
      odp: ['content.xml'],
      xlsx: ['xl/sharedStrings.xml'].concat(nomesDoZip(zip, /^xl\/worksheets\/sheet\d+\.xml$/)),
      pptx: nomesDoZip(zip, /^ppt\/slides\/slide\d+\.xml$/)
    }[formato];

    const partes = alvos.map((a) => lerDoZip(zip, a)).filter(Boolean)
      .map((xml) => textoDoXml(formato === 'docx' ? achatarTabelasDocx(xml) : xml));
    const texto = partes.join('\n')
      .replace(/[ \t]*\|[ \t]*(?=\n|$)/g, '')        // barra que sobra no fim da linha da tabela
      .replace(/\n{3,}/g, '\n\n').trim();
    return {
      texto, formato,
      titulo: tituloDasPropriedades(zip),
      aviso: texto ? null : 'O arquivo abriu, mas não encontrei texto dentro dele.'
    };
  }

  if (formato === 'pdf') {
    const texto = textoDoPdf(buffer);
    if (!pareceTexto(texto)) {
      return {
        texto: '', formato,
        aviso: 'Não consegui ler o texto deste PDF (provavelmente é digitalizado ou usa fonte '
          + 'sem mapa de caracteres). Anexe o documento em DOCX, ODT, TXT ou MD — '
          + 'ou cole o texto dos requisitos na importação.'
      };
    }
    return { texto, formato, aviso: null };
  }

  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(formato)) {
    return {
      texto: '', formato,
      aviso: 'Imagens não têm texto para ler. Anexe o documento em DOCX, ODT, TXT ou MD — '
        + 'ou cole o texto dos requisitos na importação.'
    };
  }

  return {
    texto: '', formato,
    aviso: `Não sei ler arquivos .${formato || '(sem extensão)'}. `
      + 'Use DOCX, ODT, RTF, TXT, MD, CSV, planilhas ou PDF com texto.'
  };
}

module.exports = { extrairTexto, pareceTexto };
