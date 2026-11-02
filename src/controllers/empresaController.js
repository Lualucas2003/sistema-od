/**
 * Controller de empresas e dos usuários de cada empresa.
 * Só o administrador cria/remove empresas; um gestor administra os usuários
 * da própria empresa.
 */
const empresaModel = require('../models/empresaModel');
const usuarioModel = require('../models/usuarioModel');
const listaModel = require('../models/listaModel');
const perfilModel = require('../models/perfilModel');
const { gerarSlug, gerarHash } = require('../config/senha');

const PERFIS_EMPRESA = ['gestor', 'operador', 'leitor'];

exports.listar = async (_req, res, next) => {
  try { res.json(await empresaModel.listar()); } catch (erro) { next(erro); }
};

exports.criar = async (req, res, next) => {
  try {
    // ---- valida tudo ANTES de gravar qualquer coisa ----
    const nome = String(req.body.nome || '').trim();
    if (nome.length < 2) return res.status(422).json({ mensagem: 'Informe o nome da empresa.' });

    const repetida = await empresaModel.buscarPorNome(nome);
    if (repetida && !req.body.permitirNomeRepetido) {
      return res.status(409).json({
        mensagem: `Já existe uma empresa chamada "${repetida.nome}" (portal /p/${repetida.slug}).`,
        detalhe: { empresaId: repetida.id, slug: repetida.slug }
      });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    if (email || senha) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(422).json({ mensagem: 'E-mail do gestor inválido.' });
      }
      if (senha.length < 8) {
        return res.status(422).json({ mensagem: 'A senha do gestor precisa de ao menos 8 caracteres.' });
      }
    }

    let slug = gerarSlug(req.body.slug || nome);
    if (slug.length < 3) return res.status(422).json({ mensagem: 'Nome curto demais para gerar o endereço.' });
    let sufixo = 1;
    const base = slug;
    while (await empresaModel.buscarPorSlug(slug)) slug = `${base}-${++sufixo}`;

    // ---- só agora grava: empresa, listas e gestor na mesma transação ----
    const empresa = await empresaModel.criar({
      nome, slug,
      documento: req.body.documento,
      contato: req.body.contato,
      // aceita lista de nomes ou um texto com um sistema por linha
      sistemas: Array.isArray(req.body.sistemas)
        ? req.body.sistemas.map((s) => String(s).trim()).filter(Boolean).slice(0, 20)
        : String(req.body.sistema || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      gestor: email && senha
        ? { nome: req.body.responsavel || 'Gestor', email, senhaHash: gerarHash(senha) }
        : null
    });

    const contas = await usuarioModel.listar(empresa.id);
    res.status(201).json({ ...empresa, gestor: contas[0] || null });
  } catch (erro) { next(erro); }
};

/** Sistemas de uma empresa. */
exports.sistemas = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(404).json({ mensagem: 'Empresa não encontrada.' });
    res.json(await empresaModel.sistemas(id));
  } catch (erro) { next(erro); }
};

exports.adicionarSistema = async (req, res, next) => {
  try {
    const nome = String(req.body.nome || '').trim();
    if (nome.length < 2) return res.status(422).json({ mensagem: 'Informe o nome do sistema.' });
    const empresa = await empresaModel.buscarPorId(req.params.id);
    if (!empresa) return res.status(404).json({ mensagem: 'Empresa não encontrada.' });
    res.status(201).json(await empresaModel.adicionarSistema(empresa.id, nome));
  } catch (erro) { next(erro); }
};

/** Empresas e sistemas já vinculados a um e-mail (aviso no cadastro). */
exports.porEmail = async (req, res, next) => {
  try { res.json(await empresaModel.porEmail(req.query.email)); } catch (erro) { next(erro); }
};

