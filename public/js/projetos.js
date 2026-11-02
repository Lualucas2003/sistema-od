/**
 * Projetos: listagem, cadastro e a tela de perfil.
 *
 * O perfil é onde o projeto realmente acontece — reúne a ficha, o documento
 * de requisitos, os passos de execução (com ordem e conclusão), as demandas
 * vinculadas e o histórico.
 */
import { api, urlApi } from './api.js';
import {
  $, $$, esc, estado, toast, tentar, dataBR, dataHoraBR,
  etiquetaSituacao, etiquetaPrioridade, preencherSelect
} from './ui.js';
import { confirmar, perguntar } from './dialogo.js';

export const SITUACOES = [
  { id: 'planejamento', nome: 'Planejamento', classe: 'st-aberta' },
  { id: 'andamento', nome: 'Em andamento', classe: 'st-andamento' },
  { id: 'pausado', nome: 'Pausado', classe: 'st-aguardando' },
  { id: 'concluido', nome: 'Concluído', classe: 'st-concluida' },
  { id: 'cancelado', nome: 'Cancelado', classe: 'st-cancelada' }
];

const SITUACOES_ETAPA = [
  { id: 'pendente', nome: 'Pendente', classe: 'pr-baixa', marca: '○' },
  { id: 'andamento', nome: 'Em andamento', classe: 'st-andamento', marca: '◐' },
  { id: 'concluida', nome: 'Concluído', classe: 'st-concluida', marca: '✓' },
  { id: 'bloqueada', nome: 'Bloqueado', classe: 'pr-urgente', marca: '!' }
];

const PROXIMA = { planejamento: 'andamento', andamento: 'concluido', pausado: 'andamento' };
const LIMITE_BYTES = 6 * 1024 * 1024;
const LIMITE_DOCS = 12;

export const filtros = { busca: '', situacao: '', prioridade: '', sistema: '', responsavel: '' };
export let idAberto = null;

const situacaoDe = (id) => SITUACOES.find((s) => s.id === id) || SITUACOES[0];
const situacaoEtapaDe = (id) => SITUACOES_ETAPA.find((s) => s.id === id) || SITUACOES_ETAPA[0];
const ativos = (lista) => (lista || []).filter((i) => i.ativo !== false);

