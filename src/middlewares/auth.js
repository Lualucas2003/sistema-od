/**
 * Autenticação, permissões e — o mais importante — o escopo de empresa.
 *
 * O que a conta pode fazer vem do perfil dela (od.perfil_acesso), carregado
 * junto com a sessão. `req.pode` tem uma chave por permissão concedida
 * ('demanda.criar', 'projeto.excluir'...) mais os apelidos que as telas já
 * usavam (ver, criar, editar, excluir, administrar, tudo).
 *
 * `req.escopo` é a única fonte de verdade sobre o que a requisição pode ver:
 *   { empresaId: null }  -> administrador: enxerga tudo
 *   { empresaId: 7 }     -> usuário da empresa 7: só as demandas dela
 * Os models recebem esse escopo e o aplicam no SQL. Nenhuma rota confia em
 * empresa_id vindo do corpo ou da query.
 */
const usuarioModel = require('../models/usuarioModel');
const empresaModel = require('../models/empresaModel');

const COOKIE = 'od_sessao';

/** Requisição de API? Vale para /api/... e /p/<slug>/api/... */
const ehApi = (req) => /\/api(\/|$)/.test(req.originalUrl || req.path);

/**
 * Rede de segurança: se a conta ainda não tem perfil gravado (banco sem a
 * migração 10, por exemplo), vale o conjunto que o código dava antes.
 */
const HERANCA = {
  admin: null,   // administrador tem tudo; resolvido em montarPode
  gestor: ['demanda.ver', 'demanda.criar', 'demanda.editar', 'demanda.excluir', 'demanda.anexar',
    'projeto.ver', 'projeto.criar', 'projeto.editar', 'projeto.excluir',
    'analise.ver', 'dados.exportar', 'usuario.administrar', 'perfil.administrar'],
  operador: ['demanda.ver', 'demanda.criar', 'demanda.editar', 'demanda.anexar',
    'projeto.ver', 'projeto.criar', 'projeto.editar', 'analise.ver', 'dados.exportar'],
  leitor: ['demanda.ver', 'projeto.ver', 'analise.ver', 'dados.exportar']
};

/** Permissões que só o dono do sistema pode ter. */
const SO_ADMIN = ['catalogo.administrar', 'empresa.administrar', 'config.administrar', 'dados.apagar'];

const TODAS = Object.values(HERANCA).filter(Boolean).flat().concat(SO_ADMIN);

/** Apelidos que as telas já usavam, para não quebrar nada que existe. */
function apelidos(pode, tem) {
  pode.ver = tem('demanda.ver');
  pode.criar = tem('demanda.criar');
  pode.editar = tem('demanda.editar');
  pode.excluir = tem('demanda.excluir');
  // controla a aba Configurações: aparece se houver algo para administrar ali
  pode.administrar = ['usuario.administrar', 'perfil.administrar'].concat(SO_ADMIN).some(tem);
  return pode;
}

/**
 * Monta o que a conta pode fazer, a partir das permissões do perfil dela.
 * Devolve um objeto com uma chave true por permissão, mais os apelidos.
 */
function montarPode(usuario) {
  if (!usuario) return apelidos({ tudo: false }, () => false);

  const doAdmin = usuario.perfil === 'admin';
  const guardadas = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
  const chaves = new Set(
    guardadas.length ? guardadas
      : (doAdmin ? [...new Set(TODAS)] : (HERANCA[usuario.perfil] || HERANCA.leitor)));

  const pode = { tudo: doAdmin };
  chaves.forEach((chave) => { pode[chave] = true; });
  return apelidos(pode, (c) => chaves.has(c));
}

const permissoes = (perfil) => montarPode({ perfil, permissoes: [] });

/** Lê o cookie de sessão e preenche req.usuario / req.escopo. */
async function carregarSessao(req, _res, next) {
  try {
    req.usuario = await usuarioModel.usuarioDaSessao(req.cookies[COOKIE]);
    // além da empresa, o usuário pode estar restrito a alguns sistemas
    const sistemas = req.usuario && req.usuario.perfil !== 'admin'
      ? await usuarioModel.sistemasDoUsuario(req.usuario.id) : [];
    req.escopo = {
      empresaId: req.usuario ? req.usuario.empresa_id : null,
      sistemasIds: sistemas.length ? sistemas : null
    };
    req.pode = montarPode(req.usuario);
    next();
  } catch (erro) { next(erro); }
}

/** Rota de página: manda para o login certo quando não há sessão. */
function exigirLogin(req, res, next) {
  if (req.usuario) return next();
  if (ehApi(req)) {
    return res.status(401).json({ mensagem: 'Sessão expirada. Entre novamente.' });
  }
  const destino = req.portal ? `/p/${req.portal.slug}/entrar` : '/entrar';
  res.redirect(destino + '?de=' + encodeURIComponent(req.originalUrl));
}

/** Só o administrador do sistema principal. */
function exigirAdmin(req, res, next) {
  if (req.usuario && req.usuario.perfil === 'admin') return next();
  if (ehApi(req)) {
    return res.status(403).json({ mensagem: 'Ação restrita ao administrador.' });
  }
  res.status(403).send('<h1>403</h1><p>Ação restrita ao administrador.</p>');
}

/**
 * Exige uma permissão. Aceita a chave do catálogo ('demanda.criar') e também
 * os apelidos antigos ('criar', 'editar', 'excluir', 'administrar').
 */
const exigir = (acao) => (req, res, next) => {
  if (req.pode && req.pode[acao]) return next();
  res.status(403).json({ mensagem: 'Seu perfil não permite essa ação.' });
};

/**
 * Resolve /p/:slug: carrega a empresa e confere que o usuário logado
 * pertence a ela (o administrador pode entrar em qualquer portal).
 */
async function resolverPortal(req, res, next) {
  try {
    const empresa = await empresaModel.buscarPorSlug(req.params.slug);
    if (!empresa || !empresa.ativo) {
      return ehApi(req)
        ? res.status(404).json({ mensagem: 'Portal não encontrado ou desativado.' })
        : res.status(404).send('<h1>404</h1><p>Portal não encontrado ou desativado.</p>');
    }
    req.portal = empresa;

    if (req.usuario && req.usuario.perfil !== 'admin'
        && req.usuario.empresa_id !== empresa.id) {
      return ehApi(req)
        ? res.status(403).json({ mensagem: 'Sua conta não pertence a este portal.' })
        : res.status(403).send('<h1>403</h1><p>Sua conta não pertence a este portal.</p>');
    }
    // administrador visitando o portal enxerga o recorte da empresa
    if (req.usuario && req.usuario.perfil === 'admin') {
      req.escopo = { empresaId: empresa.id, sistemasIds: null };
    }
    next();
  } catch (erro) { next(erro); }
}

module.exports = {
  COOKIE, carregarSessao, exigirLogin, exigirAdmin, exigir, resolverPortal,
  permissoes, montarPode, SO_ADMIN
};
