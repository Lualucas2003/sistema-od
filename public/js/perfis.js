/**
 * Configurações › Perfis e permissões.
 *
 * Um perfil é um nome com um conjunto de permissões; as contas apontam para
 * ele. A tela separa os perfis em blocos recolhidos, um por dono:
 *
 *   Perfis do sistema      os quatro de fábrica, iguais em todo lugar
 *   Todos os portais       personalizados que valem em qualquer empresa
 *   <Empresa>              os daquela empresa — cada empresa ganha o bloco dela
 *
 * Cada bloco tem o próprio botão de criar, então fica claro para quem o perfil
 * novo vai valer. O que estava aberto fica lembrado no navegador.
 *
 * O servidor é quem manda: aqui só aparece o que ele disse que dá para
 * conceder (`concedeveis`) — um gestor nunca vê as permissões de dono do
 * sistema, e nunca consegue conceder o que ele mesmo não tem.
 */
import { api } from './api.js';
import { $, $$, esc, estado, toast, tentar } from './ui.js';
import { confirmar, perguntar } from './dialogo.js';

const BASES = [
  { valor: 'gestor', nome: 'Gestor — administra a empresa' },
  { valor: 'operador', nome: 'Operador — trabalha nas OD' },
  { valor: 'leitor', nome: 'Leitor — só consulta' }
];

const COR_BASE = { admin: 'pr-urgente', gestor: 'pr-alta', operador: 'pr-media', leitor: 'pr-baixa' };
const CHAVE_ABERTOS = 'od.perfis.abertos';

let catalogo = [];      // permissões que esta tela pode mostrar
let concedeveis = [];   // as que quem está logado pode conceder
let perfis = [];
let empresas = [];
let ehAdmin = false;

let aoMudarPerfis = () => {};
export function aoAtualizar(fn) { aoMudarPerfis = fn; }

/** As empresas vêm do módulo de administração; cada uma vira um bloco. */
export function definirEmpresas(lista) { empresas = lista || []; }

const porGrupo = () => catalogo.reduce((mapa, p) => {
  (mapa[p.grupo] = mapa[p.grupo] || []).push(p);
  return mapa;
}, {});

/* ------------------- Blocos abertos, lembrados aqui ------------------- */

function abertos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_ABERTOS) || '[]'); }
  catch (e) { return []; }                        // modo privado
}

function guardarAberto(chave, aberto) {
  const lista = new Set(abertos());
  if (aberto) lista.add(chave);
  else lista.delete(chave);
  try { localStorage.setItem(CHAVE_ABERTOS, JSON.stringify([...lista])); }
  catch (e) { /* modo privado */ }
}

/* ------------------------------ Listagem ------------------------------ */