const tamanhoLegivel = (b) => (b >= 1048576
  ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

const tag = (s) => `<span class="tag ${s.classe}">${esc(s.nome)}</span>`;

/* ------------------- Requisitos: exibição recolhível ------------------- */

const GRUPOS_REQ = [
  { id: 'funcional', nome: 'Requisitos funcionais (RF)' },
  { id: 'nao-funcional', nome: 'Requisitos não funcionais (RNF)' },
  { id: 'outro', nome: 'Outros requisitos' }
];

/** "RF01 — Título" + "Prioridade: X\n\ntexto" → código, nome, prioridade, corpo e grupo. */
function partesRequisito(titulo, descricao) {
  const casa = String(titulo || '').match(/^([A-Z]{1,4}-?\d+(?:\.\d+)*)\s+—\s+(.+)$/);
  let prioridade = null;
  const corpo = String(descricao || '')
    .replace(/^Prioridade:\s*([^\n]+)\s*/i, (t, valor) => { prioridade = valor.trim(); return ''; })
    .trim();
  const codigo = casa ? casa[1] : '';
  const grupo = /^RNF/i.test(codigo) ? 'nao-funcional' : (/^RF/i.test(codigo) ? 'funcional' : 'outro');
  return { codigo, nome: casa ? casa[2] : String(titulo || ''), prioridade, corpo, grupo };
}

function tagPrioridadeReq(prioridade) {
  if (!prioridade) return '';
  const chave = prioridade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const classe = { essencial: 'pr-urgente', importante: 'pr-alta', desejavel: 'pr-media' }[chave] || 'pr-baixa';
  return `<span class="tag ${classe}">${esc(prioridade)}</span>`;
}

/** "24 funcionais · 10 não funcionais" */
function resumoRequisitos(itens) {
  const conta = (g) => itens.filter((i) => partesRequisito(i.titulo).grupo === g).length;
  return [
    conta('funcional') && `${conta('funcional')} funcionais`,
    conta('nao-funcional') && `${conta('nao-funcional')} não funcionais`,
    conta('outro') && `${conta('outro')} outros`
  ].filter(Boolean).join(' · ');
}

/**
 * Um requisito recolhido: o resumo mostra código, nome e prioridade;
 * ao abrir, aparece a descrição completa.
 * `extra`: { antes, depois, rodape, attrs } — HTML de quem chama.
 */
function itemRequisito(item, extra = {}) {
  const r = partesRequisito(item.titulo, item.descricao);
  return `
    <details class="req${extra.classe ? ' ' + extra.classe : ''}" ${extra.attrs || ''}>
      <summary>
        ${extra.antes || ''}
        ${r.codigo ? `<span class="req-codigo req-${r.grupo}">${esc(r.codigo)}</span>` : ''}
        <span class="req-nome">${esc(r.nome)}</span>
        <span class="req-tags">${tagPrioridadeReq(r.prioridade)}${extra.depois || ''}</span>
      </summary>
      <div class="req-corpo">
        ${r.corpo ? `<p>${esc(r.corpo)}</p>` : '<p class="dica">Sem descrição no documento.</p>'}
        ${extra.rodape || ''}
      </div>
    </details>`;
}

/**
 * Bloco recolhível com todos os requisitos, separados por grupo.
 * `desenhar(item, indiceNoGrupo, totalDoGrupo)` monta cada linha.
 */
function blocoRequisitos(itens, desenhar, { titulo, subtitulo, id = '' } = {}) {
  const grupos = GRUPOS_REQ.map((g) => {
    const doGrupo = itens.filter((i) => partesRequisito(i.titulo).grupo === g.id);
    if (!doGrupo.length) return '';
    return `<div class="req-grupo">
      <h4>${g.nome}<span>${doGrupo.length}</span></h4>
      ${doGrupo.map((item, i) => desenhar(item, i, doGrupo.length)).join('')}
    </div>`;
  }).join('');
  return `
    <details class="grupo-perfis grupo-req" ${id ? `id="${id}"` : ''}>
      <summary>
        <span class="gp-icone">📋</span>
        <span class="gp-titulo"><b>${esc(titulo)}</b><span>${esc(subtitulo || resumoRequisitos(itens))}</span></span>
        <span class="gp-contagem">${itens.length}</span>
      </summary>
      <div class="gp-corpo">
        <div class="req-controles">
          <button type="button" class="btn btn-sm" data-req-todos="abrir">Expandir todos</button>
          <button type="button" class="btn btn-sm" data-req-todos="fechar">Recolher todos</button>
        </div>
        ${grupos}
      </div>
    </details>`;
}

/** Liga os botões "Expandir/Recolher todos" dentro de um contêiner. */
function ligarControlesReq(raiz) {
  if (!raiz) return;
  raiz.querySelectorAll('[data-req-todos]').forEach((b) => b.addEventListener('click', () => {
    const abrir = b.dataset.reqTodos === 'abrir';
    b.closest('.gp-corpo').querySelectorAll('details.req').forEach((d) => { d.open = abrir; });
  }));
}

/** Quem chama nos diz como abrir uma OD (o modal mora em demandas.js). */
let abrirDemanda = () => {};
export function aoAbrirDemanda(fn) { abrirDemanda = fn; }

/* ------------------------------- Listagem ------------------------------- */

export function montarFiltros() {
  preencherSelect($('#pSituacao'), SITUACOES.map((s) => ({ valor: s.id, nome: s.nome })),
    true, 'Todas');
  preencherSelect($('#pPrioridade'), estado.prioridades.map((p) => ({ valor: p.id, nome: p.nome })),
    true, 'Todas');
  preencherSelect($('#pSistema'),
    ativos(estado.listas.sistemas).map((s) => ({ valor: s.nome, nome: s.nome })), true, 'Todos');
  preencherSelect($('#pResponsavel'),
    ativos(estado.listas.responsaveis).map((r) => ({ valor: r.nome, nome: r.nome })), true, 'Todos');
  Object.entries(filtros).forEach(([chave, valor]) => {
    const sel = $('#p' + chave.charAt(0).toUpperCase() + chave.slice(1));
    if (sel && sel.tagName === 'SELECT') sel.value = valor;
  });
}

export async function renderLista() {
  const itens = await tentar(() => api.projetos.listar(filtros));
  if (!itens) return;

  const alvo = $('#listaProjetos');
  if (!itens.length) {
    const temFiltro = Object.values(filtros).some(Boolean);
    alvo.innerHTML = `<div class="cartao vazio"><div class="big">🗂️</div>${temFiltro
      ? 'Nenhum projeto corresponde aos filtros.'
      : 'Nenhum projeto cadastrado. Comece pelo primeiro.'}</div>`;
    return;
  }

  alvo.innerHTML = `<div class="grade-projetos">${itens.map(cartaoProjeto).join('')}</div>`;
  $$('#listaProjetos [data-projeto]').forEach((cartao) => {
    cartao.addEventListener('click', () => { location.hash = '#projeto/' + cartao.dataset.projeto; });
  });
}

function cartaoProjeto(p) {
  const prazo = p.dias_para_prazo != null && p.dias_para_prazo < 0
    ? `<span class="tag selo-atraso">${Math.abs(p.dias_para_prazo)}d de atraso</span>`
    : (p.fim_previsto ? `<span class="dica">entrega ${dataBR(p.fim_previsto)}</span>` : '');

  return `
    <article class="projeto-cartao" data-projeto="${p.id}">
      <div class="projeto-cartao-topo">
        <span class="projeto-codigo">${esc(p.codigo)}</span>
        ${tag(situacaoDe(p.situacao))}
      </div>
      <h3>${esc(p.nome)}</h3>
      <p>${esc((p.objetivo || 'Sem objetivo descrito.').slice(0, 130))}</p>
      ${barraProgresso(p)}
      <div class="projeto-cartao-rodape">
        <span title="Requisitos e atividades concluídos">✓ ${p.etapas_concluidas}/${p.etapas} itens</span>
        <span title="Documentos anexados">${p.tem_requisitos ? '📄' : '📎'} ${p.documentos} doc.</span>
        <span title="Demandas vinculadas">🧾 ${p.demandas} OD</span>
        ${prazo}
      </div>
    </article>`;
}

function barraProgresso(p) {
  return `<div class="projeto-progresso">
      <div class="trilho"><div class="preenche" style="width:${p.progresso}%;
        --cor:${p.situacao === 'concluido' ? 'var(--ok)' : 'var(--primary)'}"></div></div>
      <b>${p.progresso}%</b>
    </div>`;
}

/* ------------------------------- Cadastro ------------------------------- */

/** Documentos escolhidos no formulário; só sobem depois que o projeto existe. */
const filaDocs = [];

/** Só o administrador, no sistema principal, escolhe a empresa do projeto. */
const adminPrincipal = () => estado.usuario.perfil === 'admin' && !estado.portal;
let empresasForm = null;

async function garantirEmpresasForm() {
  if (empresasForm || !adminPrincipal()) return;
  empresasForm = (await tentar(() => api.empresas.listar())) || [];
  montarSelectsForm();
}

export function montarSelectsForm() {
  const campoEmpresa = $('#pjEmpresa');
  const escolhendo = !!campoEmpresa && adminPrincipal();
  if (campoEmpresa) {
    campoEmpresa.closest('.campo').hidden = !escolhendo;
    // na edição o campo fica travado: a empresa é definida no cadastro
    if (escolhendo && !campoEmpresa.disabled) {
      preencherSelect(campoEmpresa,
        (empresasForm || []).filter((e) => e.ativo).map((e) => ({ valor: e.id, nome: e.nome })),
        true, 'Interno (sem empresa)');
    }
    if (escolhendo && !campoEmpresa.dataset.ligado) {
      campoEmpresa.dataset.ligado = '1';
      campoEmpresa.addEventListener('change', montarSelectsForm);
    }
  }
  // as listas seguem a empresa escolhida: sistemas dela e as contas dela
  const empresaId = escolhendo ? Number(campoEmpresa.value) || null : null;
  const daEmpresa = (lista, comFixos) => (escolhendo
    ? lista.filter((i) => (i.empresa_id ?? null) === empresaId || (comFixos && i.fixo))
    : lista);

  preencherSelect($('#pjSistema'),
    ativos(daEmpresa(estado.listas.sistemas, true)).map((s) => ({ valor: s.id, nome: s.nome })), true, 'Nenhum / vários');
  preencherSelect($('#pjSolicitante'),
    ativos(daEmpresa(estado.listas.solicitantes)).map((s) => ({ valor: s.id, nome: s.nome })), true, 'Não informado');
  preencherSelect($('#pjResponsavel'),
    ativos(daEmpresa(estado.listas.responsaveis)).map((r) => ({ valor: r.id, nome: r.nome })), true, 'Não atribuído');
  preencherSelect($('#pjPrioridade'),
    estado.prioridades.map((p) => ({ valor: p.id, nome: p.nome })), false);
  preencherSelect($('#pjSituacao'), SITUACOES.map((s) => ({ valor: s.id, nome: s.nome })), false);
}

/** Requisitos lidos do documento no cadastro — salvos junto com o projeto. */
let requisitosForm = [];

function renderRequisitosForm() {
  const campo = $('#pjRequisitosCampo');
  const alvo = $('#pjRequisitos');
  if (!campo || !alvo) return;
  campo.hidden = !requisitosForm.length;
  if (!requisitosForm.length) { alvo.innerHTML = ''; return; }

  const aberto = $('#pjRequisitosGrupo') ? $('#pjRequisitosGrupo').open : false;
  const itens = requisitosForm.map((r, i) => ({ ...r, indice: i }));
  alvo.innerHTML = blocoRequisitos(itens, (r) => itemRequisito(r, {
    depois: `<button type="button" class="mini-btn perigo" data-tirar-req="${r.indice}"
               title="Tirar este requisito do projeto">&times;</button>`
  }), { titulo: `${itens.length} requisito(s) do documento`, id: 'pjRequisitosGrupo' });
  $('#pjRequisitosGrupo').open = aberto;

  ligarControlesReq(alvo);
  alvo.querySelectorAll('[data-tirar-req]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.preventDefault();                    // o botão fica no resumo: não abre/fecha o item
    requisitosForm.splice(Number(b.dataset.tirarReq), 1);
    renderRequisitosForm();
  }));
}

/** Uma linha por passo, no mesmo padrão dos sistemas no cadastro da empresa. */
export function adicionarLinhaEtapa(valor = '', descricao = '', focar = true) {
  const alvo = $('#pjEtapas');
  if (!alvo) return;
  const linha = document.createElement('div');
  linha.className = 'campo-repetido';
  linha.innerHTML = `
    <span class="passo-num"></span>
    <input type="text" maxlength="300" value="${esc(valor)}"
           placeholder="Ex.: Levantar requisitos com o cliente">
    <button type="button" class="mini-btn perigo" title="Remover atividade">&times;</button>`;
  // a descrição lida do documento vai junto com o passo ao salvar
  const campo = linha.querySelector('input');
  if (descricao) {
    campo.dataset.descricao = descricao;
    campo.title = descricao;
  }
  linha.querySelector('button').addEventListener('click', () => {
    linha.remove();
    numerarEtapas();
  });
  alvo.appendChild(linha);
  numerarEtapas();
  if (focar) campo.focus();
}

