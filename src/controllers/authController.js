/**
 * Login e logout. O escopo do login vem da rota, nunca do formulário:
 *   /entrar            -> administradores do sistema principal
 *   /p/:slug/entrar    -> usuários daquela empresa
 */
const usuarioModel = require('../models/usuarioModel');
const { COOKIE } = require('../middlewares/auth');

const MENSAGEM_GENERICA = 'E-mail ou senha inválidos.';

function opcoesCookie(dias) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SEGURO === 'true',
    maxAge: dias * 24 * 60 * 60 * 1000,
    path: '/'
  };
}

/** Tela de login (a mesma view serve o principal e os portais). */
exports.formulario = (req, res) => {
  res.render('login', {
    titulo: req.portal ? `Entrar — ${req.portal.nome}` : 'Entrar — OD',
    portal: req.portal || null,
    destino: req.query.de || '',
    erro: req.query.erro ? MENSAGEM_GENERICA : null
  });
};

exports.entrar = async (req, res, next) => {
  try {
    const empresaId = req.portal ? req.portal.id : null;
    const base = req.portal ? `/p/${req.portal.slug}` : '';
    const usuario = await usuarioModel.autenticar(empresaId, req.body.email, req.body.senha);

    if (!usuario) {
      const de = req.body.destino ? '&de=' + encodeURIComponent(req.body.destino) : '';
      return res.redirect(`${base}/entrar?erro=1${de}`);
    }

    const { token, dias } = await usuarioModel.abrirSessao(usuario.id, req.get('user-agent'));
    res.cookie(COOKIE, token, opcoesCookie(dias));

    const destino = String(req.body.destino || '');
    const seguro = destino.startsWith(base + '/') || destino === base;
    res.redirect(seguro && destino ? destino : (base || '/'));
  } catch (erro) { next(erro); }
};

exports.sair = async (req, res, next) => {
  try {
    await usuarioModel.fecharSessao(req.cookies[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect(req.portal ? `/p/${req.portal.slug}/entrar` : '/entrar');
  } catch (erro) { next(erro); }
};

/** Quem sou eu — usado pela interface. */
exports.eu = (req, res) => {
  if (!req.usuario) return res.status(401).json({ mensagem: 'Sem sessão.' });
  res.json({
    id: req.usuario.id, nome: req.usuario.nome, email: req.usuario.email,
    perfil: req.usuario.perfil, empresa: req.usuario.empresa, empresaId: req.usuario.empresa_id,
    pode: req.pode
  });
};

/** Troca da própria senha. */
exports.trocarSenha = async (req, res, next) => {
  try {
    const atual = await usuarioModel.autenticar(
      req.usuario.empresa_id, req.usuario.email, req.body.senhaAtual);
    if (!atual) return res.status(403).json({ mensagem: 'Senha atual incorreta.' });
    if (String(req.body.senhaNova || '').length < 8) {
      return res.status(422).json({ mensagem: 'A nova senha precisa de ao menos 8 caracteres.' });
    }
    await usuarioModel.atualizar(req.usuario.id, { senha: req.body.senhaNova });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ mensagem: 'Senha alterada. Entre novamente.' });
  } catch (erro) { next(erro); }
};
