/**
 * Ponto de entrada da interface: navegação entre abas e ligação dos eventos.
 */
import { api } from './api.js';
import { $, $$, estado, toast, tentar, recarregarListas } from './ui.js';
import { ligarDicas } from './graficos.js';
import { renderPainel } from './painel.js';
import * as lista from './demandas.js';
import * as form from './formulario.js';
import * as analise from './analise.js';
import * as config from './configuracoes.js';
import * as projetos from './projetos.js';
import { adicionarNaFila, fecharVisor } from './anexos.js';
import * as admin from './admin.js';
import * as perfis from './perfis.js';

const PAGINAS = ['painel', 'demandas', 'nova', 'projetos', 'projeto', 'projeto-novo',
  'analise', 'config']
  .filter((p) => (p !== 'nova' || estado.pode['demanda.criar'])
               && (p !== 'demandas' || estado.pode['demanda.ver'])
               && (p !== 'analise' || estado.pode['analise.ver'])
               && (!p.startsWith('projeto') || estado.pode['projeto.ver'])
               && (p !== 'projeto-novo' || estado.pode['projeto.criar'])
               && (p !== 'config' || estado.pode.administrar));
let paginaAtual = 'painel';
let carregandoConfig = false;   // evita redesenhar os perfis duas vezes ao abrir a aba

async function irPara(nome) {
  if (!PAGINAS.includes(nome)) nome = 'painel';
  paginaAtual = nome;
  // preserva a parte de filtros do endereço (#analise?sistema=...)
  const atual = location.hash.slice(1).split('?')[0].split('/')[0];
  if (atual !== nome) history.replaceState(null, '', '#' + nome);
  $$('.pagina').forEach((s) => s.classList.toggle('ativa', s.id === 'pg-' + nome));
  // as telas de projeto (perfil e cadastro) mantêm a aba "Projetos" marcada
  const aba = nome.startsWith('projeto') ? 'projetos' : nome;
  $$('#abas button').forEach((b) => {
    if (b.dataset.pagina === aba) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);

  if (nome === 'painel') await renderPainel(abrirDemanda);
  if (nome === 'demandas') await lista.renderTabela();
  if (nome === 'projetos') await projetos.renderLista();
  if (nome === 'analise') {
    await analise.renderAnalise();
    await analise.renderKanban(abrirDemanda, lista.mudarSituacao);
  }
  if (nome === 'config') {
    carregandoConfig = true;
    await config.renderConfig();
    await admin.prepararFormularioEmpresa();
    await admin.renderEmpresas();
    carregandoConfig = false;
    perfis.definirEmpresas(admin.empresasCarregadas());
    await perfis.renderPerfis();
    await admin.renderUsuarios();
  }
}

/** Redesenha os gráficos e o quadro com os filtros atuais. */
async function atualizarAnalise() {
  await analise.renderAnalise();
  await analise.renderKanban(abrirDemanda, lista.mudarSituacao);
}

async function abrirDemanda(id) {
  await lista.abrirModal(id);
}

/** Recarrega o que estiver visível depois de qualquer alteração. */
async function atualizarTelas() {
  if (paginaAtual === 'analise') {
    await analise.renderAnalise();
    await analise.renderKanban(abrirDemanda, lista.mudarSituacao);
  } else if (paginaAtual === 'painel') {
    await renderPainel(abrirDemanda);
  } else if (paginaAtual === 'demandas') {
    await lista.renderTabela();
  } else if (paginaAtual === 'projetos') {
    await projetos.renderLista();
  } else if (paginaAtual === 'projeto') {
    await projetos.recarregarPerfil();
  }
}

/** Abre uma seção das Configurações (usada por #config/empresas). */
function abrirSecaoConfig(secao) {
  const botao = $(`#menuConfig button[data-sec="${secao}"]`);
  if (botao) botao.click();
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem('od.tema', tema); } catch (e) { /* modo privado */ }
}