function numerarEtapas() {
  $$('#pjEtapas .campo-repetido').forEach((linha, i) => {
    linha.querySelector('.passo-num').textContent = i + 1;
  });
}

function limparErrosForm() {
  ['PjNome', 'PjFim'].forEach((c) => {
    const e = $('#erro' + c);
    if (e) e.textContent = '';
  });
  ['#pjNome', '#pjFim'].forEach((s) => {
    const el = $(s);
    if (el) el.classList.remove('invalido');
  });
}

export function limparForm() {
  if (!$('#formProjeto')) return;
  const campoEmpresa = $('#pjEmpresa');
  if (campoEmpresa) { campoEmpresa.disabled = false; campoEmpresa.value = ''; }
  montarSelectsForm();
  $('#pjId').value = '';
  $('#pjNome').value = '';
  $('#pjObjetivo').value = '';
  $('#pjSistema').value = '';
  $('#pjSolicitante').value = '';
  $('#pjResponsavel').value = '';
  $('#pjPrioridade').value = 'media';
  $('#pjSituacao').value = 'planejamento';
  $('#pjInicio').value = '';
  $('#pjFim').value = '';
  $('#pjEtapas').innerHTML = '';
  $('#pjEtapas').closest('.campo').hidden = false;
  $('#btnAddLinhaEtapa').hidden = false;
  adicionarLinhaEtapa('', '', false);
  requisitosForm = [];
  renderRequisitosForm();
  filaDocs.length = 0;
  renderFilaDocs();
  limparErrosForm();
  $('#tituloProjeto').textContent = 'Novo projeto';
  $('#subtituloProjeto').textContent = 'O código sai automático (PRJ-AAAA-NNNN) ao salvar.';
}

/** Projeto antigo pode apontar para item desativado: mantém a opção no select. */
function garantirOpcao(seletor, id, nome) {
  const sel = $(seletor);
  if (!sel || !id) return;
  if (Array.from(sel.options).some((o) => o.value === String(id))) return;
  const opcao = document.createElement('option');
  opcao.value = id;
  opcao.textContent = nome + ' (inativo)';
  sel.appendChild(opcao);
}

export function preencherForm(p) {
  if (!$('#formProjeto')) return;          // perfil sem permissão de cadastro
  limparForm();
  const campoEmpresa = $('#pjEmpresa');
  if (campoEmpresa) {
    if (p.empresa_id && !Array.from(campoEmpresa.options).some((o) => o.value === String(p.empresa_id))) {
      campoEmpresa.add(new Option(p.empresa, p.empresa_id));
    }
    campoEmpresa.value = p.empresa_id || '';
    campoEmpresa.disabled = true;            // a empresa não muda depois de salvo
    montarSelectsForm();
  }
  garantirOpcao('#pjSistema', p.sistema_id, p.sistema);
  garantirOpcao('#pjSolicitante', p.solicitante_id, p.solicitante);
  garantirOpcao('#pjResponsavel', p.responsavel_id, p.responsavel);
  $('#pjId').value = p.id;
  $('#pjNome').value = p.nome;
  $('#pjObjetivo').value = p.objetivo || '';
  $('#pjSistema').value = p.sistema_id || '';
  $('#pjSolicitante').value = p.solicitante_id || '';
  $('#pjResponsavel').value = p.responsavel_id || '';
  $('#pjPrioridade').value = p.prioridade;
  $('#pjSituacao').value = p.situacao;
  $('#pjInicio').value = p.inicio_previsto ? String(p.inicio_previsto).slice(0, 10) : '';
  $('#pjFim').value = p.fim_previsto ? String(p.fim_previsto).slice(0, 10) : '';
  // na edição as atividades são mantidas pelo perfil, não pelo formulário
  $('#pjEtapas').innerHTML = '';
  $('#pjEtapas').closest('.campo').hidden = true;
  $('#btnAddLinhaEtapa').hidden = true;
  $('#tituloProjeto').textContent = 'Editar ' + p.codigo;
  $('#subtituloProjeto').textContent =
    'Atividades e documentos continuam sendo mantidos no perfil do projeto.';
}

/** Envia o formulário. Devolve o projeto salvo ou null. */
export async function salvar() {
  const id = $('#pjId').value;
  const corpo = {
    // só no cadastro e só para o administrador; para os demais a empresa é a do portal
    empresaId: !id && adminPrincipal() ? ($('#pjEmpresa').value || null) : undefined,
    nome: $('#pjNome').value,
    objetivo: $('#pjObjetivo').value,
    sistemaId: $('#pjSistema').value || null,
    solicitanteId: $('#pjSolicitante').value || null,
    responsavelId: $('#pjResponsavel').value || null,
    prioridade: $('#pjPrioridade').value,
    situacao: $('#pjSituacao').value,
    inicioPrevisto: $('#pjInicio').value || null,
    fimPrevisto: $('#pjFim').value || null,
    // requisitos do documento primeiro, depois os passos de desenvolvimento
    etapas: id ? [] : requisitosForm
      .map((r) => ({ titulo: r.titulo, descricao: r.descricao || null, tipo: 'requisito' }))
      .concat($$('#pjEtapas input')
        .map((i) => ({ titulo: i.value.trim(), descricao: i.dataset.descricao || null, tipo: 'passo' }))
        .filter((e) => e.titulo))
  };
  // documento que já preencheu o formulário não precisa oferecer a importação de novo
  const jaLido = filaDocs.some((d) => d.jaLido);

  try {
    const salvo = id ? await api.projetos.atualizar(id, corpo) : await api.projetos.criar(corpo);
    limparErrosForm();

    if (filaDocs.length) {
      const enviados = await enviarDocumentos(salvo.id, filaDocs.slice());
      if (enviados.length) toast(`${enviados.length} documento(s) anexado(s) ao ${salvo.codigo}.`);
      filaDocs.length = 0;
      renderFilaDocs();

      // o documento de requisitos já propõe os passos, sem o usuário pedir
      const requisitos = enviados.find((d) => d.categoria === 'requisitos');
      if (requisitos && !jaLido) await oferecerImportacao(salvo.id, requisitos);
    }
    toast(id ? `${salvo.codigo} atualizado.` : `Projeto ${salvo.codigo} cadastrado.`);
    return salvo;
  } catch (erro) {
    if (erro.erros) {
      limparErrosForm();
      Object.entries(erro.erros).forEach(([chave, msg]) => {
        const suf = { nome: 'PjNome', fimPrevisto: 'PjFim' }[chave];
        if (!suf) return;
        $('#erro' + suf).textContent = msg;
        $('#' + suf.charAt(0).toLowerCase() + suf.slice(1)).classList.add('invalido');
      });
      toast('Verifique os campos destacados.', 'erro');
    } else {
      toast(erro.message, 'erro');
    }
    return null;
  }
}

/* ------------------------------ Documentos ------------------------------ */

const lerComoDataURL = (arquivo) => new Promise((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(leitor.result);
  leitor.onerror = () => falha(new Error(`Não foi possível ler "${arquivo.name}".`));
  leitor.readAsDataURL(arquivo);
});

