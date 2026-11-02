/**
 * Teste de ponta a ponta do OD — percorre os processos do sistema pela API,
 * do jeito que a tela usa, e confere o isolamento entre empresas.
 *
 * Uso: npm run testar
 *
 * O teste sobe o próprio servidor numa porta separada (TESTE_PORTA, padrão
 * 3999), cria um administrador temporário e empresas marcadas com [TESTE].
 * No fim — passando ou falhando — apaga tudo o que criou.
 */
require('dotenv').config();

const path = require('path');
const { spawn } = require('child_process');
const { pool, consultarUm, consultar } = require('../src/config/db');
const { gerarHash } = require('../src/config/senha');

const PORTA = Number(process.env.TESTE_PORTA) || 3999;
const URL_BASE = `http://localhost:${PORTA}`;
const MARCA = `[TESTE ${Date.now().toString(36)}]`;
const SENHA = 'Teste@12345';
const ADMIN_EMAIL = `admin.${Date.now()}@od-teste.invalid`;

/** Empresas do cenário, cada uma com sistemas diferentes. */
const EMPRESAS = [
  { nome: `${MARCA} Clínica Vida`, sistemas: ['Prontuário Web', 'Agenda Online'] },
  { nome: `${MARCA} Transportadora Rota`, sistemas: ['Rastreamento', 'App Motorista', 'ERP Frota'] },
  { nome: `${MARCA} Escola Saber`, sistemas: ['Portal do Aluno'] }
];

// PNG 1x1 transparente
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/* ------------------------------ relatório ------------------------------ */

const resultados = [];
let secaoAtual = '';

function secao(nome) {
  secaoAtual = nome;
  console.log(`\n▸ ${nome}`);
}

function ok(condicao, descricao, detalhe) {
  resultados.push({ secao: secaoAtual, descricao, passou: !!condicao, detalhe });
  console.log(`  ${condicao ? '✔' : '✘'} ${descricao}${!condicao && detalhe ? `  → ${detalhe}` : ''}`);
  return !!condicao;
}

/* ------------------------------ cliente HTTP ------------------------------ */

