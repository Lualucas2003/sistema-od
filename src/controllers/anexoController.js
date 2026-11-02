/**
 * Controller dos anexos de imagem.
 * Recebe a imagem já em base64 (o navegador converte e reduz antes de enviar),
 * valida tipo/tamanho/quantidade e devolve os metadados.
 */
const anexoModel = require('../models/anexoModel');
const demandaModel = require('../models/demandaModel');

const TIPOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const LIMITE_BYTES = 3 * 1024 * 1024;   // 3 MB por imagem, já decodificada
const LIMITE_POR_DEMANDA = 8;

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

    if (!base64) return res.status(422).json({ mensagem: 'Envie o conteúdo da imagem.' });
    if (!TIPOS.includes(tipo)) {
      return res.status(422).json({ mensagem: 'Formato não aceito. Use PNG, JPEG, WEBP ou GIF.' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return res.status(422).json({ mensagem: 'Conteúdo da imagem inválido.' });
    }

    const tamanho = Buffer.byteLength(base64, 'base64');
    if (tamanho > LIMITE_BYTES) {
      return res.status(413).json({ mensagem: 'Imagem acima de 3 MB. Reduza antes de anexar.' });
    }

    const quantos = await anexoModel.contar(req.params.id);
    if (quantos >= LIMITE_POR_DEMANDA) {
      return res.status(409).json({ mensagem: `Limite de ${LIMITE_POR_DEMANDA} imagens por demanda.` });
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