function ligarEventos() {
  /** Alguns campos só existem para certos perfis; ligar() ignora os ausentes. */
  const ligar = (seletor, evento, fn) => {
    const el = $(seletor);
    if (el) el.addEventListener(evento, fn);
  };

  $$('#abas button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.pagina)));
  $$('[data-ir]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.ir === 'nova') form.limparForm();
    if (b.dataset.ir === 'projeto-novo') projetos.limparForm();
    irPara(b.dataset.ir);
  }));

  $('#btnTema').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-tema');
    aplicarTema(atual === 'escuro' ? 'claro' : 'escuro');
  });

  // ----- filtros da listagem -----
  let debounce;
  $('#fBusca').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      lista.filtros.busca = e.target.value;
      lista.irParaPagina(1);
      lista.renderTabela();
    }, 250);
  });
  [['fStatus', 'situacao'], ['fPrioridade', 'prioridade'], ['fSistema', 'sistema'],
   ['fResponsavel', 'responsavel'], ['fTipo', 'tipo']].forEach(([id, chave]) => {
    $('#' + id).addEventListener('change', (e) => {
      lista.filtros[chave] = e.target.value;
      lista.irParaPagina(1);
      lista.renderTabela();
    });
  });
  $('#btnLimpar').addEventListener('click', () => {
    Object.keys(lista.filtros).forEach((k) => { lista.filtros[k] = ''; });
    $('#fBusca').value = '';
    lista.montarFiltros();
    lista.irParaPagina(1);
    lista.renderTabela();
  });
  $$('#tabela th').forEach((th) => th.addEventListener('click', () => {
    const campo = th.dataset.ord;
    if (lista.ordem.campo === campo) lista.ordem.desc = !lista.ordem.desc;
    else { lista.ordem.campo = campo; lista.ordem.desc = false; }
    lista.renderTabela();
  }));
  $('#btnCsv').addEventListener('click', lista.exportarCsv);

  // ----- formulário -----
  $('#formOD').addEventListener('submit', async (e) => {
    e.preventDefault();
    const salva = await form.salvar();
    if (!salva) return;
    form.limparForm();
    lista.irParaPagina(1);
    irPara('demandas');
  });
  $('#btnCancelarForm').addEventListener('click', () => { form.limparForm(); irPara('demandas'); });

  // ----- imagens no formulário (escolher e arrastar) -----
  $('#cImagens').addEventListener('change', (e) => {
    adicionarNaFila(Array.from(e.target.files || []));
    e.target.value = '';
  });
  const area = $('#areaSolta');
  ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => {
    e.preventDefault();
    area.classList.add('sobre');
  }));
  ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
    e.preventDefault();
    area.classList.remove('sobre');
  }));
  area.addEventListener('drop', (e) => {
    const arquivos = Array.from(e.dataTransfer.files || []);
    if (arquivos.length) adicionarNaFila(arquivos);
  });

  // ----- visor de imagem -----
  $('#visorFechar').addEventListener('click', fecharVisor);
  $('#visorImagem').addEventListener('click', (e) => {
    if (e.target.id === 'visorImagem') fecharVisor();
  });

  // ----- modal -----
  $('#btnFecharModal').addEventListener('click', lista.fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) lista.fecharModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#visorImagem').classList.contains('aberto')) fecharVisor();
    else lista.fecharModal();
  });
  $('#btnImprimir').addEventListener('click', () => window.print());
  $('#btnAvancar').addEventListener('click', lista.avancar);
  $('#btnExcluir').addEventListener('click', lista.excluir);
  $('#btnEditar').addEventListener('click', async () => {
    const demanda = await tentar(() => api.demandas.buscar(lista.idAberto));
    if (!demanda) return;
    lista.fecharModal();
    form.preencherForm(demanda);
    irPara('nova');
  });

  // ----- análise -----
  $('#fPeriodo').addEventListener('change', () => atualizarAnalise());
  ['aSistema', 'aSituacao', 'aPrioridade', 'aResponsavel', 'aTipo'].forEach((id) => {
    $('#' + id).addEventListener('change', () => atualizarAnalise());
  });
  $('#btnLimparAnalise').addEventListener('click', async () => {
    await analise.limparFiltros();
    await analise.renderKanban(abrirDemanda, lista.mudarSituacao);
  });

  // ----- projetos -----
  let debounceProjetos;
  ligar('#pBusca', 'input', (e) => {
    clearTimeout(debounceProjetos);
    debounceProjetos = setTimeout(() => {
      projetos.filtros.busca = e.target.value;
      projetos.renderLista();
    }, 250);
  });
  [['pSituacao', 'situacao'], ['pPrioridade', 'prioridade'],
   ['pSistema', 'sistema'], ['pResponsavel', 'responsavel']].forEach(([id, chave]) => {
    ligar('#' + id, 'change', (e) => {
      projetos.filtros[chave] = e.target.value;
      projetos.renderLista();
    });
  });
  ligar('#btnLimparProjetos', 'click', () => {
    Object.keys(projetos.filtros).forEach((k) => { projetos.filtros[k] = ''; });
    $('#pBusca').value = '';
    projetos.montarFiltros();
    projetos.renderLista();
  });

  ligar('#formProjeto', 'submit', async (e) => {
    e.preventDefault();
    const salvo = await projetos.salvar();
    if (!salvo) return;
    projetos.limparForm();
    await form.carregarProjetos();        // o novo projeto já aparece no select da OD
    location.hash = '#projeto/' + salvo.id;
  });
  ligar('#btnCancelarProjeto', 'click', () => { projetos.limparForm(); irPara('projetos'); });
  ligar('#btnAddLinhaEtapa', 'click', () => projetos.adicionarLinhaEtapa());

  ligar('#pjArquivos', 'change', (e) => {
    projetos.adicionarDocsNaFila(Array.from(e.target.files || []));
    e.target.value = '';
  });
  const areaReq = $('#areaRequisitos');
  if (areaReq) {
    ['dragenter', 'dragover'].forEach((ev) => areaReq.addEventListener(ev, (e) => {
      e.preventDefault();
      areaReq.classList.add('sobre');
    }));
    ['dragleave', 'drop'].forEach((ev) => areaReq.addEventListener(ev, (e) => {
      e.preventDefault();
      areaReq.classList.remove('sobre');
    }));
    areaReq.addEventListener('drop', (e) => {
      const arquivos = Array.from(e.dataTransfer.files || []);
      if (arquivos.length) projetos.adicionarDocsNaFila(arquivos);
    });
  }

  // ----- configurações -----
  $$('#menuConfig button').forEach((b) => b.addEventListener('click', () => {
    $$('#menuConfig button').forEach((o) => o.classList.toggle('ativo', o === b));
    $$('.config-sec').forEach((s) => s.classList.toggle('ativa', s.id === 'sec-' + b.dataset.sec));
  }));
  $$('#segLista button').forEach((b) => b.addEventListener('click',
    () => config.trocarLista(b.dataset.lista)));

  // ----- empresas e usuários -----
  ligar('#btnAddEmpresa', 'click', admin.criarEmpresa);
  ligar('#btnAddLinhaSistema', 'click', () => admin.adicionarLinhaSistema());
  ligar('#eEmail', 'change', admin.verificarEmail);
  ligar('#eEmail', 'blur', admin.verificarEmail);
  ligar('#btnAddUsuario', 'click', admin.criarUsuario);
  ligar('#uEscopo', 'change', (e) => admin.trocarEscopoUsuarios(e.target.value));
  ligar('#btnTrocarSenha', 'click', admin.trocarPropriaSenha);
  ligar('#cTipoAcao', 'change', form.mostrarDicaTipo);
  ligar('#btnAddItem', 'click', config.adicionarItem);
  ligar('#novoItem', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); config.adicionarItem(); }
  });
  ligar('#cOrg', 'change', (e) => config.salvarIdentificacao('org', e.target.value));
  ligar('#cPrefixo', 'change', (e) => config.salvarIdentificacao('prefixo', e.target.value));
  ligar('#btnExportar', 'click', config.exportarBackup);
  ligar('#btnImportar', 'click',
    () => toast('Nesta versão os dados ficam no banco: use “Carregar exemplos” ou a API.', 'erro'));
  ligar('#btnExemplo', 'click', config.carregarExemplos);
  ligar('#btnApagar', 'click', config.apagarTudo);
}