export async function renderPerfis() {
  if (!$('#listaPerfis')) return;

  const dados = await tentar(() => api.perfis.listar());
  if (!dados) return;
  perfis = dados.perfis;
  catalogo = dados.permissoes;
  concedeveis = dados.concedeveis;
  ehAdmin = dados.ehAdmin;

  const blocos = montarBlocos();
  const lembrados = abertos();
  // primeira visita: abre o bloco onde há algo a fazer, para a tela não vir vazia
  const semLembranca = !lembrados.length;

  $('#listaPerfis').innerHTML = blocos.map((bloco, i) => {
    const aberto = semLembranca
      ? (bloco.criavel && i === blocos.findIndex((b) => b.criavel))
      : lembrados.includes(bloco.chave);
    return `
    <details class="grupo-perfis" data-grupo="${esc(bloco.chave)}" ${aberto ? 'open' : ''}>
      <summary>
        <span class="gp-icone">${bloco.icone}</span>
        <span class="gp-titulo"><b>${esc(bloco.nome)}</b><span>${esc(bloco.dica)}</span></span>
        <span class="gp-contagem">${bloco.perfis.length}</span>
      </summary>
      <div class="gp-corpo">
        ${bloco.perfis.length
          ? `<div class="lista-itens">${bloco.perfis.map(linhaPerfil).join('')}</div>`
          : `<p class="dica" style="margin:0">${esc(bloco.vazio)}</p>`}
        ${bloco.criavel ? `
        <div class="barra-acoes" style="margin-top:12px">
          <button class="btn btn-sm btn-primario" data-novo-perfil="${bloco.empresaId ?? ''}"
            >+ Novo perfil${bloco.sufixoBotao ? ' ' + esc(bloco.sufixoBotao) : ''}</button>
        </div>` : ''}
      </div>
    </details>`;
  }).join('');

  ligarEventos();

  const rodape = $('#dicaPerfis');
  if (rodape) {
    rodape.textContent = ehAdmin
      ? 'Os quatro perfis do sistema não podem ser excluídos, mas você ajusta as permissões '
        + 'deles (menos as do administrador, que tem tudo por definição). Cada empresa tem o '
        + 'bloco dela — o perfil criado ali só aparece naquele portal.'
      : `Você mantém os perfis de ${estado.usuario.empresa || 'sua empresa'} e só pode conceder `
        + 'permissões que a sua própria conta tem.';
  }
}

/** Separa os perfis por dono e monta um bloco para cada um. */
function montarBlocos() {
  // perfis de fábrica: só o administrador vê e ajusta
  const blocos = ehAdmin ? [{
    chave: 'sistema',
    icone: '⚙️',
    nome: 'Perfis do sistema',
    dica: 'De fábrica: não são excluídos, mas as permissões você ajusta.',
    perfis: perfis.filter((p) => p.sistema),
    vazio: 'Nenhum perfil de fábrica encontrado.',
    criavel: false,
    empresaId: null,
    sufixoBotao: ''
  }] : [];

  if (!ehAdmin) {
    // gestor: um bloco só, o da empresa dele
    blocos.push({
      chave: 'minha-empresa',
      icone: '🏢',
      nome: estado.usuario.empresa || 'Minha empresa',
      dica: 'Perfis que você mantém para as contas do seu portal.',
      perfis: perfis.filter((p) => !p.sistema),
      vazio: 'Nenhum perfil próprio ainda — crie um para ajustar o que cada conta faz.',
      criavel: true,
      empresaId: null,
      sufixoBotao: ''
    });
    return blocos;
  }

  blocos.push({
    chave: 'globais',
    icone: '🌐',
    nome: 'Todos os portais',
    dica: 'Perfis que você criou e ficam disponíveis em qualquer empresa.',
    perfis: perfis.filter((p) => !p.sistema && p.empresa_id == null),
    vazio: 'Nenhum perfil global ainda.',
    criavel: true,
    empresaId: null,
    sufixoBotao: 'para todos os portais'
  });

  // uma empresa cadastrada = um bloco próprio, mesmo sem perfil nenhum ainda
  empresas.forEach((e) => blocos.push({
    chave: 'empresa-' + e.id,
    icone: '🏢',
    nome: e.nome,
    dica: e.slug ? `Só no portal /p/${e.slug}` : 'Perfis exclusivos desta empresa.',
    perfis: perfis.filter((p) => p.empresa_id === e.id),
    vazio: 'Nenhum perfil próprio — as contas usam os perfis do sistema.',
    criavel: true,
    empresaId: e.id,
    sufixoBotao: 'para ' + e.nome
  }));

  return blocos;
}