exports.atualizar = async (req, res, next) => {
  try {
    const atual = await empresaModel.buscarPorId(req.params.id);
    if (!atual) return res.status(404).json({ mensagem: 'Empresa não encontrada.' });

    const dados = { ativo: req.body.ativo };

    if (req.body.nome !== undefined) {
      const nome = String(req.body.nome).trim();
      if (nome.length < 2) return res.status(422).json({ mensagem: 'Informe o nome da empresa.' });
      const repetida = await empresaModel.buscarPorNome(nome);
      if (repetida && repetida.id !== atual.id && !req.body.permitirNomeRepetido) {
        return res.status(409).json({
          mensagem: `Já existe uma empresa chamada "${repetida.nome}".`,
          detalhe: { empresaId: repetida.id, slug: repetida.slug }
        });
      }
      dados.nome = nome;
    }

    // trocar o endereço do portal muda o link que o cliente usa
    if (req.body.slug !== undefined && String(req.body.slug).trim()) {
      const slug = gerarSlug(req.body.slug);
      if (slug.length < 3) {
        return res.status(422).json({ mensagem: 'Endereço curto demais (mínimo 3 caracteres).' });
      }
      const ocupado = await empresaModel.buscarPorSlug(slug);
      if (ocupado && ocupado.id !== atual.id) {
        return res.status(409).json({ mensagem: `O endereço /p/${slug} já está em uso.` });
      }
      dados.slug = slug;
    }

    if (req.body.documento !== undefined) dados.documento = String(req.body.documento).trim();
    if (req.body.contato !== undefined) dados.contato = String(req.body.contato).trim();

    res.json(await empresaModel.atualizar(atual.id, dados));
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    const cascata = req.query.cascata === '1' || req.body.cascata === true;
    const r = await empresaModel.remover(req.params.id, { cascata });
    if (!r) return res.status(404).json({ mensagem: 'Empresa não encontrada.' });
    const extras = [];
    if (r.demandas) extras.push(`${r.demandas} demanda(s)`);
    if (r.usuarios) extras.push(`${r.usuarios} conta(s)`);
    res.json({
      mensagem: `"${r.nome}" excluída${extras.length ? ' com ' + extras.join(' e ') : ''}.`
    });
  } catch (erro) { next(erro); }
};

/* ------------------------------ Usuários ------------------------------ */

/** Qual empresa este usuário pode administrar? */
function empresaAlvo(req) {
  if (req.usuario.perfil === 'admin') {
    const pedido = req.params.empresaId || req.body.empresaId || req.query.empresaId;
    return pedido ? Number(pedido) : null;      // null = administradores do principal
  }
  return req.usuario.empresa_id;                // gestor: sempre a própria
}

/**
 * Resolve o perfil de acesso que a conta vai usar.
 * Aceita `perfilId` (o caminho novo) e ainda o `perfil` antigo ('operador'),
 * que vira o perfil de fábrica correspondente. Confere sempre o escopo:
 * perfil de outra empresa, ou de base admin numa conta de empresa, é recusado.
 */
async function resolverPerfil(corpo, empresaId) {
  let perfil = null;
  if (corpo.perfilId) perfil = await perfilModel.buscarPorId(Number(corpo.perfilId));
  else if (corpo.perfil) perfil = await perfilModel.deFabrica(String(corpo.perfil));

  if (!perfil) {
    perfil = await perfilModel.deFabrica(empresaId == null ? 'admin' : 'operador');
  }
  if (!perfil) return { erro: 'Nenhum perfil de acesso cadastrado. Rode as migracoes do banco.' };

  if (empresaId == null && perfil.base !== 'admin') {
    return { erro: 'Conta do sistema principal precisa de um perfil de administrador.' };
  }
  if (empresaId != null && perfil.base === 'admin') {
    return { erro: 'Perfil de administrador nao pode ser dado a uma conta de empresa.' };
  }
  if (perfil.empresa_id != null && perfil.empresa_id !== empresaId) {
    return { erro: 'Esse perfil pertence a outra empresa.' };
  }
  if (perfil.ativo === false) return { erro: `O perfil "${perfil.nome}" esta desativado.` };
  return { perfil };
}

exports.listarUsuarios = async (req, res, next) => {
  try { res.json(await usuarioModel.listar(empresaAlvo(req))); } catch (erro) { next(erro); }
};

