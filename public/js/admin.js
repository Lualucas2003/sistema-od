/**
 * Cadastro de empresas (portais) e das contas de acesso.
 * Empresas: só administrador. Usuários: administrador ou gestor da empresa.
 */
import { api } from './api.js';
import { $, $$, esc, estado, toast, tentar } from './ui.js';
import { confirmar, perguntar } from './dialogo.js';

/** Perfis que podem ser dados a uma conta daquele escopo (vêm do banco). */
async function perfisAtribuiveis(empresaId) {
  const lista = await tentar(() => api.perfis.atribuiveis(empresaId)) || [];
  return lista.map((p) => ({
    valor: String(p.id),
    nome: p.nome + (p.empresa ? ` (${p.empresa})` : '')
      + ' — ' + (p.base === 'admin' ? 'tudo' : p.permissoes + ' permissões')
  }));
}

const ehAdmin = () => estado.usuario.perfil === 'admin';
let empresas = [];
const abertas = new Set();         // empresas com o cartão aberto

/** As empresas já carregadas — a tela de perfis monta um bloco para cada uma. */
export const empresasCarregadas = () => empresas;

/** Avisa quando a lista de empresas muda (cadastro, exclusão, reativação). */
let aoMudarEmpresas = () => {};
export function aoAtualizarEmpresas(fn) { aoMudarEmpresas = fn; }
let escopoUsuarios = '';     // '' = administradores do principal

/* ------------------------------ Empresas ------------------------------ */

