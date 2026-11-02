/**
 * Tratamento central de erros e de rota inexistente.
 */

/** Vale para /api/... e para /p/<slug>/api/... */
const ehApi = (req) => /\/api(\/|$)/.test(req.originalUrl || req.path);

function naoEncontrado(req, res, next) {
  if (ehApi(req)) {
    return res.status(404).json({ mensagem: 'Recurso não encontrado.' });
  }
  next();
}

function tratarErro(erro, req, res, _next) {
  const status = erro.status || 500;
  if (status >= 500) console.error('[OD]', erro);

  // erros conhecidos do PostgreSQL viram mensagem legível
  const mapa = {
    '23505': 'Já existe um registro com esse valor.',
    '23503': 'Registro vinculado a outro cadastro.',
    '23514': 'Dados fora das regras do cadastro.',
    '22P02': 'Valor inválido para o campo informado.'
  };
  const mensagem = mapa[erro.code] || erro.message || 'Erro inesperado.';

  if (ehApi(req)) {
    const corpo = { mensagem };
    if (erro.detalhe) corpo.detalhe = erro.detalhe;   // ex.: quantas demandas seriam apagadas
    return res.status(mapa[erro.code] ? 422 : status).json(corpo);
  }
  res.status(status).send(`<h1>Erro ${status}</h1><p>${mensagem}</p>`);
}

module.exports = { naoEncontrado, tratarErro };
