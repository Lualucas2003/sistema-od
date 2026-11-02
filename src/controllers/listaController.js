/**
 * Controller das listas auxiliares (sistemas, solicitantes, responsáveis).
 */
const listaModel = require('../models/listaModel');

function nomeValido(valor) {
  const nome = String(valor || '').trim();
  return nome.length >= 2 && nome.length <= 60 ? nome : null;
}

exports.listarTodas = async (req, res, next) => {
  try { res.json(await listaModel.listarTodas(req.escopo)); } catch (erro) { next(erro); }
};

exports.listar = async (req, res, next) => {
  try { res.json(await listaModel.listar(req.params.tipo, req.escopo)); } catch (erro) { next(erro); }
};

exports.criar = async (req, res, next) => {
  try {
    const nome = nomeValido(req.body.nome);
    if (!nome) return res.status(422).json({ mensagem: 'Informe um nome entre 2 e 60 caracteres.' });
    res.status(201).json(await listaModel.criar(req.params.tipo, nome, req.escopo));
  } catch (erro) { next(erro); }
};

exports.renomear = async (req, res, next) => {
  try {
    const nome = nomeValido(req.body.nome);
    if (!nome) return res.status(422).json({ mensagem: 'Informe um nome entre 2 e 60 caracteres.' });
    const item = await listaModel.renomear(req.params.tipo, req.params.id, nome, req.escopo);
    if (!item) return res.status(404).json({ mensagem: 'Item não encontrado.' });
    res.json(item);
  } catch (erro) { next(erro); }
};

exports.alternarAtivo = async (req, res, next) => {
  try {
    const ativo = req.body.ativo !== false;
    const item = await listaModel.alternarAtivo(req.params.tipo, req.params.id, ativo, req.escopo);
    if (!item) return res.status(404).json({ mensagem: 'Item não encontrado.' });
    res.json(item);
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    const cascata = req.query.cascata === '1' || req.body.cascata === true;
    const r = await listaModel.remover(req.params.tipo, req.params.id, req.escopo, { cascata });
    if (!r) return res.status(404).json({ mensagem: 'Item não encontrado.' });
    res.json({
      mensagem: `"${r.nome}" removido${r.demandas ? ` com ${r.demandas} demanda(s)` : ''}.`
    });
  } catch (erro) { next(erro); }
};
