/**
 * Controller do painel inicial e da aba Análise.
 */
const analiseModel = require('../models/analiseModel');
const demandaModel = require('../models/demandaModel');

exports.painel = async (req, res, next) => {
  try {
    const [dados, recentes] = await Promise.all([
      analiseModel.painel(req.escopo),
      demandaModel.listar(req.escopo, {}, { campo: 'criadaEm', desc: true }, 1, 7)
    ]);
    res.json({ ...dados, recentes: recentes.itens });
  } catch (erro) { next(erro); }
};

/** Área de projetos da aba Análise. Só sistema e responsável a recortam. */
exports.projetos = async (req, res, next) => {
  try {
    const meses = Math.max(0, Math.min(24, parseInt(req.query.meses, 10) || 6));
    res.json(await analiseModel.projetos(meses, {
      sistema: req.query.sistema || '',
      responsavel: req.query.responsavel || ''
    }, req.escopo));
  } catch (erro) { next(erro); }
};

exports.analise = async (req, res, next) => {
  try {
    const meses = Math.max(0, Math.min(24, parseInt(req.query.meses, 10) || 6));
    const filtros = {
      sistema: req.query.sistema || '',
      situacao: req.query.situacao || '',
      prioridade: req.query.prioridade || '',
      responsavel: req.query.responsavel || '',
      tipo: req.query.tipo || ''
    };
    res.json(await analiseModel.analise(meses, filtros, req.escopo));
  } catch (erro) { next(erro); }
};
