/**
 * Controller de projetos — valida a entrada, chama o model e responde JSON.
 * O recorte de empresa vem sempre de req.escopo. A única exceção é o administrador no
 * sistema principal, que escolhe a empresa de um projeto novo (empresaId no corpo).
 *
 * Três blocos: o projeto em si, os passos de execução e os documentos
 * (entre eles o documento de requisitos).
 */
const projetoModel = require('../models/projetoModel');
const { extrairTexto } = require('../lib/documentoTexto');
const { extrairRequisitos, extrairFicha } = require('../lib/requisitos');

const SITUACOES = ['planejamento', 'andamento', 'pausado', 'concluido', 'cancelado'];
const SITUACOES_ETAPA = ['pendente', 'andamento', 'concluida', 'bloqueada'];
const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'];
const PROXIMA = { planejamento: 'andamento', andamento: 'concluido', pausado: 'andamento' };

/** Formatos aceitos como documento, por extensão (o MIME do navegador varia). */
const EXTENSOES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip'
};
const LIMITE_BYTES = 6 * 1024 * 1024;     // 6 MB por documento, já decodificado
const LIMITE_POR_PROJETO = 12;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const soData = (valor) => (DATA.test(String(valor || '').slice(0, 10))
  ? String(valor).slice(0, 10) : null);

/** Aceita "data:application/pdf;base64,AAA..." ou a base64 pura. */
function separarBase64(valor) {
  const texto = String(valor || '');
  const casa = texto.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  return casa ? { tipo: casa[1], base64: casa[2] } : { tipo: null, base64: texto };
}

/** Valida o corpo de criação/edição e devolve os erros por campo. */
function validar(corpo, usuario) {
  const erros = {};
  const nome = String(corpo.nome || '').trim();
  const objetivo = String(corpo.objetivo || '').trim();
  const inicio = soData(corpo.inicioPrevisto);
  const fim = soData(corpo.fimPrevisto);

  if (nome.length < 3) erros.nome = 'Informe um nome com pelo menos 3 caracteres.';
  if (corpo.prioridade && !PRIORIDADES.includes(corpo.prioridade)) erros.prioridade = 'Prioridade inválida.';
  if (corpo.situacao && !SITUACOES.includes(corpo.situacao)) erros.situacao = 'Situação inválida.';
  if (inicio && fim && fim < inicio) erros.fimPrevisto = 'A previsão de término é anterior ao início.';

  // cada passo pode vir só com o título ou como { titulo, descricao } (lido do documento)
  const etapas = Array.isArray(corpo.etapas)
    ? corpo.etapas
      .map((t) => (t && typeof t === 'object'
        ? { titulo: String(t.titulo || '').trim().slice(0, 300),
            descricao: String(t.descricao || '').trim().slice(0, 4000) || null,
            tipo: t.tipo === 'requisito' ? 'requisito' : 'passo' }
        : { titulo: String(t || '').trim(), descricao: null, tipo: 'passo' }))
      .filter((t) => t.titulo.length >= 3)
      .slice(0, 60)
    : [];

  return {
    erros,
    dados: {
      nome,
      objetivo: objetivo || null,
      sistemaId: Number(corpo.sistemaId) || null,
      solicitanteId: Number(corpo.solicitanteId) || null,
      responsavelId: Number(corpo.responsavelId) || null,
      empresaId: Number(corpo.empresaId) || null,
      situacao: corpo.situacao || 'planejamento',
      prioridade: corpo.prioridade || 'media',
      inicioPrevisto: inicio,
      fimPrevisto: fim,
      etapas,
      autor: usuario ? usuario.nome : null
    }
  };
}

/* ----------------------------- Projeto ----------------------------- */

exports.listar = async (req, res, next) => {
  try {
    res.json(await projetoModel.listar(req.escopo, {
      busca: req.query.busca || '',
      situacao: req.query.situacao || '',
      prioridade: req.query.prioridade || '',
      sistema: req.query.sistema || '',
      responsavel: req.query.responsavel || ''
    }));
  } catch (erro) { next(erro); }
};

/** Lista enxuta para o select do formulário de demanda. */
exports.paraSelecao = async (req, res, next) => {
  try { res.json(await projetoModel.paraSelecao(req.escopo)); } catch (erro) { next(erro); }
};

