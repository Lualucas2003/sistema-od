/**
 * Aba Configurações: listas auxiliares, identificação e dados.
 */
import { api, urlApi } from './api.js';
import { $, $$, esc, estado, toast, tentar, recarregarListas } from './ui.js';
import { confirmar } from './dialogo.js';

const META = {
  solicitantes: {
    titulo: 'Solicitantes',
    singular: 'o solicitante',
    desc: 'Quem pode abrir uma demanda. A lista é formada pelas contas de usuário da empresa: '
      + 'para incluir alguém, crie a conta em Usuários.',
    daConta: true
  },
  responsaveis: {
    titulo: 'Responsáveis',
    singular: 'o responsável',
    desc: 'Quem pode ser designado para atender a demanda. A lista é formada pelas contas de usuário '
      + 'da empresa: para incluir alguém, crie a conta em Usuários.',
    daConta: true
  },
  tipos: {
    titulo: 'Tipos de ação',
    singular: 'o tipo de ação',
    desc: 'Categoria da demanda: que tipo de problema ou pedido é. '
      + 'Os itens sem empresa valem em todos os portais.',
    placeholder: 'Ex.: Falha de impressão'
  }
};

let listaAtiva = 'solicitantes';   // sistemas agora ficam no cartão da empresa
let editando = null;
let aoMudarListas = () => {};

export function aoAtualizarListas(fn) { aoMudarListas = fn; }

/** Preenche um elemento só se ele existir (seções variam por perfil). */
function definir(seletor, propriedade, valor) {
  const el = $(seletor);
  if (el) el[propriedade] = valor;
}

export async function renderConfig() {
  const config = await tentar(() => api.config.obter());
  if (!config) return;
  estado.config = config;

  // Identificação só existe para o administrador; no portal, nem a seção de listas
  definir('#cOrg', 'value', config.org);
  definir('#cPrefixo', 'value', config.prefixo);
  definir('#previaNumero', 'textContent', config.proximoNumero);
  definir('#previaTotal', 'textContent', `${config.totalDemandas} demanda(s)`);
  if (!estado.portal) definir('#rotuloOrg', 'textContent', config.org);

  renderLista();
}