function linhaPerfil(p) {
  const chaves = p.chaves || [];
  const resumo = p.base === 'admin'
    ? 'todas as permissões'
    : chaves.length + ' de ' + catalogo.length + ' permissões';
  return `
    <div class="item-lista${p.ativo ? '' : ' desativado'}">
      <span class="nome">${esc(p.nome)}
        <span class="sistemas-conta">${esc(p.descricao || resumo)}</span>
        ${p.base === 'admin' ? '' : `<span class="chips chips-perm">${chaves.length
          ? chaves.slice(0, 6).map((c) => `<span class="chip">${esc(rotulo(c))}</span>`).join('')
            + (chaves.length > 6 ? `<span class="chip">+${chaves.length - 6}</span>` : '')
          : '<span class="dica">sem permissão nenhuma</span>'}</span>`}
      </span>
      <span class="tag ${COR_BASE[p.base] || 'pr-media'}">${esc(p.base)}</span>
      <span class="uso">${p.contas} conta(s)</span>
      <div class="acoes">
        <button class="mini-btn" data-editar-perfil="${p.id}"
                ${p.base === 'admin' ? 'disabled title="O administrador tem tudo, sempre"'
                                     : 'title="Editar permissões"'}>&#9998;</button>
        <button class="mini-btn perigo" data-remover-perfil="${p.id}"
                ${p.sistema ? 'disabled title="Perfil do sistema"' : 'title="Excluir"'}
                >&#128465;</button>
      </div>
    </div>`;
}

function ligarEventos() {
  $$('#listaPerfis .grupo-perfis').forEach((bloco) => {
    bloco.addEventListener('toggle', () => guardarAberto(bloco.dataset.grupo, bloco.open));
  });
  $$('#listaPerfis [data-editar-perfil]').forEach((b) => b.addEventListener('click',
    () => editarPerfil(perfis.find((p) => String(p.id) === b.dataset.editarPerfil))));
  $$('#listaPerfis [data-remover-perfil]').forEach((b) => b.addEventListener('click',
    () => removerPerfil(perfis.find((p) => String(p.id) === b.dataset.removerPerfil))));
  $$('#listaPerfis [data-novo-perfil]').forEach((b) => b.addEventListener('click',
    () => criarPerfil(b.dataset.novoPerfil || null)));
}

const rotulo = (chave) => {
  const p = catalogo.find((x) => x.chave === chave);
  return p ? p.nome : chave;
};

/* --------------------------- Criar e editar --------------------------- */

/** Campos de permissão, um bloco de checks por grupo. */
function camposDePermissao(marcadas) {
  return Object.entries(porGrupo()).map(([grupo, itens]) => ({
    id: 'g_' + grupo.normalize('NFD').replace(/[^a-zA-Z]/g, ''),
    rotulo: grupo,
    tipo: 'checks',
    valor: itens.filter((i) => marcadas.includes(i.chave)).map((i) => i.chave),
    opcoes: itens.map((i) => ({
      valor: i.chave,
      nome: i.nome,
      // o que a própria conta não tem, ela não concede — fica visível, mas travado
      desabilitado: !concedeveis.includes(i.chave),
      detalhe: concedeveis.includes(i.chave) ? '' : 'sua conta não tem'
    })),
    vazio: 'Nada neste grupo.'
  }));
}

/** Junta os grupos de volta numa lista só de chaves. */
function reunir(valores) {
  return Object.entries(valores)
    .filter(([id]) => id.startsWith('g_'))
    .flatMap(([, v]) => (Array.isArray(v) ? v : []))
    .map(String);
}

/**
 * Abre o cadastro já sabendo para quem o perfil vale — quem diz isso é o
 * bloco de onde o botão foi clicado.
 * @param {string|number|null} empresaId  null = todos os portais (ou a empresa do gestor)
 */