exports.buscar = async (req, res, next) => {
  try {
    const projeto = await projetoModel.buscarPorId(req.escopo, req.params.id);
    if (!projeto) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    res.json(projeto);
  } catch (erro) { next(erro); }
};

exports.criar = async (req, res, next) => {
  try {
    const { erros, dados } = validar(req.body, req.usuario);
    if (Object.keys(erros).length) return res.status(422).json({ erros });
    const { empresaId, erro: erroEmpresa } =
      await projetoModel.empresaDoNovoProjeto(req.escopo, dados.empresaId);
    if (erroEmpresa) return res.status(422).json({ mensagem: erroEmpresa });
    if (!await projetoModel.sistemaPermitido(req.escopo, dados.sistemaId)) {
      return res.status(403).json({ mensagem: 'Sistema fora do seu escopo.' });
    }
    const conflito = await projetoModel.vinculosDaEmpresa(empresaId, dados);
    if (conflito) return res.status(422).json({ mensagem: conflito });
    dados.empresaId = empresaId;
    res.status(201).json(await projetoModel.criar(req.escopo, dados));
  } catch (erro) { next(erro); }
};

exports.atualizar = async (req, res, next) => {
  try {
    const { erros, dados } = validar(req.body, req.usuario);
    if (Object.keys(erros).length) return res.status(422).json({ erros });
    if (!await projetoModel.sistemaPermitido(req.escopo, dados.sistemaId)) {
      return res.status(403).json({ mensagem: 'Sistema fora do seu escopo.' });
    }
    // a empresa do projeto não muda na edição; só o que mudou é conferido contra ela
    const atual = await projetoModel.buscarFicha(req.escopo, req.params.id);
    if (!atual) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    const mudou = (campo, antes) => (dados[campo] !== (antes || null) ? dados[campo] : null);
    const conflito = await projetoModel.vinculosDaEmpresa(atual.empresa_id, {
      sistemaId: mudou('sistemaId', atual.sistema_id),
      solicitanteId: mudou('solicitanteId', atual.solicitante_id),
      responsavelId: mudou('responsavelId', atual.responsavel_id)
    });
    if (conflito) return res.status(422).json({ mensagem: conflito });
    const projeto = await projetoModel.atualizar(req.escopo, req.params.id, dados);
    if (!projeto) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    res.json(projeto);
  } catch (erro) { next(erro); }
};

exports.mudarSituacao = async (req, res, next) => {
  try {
    if (!SITUACOES.includes(req.body.situacao)) {
      return res.status(422).json({ mensagem: 'Situação inválida.' });
    }
    const projeto = await projetoModel.mudarSituacao(req.escopo, req.params.id, req.body.situacao);
    if (!projeto) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    res.json(projeto);
  } catch (erro) { next(erro); }
};

exports.avancar = async (req, res, next) => {
  try {
    const atual = await projetoModel.buscarFicha(req.escopo, req.params.id);
    if (!atual) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    const proxima = PROXIMA[atual.situacao];
    if (!proxima) return res.status(409).json({ mensagem: 'Este projeto não tem próxima etapa.' });
    if (proxima === 'concluido' && atual.etapas > atual.etapas_concluidas) {
      return res.status(409).json({
        mensagem: `Ainda faltam ${atual.etapas - atual.etapas_concluidas} atividade(s) para concluir o projeto.`
      });
    }
    res.json(await projetoModel.mudarSituacao(req.escopo, req.params.id, proxima));
  } catch (erro) { next(erro); }
};

exports.registrarAndamento = async (req, res, next) => {
  try {
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.status(422).json({ mensagem: 'Escreva o andamento antes de registrar.' });
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    await projetoModel.registrarHistorico(req.params.id, texto,
      req.usuario ? req.usuario.nome : null);
    res.status(201).json(await projetoModel.buscarPorId(req.escopo, req.params.id));
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    const saida = await projetoModel.remover(req.escopo, req.params.id);
    if (!saida) return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    res.json({
      mensagem: `${saida.codigo} excluído.`
        + (saida.demandas ? ` ${saida.demandas} demanda(s) continuam registradas, sem o vínculo.` : '')
    });
  } catch (erro) { next(erro); }
};