export function renderLista() {
  if (!$('#listaItens')) return;          // portal não administra listas auxiliares
  const meta = META[listaAtiva];
  const itens = estado.listas[listaAtiva] || [];

  $('#listaTitulo').textContent = meta.titulo;
  $('#listaDesc').textContent = meta.desc;
  $('#novoItem').placeholder = meta.placeholder || '';
  // lista formada pelas contas: sem campo de cadastro e sem botões de edição
  const daConta = !!meta.daConta;
  const linhaAdd = $('#novoItem').closest('.add-linha');
  if (linhaAdd) linhaAdd.hidden = daConta;
  $$('#segLista button').forEach((b) => b.classList.toggle('ativo', b.dataset.lista === listaAtiva));

  $('#listaItens').innerHTML = itens.map((item) => {
    if (daConta) {
      return `<div class="item-lista${item.ativo ? '' : ' desativado'}">
        <span class="nome">${esc(item.nome)}</span>
        ${item.ativo ? '' : '<span class="tag st-cancelada">inativo</span>'}
        ${item.empresa ? `<span class="fixo">${esc(item.empresa)}</span>` : ''}
        <span class="uso">${item.uso ? item.uso + ' demanda(s)' : 'não utilizado'}</span>
      </div>`;
    }
    if (editando === item.id) {
      return `<div class="item-lista">
        <input type="text" id="editItem" maxlength="60" value="${esc(item.nome)}">
        <div class="acoes">
          <button class="mini-btn" data-ok="${item.id}" title="Salvar">&#10003;</button>
          <button class="mini-btn" data-cancela="1" title="Cancelar">&times;</button>
        </div></div>`;
    }
    // desativar é a trava: item inativo pode ser excluído, levando as demandas junto
    const podeExcluir = !item.fixo && !item.ativo;
    return `<div class="item-lista${item.ativo ? '' : ' desativado'}">
      <span class="nome">${esc(item.nome)}
        ${item.descricao ? `<span class="dica" style="display:block">${esc(item.descricao)}</span>` : ''}</span>
      ${item.fixo ? '<span class="fixo">fixo</span>' : ''}
      ${item.ativo ? '' : '<span class="tag st-cancelada">inativo</span>'}
      ${item.empresa ? `<span class="fixo">${esc(item.empresa)}</span>` : ''}
      <span class="uso">${item.uso ? item.uso + ' demanda(s)' : 'não utilizado'}</span>
      <div class="acoes">
        <button class="mini-btn" data-edita="${item.id}" title="Renomear"
                ${item.fixo ? 'disabled' : ''}>&#9998;</button>
        <button class="mini-btn" data-ativo="${item.id}" data-valor="${item.ativo ? '0' : '1'}"
                title="${item.ativo ? 'Desativar — some dos formulários, o histórico fica' : 'Reativar'}"
                ${item.fixo ? 'disabled' : ''}>${item.ativo ? '⏸' : '▶'}</button>
        <button class="mini-btn perigo" data-remove="${item.id}"
                title="${podeExcluir
                  ? (item.uso ? `Excluir e apagar as ${item.uso} demanda(s) vinculadas` : 'Excluir definitivamente')
                  : 'Desative o item antes de excluir'}"
                ${podeExcluir ? '' : 'disabled'}>&#128465;</button>
      </div></div>`;
  }).join('') || `<div class="item-lista"><span class="uso" style="margin:0">${daConta
    ? 'Nenhuma conta de usuário cadastrada.' : 'Nenhum item cadastrado.'}</span></div>`;

  const campo = $('#editItem');
  if (campo) {
    campo.focus();
    campo.select();
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); renomear(editando, campo.value); }
      if (e.key === 'Escape') { editando = null; renderLista(); }
    });
  }

  $$('#listaItens [data-edita]').forEach((b) => b.addEventListener('click', () => {
    editando = Number(b.dataset.edita);
    renderLista();
  }));
  $$('#listaItens [data-ok]').forEach((b) => b.addEventListener('click',
    () => renomear(Number(b.dataset.ok), $('#editItem').value)));
  $$('#listaItens [data-cancela]').forEach((b) => b.addEventListener('click', () => {
    editando = null;
    renderLista();
  }));
  $$('#listaItens [data-ativo]').forEach((b) => b.addEventListener('click',
    () => alternarAtivo(Number(b.dataset.ativo), b.dataset.valor === '1')));
  $$('#listaItens [data-remove]').forEach((b) => b.addEventListener('click',
    () => remover(Number(b.dataset.remove))));
}

export function trocarLista(tipo) {
  listaAtiva = tipo;
  editando = null;
  renderLista();
}

async function atualizarTudo(mensagem) {
  await recarregarListas(api);
  editando = null;
  await renderConfig();
  aoMudarListas();
  if (mensagem) toast(mensagem);
}

export async function adicionarItem() {
  const campo = $('#novoItem');
  const nome = campo.value.trim();
  if (!nome) return toast('Digite um nome.', 'erro');
  const item = await tentar(() => api.listas.criar(listaAtiva, nome));
  if (!item) return;
  campo.value = '';
  atualizarTudo(`"${item.nome}" adicionado a ${META[listaAtiva].titulo.toLowerCase()}.`);
}

async function renomear(id, nome) {
  const item = estado.listas[listaAtiva].find((i) => i.id === id);
  if (!item) return;
  if (nome.trim() === item.nome) { editando = null; return renderLista(); }
  const salvo = await tentar(() => api.listas.renomear(listaAtiva, id, nome.trim()));
  if (!salvo) return;
  atualizarTudo(`Renomeado para "${salvo.nome}"${item.uso ? ` em ${item.uso} demanda(s).` : '.'}`);
}