/** Um "navegador": guarda o cookie de sessão e fala com a API. */
function cliente(base = '') {
  let cookie = '';
  const api = async (metodo, rota, corpo) => {
    const resp = await fetch(`${URL_BASE}${base}/api${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', cookie },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: 'manual'
    });
    const tipo = resp.headers.get('content-type') || '';
    const dados = tipo.includes('json') ? await resp.json() : await resp.arrayBuffer();
    return { status: resp.status, dados, tipo };
  };
  return {
    base,
    /** Mesmo navegador (mesmo cookie) apontando para outro portal. */
    em(novaBase) { const c = cliente(novaBase); c.usarCookie(cookie); return c; },
    usarCookie(valor) { cookie = valor; },
    async entrar(email, senha) {
      const resp = await fetch(`${URL_BASE}${base}/entrar`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, senha, destino: '' }),
        redirect: 'manual'
      });
      const setCookie = resp.headers.get('set-cookie') || '';
      const casa = setCookie.match(/od_sessao=[^;]+/);
      if (casa) cookie = casa[0];
      return { status: resp.status, local: resp.headers.get('location'), logou: !!casa };
    },
    async pagina(rota) {
      const resp = await fetch(`${URL_BASE}${rota}`, { headers: { cookie }, redirect: 'manual' });
      return { status: resp.status, local: resp.headers.get('location'), html: await resp.text() };
    },
    get: (r) => api('GET', r),
    post: (r, c = {}) => api('POST', r, c),
    put: (r, c = {}) => api('PUT', r, c),
    patch: (r, c = {}) => api('PATCH', r, c),
    del: (r, c) => api('DELETE', r, c)
  };
}

/* ------------------------------ servidor ------------------------------ */

async function subirServidor() {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORTA) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d; });
  proc.stderr.on('data', (d) => { saida += d; });
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) throw new Error(`Servidor não subiu:\n${saida}`);
    try {
      const r = await fetch(`${URL_BASE}/entrar`);
      if (r.ok) return proc;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error(`Servidor não respondeu em 30s:\n${saida}`);
}

/* ------------------------------ cenário ------------------------------ */

const criados = { adminId: null, empresas: [], catalogo: [] };

async function testar() {
  /* ---------- administrador ---------- */
  secao('Login do administrador');
  const adm = await consultarUm(
    `insert into od.usuario (empresa_id, nome, email, senha_hash, perfil)
     values (null, $1, $2, $3, 'admin') returning id`,
    [`${MARCA} Admin`, ADMIN_EMAIL, gerarHash(SENHA)]);
  criados.adminId = adm.id;

  const admin = cliente();
  const semLogin = await admin.pagina('/');
  ok(semLogin.status === 302 && /\/entrar/.test(semLogin.local), 'Sem sessão, / redireciona para /entrar');
  ok((await admin.get('/eu')).status === 401, 'API sem sessão responde 401');

  const senhaErrada = await admin.entrar(ADMIN_EMAIL, 'senha-errada');
  ok(!senhaErrada.logou && /erro=1/.test(senhaErrada.local || ''), 'Senha errada é recusada');

  const login = await admin.entrar(ADMIN_EMAIL, SENHA);
  ok(login.logou, 'Administrador entra com e-mail e senha');
  const eu = await admin.get('/eu');
  ok(eu.status === 200 && eu.dados.perfil === 'admin', '/api/eu devolve o perfil admin', JSON.stringify(eu.dados));
  const inicio = await admin.pagina('/');
  ok(inicio.status === 200 && inicio.html.includes('pg-painel'), 'Página principal abre para o administrador');

  secao('Leituras gerais do administrador');
  for (const rota of ['/listas', '/config', '/painel', '/analise', '/analise/projetos',
    '/demandas', '/demandas/todas', '/projetos', '/empresas', '/perfis', '/usuarios', '/backup']) {
    const r = await admin.get(rota);
    ok(r.status === 200, `GET /api${rota} responde 200`, `status ${r.status} ${JSON.stringify(r.dados).slice(0, 160)}`);
  }

  // catálogo universal: garante um solicitante e um responsável ativos
  const listas = (await admin.get('/listas')).dados;
  async function garantir(tipo, nome) {
    const ativo = listas[tipo].find((i) => i.ativo && i.empresa_id == null);
    if (ativo) return ativo.id;
    const novo = await admin.post(`/listas/${tipo}`, { nome: `${MARCA} ${nome}` });
    ok(novo.status === 201, `Cria ${tipo} de teste no catálogo`, JSON.stringify(novo.dados));
    criados.catalogo.push({ tipo, id: novo.dados.id });
    return novo.dados.id;
  }
  const solicitanteId = await garantir('solicitantes', 'Solicitante');
  const responsavelId = await garantir('responsaveis', 'Responsável');
  const tipoAcao = listas.tipos.find((i) => i.ativo && i.empresa_id == null);

  /* ---------- empresas ---------- */
  secao('Cadastro de empresas com sistemas diferentes');
  for (const [i, e] of EMPRESAS.entries()) {
    const gestorEmail = `gestor${i}.${Date.now()}@od-teste.invalid`;
    const r = await admin.post('/empresas', {
      nome: e.nome, sistemas: e.sistemas, documento: `00.000.000/000${i}-00`,
      contato: '(81) 90000-0000', responsavel: `Gestor ${i + 1}`, email: gestorEmail, senha: SENHA
    });
    if (!ok(r.status === 201, `Cria "${e.nome}" com ${e.sistemas.length} sistema(s)`, JSON.stringify(r.dados))) continue;
    criados.empresas.push(r.dados.id);
    ok(r.dados.sistemas === e.sistemas.length, `  ${e.sistemas.length} sistema(s) gravado(s)`, `veio ${r.dados.sistemas}`);
    ok(r.dados.gestor && r.dados.gestor.email === gestorEmail, '  Gestor do primeiro acesso criado');
    ok(/^[a-z0-9-]+$/.test(r.dados.slug), `  Portal gerado em /p/${r.dados.slug}`);
    Object.assign(e, { id: r.dados.id, slug: r.dados.slug, gestorEmail });
  }
  const validas = EMPRESAS.filter((e) => e.id);
  if (validas.length < 2) throw new Error('Não foi possível criar as empresas de teste; o restante depende delas.');

  const dup = await admin.post('/empresas', { nome: EMPRESAS[0].nome });
  ok(dup.status === 409, 'Nome de empresa repetido é recusado (409)', `status ${dup.status}`);
  const emailRuim = await admin.post('/empresas', { nome: `${MARCA} Inválida`, email: 'nao-e-email', senha: SENHA });
  ok(emailRuim.status === 422, 'E-mail de gestor inválido é recusado (422)', `status ${emailRuim.status}`);
  const senhaCurta = await admin.post('/empresas', { nome: `${MARCA} Inválida`, email: 'a@b.com', senha: '123' });
  ok(senhaCurta.status === 422, 'Senha curta do gestor é recusada (422)', `status ${senhaCurta.status}`);
  const semNome = await admin.post('/empresas', { nome: 'x' });
  ok(semNome.status === 422, 'Empresa sem nome é recusada (422)', `status ${semNome.status}`);

  const [A, B] = validas;
  const extra = await admin.post(`/empresas/${A.id}/sistemas`, { nome: 'Faturamento' });
  ok(extra.status === 201, `Acrescenta o sistema "Faturamento" em ${A.nome}`, JSON.stringify(extra.dados));
  A.sistemas.push('Faturamento');
  const extraDup = await admin.post(`/empresas/${A.id}/sistemas`, { nome: 'faturamento' });
  ok(extraDup.status === 409, 'Sistema repetido na mesma empresa é recusado (409)', `status ${extraDup.status}`);
  const mesmoNomeOutra = await admin.post(`/empresas/${B.id}/sistemas`, { nome: 'Faturamento' });
  ok(mesmoNomeOutra.status === 201, 'Outra empresa pode ter sistema com o mesmo nome', JSON.stringify(mesmoNomeOutra.dados));
  B.sistemas.push('Faturamento');

  for (const e of validas) {
    const s = await admin.get(`/empresas/${e.id}/sistemas`);
    const nomes = (s.dados || []).map((x) => x.nome).sort();
    ok(JSON.stringify(nomes) === JSON.stringify([...e.sistemas].sort()),
      `Sistemas de ${e.nome}: ${nomes.join(', ')}`, `esperado ${e.sistemas.join(', ')}`);
  }

  const edit = await admin.put(`/empresas/${A.id}`, { contato: 'contato@clinica.teste' });
  ok(edit.status === 200 && edit.dados.contato === 'contato@clinica.teste', 'Edita o contato da empresa');

  /* ---------- portais ---------- */
  secao('Portais das empresas');
  for (const e of validas) {
    e.gestor = cliente(`/p/${e.slug}`);
    const tela = await e.gestor.pagina(`/p/${e.slug}/entrar`);
    ok(tela.status === 200 && tela.html.includes(e.nome.replace(/&/g, '&amp;')),
      `Tela de login do portal /p/${e.slug} abre com o nome da empresa`);
    const l = await e.gestor.entrar(e.gestorEmail, SENHA);
    ok(l.logou, `Gestor entra no portal de ${e.nome}`);
    const me = await e.gestor.get('/eu');
    ok(me.dados.perfil === 'gestor' && me.dados.empresaId === e.id, '  /api/eu mostra gestor da empresa certa',
      JSON.stringify(me.dados).slice(0, 200));
    const lst = await e.gestor.get('/listas');
    const sistemasVistos = lst.dados.sistemas.filter((s) => !s.fixo).map((s) => s.nome).sort();
    ok(JSON.stringify(sistemasVistos) === JSON.stringify([...e.sistemas].sort()),
      '  Portal só lista os sistemas da própria empresa', `viu: ${sistemasVistos.join(', ')}`);
    e.sistemaIds = lst.dados.sistemas.filter((s) => !s.fixo).map((s) => s.id);
    const pg = await e.gestor.pagina(`/p/${e.slug}`);
    ok(pg.status === 200, '  Página do portal abre após o login');
  }

  const falsoLogin = cliente(`/p/${B.slug}`);
  const cruzado = await falsoLogin.entrar(A.gestorEmail, SENHA);
  ok(!cruzado.logou, 'Gestor de uma empresa não entra no portal de outra');
  const adminNoPortal = await admin.pagina(`/p/${A.slug}`);
  ok(adminNoPortal.status === 200, 'Administrador consegue abrir o portal de qualquer empresa');
  const portalInexistente = await admin.pagina('/p/nao-existe-xyz');
  ok(portalInexistente.status === 404, 'Portal inexistente responde 404');

  /* ---------- demandas ---------- */
  secao('Demandas: ciclo completo em cada empresa');
  for (const e of validas) {
    const g = e.gestor;
    const invalida = await g.post('/demandas', { titulo: 'x', descricao: 'curta' });
    ok(invalida.status === 422 && invalida.dados.erros, `[${e.slug}] Validação recusa demanda incompleta`);

    e.demandas = [];
    for (const [i, sid] of e.sistemaIds.entries()) {
      const r = await g.post('/demandas', {
        titulo: `${MARCA} Falha no sistema ${e.sistemas[i] || sid}`,
        descricao: 'Demanda criada pelo teste automatizado de ponta a ponta.',
        solicitanteId, sistemaId: sid, responsavelId,
        tipoAcaoId: tipoAcao ? tipoAcao.id : null,
        prioridade: i === 0 ? 'urgente' : 'media',
        observacao: 'Aberta pelo teste'
      });
      if (ok(r.status === 201 && r.dados.numero, `[${e.slug}] Cria OD no sistema #${sid} → ${r.dados.numero}`,
        JSON.stringify(r.dados))) e.demandas.push(r.dados);
    }
    const d = e.demandas[0];
    if (!d) continue;

    const det = await g.get(`/demandas/${d.id}`);
    ok(det.status === 200 && det.dados.situacao === 'aberta', `[${e.slug}] Detalhe da OD abre com situação "aberta"`);

    const ed = await g.put(`/demandas/${d.id}`, {
      titulo: `${MARCA} Falha editada`, descricao: 'Descrição alterada pelo teste automatizado.',
      solicitanteId, sistemaId: d.sistema_id || e.sistemaIds[0], prioridade: 'alta', situacao: 'aberta'
    });
    ok(ed.status === 200 && ed.dados.prioridade === 'alta', `[${e.slug}] Edita a OD`, JSON.stringify(ed.dados).slice(0, 200));

    const av1 = await g.post(`/demandas/${d.id}/avancar`);
    ok(av1.status === 200 && av1.dados.situacao === 'andamento', `[${e.slug}] Avança aberta → andamento`);
    const esp = await g.patch(`/demandas/${d.id}/situacao`, { situacao: 'aguardando' });
    ok(esp.status === 200 && esp.dados.situacao === 'aguardando', `[${e.slug}] Muda para aguardando`);
    const hist = await g.post(`/demandas/${d.id}/historico`, { texto: 'Andamento registrado pelo teste.' });
    ok(hist.status === 201, `[${e.slug}] Registra andamento no histórico`);
    await g.post(`/demandas/${d.id}/avancar`);
    const av2 = await g.post(`/demandas/${d.id}/avancar`);
    ok(av2.status === 200 && av2.dados.situacao === 'concluida' && av2.dados.concluida_em,
      `[${e.slug}] Conclui a OD e grava a data de conclusão`, JSON.stringify(av2.dados).slice(0, 200));
    const av3 = await g.post(`/demandas/${d.id}/avancar`);
    ok(av3.status === 409, `[${e.slug}] OD concluída não tem próxima etapa (409)`);
    const final = await g.get(`/demandas/${d.id}`);
    const nHist = (final.dados.historico || []).length;
    ok(nHist >= 4, `[${e.slug}] Histórico registrou abertura e mudanças (${nHist} registros)`);

    // imagens
    const img = await g.post(`/demandas/${d.id}/anexos`, { nome: 'print.png', dados: `data:image/png;base64,${PNG}` });
    ok(img.status === 201, `[${e.slug}] Anexa imagem PNG`, JSON.stringify(img.dados));
    const imgRuim = await g.post(`/demandas/${d.id}/anexos`, { nome: 'x.pdf', tipo: 'application/pdf', dados: PNG });
    ok(imgRuim.status === 422, `[${e.slug}] Recusa anexo que não é imagem`);
    if (img.status === 201) {
      const arq = await g.get(`/anexos/${img.dados.id}/arquivo`);
      ok(arq.status === 200 && arq.tipo === 'image/png', `[${e.slug}] Imagem é servida decodificada`);
      e.anexoId = img.dados.id;
    }

    const lista = await g.get('/demandas?porPagina=100');
    const soDela = lista.dados.itens.every((x) => e.demandas.some((m) => m.id === x.id));
    ok(lista.status === 200 && soDela && lista.dados.total === e.demandas.length,
      `[${e.slug}] Listagem mostra só as ${e.demandas.length} OD da empresa`, `total ${lista.dados.total}`);
    const busca = await g.get(`/demandas?busca=${encodeURIComponent('editada')}`);
    ok(busca.dados.total === 1, `[${e.slug}] Busca por texto encontra a OD editada`);
    const filtro = await g.get('/demandas?situacao=concluida');
    ok(filtro.dados.total === 1, `[${e.slug}] Filtro por situação funciona`);
    const painel = await g.get('/painel');
    ok(painel.status === 200, `[${e.slug}] Painel do portal carrega`);
    const analise = await g.get('/analise');
    ok(analise.status === 200, `[${e.slug}] Análise do portal carrega`);
  }

  /* ---------- isolamento ---------- */
  secao('Isolamento entre empresas');
  const dB = B.demandas[0];
  const dA = A.demandas[0];
  ok((await A.gestor.get(`/demandas/${dB.id}`)).status === 404, 'Gestor A não vê OD da empresa B (404)');
  ok((await A.gestor.put(`/demandas/${dB.id}`, {
    titulo: 'Tentativa de invasão', descricao: 'Não deveria alterar nada aqui.',
    solicitanteId, sistemaId: A.sistemaIds[0]
  })).status === 404, 'Gestor A não edita OD da empresa B');
  ok((await A.gestor.del(`/demandas/${dB.id}`)).status === 404, 'Gestor A não exclui OD da empresa B');
  const sisAlheio = await A.gestor.post('/demandas', {
    titulo: `${MARCA} Sistema de outra empresa`, descricao: 'Não deveria ser aceita pelo servidor.',
    solicitanteId, sistemaId: B.sistemaIds[0]
  });
  ok(sisAlheio.status === 403, 'Gestor A não abre OD em sistema da empresa B (403)', `status ${sisAlheio.status}`);
  if (B.anexoId) {
    ok((await A.gestor.get(`/anexos/${B.anexoId}/arquivo`)).status === 404, 'Gestor A não abre imagem da empresa B');
  }
  const apiCruzada = await cliente(`/p/${B.slug}`).get('/demandas');
  ok(apiCruzada.status === 401, 'API de portal sem sessão responde 401');
  const gestorAnaApiB = await A.gestor.em(`/p/${B.slug}`).get('/demandas');
  ok(gestorAnaApiB.status === 403, 'Sessão do gestor A é recusada na API do portal B (403)', `status ${gestorAnaApiB.status}`);
  ok((await A.gestor.get('/empresas')).status === 403, 'Gestor não acessa o cadastro de empresas (403)');
  ok((await A.gestor.post('/listas/solicitantes', { nome: 'x-teste' })).status === 403, 'Gestor não altera catálogo universal (403)');
  ok((await A.gestor.del('/demandas')).status === 403, 'Gestor não apaga todas as demandas (403)');

  const todasAdmin = await admin.get('/demandas/todas');
  const idsAdmin = new Set(todasAdmin.dados.map((x) => x.id));
  ok(validas.every((e) => e.demandas.every((d) => idsAdmin.has(d.id))), 'Administrador enxerga as OD de todas as empresas');
  const viaPortal = (await admin.em(`/p/${A.slug}`).get('/demandas/todas')).dados;
  ok(Array.isArray(viaPortal) && viaPortal.length === A.demandas.length
    && viaPortal.every((x) => A.demandas.some((m) => m.id === x.id)),
    'Administrador no portal A vê só o recorte de A', `veio ${Array.isArray(viaPortal) ? viaPortal.length : JSON.stringify(viaPortal)}`);

  /* ---------- contas e permissões ---------- */
  secao('Contas de acesso e permissões');
  const atrib = await A.gestor.get('/perfis/atribuiveis');
  ok(atrib.status === 200, 'Gestor lista os perfis que pode atribuir');
  const contas = {};
  for (const base of ['operador', 'leitor']) {
    const email = `${base}.${Date.now()}@od-teste.invalid`;
    const r = await A.gestor.post('/usuarios', { nome: `${MARCA} ${base}`, email, senha: SENHA, perfil: base });
    ok(r.status === 201, `Gestor cria conta "${base}" no portal A`, JSON.stringify(r.dados).slice(0, 200));
    contas[base] = { email, id: r.dados && r.dados.id };
  }
  const restrito = await A.gestor.post('/usuarios', {
    nome: `${MARCA} restrito`, email: `restrito.${Date.now()}@od-teste.invalid`, senha: SENHA,
    perfil: 'operador', sistemaIds: [A.sistemaIds[0]]
  });
  ok(restrito.status === 201, 'Cria operador restrito a um único sistema');
  const perfilAdmin = await A.gestor.post('/usuarios', {
    nome: 'Tentativa', email: `x.${Date.now()}@od-teste.invalid`, senha: SENHA, perfil: 'admin'
  });
  ok(perfilAdmin.status === 422, 'Gestor não consegue criar conta de administrador (422)', `status ${perfilAdmin.status}`);
  const contaSenhaCurta = await A.gestor.post('/usuarios', { nome: 'Curta', email: `c.${Date.now()}@od-teste.invalid`, senha: '1' });
  ok(contaSenhaCurta.status === 422, 'Conta com senha curta é recusada');

  const leitor = cliente(`/p/${A.slug}`);
  ok((await leitor.entrar(contas.leitor.email, SENHA)).logou, 'Leitor entra no portal A');
  ok((await leitor.get('/demandas')).status === 200, 'Leitor consulta demandas');
  const leitorCria = await leitor.post('/demandas', {
    titulo: `${MARCA} Leitor tentando criar`, descricao: 'Leitor não deveria conseguir criar.',
    solicitanteId, sistemaId: A.sistemaIds[0]
  });
  ok(leitorCria.status === 403, 'Leitor não cria demanda (403)', `status ${leitorCria.status}`);
  ok((await leitor.post(`/demandas/${dA.id}/avancar`)).status === 403, 'Leitor não muda situação (403)');
  ok((await leitor.get('/usuarios')).status === 403, 'Leitor não administra contas (403)');

  const operador = cliente(`/p/${A.slug}`);
  ok((await operador.entrar(contas.operador.email, SENHA)).logou, 'Operador entra no portal A');
  const opCria = await operador.post('/demandas', {
    titulo: `${MARCA} Aberta pelo operador`, descricao: 'Operador pode abrir demandas normalmente.',
    solicitanteId, sistemaId: A.sistemaIds[1] || A.sistemaIds[0]
  });
  ok(opCria.status === 201, 'Operador cria demanda');
  if (opCria.status === 201) A.demandas.push(opCria.dados);
  ok((await operador.del(`/demandas/${dA.id}`)).status === 403, 'Operador não exclui demanda (403)');

  const rest = cliente(`/p/${A.slug}`);
  await rest.entrar(restrito.dados.email, SENHA);
  const restLista = await rest.get('/demandas/todas');
  ok(restLista.status === 200 && restLista.dados.every((x) => x.sistema_id === A.sistemaIds[0] || x.sistema === A.sistemas[0]),
    'Operador restrito só vê demandas do sistema atribuído',
    `viu ${restLista.dados.length}: ${restLista.dados.map((x) => x.sistema).join(', ')}`);
  if (A.sistemaIds[1]) {
    const restFora = await rest.post('/demandas', {
      titulo: `${MARCA} Fora do sistema permitido`, descricao: 'Não deveria ser aceita pelo servidor.',
      solicitanteId, sistemaId: A.sistemaIds[1]
    });
    ok(restFora.status === 403, 'Operador restrito não abre OD em outro sistema (403)', `status ${restFora.status}`);
  }

  const desativa = await A.gestor.put(`/usuarios/${contas.leitor.id}`, { ativo: false });
  ok(desativa.status === 200, 'Gestor desativa a conta do leitor');
  const bloqueado = cliente(`/p/${A.slug}`);
  ok(!(await bloqueado.entrar(contas.leitor.email, SENHA)).logou, 'Conta desativada não consegue entrar');
  ok((await B.gestor.put(`/usuarios/${contas.operador.id}`, { ativo: false })).status === 403,
    'Gestor B não mexe em conta da empresa A (403)');

  /* ---------- projetos ---------- */
  secao('Projetos: passos, documentos e requisitos');
  const pj = await A.gestor.post('/projetos', {
    nome: `${MARCA} Implantação do prontuário`, objetivo: 'Projeto criado pelo teste.',
    sistemaId: A.sistemaIds[0], solicitanteId, responsavelId, prioridade: 'alta',
    inicioPrevisto: '2026-09-01', fimPrevisto: '2026-12-01',
    etapas: ['Levantar requisitos', 'Desenvolver módulo', 'Homologar com o cliente']
  });
  ok(pj.status === 201 && /PRJ-/.test(pj.dados.codigo || ''), `Cria projeto com 3 passos → ${pj.dados.codigo}`, JSON.stringify(pj.dados).slice(0, 200));
  const datasRuins = await A.gestor.post('/projetos', { nome: 'Datas trocadas', inicioPrevisto: '2026-12-01', fimPrevisto: '2026-01-01' });
  ok(datasRuins.status === 422, 'Projeto com término antes do início é recusado');
  const pjAlheio = await A.gestor.post('/projetos', { nome: `${MARCA} Alheio`, sistemaId: B.sistemaIds[0] });
  ok(pjAlheio.status === 403, 'Projeto em sistema de outra empresa é recusado (403)');

  if (pj.status === 201) {
    const pid = pj.dados.id;
    const perfil = await A.gestor.get(`/projetos/${pid}`);
    ok(perfil.status === 200, 'Perfil do projeto abre');
    ok((await B.gestor.get(`/projetos/${pid}`)).status === 404, 'Gestor B não vê o projeto da empresa A');

    const nova = await A.gestor.post(`/projetos/${pid}/etapas`, { titulo: 'Treinar usuários', prazo: '2026-11-20' });
    ok(nova.status === 201, 'Acrescenta um passo');
    let etapas = (await A.gestor.get(`/projetos/${pid}/etapas`)).dados;
    ok(etapas.length === 4, `Projeto tem ${etapas.length} passos`);
    const mov = await A.gestor.post(`/etapas/${etapas[3].id}/mover`, { direcao: 'cima' });
    ok(mov.status === 200 && mov.dados[2].id === etapas[3].id, 'Reordena passo para cima');

    const cedo = await A.gestor.post(`/projetos/${pid}/avancar`);
    ok(cedo.status === 200 && cedo.dados.situacao === 'andamento', 'Projeto avança para andamento');
    const bloqueio = await A.gestor.post(`/projetos/${pid}/avancar`);
    ok(bloqueio.status === 409, 'Projeto não conclui com passos pendentes (409)');

    const doc = await A.gestor.post(`/projetos/${pid}/documentos`, {
      nome: 'requisitos.txt', categoria: 'requisitos',
      dados: Buffer.from('Requisitos\n1. Cadastro de pacientes\n2. Emissão de receitas\n3. Relatório mensal\n').toString('base64')
    });
    ok(doc.status === 201, 'Envia documento de requisitos (.txt)', JSON.stringify(doc.dados).slice(0, 200));
    const docRuim = await A.gestor.post(`/projetos/${pid}/documentos`, { nome: 'virus.exe', dados: 'AAAA' });
    ok(docRuim.status === 422, 'Recusa documento com formato não aceito');
    if (doc.status === 201) {
      const prev = await A.gestor.get(`/documentos/${doc.dados.id}/requisitos`);
      ok(prev.status === 200 && prev.dados.itens.length === 3,
        `Lê ${prev.dados.itens ? prev.dados.itens.length : 0} requisitos do documento`, JSON.stringify(prev.dados).slice(0, 200));
      const arq = await A.gestor.get(`/documentos/${doc.dados.id}/arquivo`);
      ok(arq.status === 200, 'Documento é servido para download');
      if (prev.status === 200) {
        const imp = await A.gestor.post(`/projetos/${pid}/etapas/importar`, { itens: prev.dados.itens, origem: 'requisitos.txt' });
        ok(imp.status === 201 && imp.dados.quantos === 3, 'Importa os requisitos como passos');
      }
    }
    const colado = await A.gestor.post(`/projetos/${pid}/requisitos/previa`, { texto: '- Primeiro item\n- Segundo item' });
    ok(colado.status === 200 && colado.dados.itens.length === 2, 'Prévia de requisitos a partir de texto colado');

    etapas = (await A.gestor.get(`/projetos/${pid}/etapas`)).dados;
    const remover = await A.gestor.del(`/etapas/${etapas[etapas.length - 1].id}`);
    ok(remover.status === 200, 'Remove um passo');
    etapas = (await A.gestor.get(`/projetos/${pid}/etapas`)).dados;
    for (const et of etapas) await A.gestor.patch(`/etapas/${et.id}/situacao`, { situacao: 'concluida' });
    const concl = await A.gestor.post(`/projetos/${pid}/avancar`);
    ok(concl.status === 200 && concl.dados.situacao === 'concluido', 'Com todos os passos feitos, o projeto é concluído',
      JSON.stringify(concl.dados).slice(0, 200));

    // OD ligada ao projeto
    const odPj = await A.gestor.post('/demandas', {
      titulo: `${MARCA} OD do projeto`, descricao: 'Demanda vinculada ao projeto de teste.',
      solicitanteId, sistemaId: A.sistemaIds[0], projetoId: pid
    });
    ok(odPj.status === 201, 'Cria OD vinculada ao projeto');
    if (odPj.status === 201) A.demandas.push(odPj.dados);
    const odPjAlheio = await B.gestor.post('/demandas', {
      titulo: `${MARCA} OD em projeto alheio`, descricao: 'Não deveria ser aceita pelo servidor.',
      solicitanteId, sistemaId: B.sistemaIds[0], projetoId: pid
    });
    ok(odPjAlheio.status === 403, 'Empresa B não vincula OD ao projeto da empresa A (403)');
    ok((await A.gestor.get('/analise/projetos')).status === 200, 'Área de projetos da Análise carrega');

    const exc = await A.gestor.del(`/projetos/${pid}`);
    ok(exc.status === 200, 'Exclui o projeto (a OD continua existindo)', JSON.stringify(exc.dados));
    ok((await A.gestor.get(`/demandas/${odPj.dados.id}`)).status === 200, 'OD do projeto excluído continua acessível');
  }

  /* ---------- projeto preenchido pelo documento ---------- */
  secao('Projeto preenchido por documento de requisitos (.docx)');
  const docx = docxDeRequisitos().toString('base64');
  const lido = await A.gestor.post('/projetos/ler-documento', { nome: 'SOAP-requisitos.docx', dados: docx });
  ok(lido.status === 200, 'Lê o .docx antes de o projeto existir', JSON.stringify(lido.dados).slice(0, 200));
  if (lido.status === 200) {
    const d = lido.dados;
    ok(d.nome === 'Sistema SOAP', `Nome do projeto vem do título → "${d.nome}"`);
    ok(/Assistente de IA local/.test(d.objetivo || '') && /ferramenta de conversa/.test(d.objetivo || ''),
      'Objetivo reúne o subtítulo e o escopo', d.objetivo);
    ok(d.estrategia === 'estruturado', 'Reconhece o padrão [RF01] / Prioridade', d.estrategia);
    const titulos = d.itens.map((i) => i.titulo);
    ok(JSON.stringify(titulos) === JSON.stringify(
      ['RF01 — Autenticação e Sessão', 'RF02 — Perfis e Permissões', 'RNF01 — Segurança']),
    'Passos: só RF e RNF, na ordem do documento', titulos.join(' / '));
    const rf01 = d.itens[0] || {};
    ok(/Prioridade: Essencial/.test(rf01.descricao) && /30 dias/.test(rf01.descricao)
      && /UC01/.test(rf01.descricao), 'Descrição traz prioridade, texto e casos de uso', rf01.descricao);
    ok(/chat: usar o chat/.test((d.itens[1] || {}).descricao || ''), 'Tabela dentro do requisito vira "célula: célula"',
      (d.itens[1] || {}).descricao);
    ok(!titulos.some((t) => /^UC/.test(t)), 'Casos de uso não viram passos soltos');

    const pjDoc = await A.gestor.post('/projetos', {
      nome: d.nome, objetivo: d.objetivo,
      etapas: d.itens.map((i) => ({ titulo: i.titulo, descricao: i.descricao, tipo: 'requisito' }))
        .concat([{ titulo: 'Configurar servidor', tipo: 'passo' }, { titulo: 'Homologar entrega', tipo: 'passo' }])
    });
    ok(pjDoc.status === 201, 'Salva o projeto com os requisitos lidos e dois passos', JSON.stringify(pjDoc.dados).slice(0, 200));
    if (pjDoc.status === 201) {
      const itens = (await A.gestor.get(`/projetos/${pjDoc.dados.id}/etapas`)).dados;
      const tipos = itens.map((x) => x.tipo).join(',');
      ok(tipos === 'requisito,requisito,requisito,passo,passo', 'Requisitos e passos gravados com o tipo certo', tipos);
      ok(/30 dias/.test(itens[0].descricao || ''), 'Requisito gravado com a descrição', JSON.stringify(itens[0]).slice(0, 200));
      const mov = await A.gestor.post(`/etapas/${itens[3].id}/mover`, { direcao: 'cima' });
      ok(mov.status === 200 && mov.dados[3].id === itens[3].id,
        'Passo não troca de lugar com requisito ao subir', JSON.stringify((mov.dados || []).map((x) => x.tipo)));
      const novo = await A.gestor.post(`/projetos/${pjDoc.dados.id}/etapas`, { titulo: 'Escrever testes' });
      ok(novo.status === 201 && novo.dados.tipo === 'passo', 'Passo adicionado no perfil nasce como passo');
      await A.gestor.del(`/projetos/${pjDoc.dados.id}`);
    }
  }
  const ruim = await A.gestor.post('/projetos/ler-documento', { nome: 'x.exe', dados: 'AAAA' });
  ok(ruim.status === 422, 'Recusa formato não aceito na leitura');

  /* ---------- exclusão de demanda e de empresa ---------- */
  secao('Exclusões e desativação de empresa');
  const exD = await A.gestor.del(`/demandas/${A.demandas[A.demandas.length - 1].id}`);
  ok(exD.status === 200, 'Gestor exclui uma demanda');
  A.demandas.pop();

  const C = validas[2];
  if (C) {
    const ativaComOD = await admin.del(`/empresas/${C.id}`);
    ok(ativaComOD.status === 409, 'Empresa ativa com demandas não pode ser excluída (409)', `status ${ativaComOD.status}`);
    const desat = await admin.put(`/empresas/${C.id}`, { ativo: false });
    ok(desat.status === 200 && desat.dados.ativo === false, 'Desativa a empresa');
    ok((await C.gestor.pagina(`/p/${C.slug}`)).status === 404, 'Portal da empresa desativada fica indisponível');
    ok((await C.gestor.get('/demandas')).status === 404, 'API do portal desativado responde 404');
    const semCascata = await admin.del(`/empresas/${C.id}`);
    ok(semCascata.status === 409, 'Exclusão pede confirmação em cascata (409)');
    const cascata = await admin.del(`/empresas/${C.id}?cascata=1`);
    ok(cascata.status === 200, `Exclui a empresa em cascata: ${cascata.dados.mensagem}`);
    if (cascata.status === 200) criados.empresas = criados.empresas.filter((id) => id !== C.id);
    const resto = await consultarUm(
      `select (select count(*) from od.demandas where empresa_id = $1)::int as d,
              (select count(*) from od.sistemas where empresa_id = $1)::int as s,
              (select count(*) from od.usuario where empresa_id = $1)::int as u`, [C.id]);
    ok(resto.d + resto.s + resto.u === 0, 'Nada da empresa excluída ficou no banco', JSON.stringify(resto));
  }

  secao('Encerramento de sessão');
  const sair = await fetch(`${URL_BASE}/p/${A.slug}/sair`, { method: 'POST', redirect: 'manual', headers: { cookie: '' } });
  ok(sair.status === 302, 'Rota de sair do portal redireciona para o login');
}