/* ------------------------------ Passos ------------------------------ */

/** Confere se o passo pertence a um projeto do escopo. */
async function etapaDoEscopo(req) {
  const projetoId = await projetoModel.projetoDaEtapa(req.params.etapaId);
  if (!projetoId) return null;
  return projetoModel.buscarFicha(req.escopo, projetoId);
}

exports.listarEtapas = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    res.json(await projetoModel.listarEtapas(req.params.id));
  } catch (erro) { next(erro); }
};

exports.criarEtapa = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    const titulo = String(req.body.titulo || '').trim();
    if (titulo.length < 3) {
      return res.status(422).json({ mensagem: 'Descreva a atividade com pelo menos 3 caracteres.' });
    }
    res.status(201).json(await projetoModel.criarEtapa(req.params.id, {
      titulo,
      tipo: req.body.tipo === 'requisito' ? 'requisito' : 'passo',
      descricao: String(req.body.descricao || '').trim() || null,
      responsavelId: Number(req.body.responsavelId) || null,
      prazo: soData(req.body.prazo)
    }, req.usuario ? req.usuario.nome : null));
  } catch (erro) { next(erro); }
};

exports.atualizarEtapa = async (req, res, next) => {
  try {
    if (!await etapaDoEscopo(req)) return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    const titulo = String(req.body.titulo || '').trim();
    if (titulo.length < 3) {
      return res.status(422).json({ mensagem: 'Descreva a atividade com pelo menos 3 caracteres.' });
    }
    if (req.body.situacao && !SITUACOES_ETAPA.includes(req.body.situacao)) {
      return res.status(422).json({ mensagem: 'Situação da atividade inválida.' });
    }
    res.json(await projetoModel.atualizarEtapa(req.params.etapaId, {
      titulo,
      descricao: String(req.body.descricao || '').trim() || null,
      responsavelId: Number(req.body.responsavelId) || null,
      prazo: soData(req.body.prazo),
      situacao: req.body.situacao || null
    }, req.usuario ? req.usuario.nome : null));
  } catch (erro) { next(erro); }
};

exports.mudarSituacaoEtapa = async (req, res, next) => {
  try {
    if (!SITUACOES_ETAPA.includes(req.body.situacao)) {
      return res.status(422).json({ mensagem: 'Situação da atividade inválida.' });
    }
    const etapa = await projetoModel.buscarEtapa(req.params.etapaId);
    if (!etapa || !await etapaDoEscopo(req)) {
      return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    }
    res.json(await projetoModel.atualizarEtapa(req.params.etapaId, {
      titulo: etapa.titulo,
      descricao: etapa.descricao,
      responsavelId: etapa.responsavel_id,
      prazo: etapa.prazo,
      situacao: req.body.situacao
    }, req.usuario ? req.usuario.nome : null));
  } catch (erro) { next(erro); }
};

exports.moverEtapa = async (req, res, next) => {
  try {
    if (!await etapaDoEscopo(req)) return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    const direcao = req.body.direcao === 'cima' ? -1 : 1;
    const mexeu = await projetoModel.moverEtapa(req.params.etapaId, direcao);
    if (mexeu === null) return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    const projetoId = await projetoModel.projetoDaEtapa(req.params.etapaId);
    res.json(await projetoModel.listarEtapas(projetoId));
  } catch (erro) { next(erro); }
};

exports.removerEtapa = async (req, res, next) => {
  try {
    if (!await etapaDoEscopo(req)) return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    const etapa = await projetoModel.removerEtapa(req.params.etapaId,
      req.usuario ? req.usuario.nome : null);
    if (!etapa) return res.status(404).json({ mensagem: 'Atividade não encontrada.' });
    res.json({ mensagem: `Passo "${etapa.titulo}" removido.` });
  } catch (erro) { next(erro); }
};

/* ------------------- Requisitos -> passos (importação) ------------------- */

const LIMITE_IMPORTACAO = 60;