async function iniciar() {
  try {
    const tema = localStorage.getItem('od.tema');
    if (tema) document.documentElement.setAttribute('data-tema', tema);
  } catch (e) { /* modo privado */ }

  lista.aoAtualizar(atualizarTelas);
  projetos.aoAbrirDemanda(abrirDemanda);
  analise.aoFiltrar(() => analise.renderKanban(abrirDemanda, lista.mudarSituacao));
  // trocou uma permissão de perfil? as contas afetadas veem na próxima carga
  perfis.aoAtualizar(() => admin.renderUsuarios());
  // cadastrou uma empresa? ela ganha o bloco de perfis dela na hora
  admin.aoAtualizarEmpresas((lista) => {
    if (carregandoConfig) return;
    perfis.definirEmpresas(lista);
    perfis.renderPerfis();
  });
  admin.aoAtualizarSistemas(async () => {
    await recarregarListas(api);
    lista.montarFiltros();
    analise.montarFiltros();
    projetos.montarFiltros();
    form.montarSelects();
  });
  config.aoAtualizarListas(() => {
    lista.montarFiltros();
    analise.montarFiltros();
    projetos.montarFiltros();
    form.montarSelects();
    atualizarTelas();
  });

  lista.montarFiltros();
  analise.montarFiltros();
  projetos.montarFiltros();
  form.limparForm();
  projetos.limparForm();
  await form.carregarProjetos();
  ligarEventos();
  ligarDicas($('#pg-analise'));

  window.addEventListener('hashchange', rotear);
  await rotear();
}

