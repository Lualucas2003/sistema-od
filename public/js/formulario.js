/**
 * Formulário de abertura e edição de OD.
 * A validação também roda no servidor; aqui é só o retorno imediato ao usuário.
 */
import { api } from './api.js';
import { $, estado, toast, tentar, preencherSelect } from './ui.js';
import { filaForm, limparFila, enviarImagens } from './anexos.js';

const CAMPOS = ['Titulo', 'Descricao', 'Solicitante', 'Sistema'];

/** Mostra a explicação do tipo escolhido, logo abaixo do campo. */
export function mostrarDicaTipo() {
  const alvo = $('#dicaTipoAcao');
  if (!alvo) return;
  const id = Number($('#cTipoAcao').value);
  const tipo = (estado.listas.tipos || []).find((t) => t.id === id);
  alvo.textContent = tipo && tipo.descricao
    ? tipo.descricao
    : 'Classifique o tipo de problema ou pedido — ajuda a agrupar as demandas na análise.';
}

/** Nos formulários só entram itens ativos. */
const ativos = (lista) => (lista || []).filter((i) => i.ativo !== false);

/** Projetos abertos do escopo, para o campo "Projeto" da OD. */
let projetosAbertos = [];

export async function carregarProjetos() {
  projetosAbertos = await tentar(() => api.projetos.selecao()) || [];
  preencherProjetos();
}

function preencherProjetos() {
  preencherSelect($('#cProjeto'),
    projetosAbertos.map((p) => ({ valor: p.id, nome: `${p.codigo} · ${p.nome}` })),
    true, 'Nenhum');
}

export function montarSelects() {
  preencherSelect($('#cSolicitante'),
    ativos(estado.listas.solicitantes).map((s) => ({ valor: s.id, nome: s.nome })), true, 'Selecione...');
  preencherSelect($('#cSistema'),
    ativos(estado.listas.sistemas).map((s) => ({ valor: s.id, nome: s.nome })), true, 'Selecione...');
  preencherSelect($('#cResponsavel'),
    ativos(estado.listas.responsaveis).map((r) => ({ valor: r.id, nome: r.nome })), true, 'Não atribuído');
  preencherSelect($('#cTipoAcao'),
    ativos(estado.listas.tipos).map((t) => ({ valor: t.id, nome: t.nome })), true, 'Não classificado');
  preencherSelect($('#cPrioridade'),
    estado.prioridades.map((p) => ({ valor: p.id, nome: p.nome })), false);
  preencherSelect($('#cStatus'),
    estado.situacoes.map((s) => ({ valor: s.id, nome: s.nome })), false);
  preencherProjetos();
}

function limparErros() {
  CAMPOS.forEach((c) => {
    const e = $('#erro' + c);
    if (e) e.textContent = '';
    const campo = $('#c' + c);
    if (campo) campo.classList.remove('invalido');
  });
}

function mostrarErros(erros) {
  limparErros();
  const mapa = { titulo: 'Titulo', descricao: 'Descricao', solicitante: 'Solicitante', sistema: 'Sistema' };
  Object.entries(erros || {}).forEach(([chave, msg]) => {
    const suf = mapa[chave];
    if (!suf) return;
    $('#erro' + suf).textContent = msg;
    $('#c' + suf).classList.add('invalido');
  });
}

export function limparForm() {
  montarSelects();
  $('#fId').value = '';
  $('#cTitulo').value = '';
  $('#cDescricao').value = '';
  $('#cSolicitante').value = '';
  $('#cSistema').value = '';
  $('#cResponsavel').value = '';
  $('#cTipoAcao').value = '';
  mostrarDicaTipo();
  $('#cProjeto').value = '';
  $('#cPrioridade').value = 'media';
  $('#cStatus').value = 'aberta';
  $('#cObs').value = '';
  $('#tituloForm').textContent = 'Nova Ordem de Demanda';
  $('#subtituloForm').textContent = 'Preencha os dados para registrar a demanda.';
  limparFila();
  limparErros();
}

/** Demanda antiga pode apontar para item desativado: mantém a opção no select. */
function garantirOpcao(seletor, id, nome) {
  const sel = $(seletor);
  if (!sel || !id) return;
  if (Array.from(sel.options).some((o) => o.value === String(id))) return;
  const opcao = document.createElement('option');
  opcao.value = id;
  opcao.textContent = nome + ' (inativo)';
  sel.appendChild(opcao);
}

export function preencherForm(d) {
  limparForm();
  garantirOpcao('#cSolicitante', d.solicitante_id, d.solicitante);
  garantirOpcao('#cSistema', d.sistema_id, d.sistema);
  garantirOpcao('#cResponsavel', d.responsavel_id, d.responsavel);
  garantirOpcao('#cTipoAcao', d.tipo_acao_id, d.tipo_acao);
  garantirOpcao('#cProjeto', d.projeto_id, d.projeto_codigo || d.projeto);
  $('#fId').value = d.id;
  $('#cTitulo').value = d.titulo;
  $('#cDescricao').value = d.descricao;
  $('#cSolicitante').value = d.solicitante_id;
  $('#cSistema').value = d.sistema_id;
  $('#cResponsavel').value = d.responsavel_id || '';
  $('#cTipoAcao').value = d.tipo_acao_id || '';
  mostrarDicaTipo();
  $('#cProjeto').value = d.projeto_id || '';
  $('#cPrioridade').value = d.prioridade;
  $('#cStatus').value = d.situacao;
  $('#tituloForm').textContent = 'Editar ' + d.numero;
  $('#subtituloForm').textContent = 'Alterações ficam registradas no histórico da demanda.';
}

/** Envia o formulário. Devolve a demanda salva ou null. */
export async function salvar() {
  const id = $('#fId').value;
  const corpo = {
    titulo: $('#cTitulo').value,
    descricao: $('#cDescricao').value,
    solicitanteId: $('#cSolicitante').value,
    sistemaId: $('#cSistema').value,
    responsavelId: $('#cResponsavel').value || null,
    tipoAcaoId: $('#cTipoAcao').value || null,
    projetoId: $('#cProjeto').value || null,
    prioridade: $('#cPrioridade').value,
    situacao: $('#cStatus').value,
    observacao: $('#cObs').value
  };
  try {
    const salva = id ? await api.demandas.atualizar(id, corpo) : await api.demandas.criar(corpo);
    limparErros();

    // as imagens escolhidas no formulário só sobem depois que a OD existe
    if (filaForm.length) {
      const enviadas = await enviarImagens(salva.id, filaForm.slice());
      if (enviadas) toast(`${enviadas} imagem(ns) anexada(s) à ${salva.numero}.`);
      limparFila();
    }

    toast(id ? `${salva.numero} atualizada.` : `OD ${salva.numero} criada.`);
    return salva;
  } catch (erro) {
    if (erro.erros) {
      mostrarErros(erro.erros);
      toast('Verifique os campos destacados.', 'erro');
    } else {
      toast(erro.message, 'erro');
    }
    return null;
  }
}