/** Explica, em uma frase, de onde saiu cada item da lista. */
const COMO_LEU = {
  estruturado: 'Li os requisitos (RF/RNF) do documento, com prioridade e descrição de cada um.',
  secao: 'Li a seção de requisitos do documento.',
  marcacao: 'Li os itens numerados/marcados do documento.',
  tabela: 'Li a planilha: uma linha por requisito.',
  linhas: 'O documento não tem lista, então li linha a linha.',
  nenhum: 'Não encontrei requisitos.',
  vazio: 'O documento não tem texto.'
};

/** Prévia dos passos que sairiam de um documento já anexado. */
exports.previaRequisitos = async (req, res, next) => {
  try {
    const projetoId = await projetoModel.projetoDoAnexo(req.params.anexoId);
    if (!projetoId || !await projetoModel.buscarFicha(req.escopo, projetoId)) {
      return res.status(404).json({ mensagem: 'Documento não encontrado.' });
    }
    const anexo = await projetoModel.obterConteudoAnexo(req.params.anexoId);
    const lido = extrairTexto(Buffer.from(anexo.dados, 'base64'), anexo.nome);
    if (!lido.texto) {
      return res.status(422).json({ mensagem: lido.aviso || 'Não consegui ler este documento.' });
    }
    const achado = extrairRequisitos(lido.texto, lido.formato);
    res.json({
      documento: anexo.nome,
      formato: lido.formato,
      projetoId,
      itens: achado.itens,
      estrategia: achado.estrategia,
      explicacao: COMO_LEU[achado.estrategia] || null,
      aviso: achado.aviso
    });
  } catch (erro) { next(erro); }
};

/** Mesma prévia, a partir de um texto colado na tela. */
exports.previaDeTexto = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    const texto = String(req.body.texto || '').slice(0, 400000);
    if (texto.trim().length < 10) {
      return res.status(422).json({ mensagem: 'Cole o texto dos requisitos antes de continuar.' });
    }
    const achado = extrairRequisitos(texto, 'txt');
    if (!achado.itens.length) {
      return res.status(422).json({ mensagem: achado.aviso || 'Não encontrei requisitos no texto.' });
    }
    res.json({
      documento: null, formato: 'txt', projetoId: req.params.id,
      itens: achado.itens, estrategia: achado.estrategia,
      explicacao: COMO_LEU[achado.estrategia] || null, aviso: achado.aviso
    });
  } catch (erro) { next(erro); }
};

/** Grava como passos os requisitos que o usuário confirmou. */
exports.importarEtapas = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    const itens = (Array.isArray(req.body.itens) ? req.body.itens : [])
      .map((i) => ({
        titulo: String((i && i.titulo) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        descricao: String((i && i.descricao) || '').replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000) || null
      }))
      .filter((i) => i.titulo.length >= 3)
      .slice(0, LIMITE_IMPORTACAO);

    if (!itens.length) {
      return res.status(422).json({ mensagem: 'Escolha ao menos um requisito para virar atividade.' });
    }
    const origem = String(req.body.origem || '').trim().slice(0, 160) || null;
    const quantos = await projetoModel.criarEtapasEmLote(req.params.id, itens, origem,
      req.usuario ? req.usuario.nome : null);

    res.status(201).json({
      mensagem: `${quantos} requisito(s) importado(s)${origem ? ` de "${origem}"` : ''}.`,
      quantos,
      projeto: await projetoModel.buscarPorId(req.escopo, req.params.id)
    });
  } catch (erro) { next(erro); }
};

/**
 * Lê um documento que ainda não foi salvo (formulário de novo projeto) e
 * devolve o que dá para preencher: nome, objetivo e os passos.
 */
