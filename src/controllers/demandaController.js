/**
 * Controller de demandas — valida a entrada, chama o model e responde JSON.
 * O recorte de empresa vem sempre de req.escopo (montado pelo middleware),
 * nunca do corpo da requisição.
 */
const demandaModel = require('../models/demandaModel');
const projetoModel = require('../models/projetoModel');

const SITUACOES = ['aberta', 'andamento', 'aguardando', 'concluida', 'cancelada'];
const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'];
const PROXIMA = { aberta: 'andamento', andamento: 'concluida', aguardando: 'andamento' };

/** Valida o corpo de criação/edição e devolve os erros por campo. */
function validar(corpo, usuario) {
  const erros = {};
  const titulo = String(corpo.titulo || '').trim();
  const descricao = String(corpo.descricao || '').trim();

  if (titulo.length < 5) erros.titulo = 'Informe um título com pelo menos 5 caracteres.';
  if (descricao.length < 10) erros.descricao = 'Descreva a demanda com pelo menos 10 caracteres.';
  if (!Number(corpo.solicitanteId)) erros.solicitante = 'Selecione o solicitante.';
  if (!Number(corpo.sistemaId)) erros.sistema = 'Selecione o sistema.';
  if (corpo.prioridade && !PRIORIDADES.includes(corpo.prioridade)) erros.prioridade = 'Prioridade inválida.';
  if (corpo.situacao && !SITUACOES.includes(corpo.situacao)) erros.situacao = 'Situação inválida.';

  return {
    erros,
    dados: {
      titulo,
      descricao,
      solicitanteId: Number(corpo.solicitanteId) || null,
      sistemaId: Number(corpo.sistemaId) || null,
      responsavelId: Number(corpo.responsavelId) || null,
      tipoAcaoId: Number(corpo.tipoAcaoId) || null,
      projetoId: Number(corpo.projetoId) || null,
      prioridade: corpo.prioridade || 'media',
      situacao: corpo.situacao || 'aberta',
      observacao: String(corpo.observacao || '').trim() || null,
      autor: usuario ? usuario.nome : null
    }
  };
}

exports.listar = async (req, res, next) => {
  try {
    const filtros = {
      busca: req.query.busca || '',
      situacao: req.query.situacao || '',
      prioridade: req.query.prioridade || '',
      sistema: req.query.sistema || '',
      responsavel: req.query.responsavel || '',
      tipo: req.query.tipo || ''
    };
    const ordem = { campo: req.query.ordem || 'numero', desc: req.query.dir !== 'asc' };
    const pagina = parseInt(req.query.pagina, 10) || 1;
    const porPagina = parseInt(req.query.porPagina, 10) || 10;
    res.json(await demandaModel.listar(req.escopo, filtros, ordem, pagina, porPagina));
  } catch (erro) { next(erro); }
};

exports.listarTudo = async (req, res, next) => {
  try { res.json(await demandaModel.listarTudo(req.escopo)); } catch (erro) { next(erro); }
};

exports.buscar = async (req, res, next) => {
  try {
    const demanda = await demandaModel.buscarPorId(req.escopo, req.params.id);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    res.json(demanda);
  } catch (erro) { next(erro); }
};

exports.criar = async (req, res, next) => {
  try {
    const { erros, dados } = validar(req.body, req.usuario);
    if (Object.keys(erros).length) return res.status(422).json({ erros });
    if (!await demandaModel.sistemaPermitido(req.escopo, dados.sistemaId)) {
      return res.status(403).json({ mensagem: 'Sistema fora do seu escopo.' });
    }
    if (dados.projetoId && !await projetoModel.buscarFicha(req.escopo, dados.projetoId)) {
      return res.status(403).json({ mensagem: 'Projeto fora do seu escopo.' });
    }
    res.status(201).json(await demandaModel.criar(req.escopo, dados));
  } catch (erro) { next(erro); }
};

exports.atualizar = async (req, res, next) => {
  try {
    const { erros, dados } = validar(req.body, req.usuario);
    if (Object.keys(erros).length) return res.status(422).json({ erros });
    if (!await demandaModel.sistemaPermitido(req.escopo, dados.sistemaId)) {
      return res.status(403).json({ mensagem: 'Sistema fora do seu escopo.' });
    }
    if (dados.projetoId && !await projetoModel.buscarFicha(req.escopo, dados.projetoId)) {
      return res.status(403).json({ mensagem: 'Projeto fora do seu escopo.' });
    }
    const demanda = await demandaModel.atualizar(req.escopo, req.params.id, dados);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    res.json(demanda);
  } catch (erro) { next(erro); }
};

exports.mudarSituacao = async (req, res, next) => {
  try {
    const situacao = req.body.situacao;
    if (!SITUACOES.includes(situacao)) return res.status(422).json({ mensagem: 'Situação inválida.' });
    const demanda = await demandaModel.mudarSituacao(req.escopo, req.params.id, situacao);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    res.json(demanda);
  } catch (erro) { next(erro); }
};

exports.avancar = async (req, res, next) => {
  try {
    const atual = await demandaModel.buscarPorId(req.escopo, req.params.id);
    if (!atual) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    const proxima = PROXIMA[atual.situacao];
    if (!proxima) return res.status(409).json({ mensagem: 'Esta demanda não tem próxima etapa.' });
    res.json(await demandaModel.mudarSituacao(req.escopo, req.params.id, proxima));
  } catch (erro) { next(erro); }
};

exports.registrarAndamento = async (req, res, next) => {
  try {
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.status(422).json({ mensagem: 'Escreva o andamento antes de registrar.' });
    const demanda = await demandaModel.buscarPorId(req.escopo, req.params.id);
    if (!demanda) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    await demandaModel.registrarHistorico(req.params.id, texto,
      req.usuario ? req.usuario.nome : null);
    res.status(201).json(await demandaModel.buscarPorId(req.escopo, req.params.id));
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    const numero = await demandaModel.remover(req.escopo, req.params.id);
    if (!numero) return res.status(404).json({ mensagem: 'Demanda não encontrada.' });
    res.json({ mensagem: `${numero} excluída.` });
  } catch (erro) { next(erro); }
};

exports.removerTodas = async (req, res, next) => {
  try {
    const total = await demandaModel.removerTodas(req.escopo);
    res.json({ mensagem: `${total} demanda(s) apagada(s).` });
  } catch (erro) { next(erro); }
};