export async function renderEmpresas() {
  if (!ehAdmin() || !$('#listaEmpresas')) return;
  empresas = await tentar(() => api.empresas.listar()) || [];
  aoMudarEmpresas(empresas);

  $('#listaEmpresas').innerHTML = empresas.length ? empresas.map((e) => {
    const link = `${window.location.origin}/p/${e.slug}`;
    return `<div class="empresa-cartao${e.ativo ? '' : ' inativa'}${abertas.has(e.id) ? ' aberta' : ''}">
      <div class="empresa-topo">
        <button class="mini-btn empresa-recolher" data-recolher="${e.id}"
                aria-expanded="${abertas.has(e.id)}" title="Mostrar link e sistemas">▸</button>
        <div>
          <b>${esc(e.nome)}</b>
          ${e.ativo ? '' : '<span class="tag st-cancelada">inativa</span>'}
          <span class="dica">${e.demandas} OD · ${e.sistemas} sistema(s) · ${e.usuarios} usuário(s)</span>
        </div>
        <div class="acoes">
          <button class="mini-btn" data-editar="${e.id}" title="Editar dados da empresa">&#9998;</button>
          <button class="mini-btn" data-usuarios="${e.id}" title="Usuários da empresa">👤</button>
          <button class="mini-btn" data-alternar="${e.id}"
                  title="${e.ativo ? 'Desativar portal' : 'Reativar portal'}">${e.ativo ? '⏸' : '▶'}</button>
          <button class="mini-btn perigo" data-remove-empresa="${e.id}" title="Excluir">&#128465;</button>
        </div>
      </div>
      <div class="empresa-corpo">
        <div class="empresa-link">
          <input type="text" readonly value="${esc(link)}">
          <button class="btn btn-sm" data-copiar="${esc(link)}">Copiar link</button>
          <a class="btn btn-sm" href="/p/${esc(e.slug)}" target="_blank" rel="noopener">Abrir</a>
        </div>

        <div class="empresa-sistemas">
          <h4>Sistemas do cliente</h4>
          <div class="lista-itens" data-sistemas-de="${e.id}">
            <div class="item-lista"><span class="uso" style="margin:0">carregando…</span></div>
          </div>
          <div class="add-linha" style="margin:10px 0 0">
            <input type="text" data-novo-sistema="${e.id}" maxlength="60"
                   placeholder="Acrescentar sistema a ${esc(e.nome)}">
            <button class="btn btn-sm" data-add-sistema="${e.id}">Adicionar</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('') : '<p class="graf-vazio">Nenhuma empresa cadastrada ainda.</p>';

  // o cartão começa recolhido; o estado aberto sobrevive a um redesenho da lista
  $$('#listaEmpresas [data-recolher]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.recolher);
    const aberta = !abertas.has(id);
    if (aberta) abertas.add(id); else abertas.delete(id);
    const cartao = b.closest('.empresa-cartao');
    cartao.classList.toggle('aberta', aberta);
    b.setAttribute('aria-expanded', String(aberta));
  }));

  empresas.forEach((e) => renderSistemasDaEmpresa(e.id));

  $$('#listaEmpresas [data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    const link = b.dataset.copiar;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado.');
    } catch (e) {
      const campo = b.parentElement.querySelector('input');
      campo.select();
      toast('Selecione e copie: ' + link);
    }
  }));
  $$('#listaEmpresas [data-alternar]').forEach((b) => b.addEventListener('click', async () => {
    const empresa = empresas.find((e) => e.id === Number(b.dataset.alternar));
    const r = await tentar(() => api.empresas.atualizar(empresa.id, { ativo: !empresa.ativo }));
    if (r) { toast(`"${r.nome}" ${r.ativo ? 'reativada' : 'desativada'}.`); renderEmpresas(); }
  }));
  $$('#listaEmpresas [data-remove-empresa]').forEach((b) => b.addEventListener('click', async () => {
    const empresa = empresas.find((e) => e.id === Number(b.dataset.removeEmpresa));
    // desativar é a trava: com a empresa ativa e com demandas, o servidor recusa
    if (empresa.ativo && empresa.demandas > 0) {
      await confirmar({
        titulo: `"${empresa.nome}" ainda está ativa`,
        texto: `A empresa tem ${empresa.demandas} demanda(s) registradas.`,
        icone: '⏸',
        ok: 'Entendi', cancelar: 'Fechar',
        itens: [
          { marca: 'Passo 1', texto: 'Desative a empresa no botão ⏸ — o portal para de aceitar acesso.' },
          { marca: 'Passo 2', texto: 'Com ela desativada, a exclusão de tudo fica liberada aqui.' }
        ]
      });
      return;
    }

    const ok = await confirmar({
      titulo: `Excluir a empresa "${empresa.nome}"?`,
      texto: `O portal /p/${empresa.slug} deixa de existir.`,
      itens: [
        { marca: 'Apaga', texto: `${empresa.demandas} demanda(s), com histórico e imagens.` },
        { marca: 'Apaga', texto: `${empresa.usuarios} conta(s) de acesso e ${empresa.sistemas} sistema(s), solicitantes e responsáveis da empresa.` },
        { marca: 'Atenção', texto: 'Não há como desfazer. Exporte um backup antes, se precisar do histórico.' }
      ],
      ok: 'Excluir tudo', perigo: true
    });
    if (!ok) return;
    const r = await tentar(() => api.empresas.remover(empresa.id, true));
    if (r) { toast(r.mensagem); renderEmpresas(); montarEscopos(); }
  }));
  $$('#listaEmpresas [data-editar]').forEach((b) => b.addEventListener('click',
    () => editarEmpresa(empresas.find((e) => e.id === Number(b.dataset.editar)))));
  $$('#listaEmpresas [data-add-sistema]').forEach((b) => b.addEventListener('click',
    () => adicionarSistema(Number(b.dataset.addSistema))));
  $$('#listaEmpresas [data-novo-sistema]').forEach((campo) => campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); adicionarSistema(Number(campo.dataset.novoSistema)); }
  }));
  $$('#listaEmpresas [data-usuarios]').forEach((b) => b.addEventListener('click', () => {
    escopoUsuarios = b.dataset.usuarios;
    const menu = $('#menuConfig button[data-sec="usuarios"]');
    if (menu) menu.click();
    if ($('#uEscopo')) $('#uEscopo').value = escopoUsuarios;
    renderUsuarios();
  }));

  montarEscopos();
}

/** Edição dos dados de uma empresa já cadastrada. */
async function editarEmpresa(empresa) {
  if (!empresa) return;

  const resposta = await perguntar({
    titulo: `Editar "${empresa.nome}"`,
    texto: 'Os sistemas do cliente são gerenciados na lista abaixo do cartão.',
    icone: '🏢',
    ok: 'Salvar alterações',
    campos: [
      { id: 'nome', rotulo: 'Nome da empresa', valor: empresa.nome, minimo: 2 },
      { id: 'slug', rotulo: 'Endereço do portal', valor: empresa.slug, minimo: 3,
        padrao: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, erro: 'Use apenas letras minúsculas, números e hífen.',
        ajuda: `Fica ${window.location.origin}/p/<endereço>. Mudar aqui invalida o link antigo.` },
      { id: 'documento', rotulo: 'CNPJ / documento', valor: empresa.documento || '',
        obrigatorio: false },
      { id: 'contato', rotulo: 'Contato', valor: empresa.contato || '', obrigatorio: false }
    ]
  });
  if (!resposta) return;

  // avisa quando o endereço do portal muda, porque o link enviado ao cliente para de funcionar
  if (resposta.slug !== empresa.slug) {
    const ok = await confirmar({
      titulo: 'Mudar o endereço do portal?',
      texto: `De /p/${empresa.slug} para /p/${resposta.slug}.`,
      perigo: true,
      ok: 'Mudar endereço',
      itens: [
        { marca: 'Para', texto: `O link antigo deixa de funcionar — reenvie o novo ao cliente.` },
        { marca: 'Mantém', texto: 'Demandas, sistemas e contas de acesso continuam iguais.' }
      ]
    });
    if (!ok) return;
  }

  const salva = await tentar(() => api.empresas.atualizar(empresa.id, resposta));
  if (!salva) return;
  toast(`"${salva.nome}" atualizada.`);
  await atualizarEmpresas();
}

/* ---------------------- Sistemas de cada empresa ---------------------- */

/** Desenha a lista de sistemas dentro do cartão da empresa. */
async function renderSistemasDaEmpresa(empresaId) {
  const alvo = $(`[data-sistemas-de="${empresaId}"]`);
  if (!alvo) return;
  const sistemas = await tentar(() => api.empresas.sistemas(empresaId)) || [];

  alvo.innerHTML = sistemas.length ? sistemas.map((s) => `
    <div class="item-lista${s.ativo ? '' : ' desativado'}">
      <span class="nome">${esc(s.nome)}</span>
      ${s.ativo ? '' : '<span class="tag st-cancelada">inativo</span>'}
      <span class="uso">${s.uso ? s.uso + ' demanda(s)' : 'não utilizado'}</span>
      <div class="acoes">
        <button class="mini-btn" data-ren-sis="${s.id}" data-nome="${esc(s.nome)}"
                title="Renomear">&#9998;</button>
        <button class="mini-btn" data-ativo-sis="${s.id}" data-valor="${s.ativo ? '0' : '1'}"
                title="${s.ativo ? 'Desativar — some do formulário, o histórico fica' : 'Reativar'}"
                >${s.ativo ? '⏸' : '▶'}</button>
        <button class="mini-btn perigo" data-del-sis="${s.id}" data-uso="${s.uso}"
                title="${s.ativo ? 'Desative antes de excluir'
                  : (s.uso ? `Excluir e apagar as ${s.uso} demanda(s)` : 'Excluir definitivamente')}"
                ${s.ativo ? 'disabled' : ''}>&#128465;</button>
      </div>
    </div>`).join('')
    : '<div class="item-lista"><span class="uso" style="margin:0">Nenhum sistema cadastrado.</span></div>';

  $$('[data-ren-sis]', alvo).forEach((b) => b.addEventListener('click', async () => {
    const r = await perguntar({
      titulo: 'Renomear sistema', icone: '✎', ok: 'Salvar',
      texto: 'A mudança aparece em todas as demandas que usam este sistema.',
      campos: [{ id: 'nome', rotulo: 'Nome do sistema', valor: b.dataset.nome, minimo: 2 }]
    });
    if (!r) return;
    const ok = await tentar(() => api.listas.renomear('sistemas', b.dataset.renSis, r.nome));
    if (ok) { toast(`Renomeado para "${ok.nome}".`); await atualizarEmpresas(); }
  }));

  $$('[data-ativo-sis]', alvo).forEach((b) => b.addEventListener('click', async () => {
    const ativar = b.dataset.valor === '1';
    const r = await tentar(() => api.listas.alternarAtivo('sistemas', b.dataset.ativoSis, ativar));
    if (r) { toast(`"${r.nome}" ${ativar ? 'reativado' : 'desativado'}.`); await atualizarEmpresas(); }
  }));

  $$('[data-del-sis]', alvo).forEach((b) => b.addEventListener('click', async () => {
    const uso = Number(b.dataset.uso);
    const ok = await confirmar({
      titulo: 'Excluir o sistema?',
      texto: uso ? `Este sistema está em ${uso} demanda(s).` : 'Este sistema nunca foi usado.',
      perigo: true,
      ok: uso ? `Excluir e apagar ${uso} demanda(s)` : 'Excluir',
      itens: uso
        ? [{ marca: 'Apaga', texto: `${uso} demanda(s), com histórico e imagens.` },
           { marca: 'Atenção', texto: 'Não há como desfazer.' }]
        : [{ marca: 'Atenção', texto: 'A exclusão é permanente.' }]
    });
    if (!ok) return;
    const r = await tentar(() => api.listas.remover('sistemas', b.dataset.delSis, uso > 0));
    if (r) { toast(r.mensagem); await atualizarEmpresas(); }
  }));
}

async function adicionarSistema(empresaId) {
  const campo = $(`[data-novo-sistema="${empresaId}"]`);
  const nome = campo.value.trim();
  if (!nome) return toast('Digite o nome do sistema.', 'erro');
  const novo = await tentar(() => api.empresas.adicionarSistema(empresaId, nome));
  if (!novo) return;
  campo.value = '';
  toast(`"${novo.nome}" cadastrado.`);
  await atualizarEmpresas();
}

/** Redesenha a lista de empresas e reflete as listas no resto da interface. */
async function atualizarEmpresas() {
  await renderEmpresas();
  aoMudarListas();
}

let aoMudarListas = () => {};
export function aoAtualizarSistemas(fn) { aoMudarListas = fn; }

/* ------------ Campos repetidos de sistema no cadastro da empresa ------------ */

/** Acrescenta uma linha de sistema ao formulário de nova empresa. */
export function adicionarLinhaSistema(valor = '', focar = true) {
  const alvo = $('#eSistemas');
  if (!alvo) return;

  const linha = document.createElement('div');
  linha.className = 'campo-repetido';
  linha.innerHTML = `
    <input type="text" maxlength="60" value="${esc(valor)}"
           placeholder="Ex.: Sistema de Agendamento">
    <button type="button" class="mini-btn perigo" title="Remover este sistema">&times;</button>`;

  const campo = linha.querySelector('input');
  linha.querySelector('button').addEventListener('click', () => {
    linha.remove();
    if (!alvo.children.length) adicionarLinhaSistema('', false);   // deixa sempre uma linha
  });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarLinhaSistema(); }
  });

  alvo.appendChild(linha);
  if (focar) campo.focus();
}

const sistemasDigitados = () => $$('#eSistemas input')
  .map((i) => i.value.trim())
  .filter(Boolean);

function limparLinhasSistema() {
  const alvo = $('#eSistemas');
  if (!alvo) return;
  alvo.innerHTML = '';
  adicionarLinhaSistema('', false);
}

/** Garante uma linha de sistema em branco ao abrir a tela. */
export function prepararFormularioEmpresa() {
  const alvo = $('#eSistemas');
  if (alvo && !alvo.children.length) adicionarLinhaSistema('', false);
}

let salvandoEmpresa = false;
let vinculosDoEmail = [];        // empresas já ligadas ao e-mail digitado

const descreverVinculo = (v) => {
  const sistemas = (v.sistemas || []).length ? (v.sistemas || []).join(', ') : 'nenhum sistema ativo';
  return `${v.nome} (${sistemas})`;
};

/**
 * Ao digitar o e-mail do gestor, mostra se ele já é conta de outra empresa
 * e quais sistemas estão no nome dele.
 */
export async function verificarEmail() {
  const alvo = $('#avisoEmail');
  const email = $('#eEmail').value.trim();
  vinculosDoEmail = [];
  if (!alvo) return;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alvo.innerHTML = ''; return; }

  vinculosDoEmail = await tentar(() => api.empresas.porEmail(email)) || [];
  if (!vinculosDoEmail.length) {
    alvo.innerHTML = '<span style="color:var(--g-concluida)">E-mail ainda não cadastrado.</span>';
    return;
  }

  alvo.innerHTML = `<b style="color:var(--warn)">Este e-mail já tem conta em
    ${vinculosDoEmail.length} empresa(s):</b>`
    + '<ul class="vinculos-email">' + vinculosDoEmail.map((v) => `
      <li>
        <a href="/p/${esc(v.slug)}" target="_blank" rel="noopener">${esc(v.nome)}</a>
        <span>${esc((v.sistemas || []).join(', ') || 'nenhum sistema ativo')}</span>
        <em>${v.perfil}${v.ativo ? '' : ' · empresa inativa'} · ${v.demandas} OD</em>
      </li>`).join('') + '</ul>';
}

export async function criarEmpresa() {
  if (salvandoEmpresa) return;                 // trava contra duplo clique
  const botao = $('#btnAddEmpresa');

  const corpo = {
    nome: $('#eNome').value,
    sistemas: sistemasDigitados(),
    documento: $('#eDocumento').value,
    contato: $('#eContato').value,
    responsavel: $('#eResponsavel').value,
    email: $('#eEmail').value,
    senha: $('#eSenha').value
  };
  if (!corpo.nome.trim()) return toast('Informe o nome da empresa.', 'erro');

  // e-mail já usado em outra empresa: mostra o que existe antes de duplicar o cliente
  if (corpo.email.trim()) {
    if (!vinculosDoEmail.length) await verificarEmail();
    if (vinculosDoEmail.length) {
      const seguir = await confirmar({
        titulo: 'Este e-mail já é conta de outra empresa',
        texto: `${corpo.email.trim()} já acessa ${vinculosDoEmail.length} empresa(s). `
          + 'A nova conta será separada, com senha própria.',
        icone: '⚠',
        ok: 'Cadastrar mesmo assim',
        itens: vinculosDoEmail.map((v) => ({ marca: 'Já tem', texto: descreverVinculo(v) }))
          .concat([{ marca: 'Alternativa', texto: 'Cancele e cadastre o novo sistema dentro da empresa que já existe.' }])
      });
      if (!seguir) return;
    }
  }

  salvandoEmpresa = true;
  botao.disabled = true;
  const rotulo = botao.textContent;
  botao.textContent = 'Cadastrando...';

  try {
    let empresa;
    try {
      empresa = await api.empresas.criar(corpo);
    } catch (erro) {
      // nome repetido: o servidor recusa e a tela pergunta se é mesmo outra empresa
      if (erro.status === 409 && erro.detalhe && erro.detalhe.slug) {
        const seguir = await confirmar({
          titulo: 'Já existe uma empresa com esse nome',
          texto: erro.mensagem,
          icone: '⚠',
          ok: 'Cadastrar assim mesmo',
          perigo: true,
          itens: [
            { marca: 'Cuidado', texto: 'Duas empresas com o mesmo nome ficam difíceis de distinguir na lista.' },
            { marca: 'Endereço', texto: `A nova receberia um endereço diferente, tipo /p/${erro.detalhe.slug}-2.` }
          ]
        });
        if (!seguir) return;
        empresa = await api.empresas.criar({ ...corpo, permitirNomeRepetido: true });
      } else {
        toast(erro.message, 'erro');
        return;
      }
    }

    ['eNome', 'eDocumento', 'eContato', 'eResponsavel', 'eEmail', 'eSenha']
      .forEach((id) => { $('#' + id).value = ''; });
    limparLinhasSistema();
    if ($('#avisoEmail')) $('#avisoEmail').innerHTML = '';
    vinculosDoEmail = [];

    toast(`"${empresa.nome}" cadastrada. Portal: /p/${empresa.slug}`);
    await renderEmpresas();
  } finally {
    salvandoEmpresa = false;
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

/* ------------------------------ Usuários ------------------------------ */

function montarEscopos() {
  const sel = $('#uEscopo');
  if (!sel) return;
  sel.innerHTML = '<option value="">Administradores do sistema</option>'
    + empresas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
  sel.value = escopoUsuarios;
}

export async function renderUsuarios() {
  if (!$('#listaUsuarios')) return;
  const usuarios = await tentar(() => api.usuarios.listar(escopoUsuarios)) || [];

  $('#listaUsuarios').innerHTML = usuarios.length ? usuarios.map((u) => `
    <div class="item-lista${u.ativo ? '' : ' desativado'}">
      <span class="nome">${esc(u.nome)}
        <span class="dica" style="display:block">${esc(u.email)}</span>
        ${u.empresa_id ? `<span class="sistemas-conta">${(u.sistemas || []).length
          ? '🗂️ ' + u.sistemas.map((s) => esc(s.nome)).join(', ')
          : '🗂️ todos os sistemas da empresa'}</span>` : ''}</span>
      <span class="tag ${u.perfil === 'admin' ? 'pr-urgente' : u.perfil === 'gestor' ? 'pr-alta' : 'pr-media'}"
            title="Nível de escopo: ${esc(u.perfil)}">${esc(u.perfil_nome || u.perfil)}</span>
      <span class="uso">${u.ultimo_acesso
        ? 'último acesso ' + new Date(u.ultimo_acesso).toLocaleDateString('pt-BR')
        : 'nunca acessou'}</span>
      <div class="acoes">
        ${u.empresa_id ? `<button class="mini-btn" data-sistemas="${u.id}"
                title="Sistemas que a conta enxerga">🗂️</button>` : ''}
        ${u.empresa_id ? `<button class="mini-btn" data-perfil="${u.id}"
                title="Trocar o perfil de acesso">🛡️</button>` : ''}
        <button class="mini-btn" data-senha="${u.id}" title="Definir nova senha">🔑</button>
        <button class="mini-btn" data-ativo="${u.id}"
                title="${u.ativo ? 'Desativar' : 'Reativar'}">${u.ativo ? '⏸' : '▶'}</button>
        <button class="mini-btn perigo" data-remove-usuario="${u.id}" title="Excluir">&#128465;</button>
      </div>
    </div>`).join('')
    : '<div class="item-lista"><span class="uso" style="margin:0">Nenhuma conta cadastrada.</span></div>';

  $$('#listaUsuarios [data-sistemas]').forEach((b) => b.addEventListener('click',
    () => editarSistemas(usuarios.find((u) => u.id === Number(b.dataset.sistemas)))));
  $$('#listaUsuarios [data-perfil]').forEach((b) => b.addEventListener('click',
    () => trocarPerfil(usuarios.find((u) => u.id === Number(b.dataset.perfil)))));
  $$('#listaUsuarios [data-senha]').forEach((b) => b.addEventListener('click', async () => {
    const alvo = usuarios.find((u) => u.id === Number(b.dataset.senha));
    const resposta = await perguntar({
      titulo: `Nova senha para ${alvo.nome}`,
      texto: 'As sessões abertas dessa conta serão encerradas.',
      ok: 'Definir senha',
      campos: [{ id: 'senha', rotulo: 'Nova senha', tipo: 'password', minimo: 8,
                 dica: 'mínimo 8 caracteres', autocomplete: 'new-password' }]
    });
    if (!resposta) return;
    const r = await tentar(() => api.usuarios.atualizar(alvo.id, { senha: resposta.senha }));
    if (r) toast('Senha redefinida. As sessões abertas foram encerradas.');
  }));
  $$('#listaUsuarios [data-ativo]').forEach((b) => b.addEventListener('click', async () => {
    const alvo = usuarios.find((u) => u.id === Number(b.dataset.ativo));
    const r = await tentar(() => api.usuarios.atualizar(alvo.id, { ativo: !alvo.ativo }));
    if (r) { toast(`"${r.nome}" ${r.ativo ? 'reativado' : 'desativado'}.`); renderUsuarios(); }
  }));
  $$('#listaUsuarios [data-remove-usuario]').forEach((b) => b.addEventListener('click', async () => {
    const alvo = usuarios.find((u) => u.id === Number(b.dataset.removeUsuario));
    const ok = await confirmar({
      titulo: `Excluir a conta de "${alvo.nome}"?`,
      texto: alvo.email,
      itens: [
        { marca: 'Mantém', texto: 'As demandas e o histórico registrados por essa pessoa.' },
        { marca: 'Alternativa', texto: 'Desativar (⏸) bloqueia o acesso sem apagar a conta.' }
      ],
      ok: 'Excluir conta', perigo: true
    });
    if (!ok) return;
    const r = await tentar(() => api.usuarios.remover(alvo.id));
    if (r) { toast(r.mensagem); renderUsuarios(); }
  }));
}

/** Sistemas que podem ser atribuídos às contas do escopo atual. */
async function sistemasAtribuiveis() {
  return await tentar(() => api.usuarios.sistemas(escopoUsuarios)) || [];
}

/** Tela de atribuição de sistemas de uma conta já existente. */
async function editarSistemas(alvo) {
  const opcoes = (await sistemasAtribuiveis()).map((s) => ({ valor: s.id, nome: s.nome }));
  const atuais = (alvo.sistemas || []).map((s) => s.id);

  const resposta = await perguntar({
    titulo: `Sistemas de ${alvo.nome}`,
    texto: atuais.length
      ? `Hoje a conta enxerga ${atuais.length} sistema(s).`
      : 'Hoje a conta enxerga todos os sistemas da empresa.',
    icone: '🗂️',
    ok: 'Salvar acesso',
    campos: [{
      id: 'sistemaIds', rotulo: 'Sistemas que a conta enxerga', tipo: 'checks',
      opcoes, valor: atuais,
      vazio: 'Nenhum sistema cadastrado para esta empresa ainda.',
      ajuda: 'Sem nenhum marcado, a conta volta a enxergar todos os sistemas da empresa.'
    }]
  });
  if (!resposta) return;

  const r = await tentar(() => api.usuarios.atualizar(alvo.id, { sistemaIds: resposta.sistemaIds }));
  if (!r) return;
  toast(resposta.sistemaIds.length
    ? `${r.nome} agora enxerga ${resposta.sistemaIds.length} sistema(s).`
    : `${r.nome} voltou a enxergar todos os sistemas.`);
  renderUsuarios();
}

/** Troca o perfil de acesso de uma conta já criada. */
async function trocarPerfil(alvo) {
  if (!alvo) return;
  const opcoes = await perfisAtribuiveis(alvo.empresa_id);
  if (!opcoes.length) return toast('Nenhum perfil disponível para esta empresa.', 'erro');

  const resposta = await perguntar({
    titulo: `Perfil de ${alvo.nome}`,
    texto: `Hoje: ${alvo.perfil_nome || alvo.perfil}. A mudança vale no próximo carregamento `
      + 'de tela da pessoa.',
    icone: '🛡️',
    ok: 'Trocar perfil',
    campos: [{
      id: 'perfilId', rotulo: 'Perfil de acesso', tipo: 'select',
      valor: String(alvo.perfil_id || (opcoes[0] || {}).valor || ''), opcoes
    }]
  });
  if (!resposta) return;

  const r = await tentar(() => api.usuarios.atualizar(alvo.id, { perfilId: resposta.perfilId }));
  if (!r) return;
  toast(`"${r.nome}" agora é ${r.perfil_nome || r.perfil}.`);
  renderUsuarios();
}

/** Tela de cadastro de conta: nome, e-mail, senha (com gerador) e perfil. */
export async function criarUsuario() {
  const noPrincipal = ehAdmin() && !escopoUsuarios;
  const empresa = empresas.find((e) => e.id === Number(escopoUsuarios));
  const onde = noPrincipal
    ? 'Administrador do sistema principal — enxerga todas as empresas.'
    : `A conta terá acesso apenas ao portal de ${empresa ? empresa.nome : estado.usuario.empresa}.`;

  const opcoesPerfil = noPrincipal ? [] : await perfisAtribuiveis(escopoUsuarios);
  if (!noPrincipal && !opcoesPerfil.length) {
    return toast('Nenhum perfil de acesso disponível para esta empresa.', 'erro');
  }

  const resposta = await perguntar({
    titulo: 'Nova conta de acesso',
    texto: onde,
    icone: '👤',
    ok: 'Criar conta',
    campos: [
      { id: 'nome', rotulo: 'Nome', dica: 'Como a pessoa será identificada', minimo: 2 },
      { id: 'email', rotulo: 'E-mail', tipo: 'email', dica: 'pessoa@empresa.com',
        padrao: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, erro: 'Informe um e-mail válido.' },
      { id: 'senha', rotulo: 'Senha inicial', tipo: 'password', minimo: 8, gerar: true,
        dica: 'mínimo 8 caracteres',
        ajuda: 'Use "Gerar" para criar uma senha forte e anote antes de salvar.' },
      ...(noPrincipal ? [] : [{
        id: 'perfilId', rotulo: 'Perfil de acesso', tipo: 'select',
        valor: String((opcoesPerfil[0] || {}).valor || ''), opcoes: opcoesPerfil,
        ajuda: 'O perfil define o que a conta pode fazer. Crie outros em '
          + 'Configurações › Perfis e permissões.'
      }, {
        id: 'sistemaIds', rotulo: 'Sistemas que a conta enxerga', tipo: 'checks',
        opcoes: (await sistemasAtribuiveis()).map((s) => ({ valor: s.id, nome: s.nome })),
        valor: [],
        vazio: 'Nenhum sistema cadastrado para esta empresa ainda.',
        ajuda: 'Deixe tudo desmarcado para dar acesso a todos os sistemas da empresa.'
      }])
    ]
  });
  if (!resposta) return;

  const novo = await tentar(() => api.usuarios.criar({
    ...resposta,
    perfil: noPrincipal ? 'admin' : undefined,
    empresaId: escopoUsuarios || undefined
  }));
  if (!novo) return;

  toast(`"${novo.nome}" cadastrado.`);
  await renderUsuarios();

  // entrega das credenciais: o endereço certo depende do escopo da conta
  const endereco = empresa
    ? `${window.location.origin}/p/${empresa.slug}`
    : `${window.location.origin}/entrar`;
  const copiar = await confirmar({
    titulo: 'Conta criada',
    texto: 'Anote ou copie os dados agora — a senha não é exibida novamente.',
    icone: '🔑',
    ok: 'Copiar dados',
    cancelar: 'Fechar',
    itens: [
      { marca: 'Acesso', texto: endereco },
      { marca: 'E-mail', texto: novo.email },
      { marca: 'Senha', texto: resposta.senha },
      { marca: 'Perfil', texto: novo.perfil_nome || novo.perfil }
    ]
  });
  if (copiar) {
    const texto = `Acesso: ${endereco}\nE-mail: ${novo.email}\nSenha: ${resposta.senha}`;
    try {
      await navigator.clipboard.writeText(texto);
      toast('Dados de acesso copiados.');
    } catch (e) {
      toast('Não foi possível copiar automaticamente.', 'erro');
    }
  }
}

export function trocarEscopoUsuarios(valor) {
  escopoUsuarios = String(valor || '');
  const sel = $('#uEscopo');
  if (sel) sel.value = escopoUsuarios;
  renderUsuarios();
}

/** Troca da própria senha, pelo menu da conta. */
export async function trocarPropriaSenha() {
  const resposta = await perguntar({
    titulo: 'Trocar minha senha',
    texto: 'Ao confirmar, você será desconectado e precisará entrar de novo.',
    ok: 'Trocar senha',
    campos: [
      { id: 'atual', rotulo: 'Senha atual', tipo: 'password', autocomplete: 'current-password' },
      { id: 'nova', rotulo: 'Nova senha', tipo: 'password', minimo: 8,
        dica: 'mínimo 8 caracteres', autocomplete: 'new-password' }
    ]
  });
  if (!resposta) return;
  const r = await tentar(() => api.trocarSenha(resposta.atual, resposta.nova));
  if (!r) return;
  toast(r.mensagem);
  setTimeout(() => window.location.reload(), 1500);
}