exports.lerDocumento = async (req, res, next) => {
  try {
    const nome = String(req.body.nome || '').trim().slice(0, 160);
    const extensao = (nome.split('.').pop() || '').toLowerCase();
    const { base64 } = separarBase64(req.body.dados);
    if (!base64) return res.status(422).json({ mensagem: 'Envie o conteúdo do documento.' });
    if (!EXTENSOES[extensao]) return res.status(422).json({ mensagem: 'Formato não aceito.' });
    const buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
    if (buffer.length > LIMITE_BYTES) {
      return res.status(413).json({ mensagem: 'Documento acima de 6 MB. Compacte antes de anexar.' });
    }

    const lido = extrairTexto(buffer, nome);
    if (!lido.texto) {
      return res.status(422).json({ mensagem: lido.aviso || 'Não consegui ler este documento.' });
    }
    const achado = extrairRequisitos(lido.texto, lido.formato);
    const ficha = extrairFicha(lido.texto, lido.titulo);
    res.json({
      documento: nome,
      formato: lido.formato,
      nome: ficha.nome,
      objetivo: ficha.objetivo,
      itens: achado.itens,
      estrategia: achado.estrategia,
      explicacao: COMO_LEU[achado.estrategia] || null,
      aviso: achado.aviso
    });
  } catch (erro) { next(erro); }
};

/* ---------------------------- Documentos ---------------------------- */

exports.listarDocumentos = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    res.json(await projetoModel.listarAnexos(req.params.id));
  } catch (erro) { next(erro); }
};

exports.enviarDocumento = async (req, res, next) => {
  try {
    if (!await projetoModel.buscarFicha(req.escopo, req.params.id)) {
      return res.status(404).json({ mensagem: 'Projeto não encontrado.' });
    }
    const nome = String(req.body.nome || 'documento').trim().slice(0, 160);
    const extensao = (nome.split('.').pop() || '').toLowerCase();
    const { tipo: tipoNoDado, base64 } = separarBase64(req.body.dados);
    const categoria = req.body.categoria === 'requisitos' ? 'requisitos' : 'apoio';

    if (!base64) return res.status(422).json({ mensagem: 'Envie o conteúdo do documento.' });
    if (!EXTENSOES[extensao]) {
      return res.status(422).json({
        mensagem: 'Formato não aceito. Use PDF, DOC/DOCX, ODT, RTF, TXT, MD, CSV, '
          + 'planilhas, apresentações, imagens ou ZIP.'
      });
    }
    if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(base64)) {
      return res.status(422).json({ mensagem: 'Conteúdo do documento inválido.' });
    }

    const tamanho = Buffer.byteLength(base64.replace(/\s/g, ''), 'base64');
    if (tamanho > LIMITE_BYTES) {
      return res.status(413).json({ mensagem: 'Documento acima de 6 MB. Compacte antes de anexar.' });
    }
    if (await projetoModel.contarAnexos(req.params.id) >= LIMITE_POR_PROJETO) {
      return res.status(409).json({ mensagem: `Limite de ${LIMITE_POR_PROJETO} documentos por projeto.` });
    }

    res.status(201).json(await projetoModel.criarAnexo(req.params.id, {
      categoria, nome, tamanho,
      tipo: req.body.tipo || tipoNoDado || EXTENSOES[extensao],
      dados: base64.replace(/\s/g, ''),
      autor: req.usuario ? req.usuario.nome : null
    }));
  } catch (erro) { next(erro); }
};

/** Devolve o documento já decodificado, para abrir ou baixar. */
exports.arquivoDocumento = async (req, res, next) => {
  try {
    const projetoId = await projetoModel.projetoDoAnexo(req.params.anexoId);
    if (!projetoId || !await projetoModel.buscarFicha(req.escopo, projetoId)) {
      return res.status(404).json({ mensagem: 'Documento não encontrado.' });
    }
    const anexo = await projetoModel.obterConteudoAnexo(req.params.anexoId);
    const buffer = Buffer.from(anexo.dados, 'base64');
    res.set('Content-Type', anexo.tipo);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.set('Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(anexo.nome)}"`);
    res.end(buffer);
  } catch (erro) { next(erro); }
};

exports.removerDocumento = async (req, res, next) => {
  try {
    const projetoId = await projetoModel.projetoDoAnexo(req.params.anexoId);
    if (!projetoId || !await projetoModel.buscarFicha(req.escopo, projetoId)) {
      return res.status(404).json({ mensagem: 'Documento não encontrado.' });
    }
    const nome = await projetoModel.removerAnexo(req.params.anexoId,
      req.usuario ? req.usuario.nome : null);
    if (!nome) return res.status(404).json({ mensagem: 'Documento não encontrado.' });
    res.json({ mensagem: `"${nome}" removido.` });
  } catch (erro) { next(erro); }
};
