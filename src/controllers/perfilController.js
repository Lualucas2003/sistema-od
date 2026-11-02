/**
 * Controller dos perfis de acesso.
 *
 * Regras que protegem o sistema de si mesmo:
 *  - o perfil de administrador não é editado nem excluído (ninguém se tranca
 *    do lado de fora);
 *  - perfil de fábrica pode ter as permissões ajustadas, mas não muda de base
 *    nem é excluído;
 *  - quem não é administrador só mexe em perfis da própria empresa e **só
 *    concede permissão que ele mesmo tem** — sem isso, um gestor poderia criar
 *    um perfil todo-poderoso e se atribuir a ele.
 */
const perfilModel = require('../models/perfilModel');
const { SO_ADMIN } = require('../middlewares/auth');

const BASES_EMPRESA = ['gestor', 'operador', 'leitor'];
const ehAdmin = (req) => req.usuario && req.usuario.perfil === 'admin';

const recusar = (res, mensagem, status = 403) => res.status(status).json({ mensagem });

/** Lista de chaves válidas, já filtrada pelo que quem pediu pode conceder. */
function filtrarPermissoes(req, pedidas, base) {
  const chaves = Array.isArray(pedidas) ? pedidas.map((c) => String(c)) : [];
  return chaves.filter((chave) => {
    // permissão de dono do sistema não entra em perfil de empresa
    if (SO_ADMIN.includes(chave) && base !== 'admin') return false;
    // ninguém concede o que não tem (o administrador tem tudo)
    return ehAdmin(req) || req.pode[chave] === true;
  });
}

/** O perfil está no alcance de quem está mexendo? */
function alcance(req, perfil) {
  if (ehAdmin(req)) return null;
  if (perfil.base === 'admin') return 'Perfil de administrador é do dono do sistema.';
  if (perfil.empresa_id == null) {
    return 'Este perfil vale para todos os portais e só o administrador pode alterá-lo.';
  }
  if (perfil.empresa_id !== req.usuario.empresa_id) return 'Perfil de outra empresa.';
  return null;
}

exports.listar = async (req, res, next) => {
  try {
    const [perfis, permissoes] = await Promise.all([
      perfilModel.listar(req.escopo),
      perfilModel.catalogo()
    ]);
    res.json({
      perfis,
      // um perfil de empresa nunca recebe as permissões de dono do sistema
      permissoes: ehAdmin(req) ? permissoes : permissoes.filter((p) => !p.exige_admin),
      // o que quem está na tela pode conceder
      concedeveis: ehAdmin(req)
        ? permissoes.map((p) => p.chave)
        : permissoes.filter((p) => req.pode[p.chave]).map((p) => p.chave),
      ehAdmin: ehAdmin(req)
    });
  } catch (erro) { next(erro); }
};

/** Perfis que podem ser atribuídos a uma conta daquele destino. */
exports.atribuiveis = async (req, res, next) => {
  try {
    const pedido = req.query.empresaId;
    let empresaId = pedido ? Number(pedido) : null;
    if (!ehAdmin(req)) empresaId = req.usuario.empresa_id;      // gestor: só a dele
    res.json(await perfilModel.atribuiveis(empresaId));
  } catch (erro) { next(erro); }
};

exports.buscar = async (req, res, next) => {
  try {
    const perfil = await perfilModel.buscarPorId(req.params.id);
    if (!perfil) return res.status(404).json({ mensagem: 'Perfil não encontrado.' });
    if (!ehAdmin(req) && perfil.empresa_id != null
        && perfil.empresa_id !== req.usuario.empresa_id) {
      return res.status(404).json({ mensagem: 'Perfil não encontrado.' });
    }
    res.json({ ...perfil, contas_lista: await perfilModel.contasDoPerfil(perfil.id) });
  } catch (erro) { next(erro); }
};

exports.criar = async (req, res, next) => {
  try {
    const nome = String(req.body.nome || '').trim().slice(0, 60);
    if (nome.length < 2) {
      return recusar(res, 'Informe um nome com pelo menos 2 caracteres.', 422);
    }

    let base = String(req.body.base || 'operador');
    let empresaId = req.body.empresaId ? Number(req.body.empresaId) : null;

    if (!ehAdmin(req)) {
      empresaId = req.usuario.empresa_id;                 // gestor só cria para a empresa dele
      if (!BASES_EMPRESA.includes(base)) base = 'operador';
    } else if (!['admin', ...BASES_EMPRESA].includes(base)) {
      base = 'operador';
    }
    if (base === 'admin' && empresaId != null) {
      return recusar(res, 'Perfil de administrador não pertence a uma empresa.', 422);
    }

    const permissoes = filtrarPermissoes(req, req.body.permissoes, base);
    if (!permissoes.length) {
      return recusar(res, 'Marque ao menos uma permissão para o perfil.', 422);
    }

    res.status(201).json(await perfilModel.criar({
      nome, descricao: String(req.body.descricao || '').trim().slice(0, 200) || null,
      base, empresaId, permissoes
    }));
  } catch (erro) { next(erro); }
};

exports.atualizar = async (req, res, next) => {
  try {
    const perfil = await perfilModel.buscarPorId(req.params.id);
    if (!perfil) return res.status(404).json({ mensagem: 'Perfil não encontrado.' });

    if (perfil.sistema && perfil.base === 'admin') {
      return recusar(res, 'O perfil de administrador tem todas as permissões e não é editável.', 409);
    }
    const barrado = alcance(req, perfil);
    if (barrado) return recusar(res, barrado);

    const dados = {};
    if (req.body.nome !== undefined) {
      const nome = String(req.body.nome).trim().slice(0, 60);
      if (nome.length < 2) return recusar(res, 'Informe um nome com pelo menos 2 caracteres.', 422);
      // perfil de fábrica mantém o nome: é referência para todo mundo
      if (!perfil.sistema) dados.nome = nome;
    }
    if (req.body.descricao !== undefined) {
      dados.descricao = String(req.body.descricao || '').trim().slice(0, 200);
    }
    if (req.body.base !== undefined && !perfil.sistema) {
      const base = String(req.body.base);
      if (BASES_EMPRESA.includes(base) || (ehAdmin(req) && base === 'admin')) dados.base = base;
    }
    if (typeof req.body.ativo === 'boolean') dados.ativo = req.body.ativo;

    if (req.body.permissoes !== undefined) {
      const base = dados.base || perfil.base;
      const permissoes = filtrarPermissoes(req, req.body.permissoes, base);
      if (!permissoes.length) {
        return recusar(res, 'Marque ao menos uma permissão para o perfil.', 422);
      }
      // quem não pode conceder uma permissão também não pode tirá-la
      if (!ehAdmin(req)) {
        const intocadas = (perfil.chaves || []).filter((c) => req.pode[c] !== true);
        permissoes.push(...intocadas);
      }
      dados.permissoes = [...new Set(permissoes)];
    }

    res.json(await perfilModel.atualizar(perfil.id, dados));
  } catch (erro) { next(erro); }
};

exports.remover = async (req, res, next) => {
  try {
    const perfil = await perfilModel.buscarPorId(req.params.id);
    if (!perfil) return res.status(404).json({ mensagem: 'Perfil não encontrado.' });
    const barrado = alcance(req, perfil);
    if (barrado) return recusar(res, barrado);

    const nome = await perfilModel.remover(perfil.id);
    res.json({ mensagem: `Perfil "${nome}" excluído.` });
  } catch (erro) { next(erro); }
};
