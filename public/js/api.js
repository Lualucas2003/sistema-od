/**
 * Camada de acesso à API. Nenhum outro módulo usa fetch diretamente.
 */

/** Sob /p/<slug> a API mora em /p/<slug>/api — assim o recorte vale até para o admin. */
const BASE = (() => {
  const dados = JSON.parse(document.getElementById('dados-iniciais').textContent);
  return (dados.base || '') + '/api';
})();

async function requisitar(caminho, opcoes = {}) {
  const resposta = await fetch(BASE + caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
  });
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!resposta.ok) {
    const erro = new Error((dados && dados.mensagem) || 'Falha na comunicação com o servidor.');
    erro.status = resposta.status;
    if (resposta.status === 401) setTimeout(() => window.location.reload(), 1200);
    erro.erros = dados && dados.erros;
    erro.detalhe = dados && dados.detalhe;
    throw erro;
  }
  return dados;
}

const parametros = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  demandas: {
    listar: (filtros, ordem, pagina, porPagina) => requisitar('/demandas' + parametros({
      ...filtros, ordem: ordem.campo, dir: ordem.desc ? 'desc' : 'asc', pagina, porPagina
    })),
    todas: () => requisitar('/demandas/todas'),
    buscar: (id) => requisitar('/demandas/' + id),
    criar: (dados) => requisitar('/demandas', { method: 'POST', corpo: dados }),
    atualizar: (id, dados) => requisitar('/demandas/' + id, { method: 'PUT', corpo: dados }),
    mudarSituacao: (id, situacao) => requisitar('/demandas/' + id + '/situacao',
      { method: 'PATCH', corpo: { situacao } }),
    avancar: (id) => requisitar('/demandas/' + id + '/avancar', { method: 'POST' }),
    andamento: (id, texto) => requisitar('/demandas/' + id + '/historico',
      { method: 'POST', corpo: { texto } }),
    remover: (id) => requisitar('/demandas/' + id, { method: 'DELETE' }),
    removerTodas: () => requisitar('/demandas', { method: 'DELETE' })
  },
  anexos: {
    listar: (demandaId) => requisitar(`/demandas/${demandaId}/anexos`),
    enviar: (demandaId, imagem) => requisitar(`/demandas/${demandaId}/anexos`,
      { method: 'POST', corpo: imagem }),
    remover: (id) => requisitar('/anexos/' + id, { method: 'DELETE' })
  },
  projetos: {
    listar: (filtros = {}) => requisitar('/projetos' + parametros(filtros)),
    selecao: () => requisitar('/projetos/selecao'),
    buscar: (id) => requisitar('/projetos/' + id),
    criar: (dados) => requisitar('/projetos', { method: 'POST', corpo: dados }),
    atualizar: (id, dados) => requisitar('/projetos/' + id, { method: 'PUT', corpo: dados }),
    mudarSituacao: (id, situacao) => requisitar(`/projetos/${id}/situacao`,
      { method: 'PATCH', corpo: { situacao } }),
    avancar: (id) => requisitar(`/projetos/${id}/avancar`, { method: 'POST' }),
    andamento: (id, texto) => requisitar(`/projetos/${id}/historico`,
      { method: 'POST', corpo: { texto } }),
    remover: (id) => requisitar('/projetos/' + id, { method: 'DELETE' }),

    etapas: {
      listar: (projetoId) => requisitar(`/projetos/${projetoId}/etapas`),
      criar: (projetoId, dados) => requisitar(`/projetos/${projetoId}/etapas`,
        { method: 'POST', corpo: dados }),
      atualizar: (etapaId, dados) => requisitar('/etapas/' + etapaId,
        { method: 'PUT', corpo: dados }),
      mudarSituacao: (etapaId, situacao) => requisitar(`/etapas/${etapaId}/situacao`,
        { method: 'PATCH', corpo: { situacao } }),
      mover: (etapaId, direcao) => requisitar(`/etapas/${etapaId}/mover`,
        { method: 'POST', corpo: { direcao } }),
      remover: (etapaId) => requisitar('/etapas/' + etapaId, { method: 'DELETE' }),
      importar: (projetoId, itens, origem) => requisitar(`/projetos/${projetoId}/etapas/importar`,
        { method: 'POST', corpo: { itens, origem } })
    },

    /** Requisitos lidos de um documento anexado, ou de um texto colado. */
    requisitos: {
      doDocumento: (anexoId) => requisitar(`/documentos/${anexoId}/requisitos`),
      doTexto: (projetoId, texto) => requisitar(`/projetos/${projetoId}/requisitos/previa`,
        { method: 'POST', corpo: { texto } }),
      /** Documento ainda não salvo: devolve nome, objetivo e passos do projeto. */
      lerArquivo: (nome, dados) => requisitar('/projetos/ler-documento',
        { method: 'POST', corpo: { nome, dados } })
    },

    documentos: {
      listar: (projetoId) => requisitar(`/projetos/${projetoId}/documentos`),
      enviar: (projetoId, documento) => requisitar(`/projetos/${projetoId}/documentos`,
        { method: 'POST', corpo: documento }),
      remover: (id) => requisitar('/documentos/' + id, { method: 'DELETE' })
    }
  },
  listas: {
    todas: () => requisitar('/listas'),
    criar: (tipo, nome) => requisitar('/listas/' + tipo, { method: 'POST', corpo: { nome } }),
    renomear: (tipo, id, nome) => requisitar(`/listas/${tipo}/${id}`, { method: 'PUT', corpo: { nome } }),
    alternarAtivo: (tipo, id, ativo) => requisitar(`/listas/${tipo}/${id}/ativo`,
      { method: 'PATCH', corpo: { ativo } }),
    remover: (tipo, id, cascata) => requisitar(`/listas/${tipo}/${id}` + (cascata ? '?cascata=1' : ''),
      { method: 'DELETE' })
  },
  painel: () => requisitar('/painel'),
  analise: (meses, filtros = {}) => requisitar('/analise' + parametros({ meses, ...filtros })),
  analiseProjetos: (meses, filtros = {}) =>
    requisitar('/analise/projetos' + parametros({ meses, ...filtros })),
  config: {
    obter: () => requisitar('/config'),
    salvar: (dados) => requisitar('/config', { method: 'PUT', corpo: dados })
  },
  exemplos: () => requisitar('/exemplos', { method: 'POST' }),
  eu: () => requisitar('/eu'),
  trocarSenha: (senhaAtual, senhaNova) => requisitar('/eu/senha',
    { method: 'POST', corpo: { senhaAtual, senhaNova } }),
  empresas: {
    listar: () => requisitar('/empresas'),
    porEmail: (email) => requisitar('/empresas/por-email?email=' + encodeURIComponent(email)),
    sistemas: (id) => requisitar(`/empresas/${id}/sistemas`),
    adicionarSistema: (id, nome) => requisitar(`/empresas/${id}/sistemas`,
      { method: 'POST', corpo: { nome } }),
    criar: (dados) => requisitar('/empresas', { method: 'POST', corpo: dados }),
    atualizar: (id, dados) => requisitar('/empresas/' + id, { method: 'PUT', corpo: dados }),
    remover: (id, cascata) => requisitar('/empresas/' + id + (cascata ? '?cascata=1' : ''),
      { method: 'DELETE' })
  },
  perfis: {
    listar: () => requisitar('/perfis'),
    atribuiveis: (empresaId) => requisitar('/perfis/atribuiveis'
      + (empresaId ? '?empresaId=' + empresaId : '')),
    buscar: (id) => requisitar('/perfis/' + id),
    criar: (dados) => requisitar('/perfis', { method: 'POST', corpo: dados }),
    atualizar: (id, dados) => requisitar('/perfis/' + id, { method: 'PUT', corpo: dados }),
    remover: (id) => requisitar('/perfis/' + id, { method: 'DELETE' })
  },
  usuarios: {
    listar: (empresaId) => requisitar('/usuarios' + (empresaId ? '?empresaId=' + empresaId : '')),
    sistemas: (empresaId) => requisitar('/usuarios/sistemas' + (empresaId ? '?empresaId=' + empresaId : '')),
    criar: (dados) => requisitar('/usuarios', { method: 'POST', corpo: dados }),
    atualizar: (id, dados) => requisitar('/usuarios/' + id, { method: 'PUT', corpo: dados }),
    remover: (id) => requisitar('/usuarios/' + id, { method: 'DELETE' })
  }
};

/** Caminho absoluto de um recurso da API (ex.: imagem no src de uma <img>). */
export const urlApi = (caminho) => BASE + caminho;