async function alternarAtivo(id, ativo) {
  const item = estado.listas[listaAtiva].find((i) => i.id === id);

  if (!ativo && item) {
    const ok = await confirmar({
      titulo: `Desativar ${META[listaAtiva].singular} "${item.nome}"?`,
      texto: 'Nada é apagado — o item apenas sai de circulação.',
      icone: '⏸',
      ok: 'Desativar',
      itens: [
        { marca: 'Sai', texto: 'Deixa de aparecer no formulário de abertura e edição de demandas.' },
        { marca: 'Fica', texto: item.uso
          ? `As ${item.uso} demanda(s) que já usam continuam mostrando "${item.nome}" normalmente.`
          : 'Nenhuma demanda usa este item, então nada muda no histórico.' },
        { marca: 'Volta', texto: 'Você pode reativar quando quiser, pelo botão ▶ da lista.' }
      ]
    });
    if (!ok) return;
  }
  const r = await tentar(() => api.listas.alternarAtivo(listaAtiva, id, ativo));
  if (!r) return;
  atualizarTudo(`"${r.nome}" ${ativo ? 'reativado' : 'desativado'}.`);
}

async function remover(id) {
  const item = estado.listas[listaAtiva].find((i) => i.id === id);
  if (!item) return;

  const emUso = item.uso > 0;
  const ok = await confirmar({
    titulo: `Excluir "${item.nome}" definitivamente?`,
    texto: emUso
      ? `Este item está desativado, mas ainda é usado por ${item.uso} demanda(s).`
      : 'Este item está desativado e nunca foi usado por nenhuma demanda.',
    itens: emUso
      ? [
        { marca: 'Apaga', texto: `${item.uso} demanda(s), com todo o histórico e as imagens delas.` },
        { marca: 'Apaga', texto: `O próprio item "${item.nome}".` },
        { marca: 'Atenção', texto: 'Não há como desfazer. Exporte um backup antes, se precisar do histórico.' }
      ]
      : [{ marca: 'Atenção', texto: 'A exclusão é permanente e não pode ser desfeita.' }],
    ok: emUso ? `Excluir item e ${item.uso} demanda(s)` : 'Excluir',
    perigo: true
  });
  if (!ok) return;

  const r = await tentar(() => api.listas.remover(listaAtiva, id, emUso));
  if (!r) return;
  atualizarTudo(r.mensagem);
}

export async function salvarIdentificacao(campo, valor) {
  const config = await tentar(() => api.config.salvar({ [campo]: valor }));
  if (!config) return;
  estado.config = config;
  $('#cOrg').value = config.org;
  $('#cPrefixo').value = config.prefixo;
  $('#previaNumero').textContent = config.proximoNumero;
  $('#rotuloOrg').textContent = config.org;
  document.title = `OD — ${config.org}`;
  toast(campo === 'prefixo' ? `Prefixo definido como ${config.prefixo}.` : 'Identificação salva.');
}

export function exportarBackup() {
  window.location.href = urlApi('/backup');
  toast('Backup gerado.');
}

export async function carregarExemplos() {
  const ok = await confirmar({
    titulo: 'Carregar demandas de exemplo?',
    texto: 'Recria o conjunto de teste a partir de db/02_seed.sql.',
    itens: [
      { marca: 'Apaga', texto: 'As demandas internas atuais e o histórico delas.' },
      { marca: 'Mantém', texto: 'Empresas, contas de acesso e as listas auxiliares.' }
    ],
    ok: 'Carregar exemplos', perigo: true
  });
  if (!ok) return;
  const r = await tentar(() => api.exemplos());
  if (!r) return;
  await atualizarTudo(r.mensagem);
}

export async function apagarTudo() {
  const ok = await confirmar({
    titulo: 'Apagar todas as demandas?',
    texto: estado.portal
      ? `Serão removidas as demandas de ${estado.portal.nome}.`
      : 'Serão removidas todas as demandas de todas as empresas.',
    itens: [
      { marca: 'Apaga', texto: 'Demandas, histórico e imagens anexadas.' },
      { marca: 'Mantém', texto: 'Empresas, sistemas, catálogos e contas de acesso.' },
      { marca: 'Atenção', texto: 'Não há como desfazer. Exporte um backup antes.' }
    ],
    ok: 'Apagar tudo', perigo: true
  });
  if (!ok) return;
  const r = await tentar(() => api.demandas.removerTodas());
  if (!r) return;
  await atualizarTudo(r.mensagem);
}