exports.criarUsuario = async (req, res, next) => {
  try {
    const empresaId = empresaAlvo(req);
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    let perfil = req.body.perfil;

    if (nome.length < 2) return res.status(422).json({ mensagem: 'Informe o nome.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(422).json({ mensagem: 'Informe um e-mail válido.' });
    }
    if (senha.length < 8) return res.status(422).json({ mensagem: 'A senha precisa de ao menos 8 caracteres.' });

    if (empresaId == null && req.usuario.perfil !== 'admin') {
      return res.status(403).json({ mensagem: 'Ação restrita.' });
    }

    const escolha = await resolverPerfil(req.body, empresaId);
    if (escolha.erro) return res.status(422).json({ mensagem: escolha.erro });
    perfil = escolha.perfil.base;

    const sistemaIds = Array.isArray(req.body.sistemaIds)
      ? req.body.sistemaIds.map(Number).filter(Boolean) : [];
    res.status(201).json(await usuarioModel.criar({
      empresaId, nome, email, senha, perfil, perfilId: escolha.perfil.id, sistemaIds
    }));
  } catch (erro) { next(erro); }
};

/** Sistemas que podem ser atribuídos às contas de um escopo. */
exports.sistemasDoEscopo = async (req, res, next) => {
  try {
    const empresaId = empresaAlvo(req);
    const linhas = await listaModel.listar('sistemas', { empresaId, sistemasIds: null });
    res.json(linhas
      .filter((s) => s.ativo && !s.fixo && (empresaId == null || s.empresa_id === empresaId))
      .map((s) => ({ id: s.id, nome: s.nome, empresa: s.empresa })));
  } catch (erro) { next(erro); }
};

/** Confere que o alvo está no escopo de quem edita. */
async function alvoPermitido(req, id) {
  const alvo = await usuarioModel.buscarPorId(id);
  if (!alvo) return null;
  if (req.usuario.perfil === 'admin') return alvo;
  return alvo.empresa_id === req.usuario.empresa_id ? alvo : false;
}

exports.atualizarUsuario = async (req, res, next) => {
  try {
    const alvo = await alvoPermitido(req, req.params.id);
    if (alvo === null) return res.status(404).json({ mensagem: 'Usuário não encontrado.' });
    if (alvo === false) return res.status(403).json({ mensagem: 'Usuário de outra empresa.' });

    const dados = { nome: req.body.nome, ativo: req.body.ativo, senha: req.body.senha };
    if (Array.isArray(req.body.sistemaIds)) {
      dados.sistemaIds = req.body.sistemaIds.map(Number).filter(Boolean);
    }
    if (req.body.perfilId !== undefined || req.body.perfil !== undefined) {
      const escolha = await resolverPerfil(req.body, alvo.empresa_id);
      if (escolha.erro) return res.status(422).json({ mensagem: escolha.erro });
      // trocar o perfil do último administrador o tiraria do sistema principal
      if (alvo.empresa_id == null && escolha.perfil.base !== 'admin') {
        return res.status(409).json({ mensagem: 'Conta do sistema principal é sempre administrador.' });
      }
      dados.perfil = escolha.perfil.base;
      dados.perfilId = escolha.perfil.id;
    }
    if (dados.senha && String(dados.senha).length < 8) {
      return res.status(422).json({ mensagem: 'A senha precisa de ao menos 8 caracteres.' });
    }
    // não deixa o sistema ficar sem administrador ativo
    if (alvo.empresa_id == null && dados.ativo === false && await usuarioModel.contarAdmins() <= 1) {
      return res.status(409).json({ mensagem: 'Mantenha ao menos um administrador ativo.' });
    }
    res.json(await usuarioModel.atualizar(alvo.id, dados));
  } catch (erro) { next(erro); }
};

exports.removerUsuario = async (req, res, next) => {
  try {
    const alvo = await alvoPermitido(req, req.params.id);
    if (alvo === null) return res.status(404).json({ mensagem: 'Usuário não encontrado.' });
    if (alvo === false) return res.status(403).json({ mensagem: 'Usuário de outra empresa.' });
    if (alvo.id === req.usuario.id) {
      return res.status(409).json({ mensagem: 'Você não pode excluir a própria conta.' });
    }
    if (alvo.empresa_id == null && await usuarioModel.contarAdmins() <= 1) {
      return res.status(409).json({ mensagem: 'Mantenha ao menos um administrador ativo.' });
    }
    const nome = await usuarioModel.remover(alvo.id);
    res.json({ mensagem: `"${nome}" removido.` });
  } catch (erro) { next(erro); }
};
