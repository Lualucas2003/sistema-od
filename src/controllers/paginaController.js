/**
 * Controller das páginas (View): entrega o HTML já com os dados do banco.
 * A mesma view serve o sistema principal e o portal de cada empresa —
 * o que muda é o escopo e o que o perfil do usuário pode fazer.
 */
const configModel = require('../models/configModel');
const listaModel = require('../models/listaModel');

const SITUACOES = [
  { id: 'aberta', nome: 'Aberta', classe: 'st-aberta', cor: 'var(--g-aberta)' },
  { id: 'andamento', nome: 'Em andamento', classe: 'st-andamento', cor: 'var(--g-andamento)' },
  { id: 'aguardando', nome: 'Aguardando', classe: 'st-aguardando', cor: 'var(--g-aguardando)' },
  { id: 'concluida', nome: 'Concluída', classe: 'st-concluida', cor: 'var(--g-concluida)' },
  { id: 'cancelada', nome: 'Cancelada', classe: 'st-cancelada', cor: 'var(--g-cancelada)' }
];

const PRIORIDADES = [
  { id: 'baixa', nome: 'Baixa', classe: 'pr-baixa' },
  { id: 'media', nome: 'Média', classe: 'pr-media' },
  { id: 'alta', nome: 'Alta', classe: 'pr-alta' },
  { id: 'urgente', nome: 'Urgente', classe: 'pr-urgente' }
];

exports.inicio = async (req, res, next) => {
  try {
    const [config, listas] = await Promise.all([
      configModel.obter(),
      listaModel.listarTodas(req.escopo)
    ]);

    const portal = req.portal || null;
    const nome = portal ? portal.nome : config.org;

    res.render('index', {
      titulo: `OD — ${nome}`,
      config: { ...config, org: nome },
      listas,
      situacoes: SITUACOES,
      prioridades: PRIORIDADES,
      portal,
      base: portal ? `/p/${portal.slug}` : '',
      usuario: {
        nome: req.usuario.nome,
        email: req.usuario.email,
        perfil: req.usuario.perfil,
        empresa: req.usuario.empresa || null
      },
      pode: req.pode
    });
  } catch (erro) { next(erro); }
};
