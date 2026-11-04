/**
 * Controller de configurações, exportação e carga de exemplos.
 */
const configModel = require('../models/configModel');
const listaModel = require('../models/listaModel');
const demandaModel = require('../models/demandaModel');

exports.obter = async (req, res, next) => {
  try {
    const [config, proximo, totais] = await Promise.all([
      configModel.obter(),
      configModel.proximoNumero(),
      demandaModel.listar(req.escopo, {}, {}, 1, 1)
    ]);
    res.json({ ...config, proximoNumero: proximo, totalDemandas: totais.total });
  } catch (erro) { next(erro); }
};

exports.salvar = async (req, res, next) => {
  try {
    if (typeof req.body.org === 'string') {
      await configModel.salvar('org', req.body.org.trim().slice(0, 60) || 'HeuCode');
    }
    if (typeof req.body.prefixo === 'string') {
      const prefixo = req.body.prefixo.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'OD';
      await configModel.salvar('prefixo', prefixo);
    }
    exports.obter(req, res, next);
  } catch (erro) { next(erro); }
};

/** Backup completo no formato consumido pela tela. */
exports.exportar = async (req, res, next) => {
  try {
    const [config, listas, demandas] = await Promise.all([
      configModel.obter(), listaModel.listarTodas(req.escopo), demandaModel.listarTudo(req.escopo)
    ]);
    const completas = await Promise.all(demandas.map((d) => demandaModel.buscarPorId(req.escopo, d.id)));
    res.setHeader('Content-Disposition',
      `attachment; filename="backup-od-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ geradoEm: new Date().toISOString(), config, listas, demandas: completas });
  } catch (erro) { next(erro); }
};

/** Recria o conjunto de demandas de teste (db/02_seed.sql). */
exports.carregarExemplos = async (req, res, next) => {
  try {
    await configModel.carregarExemplos();
    const { total } = await demandaModel.listar(req.escopo, {}, {}, 1, 1);
    res.json({ mensagem: `${total} demandas de exemplo carregadas.` });
  } catch (erro) { next(erro); }
};