/** Converte o arquivo em { nome, tipo, tamanho, dados(base64), categoria }. */
async function prepararDocumento(arquivo, categoria) {
  if (arquivo.size > LIMITE_BYTES) {
    throw new Error(`"${arquivo.name}" passa de 6 MB. Compacte antes de anexar.`);
  }
  const dataUrl = await lerComoDataURL(arquivo);
  return {
    categoria,
    nome: arquivo.name.slice(0, 160),
    tipo: arquivo.type || 'application/octet-stream',
    tamanho: arquivo.size,
    dados: String(dataUrl).split(',')[1]
  };
}

async function enviarDocumentos(projetoId, documentos) {
  const enviados = [];
  for (const doc of documentos) {
    const salvo = await tentar(() => api.projetos.documentos.enviar(projetoId, doc));
    if (salvo) enviados.push(salvo);
  }
  return enviados;
}

/** Fila do formulário de cadastro. */
export async function adicionarDocsNaFila(arquivos, categoria = 'requisitos') {
  for (const arquivo of arquivos) {
    if (filaDocs.length >= LIMITE_DOCS) {
      toast(`Limite de ${LIMITE_DOCS} documentos por projeto.`, 'erro');
      break;
    }
    try {
      const doc = await prepararDocumento(arquivo, categoria);
      filaDocs.push(doc);
      renderFilaDocs();
      // projeto novo + documento de requisitos: o documento preenche o cadastro
      const novo = !$('#pjId').value;
      if (novo && categoria === 'requisitos' && !filaDocs.some((d) => d.jaLido)) {
        await preencherPeloDocumento(doc);
      }
    } catch (erro) { toast(erro.message, 'erro'); }
  }
  renderFilaDocs();
}

/**
 * Lê o documento de requisitos e preenche nome, objetivo e requisitos do projeto.
 * Se o formulário já tem algo digitado, pergunta antes de substituir.
 */
async function preencherPeloDocumento(doc) {
  const contador = $('#pjContadorDocs');
  if (contador) contador.textContent = `Lendo "${doc.nome}"…`;
  let lido;
  try {
    lido = await api.projetos.requisitos.lerArquivo(doc.nome, doc.dados);
  } catch (erro) {
    toast(`Não consegui ler "${doc.nome}": ${erro.message}`, 'erro');
    return;
  } finally {
    renderFilaDocs();
  }
  if (!lido.nome && !lido.objetivo && !lido.itens.length) {
    toast(lido.aviso || `Não encontrei o que preencher em "${doc.nome}".`, 'erro');
    return;
  }

  const substitui = [];
  if (lido.nome && $('#pjNome').value.trim()) substitui.push('o nome do projeto');
  if (lido.objetivo && $('#pjObjetivo').value.trim()) substitui.push('o objetivo');
  if (lido.itens.length && requisitosForm.length) {
    substitui.push(`os ${requisitosForm.length} requisito(s) já carregados`);
  }

  const itens = [
    lido.nome && { marca: 'Nome', texto: lido.nome },
    lido.objetivo && { marca: 'Objetivo', texto: lido.objetivo.length > 140
      ? lido.objetivo.slice(0, 140) + '…' : lido.objetivo },
    lido.itens.length && { marca: 'Requisitos', texto: `${lido.itens.length} requisito(s)`
      + (lido.explicacao ? ` — ${lido.explicacao}` : '') }
  ].filter(Boolean);

  if (substitui.length) {
    const ok = await confirmar({
      titulo: 'Preencher o projeto com o documento?',
      texto: `"${doc.nome}" vai substituir ${substitui.join(', ')}.`,
      itens, ok: 'Preencher', cancelar: 'Manter o que digitei', icone: '📄'
    });
    if (!ok) { doc.jaLido = false; return; }
  }

  if (lido.nome) {
    $('#pjNome').value = lido.nome;
    limparErrosForm();
  }
  if (lido.objetivo) $('#pjObjetivo').value = lido.objetivo;
  // os requisitos vão para a lista própria; os passos de desenvolvimento ficam como estão
  if (lido.itens.length) {
    requisitosForm = lido.itens.map((item) => ({ titulo: item.titulo, descricao: item.descricao || '' }));
    renderRequisitosForm();
  }
  doc.jaLido = true;
  toast(`Projeto preenchido com "${doc.nome}"`
    + (lido.itens.length ? `: ${lido.itens.length} requisito(s).` : '.')
    + (lido.aviso ? ` ${lido.aviso}` : ''));
}

function renderFilaDocs() {
  const alvo = $('#pjDocumentos');
  if (!alvo) return;
  alvo.hidden = !filaDocs.length;
  alvo.innerHTML = filaDocs.map((d, i) => `
    <div class="item-lista">
      <span class="doc-icone">${iconeDoc(d.nome)}</span>
      <span class="nome">${esc(d.nome)}</span>
      <span class="uso">${d.categoria === 'requisitos' ? 'requisitos' : 'apoio'}
        · ${tamanhoLegivel(d.tamanho)}</span>
      <div class="acoes"><button type="button" class="mini-btn perigo" data-i="${i}"
        title="Tirar da lista">&times;</button></div>
    </div>`).join('');
  alvo.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
    filaDocs.splice(Number(b.dataset.i), 1);
    renderFilaDocs();
  }));
  const contador = $('#pjContadorDocs');
  if (contador) {
    contador.textContent = filaDocs.length
      ? `${filaDocs.length} arquivo(s) serão anexados ao salvar.`
      : 'O documento de requisitos também pode ser anexado depois, no perfil do projeto.';
  }
}

