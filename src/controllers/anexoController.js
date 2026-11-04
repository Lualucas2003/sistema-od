/**
 * Controller dos anexos de imagem.
 * Recebe a imagem já em base64 (o navegador converte e reduz antes de enviar),
 * valida tipo/tamanho/quantidade e devolve os metadados.
 */
const anexoModel = require('../models/anexoModel');
const demandaModel = require('../models/demandaModel');

const TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TIPO_PDF = 'application/pdf';
const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TIPOS_DOCUMENTO = [TIPO_PDF, TIPO_DOCX];
const LIMITE_IMAGEM = 3 * 1024 * 1024;      // 3 MB por imagem, já decodificada
const LIMITE_DOCUMENTO = 6 * 1024 * 1024;   // 6 MB por PDF ou DOCX
const LIMITE_POR_DEMANDA = 8;

/**
 * O conteúdo precisa começar como o formato declarado: PDF começa com "%PDF",
 * DOCX é um arquivo ZIP ("PK"). Evita aceitar um arquivo renomeado.
 */
function assinaturaValida(tipo, base64) {
  const inicio = Buffer.from(base64.slice(0, 16), 'base64');
  if (tipo === TIPO_PDF) return inicio.subarray(0, 4).toString('latin1') === '%PDF';
  if (tipo === TIPO_DOCX) return inicio[0] === 0x50 && inicio[1] === 0x4b;
  return true;
}

/** Aceita "data:image/png;base64,AAA..." ou a base64 pura. */
function separarBase64(valor) {
  const texto = String(valor || '');
  const casa = texto.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  return casa ? { tipo: casa[1], base64: casa[2] } : { tipo: null, base64: texto };
}

exports.listar = async (req, res, next) => {
  try {
    const demanda = await demandaModel.buscarPorId(req.escopo, req.params.id);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    res.json(await anexoModel.listarDaDemanda(req.params.id));
  } catch (erro) { next(erro); }
};

exports.enviar = async (req, res, next) => {
  try {
    const demanda = await demandaModel.buscarPorId(req.escopo, req.params.id);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });

    const { tipo: tipoNoDado, base64 } = separarBase64(req.body.dados);
    const tipo = req.body.tipo || tipoNoDado;
    const nome = String(req.body.nome || 'imagem').trim().slice(0, 120);

    const ehDocumento = TIPOS_DOCUMENTO.includes(tipo);
    if (!base64) return res.status(422).json({ mensagem: 'Envie o conteúdo do arquivo.' });
    if (!TIPOS_IMAGEM.includes(tipo) && !ehDocumento) {
      return res.status(422).json({ mensagem: 'Formato não aceito. Use PNG, JPEG, WEBP, GIF, PDF ou DOCX.' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return res.status(422).json({ mensagem: 'Conteúdo do arquivo inválido.' });
    }
    if (!assinaturaValida(tipo, base64)) {
      return res.status(422).json({ mensagem: 'O conteúdo não corresponde ao formato do arquivo.' });
    }

    const tamanho = Buffer.byteLength(base64, 'base64');
    const limite = ehDocumento ? LIMITE_DOCUMENTO : LIMITE_IMAGEM;
    if (tamanho > limite) {
      const mb = limite / (1024 * 1024);
      return res.status(413).json({ mensagem: `Arquivo acima de ${mb} MB. Reduza antes de anexar.` });
    }

    const quantos = await anexoModel.contar(req.params.id);
    if (quantos >= LIMITE_POR_DEMANDA) {
      return res.status(409).json({ mensagem: `Limite de ${LIMITE_POR_DEMANDA} anexos por demanda.` });
    }

    const anexo = await anexoModel.criar(req.params.id, {
      nome, tipo, tamanho, dados: base64,
      largura: parseInt(req.body.largura, 10) || null,
      altura: parseInt(req.body.altura, 10) || null,
      autor: req.usuario ? req.usuario.nome : null
    });
    res.status(201).json(anexo);
  } catch (erro) { next(erro); }
};

/** Devolve a imagem decodificada, para usar direto no src de uma <img>. */
exports.arquivo = async (req, res, next) => {
  try {
    const anexo = await anexoModel.obterConteudo(req.params.anexoId, req.escopo);
    if (!anexo) return res.status(404).json({ mensagem: 'Imagem não encontrada.' });
    const buffer = Buffer.from(anexo.dados, 'base64');
    res.set('Content-Type', anexo.tipo);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(anexo.nome)}"`);
    }
    res.end(buffer);
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    if (!await anexoModel.pertenceAoEscopo(req.params.anexoId, req.escopo)) {
      return res.status(404).json({ mensagem: 'Imagem não encontrada.' });
    }
    const nome = await anexoModel.remover(req.params.anexoId);
    if (!nome) return res.status(404).json({ mensagem: 'Imagem não encontrada.' });
    res.json({ mensagem: `"${nome}" removida.` });
  } catch (erro) { next(erro); }
};