export async function criarPerfil(empresaId = null) {
  if (!catalogo.length) await renderPerfis();

  const empresa = empresas.find((e) => String(e.id) === String(empresaId));
  const destino = empresa ? empresa.nome
    : (ehAdmin ? 'todos os portais' : (estado.usuario.empresa || 'sua empresa'));

  const resposta = await perguntar({
    titulo: 'Novo perfil de acesso',
    texto: `Vale para ${destino}. Marque o que o perfil libera — depois é só atribuí-lo às contas.`,
    icone: '🛡️',
    ok: 'Criar perfil',
    campos: [
      { id: 'nome', rotulo: 'Nome do perfil', minimo: 2, dica: 'Ex.: Analista de suporte' },
      { id: 'descricao', rotulo: 'Descrição', obrigatorio: false,
        dica: 'Uma linha explicando para que serve' },
      { id: 'base', rotulo: 'Nível de escopo', tipo: 'select', valor: 'operador', opcoes: BASES,
        ajuda: 'Define o alcance da conta dentro da empresa. As permissões abaixo é que '
          + 'dizem o que ela faz.' },
      ...camposDePermissao([])
    ]
  });
  if (!resposta) return;

  const permissoes = reunir(resposta);
  if (!permissoes.length) return toast('Marque ao menos uma permissão.', 'erro');

  const novo = await tentar(() => api.perfis.criar({
    nome: resposta.nome, descricao: resposta.descricao, base: resposta.base,
    empresaId: empresaId || null, permissoes
  }));
  if (!novo) return;

  // deixa aberto o bloco onde o perfil acabou de entrar
  guardarAberto(empresaId ? 'empresa-' + empresaId : (ehAdmin ? 'globais' : 'minha-empresa'), true);
  toast(`Perfil "${novo.nome}" criado com ${novo.permissoes} permissão(ões).`);
  await renderPerfis();
  aoMudarPerfis();
}

async function editarPerfil(perfil) {
  if (!perfil) return;

  const resposta = await perguntar({
    titulo: 'Editar ' + perfil.nome,
    texto: perfil.sistema
      ? 'Perfil do sistema: o nome e o nível ficam como estão, as permissões você ajusta.'
      : (perfil.contas
        ? `${perfil.contas} conta(s) usam este perfil — a mudança vale para todas.`
        : 'Nenhuma conta usa este perfil ainda.'),
    icone: '🛡️',
    ok: 'Salvar perfil',
    campos: [
      ...(perfil.sistema ? [] : [
        { id: 'nome', rotulo: 'Nome do perfil', valor: perfil.nome, minimo: 2 },
        { id: 'descricao', rotulo: 'Descrição', valor: perfil.descricao || '', obrigatorio: false },
        { id: 'base', rotulo: 'Nível de escopo', tipo: 'select', valor: perfil.base, opcoes: BASES }
      ]),
      ...camposDePermissao(perfil.chaves || [])
    ]
  });
  if (!resposta) return;

  const permissoes = reunir(resposta);
  if (!permissoes.length) return toast('Marque ao menos uma permissão.', 'erro');

  const corpo = { permissoes };
  if (!perfil.sistema) {
    corpo.nome = resposta.nome;
    corpo.descricao = resposta.descricao;
    corpo.base = resposta.base;
  }
  const salvo = await tentar(() => api.perfis.atualizar(perfil.id, corpo));
  if (!salvo) return;
  toast(`"${salvo.nome}" agora tem ${salvo.permissoes} permissão(ões).`
    + (salvo.contas ? ` Vale para ${salvo.contas} conta(s).` : ''));
  await renderPerfis();
  aoMudarPerfis();
}

async function removerPerfil(perfil) {
  if (!perfil) return;
  const ok = await confirmar({
    titulo: `Excluir o perfil "${perfil.nome}"?`,
    texto: perfil.descricao || '',
    itens: perfil.contas
      ? [{ marca: 'Atenção', texto: `${perfil.contas} conta(s) usam este perfil. `
          + 'Mude o perfil delas antes.' }]
      : [{ marca: 'Some', texto: 'O perfil e a lista de permissões dele. As contas não são tocadas.' }],
    ok: 'Excluir', perigo: true
  });
  if (!ok) return;
  const r = await tentar(() => api.perfis.remover(perfil.id));
  if (!r) return;
  toast(r.mensagem);
  await renderPerfis();
  aoMudarPerfis();
}