function iconeDoc(nome) {
  const ext = (String(nome).split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📙';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return '🖼️';
  if (ext === 'zip') return '🗜️';
  return '📄';
}

/* ------------------------------- Perfil ------------------------------- */

export async function abrirPerfil(id) {
  const p = await tentar(() => api.projetos.buscar(id));
  if (!p) {
    $('#perfilProjeto').innerHTML =
      '<div class="cartao vazio"><div class="big">🚫</div>Projeto não encontrado neste escopo.</div>';
    return null;
  }
  idAberto = p.id;
  renderPerfil(p);
  return p;
}

/** Recarrega o perfil aberto (depois de qualquer alteração). */
export async function recarregarPerfil() {
  if (idAberto) await abrirPerfil(idAberto);
}

function renderPerfil(p) {
  const pode = estado.pode;
  const proxima = PROXIMA[p.situacao];

  const requisitos = (p.documentos_lista || []).filter((d) => d.categoria === 'requisitos');
  const apoio = (p.documentos_lista || []).filter((d) => d.categoria !== 'requisitos');
  const reqItens = (p.etapas_lista || []).filter((e) => e.tipo === 'requisito');
  const atividades = (p.etapas_lista || []).filter((e) => e.tipo !== 'requisito');
  const feitos = (lista) => lista.filter((e) => e.situacao === 'concluida').length;

  const avisoPrazo = (p.dias_para_prazo != null && p.dias_para_prazo < 0)
    ? `<div class="aviso"><span>⚠</span><div>Entrega prevista para
        ${dataBR(p.fim_previsto)} — ${Math.abs(p.dias_para_prazo)} dia(s) de atraso.</div></div>` : '';

  const semRequisitos = requisitos.length ? '' :
    `<div class="aviso"><span>📄</span><div>Nenhum documento de requisitos anexado.
       É dele que saem os requisitos do projeto.</div></div>`;

  const raiz = $('#perfilProjeto');
  const mesmoProjeto = raiz.dataset.projeto === String(p.id);
  const grupoAberto = mesmoProjeto && !!raiz.querySelector('details.grupo-req[open]');
  const reqAbertos = mesmoProjeto
    ? Array.from(raiz.querySelectorAll('details.req[open]')).map((d) => d.dataset.etapa) : [];
  const posicaoLinha = mesmoProjeto ? (raiz.querySelector('.lt-rolagem') || {}).scrollLeft || 0 : 0;
  raiz.dataset.projeto = p.id;

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <div>
        <button class="btn btn-sm" id="btnVoltarProjetos">‹ Projetos</button>
        <div class="perfil-codigo">${esc(p.codigo)}</div>
        <h1>${esc(p.nome)}</h1>
        <p>${tag(situacaoDe(p.situacao))} ${etiquetaPrioridade(p)}
          ${p.empresa ? `<span class="dica">· ${esc(p.empresa)}</span>` : ''}</p>
      </div>
      <div class="barra-acoes">
        ${pode['projeto.editar'] ? '<button class="btn" id="btnEditarProjeto">Editar</button>' : ''}
        ${pode['projeto.editar'] && proxima
          ? `<button class="btn btn-primario" id="btnAvancarProjeto">${proxima === 'concluido'
              ? 'Concluir projeto' : 'Iniciar execução'}</button>` : ''}
        ${pode['projeto.excluir'] ? '<button class="btn btn-perigo" id="btnExcluirProjeto">Excluir</button>' : ''}
      </div>
    </div>

    ${avisoPrazo}

    <div class="grade-kpi">
      <div class="kpi" style="--cor:var(--primary)">
        <div class="rot">Progresso</div><div class="val">${p.progresso}%</div>
        <div class="sub">${feitos(reqItens)} de ${reqItens.length} requisito(s) ·
          ${feitos(atividades)} de ${atividades.length} atividade(s)</div>
      </div>
      <div class="kpi" style="--cor:var(--info)">
        <div class="rot">Documentos</div><div class="val">${p.documentos}</div>
        <div class="sub">${requisitos.length ? 'requisitos anexado' : 'sem documento de requisitos'}</div>
      </div>
      <div class="kpi" style="--cor:var(--roxo)">
        <div class="rot">Demandas ligadas</div><div class="val">${p.demandas}</div>
        <div class="sub">OD abertas a partir deste projeto</div>
      </div>
      <div class="kpi" style="--cor:var(--warn)">
        <div class="rot">Entrega prevista</div>
        <div class="val" style="font-size:22px">${p.fim_previsto ? dataBR(p.fim_previsto) : '—'}</div>
        <div class="sub">${p.dias_para_prazo == null ? 'sem prazo definido'
          : (p.dias_para_prazo < 0 ? `${Math.abs(p.dias_para_prazo)}d de atraso`
                                   : `faltam ${p.dias_para_prazo}d`)}</div>
      </div>
    </div>

    <div class="grade-2">
      <div>
        <div class="cartao cartao-pad" style="margin-bottom:16px">
          <h2 class="sec">Objetivo do projeto</h2>
          <div class="bloco-desc" style="margin-bottom:0">${p.objetivo
            ? esc(p.objetivo) : '<span style="color:var(--muted)">Nenhum objetivo descrito.</span>'}</div>
        </div>

        <div class="cartao cartao-pad" style="margin-bottom:16px">
          <div class="sec-topo"><div><h2>Documento de requisitos</h2>
            <p>O que foi combinado com o cliente. Fica guardado no banco e pode ser baixado
               a qualquer momento.</p></div></div>
          ${semRequisitos}
          ${listaDocumentos(requisitos, 'Nenhum documento de requisitos anexado.')}
          ${pode['projeto.criar'] ? `
          <label class="area-solta" id="areaDocRequisitos" for="docRequisitos"
                 style="margin-top:12px">
            <span class="icone">📄</span>
            <b>Clique para escolher ou arraste o documento de requisitos aqui</b>
            <span class="dica">PDF, DOC/DOCX, ODT, RTF, TXT, MD, CSV, planilhas,
              apresentações, imagens ou ZIP · até 6 MB</span>
          </label>
          <input type="file" id="docRequisitos" multiple hidden>` : ''}

          <h2 class="sec" style="margin-top:18px">Outros documentos</h2>
          ${listaDocumentos(apoio, 'Nenhum documento de apoio.')}
          ${pode['projeto.criar'] ? `
          <div class="barra-acoes" style="margin-top:12px">
            <label class="btn btn-sm" for="docApoio">+ Anexar outro documento</label>
            <input type="file" id="docApoio" multiple hidden>
            <span class="dica" id="statusDoc"></span>
          </div>` : ''}
        </div>

        <div class="cartao cartao-pad" style="margin-bottom:16px">
          <div class="sec-topo"><div><h2>Requisitos</h2>
            <p>O que foi combinado no documento. Abra a lista e clique em um requisito para ler
               a descrição; marque ✓ quando ele estiver atendido.</p></div></div>
          ${pode['projeto.criar'] ? `
          <div class="barra-acoes barra-importar">
            ${requisitos.length ? `<button class="btn btn-sm btn-primario" id="btnImportarRequisitos">
              ⚡ Ler requisitos do documento</button>` : ''}
            <button class="btn btn-sm" id="btnImportarTexto">📋 Colar requisitos</button>
            <span class="dica">${requisitos.length
              ? `Lê "${esc(requisitos[0].nome)}" e acrescenta os requisitos escolhidos.`
              : 'Anexe o documento de requisitos acima — os requisitos saem dele automaticamente.'}</span>
          </div>` : ''}
          ${listaRequisitos(reqItens, pode)}
        </div>

        <div class="cartao cartao-pad">
          <div class="sec-topo"><div><h2>Atividades</h2>
            <p>As tarefas para o projeto acontecer, na ordem de execução. Marque cada uma
               conforme for concluindo.</p></div></div>
          ${linhaDoTempo(atividades)}
          ${listaEtapas(atividades, pode)}
          ${pode['projeto.criar'] ? `
          <div class="add-linha" style="margin:14px 0 0">
            <input type="text" id="novaAtividade" maxlength="120"
                   placeholder="Descreva a próxima atividade">
            <button class="btn btn-primario" id="btnAddAtividade">Adicionar atividade</button>
          </div>` : ''}
        </div>
      </div>

      <div>
        ${fichaTemDados(p) ? `
        <div class="cartao cartao-pad cartao-ficha">
          <h2 class="sec">Ficha</h2>
          <div class="ficha ficha-perfil">
            <div><span>Sistema</span><b>${p.sistema
              ? esc(p.sistema) : '<span style="color:var(--muted)">vários / nenhum</span>'}</b></div>
            <div><span>Responsável</span><b>${esc(p.responsavel)}</b></div>
            <div><span>Solicitante</span><b>${p.solicitante
              ? esc(p.solicitante) : '<span style="color:var(--muted)">—</span>'}</b></div>
            <div><span>Início previsto</span><b>${p.inicio_previsto ? dataBR(p.inicio_previsto) : '—'}</b></div>
            <div><span>Cadastro</span><b>${dataBR(p.criado_em)}</b></div>
            <div><span>Conclusão</span><b>${p.concluido_em ? dataBR(p.concluido_em) : '—'}</b></div>
          </div>
        </div>` : ''}

        ${(p.demandas_lista || []).length ? `
        <div class="cartao cartao-pad cartao-vinculos">
          <h2 class="sec">Demandas vinculadas (${p.demandas})</h2>
          <div class="lista-itens">${
            p.demandas_lista.map((d) => `
              <div class="item-lista" data-od="${d.id}" style="cursor:pointer">
                <span class="num" style="font-weight:700;color:var(--primary)">${esc(d.numero)}</span>
                <span class="nome">${esc(d.titulo)}</span>
                <span class="uso">${etiquetaSituacao(d)}</span>
              </div>`).join('')}</div>
        </div>` : ''}

        <div class="cartao cartao-pad">
          <h2 class="sec">Histórico</h2>
          ${estado.pode['projeto.criar'] ? `
          <div class="add-linha">
            <input type="text" id="novoAndamentoProjeto" maxlength="200"
                   placeholder="Registrar andamento...">
            <button class="btn" id="btnAndamentoProjeto">Registrar</button>
          </div>` : ''}
          <div class="historico-rolagem">
            <ul class="historico">${(p.historico || []).slice().reverse().map((h) => `
              <li><time>${dataHoraBR(h.registrado_em)}${h.autor ? ' · ' + esc(h.autor) : ''}</time>
                ${esc(h.texto)}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
    </div>`;

  const grupo = raiz.querySelector('details.grupo-req');
  if (grupo) grupo.open = grupoAberto;
  reqAbertos.forEach((id) => {
    const d = raiz.querySelector(`details.req[data-etapa="${id}"]`);
    if (d) d.open = true;
  });
  ligarControlesReq(raiz);
  ligarLinhaDoTempo(raiz, posicaoLinha);
  alinharHistorico(raiz);
  ligarPerfil(p);
}

/** A Ficha só aparece quando há algo além do cadastro para mostrar. */
function fichaTemDados(p) {
  return !!(p.sistema || p.solicitante || p.inicio_previsto || p.concluido_em
    || (p.responsavel && p.responsavel !== 'Não atribuído'));
}

/** No desktop, o Histórico tem a mesma altura do cartão de Atividades. */
function alinharHistorico(raiz) {
  const cartaoDe = (titulo) => Array.from(raiz.querySelectorAll('.cartao'))
    .find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.trim() === titulo);
  const atividades = cartaoDe('Atividades');
  const historico = cartaoDe('Histórico');
  if (!atividades || !historico) return;

  const ajustar = () => {
    const desktop = window.matchMedia('(min-width: 901px)').matches;
    historico.style.height = desktop ? atividades.offsetHeight + 'px' : '';
  };
  ajustar();
  new ResizeObserver(ajustar).observe(atividades);   // acompanha a largura da janela
}

function listaDocumentos(docs, vazio) {
  if (!docs.length) return `<p class="dica" style="margin:0">${vazio}</p>`;
  return `<div class="lista-itens">${docs.map((d) => `
    <div class="item-lista">
      <span class="doc-icone">${iconeDoc(d.nome)}</span>
      <span class="nome nome-doc">${esc(d.nome)}
        <span class="sistemas-conta">${tamanhoLegivel(d.tamanho)} ·
          ${dataBR(d.criado_em)}${d.enviado_por ? ' · ' + esc(d.enviado_por) : ''}</span></span>
      <div class="acoes">
        <a class="mini-btn" href="${urlApi(`/documentos/${d.id}/arquivo`)}" target="_blank"
           rel="noopener" title="Abrir">↗</a>
        <a class="mini-btn" href="${urlApi(`/documentos/${d.id}/arquivo?download=1`)}"
           download title="Baixar">⭳</a>
        ${estado.pode['projeto.criar']
          ? `<button class="mini-btn" data-importar-doc="${d.id}"
               title="Ler os requisitos deste documento">⚡</button>` : ''}
        ${estado.pode['projeto.editar']
          ? `<button class="mini-btn perigo" data-remove-doc="${d.id}"
               data-nome="${esc(d.nome)}" title="Remover">🗑</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

/** Botões de ordem, edição e remoção de um item (requisito ou passo). */
function acoesItem(e, i, total, rotulo) {
  return `
      <div class="acoes">
        <button class="mini-btn" data-subir="${e.id}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
        <button class="mini-btn" data-descer="${e.id}"
                ${i === total - 1 ? 'disabled' : ''} title="Descer">▼</button>
        <button class="mini-btn" data-editar-etapa="${e.id}" title="Editar ${rotulo}">✎</button>
        <button class="mini-btn perigo" data-remover-etapa="${e.id}"
                data-nome="${esc(e.titulo)}" title="Remover ${rotulo}">🗑</button>
      </div>`;
}

/** Requisitos do projeto: lista recolhida, cada um abre para mostrar a descrição. */
function listaRequisitos(itens, pode) {
  if (!itens.length) {
    return `<p class="dica" style="margin:0">Nenhum requisito cadastrado. Anexe o documento de
      requisitos ou cole a lista para trazê-los para cá.</p>`;
  }
  const atendidos = itens.filter((e) => e.situacao === 'concluida').length;
  return blocoRequisitos(itens, (e, i, total) => {
    const s = situacaoEtapaDe(e.situacao);
    return itemRequisito(e, {
      classe: e.situacao === 'concluida' ? 'feito' : '',
      attrs: `data-etapa="${e.id}"`,
      antes: `<button type="button" class="passo-marca ${s.classe}" data-alternar="${e.id}"
                ${pode['projeto.editar'] ? '' : 'disabled'}
                title="${e.situacao === 'concluida' ? 'Reabrir requisito' : 'Marcar como atendido'}">
                ${s.marca}</button>`,
      depois: e.situacao !== 'pendente' ? tag(s) : '',
      rodape: `
        <div class="passo-meta">
          ${e.responsavel && e.responsavel !== 'Não atribuído'
            ? `<span>👤 ${esc(e.responsavel)}</span>` : ''}
          ${e.prazo ? `<span>🗓 ${dataBR(e.prazo)}</span>` : ''}
          ${e.concluida_em ? `<span>✓ atendido em ${dataBR(e.concluida_em)}</span>` : ''}
        </div>
        ${pode['projeto.editar'] ? acoesItem(e, i, total, 'requisito') : ''}`
    });
  }, {
    titulo: `${itens.length} requisito(s) · ${atendidos} atendido(s)`,
    subtitulo: `${resumoRequisitos(itens)} — clique para ver a lista`
  });
}

/**
 * Linha do tempo das atividades: uma bolinha por atividade, na ordem de execução,
 * com o nome e a data prevista. A cor da bolinha é a situação.
 */
function linhaDoTempo(atividades) {
  if (!atividades.length) return '';
  const hoje = new Date().toLocaleDateString('sv-SE');   // AAAA-MM-DD, no fuso local
  const itens = atividades.map((e) => {
    const s = situacaoEtapaDe(e.situacao);
    const prazo = e.prazo ? String(e.prazo).slice(0, 10) : '';
    const atrasada = prazo && prazo < hoje && e.situacao !== 'concluida';
    const quando = e.situacao === 'concluida' && e.concluida_em
      ? `✓ ${dataBR(e.concluida_em)}`
      : (prazo ? dataBR(prazo) : 'Sem data');
    return `
      <li class="lt-item lt-${e.situacao}" title="${esc(e.titulo)} — ${s.nome}${atrasada ? ' (atrasada)' : ''}">
        <span class="lt-bola"></span>
        <b>${esc(e.titulo)}</b>
        <time class="${atrasada ? 'atrasada' : ''}">${esc(quando)}</time>
      </li>`;
  }).join('');
  const legenda = SITUACOES_ETAPA.map((s) =>
    `<span class="lt-legenda lt-${s.id}"><span class="lt-bola"></span>${s.nome}</span>`).join('');
  return `
    <div class="linha-tempo">
      <div class="lt-legendas">${legenda}</div>
      <div class="lt-corpo">
        <button type="button" class="lt-seta" data-lt="-1" aria-label="Atividades anteriores">‹</button>
        <div class="lt-rolagem"><ol class="lt-itens">${itens}</ol></div>
        <button type="button" class="lt-seta" data-lt="1" aria-label="Próximas atividades">›</button>
      </div>
    </div>`;
}

/** Setas da linha do tempo: só aparecem quando as atividades não cabem na largura. */
function ligarLinhaDoTempo(raiz, posicao = 0) {
  const corpo = raiz.querySelector('.lt-corpo');
  if (!corpo) return;
  const faixa = corpo.querySelector('.lt-rolagem');
  const [anterior, proxima] = corpo.querySelectorAll('.lt-seta');

  const atualizar = () => {
    const sobra = faixa.scrollWidth - faixa.clientWidth;
    corpo.classList.toggle('com-rolagem', sobra > 1);
    anterior.disabled = faixa.scrollLeft <= 1;
    proxima.disabled = faixa.scrollLeft >= sobra - 1;
  };
  [anterior, proxima].forEach((b) => b.addEventListener('click', () => {
    faixa.scrollBy({ left: Number(b.dataset.lt) * faixa.clientWidth * 0.8, behavior: 'smooth' });
  }));
  faixa.addEventListener('scroll', atualizar, { passive: true });
  new ResizeObserver(atualizar).observe(faixa);   // some junto com o elemento a cada redesenho

  faixa.scrollLeft = posicao;
  atualizar();
}

function listaEtapas(etapas, pode) {
  if (!etapas.length) {
    return `<p class="dica" style="margin:0">Nenhuma atividade cadastrada. Liste aqui o que precisa
      acontecer — levantamento, aprovação, desenvolvimento, testes, entrega...</p>`;
  }
  return `<ol class="passos">${etapas.map((e, i) => {
    const s = situacaoEtapaDe(e.situacao);
    return `
    <li class="passo ${e.situacao === 'concluida' ? 'feito' : ''}" data-etapa="${e.id}">
      <button class="passo-marca ${s.classe}" data-alternar="${e.id}"
              ${pode['projeto.editar'] ? '' : 'disabled'}
              title="${e.situacao === 'concluida' ? 'Reabrir passo' : 'Marcar como concluído'}">
        ${s.marca}</button>
      <div class="passo-corpo">
        <b>${i + 1}. ${esc(e.titulo)}</b>
        ${e.descricao ? `<p>${esc(e.descricao)}</p>` : ''}
        <div class="passo-meta">
          ${tag(s)}
          ${e.responsavel && e.responsavel !== 'Não atribuído'
            ? `<span>👤 ${esc(e.responsavel)}</span>` : ''}
          ${e.prazo ? `<span>🗓 ${dataBR(e.prazo)}</span>` : ''}
          ${e.concluida_em ? `<span>✓ ${dataBR(e.concluida_em)}</span>` : ''}
        </div>
      </div>
      ${pode['projeto.editar'] ? acoesItem(e, i, etapas.length, 'atividade') : ''}
    </li>`;
  }).join('')}</ol>`;
}

/* ------------------------- Eventos do perfil ------------------------- */

function ligarPerfil(p) {
  const requisitos = (p.documentos_lista || []).filter((d) => d.categoria === 'requisitos');
  const ligar = (seletor, evento, fn) => {
    const el = $(seletor);
    if (el) el.addEventListener(evento, fn);
  };

  ligar('#btnVoltarProjetos', 'click', () => { location.hash = '#projetos'; });

  ligar('#btnEditarProjeto', 'click', () => {
    preencherForm(p);
    location.hash = '#projeto-novo';
  });

  ligar('#btnAvancarProjeto', 'click', async () => {
    const salvo = await tentar(() => api.projetos.avancar(p.id));
    if (salvo) { toast(`${salvo.codigo}: ${situacaoDe(salvo.situacao).nome.toLowerCase()}.`); recarregarPerfil(); }
  });

  ligar('#btnExcluirProjeto', 'click', async () => {
    const ok = await confirmar({
      titulo: `Excluir ${p.codigo}?`,
      texto: p.nome,
      itens: [
        { marca: 'Apaga', texto: `${p.etapas} requisito(s) e atividade(s), ${p.documentos} documento(s) e o histórico.` },
        { marca: 'Mantém', texto: `${p.demandas} demanda(s) vinculada(s) — só perdem o vínculo.` }
      ],
      ok: 'Excluir projeto', perigo: true
    });
    if (!ok) return;
    const r = await tentar(() => api.projetos.remover(p.id));
    if (r) { toast(r.mensagem); location.hash = '#projetos'; }
  });

  // ----- documentos -----
  ['#docRequisitos', '#docApoio'].forEach((seletor) => {
    ligar(seletor, 'change', async (e) => {
      const arquivos = Array.from(e.target.files || []);
      e.target.value = '';
      if (!arquivos.length) return;
      await anexarNoPerfil(p.id, arquivos, seletor === '#docRequisitos' ? 'requisitos' : 'apoio');
    });
  });

  const area = $('#areaDocRequisitos');
  if (area) {
    ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => {
      e.preventDefault();
      area.classList.add('sobre');
    }));
    ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
      e.preventDefault();
      area.classList.remove('sobre');
    }));
    area.addEventListener('drop', async (e) => {
      const arquivos = Array.from(e.dataTransfer.files || []);
      if (arquivos.length) await anexarNoPerfil(p.id, arquivos, 'requisitos');
    });
  }

  $$('[data-remove-doc]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Remover o documento?',
      texto: b.dataset.nome,
      itens: [{ marca: 'Atenção', texto: 'O arquivo é apagado do banco; o histórico registra a remoção.' }],
      ok: 'Remover', perigo: true
    });
    if (!ok) return;
    const r = await tentar(() => api.projetos.documentos.remover(b.dataset.removeDoc));
    if (r) { toast(r.mensagem); recarregarPerfil(); }
  }));

  // ----- importar requisitos -----
  ligar('#btnImportarRequisitos', 'click', async () => {
    if (!requisitos.length) return;
    await oferecerImportacao(p.id, requisitos[0]);
    await recarregarPerfil();
  });
  ligar('#btnImportarTexto', 'click', () => importarDeTexto(p.id));
  $$('[data-importar-doc]').forEach((b) => b.addEventListener('click', async () => {
    await oferecerImportacao(p.id, { id: b.dataset.importarDoc });
    await recarregarPerfil();
  }));

  // ----- passos -----
  ligar('#btnAddAtividade', 'click', adicionarAtividade);
  ligar('#novaAtividade', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarAtividade(); }
  });

  $$('[data-alternar]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const etapa = (p.etapas_lista || []).find((e) => String(e.id) === b.dataset.alternar);
    if (!etapa) return;
    const nova = etapa.situacao === 'concluida' ? 'pendente' : 'concluida';
    const r = await tentar(() => api.projetos.etapas.mudarSituacao(etapa.id, nova));
    if (r) recarregarPerfil();
  }));

  $$('[data-subir]').forEach((b) => b.addEventListener('click', async () => {
    const r = await tentar(() => api.projetos.etapas.mover(b.dataset.subir, 'cima'));
    if (r) recarregarPerfil();
  }));
  $$('[data-descer]').forEach((b) => b.addEventListener('click', async () => {
    const r = await tentar(() => api.projetos.etapas.mover(b.dataset.descer, 'baixo'));
    if (r) recarregarPerfil();
  }));

  $$('[data-editar-etapa]').forEach((b) => b.addEventListener('click', async () => {
    const etapa = (p.etapas_lista || []).find((e) => String(e.id) === b.dataset.editarEtapa);
    if (!etapa) return;
    const ehReq = etapa.tipo === 'requisito';
    const nomeTipo = ehReq ? 'requisito' : 'atividade';
    const valores = await perguntar({
      titulo: `Editar ${nomeTipo}`,
      texto: `${nomeTipo[0].toUpperCase() + nomeTipo.slice(1)} de ${p.codigo}.`,
      campos: [
        { id: 'titulo', rotulo: ehReq ? 'Requisito' : 'O que precisa ser feito', valor: etapa.titulo, minimo: 3 },
        { id: 'descricao', rotulo: ehReq ? 'Descrição' : 'Detalhe (opcional)', tipo: 'textarea',
          valor: etapa.descricao || '', obrigatorio: false },
        { id: 'responsavelId', rotulo: 'Responsável', tipo: 'select', obrigatorio: false,
          valor: String(etapa.responsavel_id || ''),
          opcoes: [{ valor: '', nome: 'Não atribuído' }].concat(
            ativos(estado.listas.responsaveis).map((r) => ({ valor: String(r.id), nome: r.nome }))) },
        { id: 'prazo', rotulo: 'Prazo (opcional)', tipo: 'date', obrigatorio: false,
          valor: etapa.prazo ? String(etapa.prazo).slice(0, 10) : '' },
        { id: 'situacao', rotulo: 'Situação', tipo: 'select', valor: etapa.situacao,
          opcoes: SITUACOES_ETAPA.map((s) => ({ valor: s.id, nome: s.nome })) }
      ],
      ok: `Salvar ${nomeTipo}`
    });
    if (!valores) return;
    const r = await tentar(() => api.projetos.etapas.atualizar(etapa.id, valores));
    if (r) { toast(`${nomeTipo[0].toUpperCase() + nomeTipo.slice(1)} atualizado.`); recarregarPerfil(); }
  }));

  $$('[data-remover-etapa]').forEach((b) => b.addEventListener('click', async () => {
    const ehReq = !!b.closest('details.req');
    const ok = await confirmar({
      titulo: ehReq ? 'Remover o requisito?' : 'Remover a atividade?',
      texto: b.dataset.nome,
      itens: [{ marca: 'Atenção', texto: ehReq
        ? 'O requisito sai do projeto; o documento anexado continua igual.'
        : 'As atividades seguintes são renumeradas.' }],
      ok: 'Remover', perigo: true
    });
    if (!ok) return;
    const r = await tentar(() => api.projetos.etapas.remover(b.dataset.removerEtapa));
    if (r) { toast(r.mensagem); recarregarPerfil(); }
  }));

  // ----- histórico e demandas -----
  ligar('#btnAndamentoProjeto', 'click', registrarAndamento);
  ligar('#novoAndamentoProjeto', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); registrarAndamento(); }
  });

  $$('#perfilProjeto [data-od]').forEach((linha) => {
    linha.addEventListener('click', () => abrirDemanda(linha.dataset.od));
  });
}

async function anexarNoPerfil(projetoId, arquivos, categoria) {
  const status = $('#statusDoc');
  if (status) status.textContent = 'Enviando...';
  const preparados = [];
  for (const arquivo of arquivos) {
    try { preparados.push(await prepararDocumento(arquivo, categoria)); }
    catch (erro) { toast(erro.message, 'erro'); }
  }
  const enviados = await enviarDocumentos(projetoId, preparados);
  if (enviados.length) toast(`${enviados.length} documento(s) anexado(s).`);
  await recarregarPerfil();

  // anexou requisitos? já mostra os passos que dá para tirar dele
  const requisitos = enviados.find((d) => d.categoria === 'requisitos');
  if (requisitos) {
    await oferecerImportacao(projetoId, requisitos);
    await recarregarPerfil();
  }
}

/* ------------- Requisitos do documento viram passos ------------- */

/**
 * Lê os requisitos de um documento anexado e abre a escolha do que vira passo.
 * Devolve quantos passos entraram.
 */
export async function oferecerImportacao(projetoId, documento) {
  let previa;
  try {
    previa = await api.projetos.requisitos.doDocumento(documento.id);
  } catch (erro) {
    // PDF digitalizado, imagem, formato sem texto: explica e oferece colar
    toast(erro.message, 'erro');
    return 0;
  }
  if (!previa.itens.length) {
    toast(previa.aviso || 'Não encontrei requisitos neste documento.', 'erro');
    return 0;
  }
  return escolherEImportar(projetoId, previa);
}

/** Mesma importação, a partir de um texto colado pelo usuário. */
export async function importarDeTexto(projetoId) {
  const colado = await perguntar({
    titulo: 'Colar requisitos',
    texto: 'Cole a lista de requisitos. Vale numerada (1., 2.), com marcadores (-, •) '
      + 'ou com código (RF01, US 3).',
    icone: '📋',
    campos: [{
      id: 'texto', tipo: 'textarea', rotulo: 'Requisitos', linhas: 10, minimo: 10,
      dica: 'RF01 - Permitir login único · RF02 - Emitir 2ª via do boleto...'
    }],
    ok: 'Ler requisitos'
  });
  if (!colado) return 0;

  const previa = await tentar(() => api.projetos.requisitos.doTexto(projetoId, colado.texto));
  if (!previa) return 0;
  const quantos = await escolherEImportar(projetoId, previa);
  await recarregarPerfil();
  return quantos;
}

/** A conferência: lista o que foi lido, tudo marcado, e grava o que sobrar. */
async function escolherEImportar(projetoId, previa) {
  const escolha = await perguntar({
    titulo: `${previa.itens.length} requisito(s) encontrado(s)`,
    texto: [previa.documento ? `Em "${previa.documento}".` : 'No texto colado.',
            previa.explicacao, previa.aviso].filter(Boolean).join(' '),
    icone: '⚡',
    campos: [{
      id: 'escolhidos', tipo: 'checks', rotulo: 'Quais entram nos requisitos do projeto',
      valor: previa.itens.map((item, i) => String(i)),
      opcoes: previa.itens.map((item, i) => ({
        valor: String(i), nome: item.titulo, detalhe: item.codigo || ''
      })),
      ajuda: 'Entram no fim da lista de requisitos, na ordem do documento. Dá para reordenar e editar depois.'
    }],
    ok: 'Importar requisitos'
  });
  if (!escolha) return 0;

  const itens = (escolha.escolhidos || []).map((i) => previa.itens[i]).filter(Boolean);
  if (!itens.length) {
    toast('Nenhum requisito marcado — nada foi importado.', 'erro');
    return 0;
  }
  const r = await tentar(() => api.projetos.etapas.importar(projetoId, itens, previa.documento));
  if (!r) return 0;
  toast(r.mensagem);
  return r.quantos;
}

async function adicionarAtividade() {
  const campo = $('#novaAtividade');
  const titulo = campo.value.trim();
  if (titulo.length < 3) return toast('Descreva a atividade com pelo menos 3 caracteres.', 'erro');
  const r = await tentar(() => api.projetos.etapas.criar(idAberto, { titulo }));
  if (r) { campo.value = ''; await recarregarPerfil(); }
}

async function registrarAndamento() {
  const campo = $('#novoAndamentoProjeto');
  const texto = campo.value.trim();
  if (!texto) return toast('Escreva o andamento antes de registrar.', 'erro');
  const r = await tentar(() => api.projetos.andamento(idAberto, texto));
  if (r) { campo.value = ''; await recarregarPerfil(); }
}

// o administrador precisa da lista de empresas para escolher a do projeto
garantirEmpresasForm();