/* --------------------------- .docx de exemplo --------------------------- */

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** ZIP sem compressão — basta para o leitor de .docx. */
function zipar(arquivos) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const [nome, texto] of Object.entries(arquivos)) {
    const dados = Buffer.from(texto, 'utf8');
    const n = Buffer.from(nome, 'utf8');
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locais.push(local, n, dados);
    centrais.push(central, n);
    offset += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

/** Documento no mesmo padrão dos requisitos reais: título, tabelas, [RF01], prioridade, UC. */
function docxDeRequisitos() {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const tab = (linhas) => `<w:tbl>${linhas.map((l) =>
    `<w:tr>${l.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  const pri = 'Prioridade: ☒ Essencial  ☐ Importante  ☐ Desejável';
  const corpo = [
    p('Documento de Requisitos do Sistema SOAP'),
    p('Assistente de IA local com base de conhecimento própria (RAG)'),
    p('Histórico da Revisão'),
    tab([['Data', 'Versão', 'Descrição'], ['08/09/2026', '1.0', 'Versão inicial']]),
    p('1. Introdução'), p('1.1 Objetivo do Documento'),
    p('Este documento detalha os requisitos do SOAP.'),
    p('1.2 Escopo do Sistema'),
    p('O SOAP é uma ferramenta de conversa com inteligência artificial.'),
    p('3. Requisitos Funcionais (RF)'), p('3.1 Acesso, contas e permissões'),
    p('[RF01] Autenticação e Sessão'), p(pri),
    p('O sistema deve exigir e-mail e senha. A sessão deve durar 30 dias.'),
    p('Casos de Uso relacionados: UC01 – Autenticar Usuário'),
    p('[RF02] Perfis e Permissões'), p(pri),
    p('As permissões disponíveis são:'),
    tab([['Permissão', 'Dá acesso a'], ['chat', 'usar o chat']]),
    p('4. Requisitos Não Funcionais (RNF)'),
    p('[RNF01] Segurança'), p(pri),
    p('As senhas devem ser guardadas como hash scrypt.'),
    p('6. Casos de Uso'),
    p('UC01 – Autenticar Usuário'),
    p('1. O ator informa e-mail e senha na tela de login.')
  ].join('');
  return zipar({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`
  });
}

/* ------------------------------ limpeza ------------------------------ */

async function limpar() {
  console.log('\n▸ Limpeza dos dados de teste');
  // tudo que tenha a marca deste teste, mesmo que algum passo tenha falhado no meio
  const empresas = await consultar('select id from od.empresa where nome like $1', [`${MARCA}%`]);
  for (const { id } of empresas) {
    await consultar('delete from od.demandas where empresa_id = $1', [id]);
    await consultar('delete from od.usuario where empresa_id = $1', [id]);
    await consultar('delete from od.empresa where id = $1', [id]);
  }
  await consultar('delete from od.demandas where titulo like $1', [`${MARCA}%`]);
  for (const { tipo, id } of criados.catalogo) {
    const tabela = { solicitantes: 'od.solicitantes', responsaveis: 'od.responsaveis' }[tipo];
    await consultar(`delete from ${tabela} where id = $1`, [id]).catch(() => {});
  }
  if (criados.adminId) await consultar('delete from od.usuario where id = $1', [criados.adminId]);
  const sobra = await consultarUm(
    `select (select count(*) from od.empresa where nome like $1)::int as empresas,
            (select count(*) from od.usuario where email like '%@od-teste.invalid')::int as usuarios`,
    [`${MARCA}%`]);
  console.log(`  ${sobra.empresas + sobra.usuarios === 0 ? '✔' : '✘'} Banco limpo `
    + `(empresas restantes: ${sobra.empresas}, contas de teste restantes: ${sobra.usuarios})`);
}

/* ------------------------------ execução ------------------------------ */

(async () => {
  console.log(`OD — teste de ponta a ponta  ${MARCA}`);
  let servidor;
  let falhaGeral = null;
  try {
    servidor = await subirServidor();
    console.log(`Servidor de teste em ${URL_BASE}`);
    await testar();
  } catch (erro) {
    falhaGeral = erro;
    console.error(`\n✘ Execução interrompida: ${erro.stack || erro.message}`);
  } finally {
    try { await limpar(); } catch (erro) { console.error('✘ Falha na limpeza:', erro.message); }
    if (servidor) servidor.kill();
    await pool.end();
  }

  const falhas = resultados.filter((r) => !r.passou);
  console.log(`\n══ ${resultados.length - falhas.length}/${resultados.length} verificações passaram`
    + `${falhas.length ? ` — ${falhas.length} falha(s)` : ''} ══`);
  for (const f of falhas) console.log(`  ✘ [${f.secao}] ${f.descricao}${f.detalhe ? `  → ${f.detalhe}` : ''}`);
  process.exit(falhas.length || falhaGeral ? 1 : 0);
})();