/** Aceita "#demandas" e também "#od/12", que abre a OD direto. */
async function rotear() {
  const destino = location.hash.slice(1);
  if (destino.startsWith('od/')) {
    const id = destino.slice(3);
    await irPara('demandas');
    await lista.abrirModal(id);
    history.replaceState(null, '', '#od/' + id);
    return;
  }
  // "#projeto/12" abre a tela de perfil daquele projeto
  if (destino.startsWith('projeto/')) {
    const id = destino.slice(8);
    lista.fecharModal();                  // veio do link "Projeto" no detalhe da OD
    await irPara('projeto');
    await projetos.abrirPerfil(id);
    history.replaceState(null, '', '#projeto/' + id);
    return;
  }
  const [caminho, consulta] = destino.split('?');
  const [nome, secao, sublista] = caminho.split('/');
  if (nome === 'analise') analise.definirFiltros(new URLSearchParams(consulta || ''));
  await irPara(nome || 'painel');
  if (nome === 'config' && secao) abrirSecaoConfig(secao);
  if (nome === 'config' && secao === 'listas' && sublista) config.trocarLista(sublista);
  // #config/usuarios/<idDaEmpresa> abre direto as contas daquela empresa
  if (nome === 'config' && secao === 'usuarios' && sublista) admin.trocarEscopoUsuarios(sublista);
}

iniciar().catch((erro) => {
  console.error('[OD] falha ao iniciar a interface:', erro);
  const aviso = document.createElement('div');
  aviso.className = 'aviso';
  aviso.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;max-width:520px';
  aviso.innerHTML = '<span>⚠</span><div>Não foi possível carregar a interface. '
    + 'Atualize a página (Ctrl+F5). Se persistir, veja o console do navegador.</div>';
  document.body.appendChild(aviso);
});
