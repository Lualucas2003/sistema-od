/**
 * Model de projetos — só SQL. Nenhuma regra de HTTP aqui.
 *
 * Como nas demandas, toda função recebe `escopo` ({ empresaId, sistemasIds }):
 *   empresaId null -> administrador, sem recorte
 *   empresaId N    -> só os projetos da empresa N
 * O recorte entra no SQL; nunca é aplicado depois, em memória.
 *
 * O projeto guarda três coisas além da ficha: o documento de requisitos
 * (od.projeto_anexo, categoria 'requisitos'), os passos de execução
 * (od.projeto_etapa) e o histórico do que foi acontecendo.
 */
const { consultar, consultarUm, transacao } = require('../config/db');

const SELECT_BASE = 'select * from od.vw_projetos p';

const CAMPOS_ANEXO = `id, projeto_id, categoria, nome, tipo, tamanho, enviado_por, criado_em`;

const CAMPOS_ETAPA = `e.id, e.projeto_id, e.ordem, e.tipo, e.titulo, e.descricao, e.prazo,
                      e.situacao, e.responsavel_id, e.criada_em, e.concluida_em,
                      coalesce(r.nome, 'Não atribuído') as responsavel`;

/**
 * Recorte do escopo. Projeto sem sistema é da empresa toda: continua
 * visível para quem está restrito a alguns sistemas.
 */
function recorte(escopo, vals) {
  if (!escopo) return '';
  let sql = '';
  if (escopo.empresaId != null) {
    vals.push(escopo.empresaId);
    sql += ` and p.empresa_id = $${vals.length}`;
  }
  if (escopo.sistemasIds && escopo.sistemasIds.length) {
    vals.push(escopo.sistemasIds);
    sql += ` and (p.sistema_id is null or p.sistema_id = any($${vals.length}::int[]))`;
  }
  return sql;
}

/** Lista do escopo, com os filtros da tela. */
async function listar(escopo, filtros = {}) {
  const cond = [];
  const vals = [];
  if (filtros.situacao) { vals.push(filtros.situacao); cond.push(`p.situacao = $${vals.length}::od.situacao_projeto`); }
  if (filtros.prioridade) { vals.push(filtros.prioridade); cond.push(`p.prioridade = $${vals.length}::od.prioridade`); }
  if (filtros.sistema) { vals.push(filtros.sistema); cond.push(`p.sistema = $${vals.length}`); }
  if (filtros.responsavel) { vals.push(filtros.responsavel); cond.push(`p.responsavel = $${vals.length}`); }
  if (filtros.busca) {
    vals.push('%' + filtros.busca + '%');
    cond.push(`(p.codigo ilike $${vals.length} or p.nome ilike $${vals.length}
                or coalesce(p.objetivo,'') ilike $${vals.length}
                or coalesce(p.sistema,'') ilike $${vals.length}
                or p.responsavel ilike $${vals.length})`);
  }
  const doEscopo = recorte(escopo, vals).replace(/^ and /, '');
  if (doEscopo) cond.push(doEscopo);

  const where = cond.length ? 'where ' + cond.join(' and ') : '';
  return consultar(
    `${SELECT_BASE} ${where}
      order by array_position(array['andamento','planejamento','pausado','concluido','cancelado']::text[],
                              p.situacao::text), p.criado_em desc`, vals);
}

/** Só a ficha, sem os blocos do perfil. */
async function buscarFicha(escopo, id) {
  const vals = [id];
  return consultarUm(`${SELECT_BASE} where p.id = $1 ${recorte(escopo, vals)}`, vals);
}

/** Ficha + passos + documentos + histórico + demandas vinculadas (a tela de perfil). */
async function buscarPorId(escopo, id) {
  const projeto = await buscarFicha(escopo, id);
  if (!projeto) return null;

  projeto.etapas_lista = await listarEtapas(id);
  projeto.documentos_lista = await listarAnexos(id);
  projeto.historico = await consultar(
    `select id, registrado_em, autor, texto from od.projeto_historico
      where projeto_id = $1 order by registrado_em, id`, [id]);
  projeto.demandas_lista = await consultar(
    `select d.id, d.numero, d.titulo, d.situacao, d.prioridade, d.criada_em,
            coalesce(re.nome, 'Não atribuído') as responsavel
       from od.demandas d
       left join od.responsaveis re on re.id = d.responsavel_id
      where d.projeto_id = $1 order by d.criada_em desc`, [id]);
  return projeto;
}

/**
 * Empresa de um projeto novo. Quem está numa empresa cria só para ela, e isso é
 * fixo: o corpo da requisição não muda nada. Só o administrador, no sistema
 * principal, escolhe a empresa — ou deixa em branco para um projeto interno.
 */
async function empresaDoNovoProjeto(escopo, empresaEscolhida) {
  if (escopo && escopo.empresaId != null) return { empresaId: escopo.empresaId };
  if (!empresaEscolhida) return { empresaId: null };
  const empresa = await consultarUm('select id from od.empresa where id = $1', [empresaEscolhida]);
  return empresa ? { empresaId: empresa.id } : { erro: 'Empresa não encontrada.' };
}

/** Sistema, solicitante e responsável escolhidos precisam ser da empresa do projeto. */
async function vinculosDaEmpresa(empresaId, dados) {
  if (dados.sistemaId) {
    const s = await consultarUm('select empresa_id, fixo from od.sistemas where id = $1', [dados.sistemaId]);
    if (!s || !(s.fixo === true || s.empresa_id === empresaId)) {
      return 'O sistema escolhido não é da empresa do projeto.';
    }
  }
  const itens = [['solicitanteId', 'od.solicitantes', 'solicitante'],
                 ['responsavelId', 'od.responsaveis', 'responsável']];
  for (const [campo, tabela, rotulo] of itens) {
    if (!dados[campo]) continue;
    const item = await consultarUm(`select empresa_id from ${tabela} where id = $1`, [dados[campo]]);
    if (!item || item.empresa_id !== empresaId) return `O ${rotulo} escolhido não é da empresa do projeto.`;
  }
  return null;
}

/** O sistema escolhido precisa pertencer ao escopo de quem está cadastrando. */
async function sistemaPermitido(escopo, sistemaId) {
  if (!sistemaId) return true;                                       // projeto sem sistema
  const linha = await consultarUm('select empresa_id, fixo from od.sistemas where id = $1', [sistemaId]);
  if (!linha) return false;
  if (escopo && escopo.sistemasIds && escopo.sistemasIds.length
      && !escopo.sistemasIds.includes(Number(sistemaId))) return false;
  if (!escopo || escopo.empresaId == null) return true;              // administrador
  return linha.empresa_id === escopo.empresaId || linha.fixo === true;
}

async function criar(escopo, dados) {
  const linha = await consultarUm(
    `insert into od.projeto
       (nome, objetivo, empresa_id, sistema_id, solicitante_id, responsavel_id,
        situacao, prioridade, inicio_previsto, fim_previsto)
     values ($1, $2, $3, $4, $5, $6, $7::od.situacao_projeto, $8::od.prioridade, $9, $10)
     returning id`,
    [dados.nome, dados.objetivo || null,
     escopo && escopo.empresaId != null ? escopo.empresaId : (dados.empresaId || null),
     dados.sistemaId || null, dados.solicitanteId || null, dados.responsavelId || null,
     dados.situacao, dados.prioridade, dados.inicioPrevisto || null, dados.fimPrevisto || null]);

  // os passos informados no cadastro já entram na ordem digitada
  if (dados.etapas && dados.etapas.length) {
    await transacao(async (cliente) => {
      for (let i = 0; i < dados.etapas.length; i++) {
        const etapa = typeof dados.etapas[i] === 'object'
          ? dados.etapas[i] : { titulo: dados.etapas[i], descricao: null };
        await cliente.query(
          `insert into od.projeto_etapa (projeto_id, ordem, tipo, titulo, descricao)
           values ($1, $2, $3, $4, $5)`,
          [linha.id, i + 1, etapa.tipo === 'requisito' ? 'requisito' : 'passo',
           etapa.titulo, etapa.descricao || null]);
      }
    });
  }
  return buscarPorId(escopo, linha.id);
}

async function atualizar(escopo, id, dados) {
  const atual = await buscarFicha(escopo, id);
  if (!atual) return null;

  await transacao(async (cliente) => {
    await cliente.query(
      `update od.projeto set nome = $2, objetivo = $3, sistema_id = $4, solicitante_id = $5,
              responsavel_id = $6, situacao = $7::od.situacao_projeto,
              prioridade = $8::od.prioridade, inicio_previsto = $9, fim_previsto = $10
         where id = $1`,
      [id, dados.nome, dados.objetivo || null, dados.sistemaId || null,
       dados.solicitanteId || null, dados.responsavelId || null, dados.situacao,
       dados.prioridade, dados.inicioPrevisto || null, dados.fimPrevisto || null]);

    const mudou = [];
    if (atual.nome !== dados.nome) mudou.push('nome');
    if ((atual.objetivo || '') !== (dados.objetivo || '')) mudou.push('objetivo');
    if ((atual.sistema_id || null) !== (dados.sistemaId || null)) mudou.push('sistema');
    if ((atual.solicitante_id || null) !== (dados.solicitanteId || null)) mudou.push('solicitante');
    if ((atual.responsavel_id || null) !== (dados.responsavelId || null)) mudou.push('responsável');
    if (atual.prioridade !== dados.prioridade) mudou.push('prioridade');
    if (String(atual.inicio_previsto || '') !== String(dados.inicioPrevisto || '')
        || String(atual.fim_previsto || '') !== String(dados.fimPrevisto || '')) mudou.push('prazos');
    if (mudou.length) {
      await cliente.query(
        `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
        [id, dados.autor || null, `Projeto editado (${mudou.join(', ')}).`]);
    }
  });
  return buscarPorId(escopo, id);
}

async function mudarSituacao(escopo, id, situacao) {
  const vals = [id, situacao];
  const linha = await consultarUm(
    `update od.projeto p set situacao = $2::od.situacao_projeto
      where p.id = $1 ${recorte(escopo, vals)} returning p.id`, vals);
  return linha ? buscarPorId(escopo, id) : null;
}

async function registrarHistorico(id, texto, autor) {
  return consultarUm(
    `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)
     returning id, registrado_em, autor, texto`, [id, autor || null, texto]);
}

/** Exclui o projeto; passos, documentos e histórico vão junto (cascade). */
async function remover(escopo, id) {
  const projeto = await buscarFicha(escopo, id);
  if (!projeto) return null;
  return transacao(async (cliente) => {
    // as demandas ficam, só perdem o vínculo (on delete set null)
    await cliente.query('delete from od.projeto where id = $1', [id]);
    return { codigo: projeto.codigo, nome: projeto.nome, demandas: projeto.demandas };
  });
}

/* ----------------------------- Passos ----------------------------- */

async function listarEtapas(projetoId) {
  return consultar(
    `select ${CAMPOS_ETAPA} from od.projeto_etapa e
       left join od.responsaveis r on r.id = e.responsavel_id
      where e.projeto_id = $1 order by e.ordem, e.id`, [projetoId]);
}

async function buscarEtapa(id) {
  return consultarUm(
    `select ${CAMPOS_ETAPA} from od.projeto_etapa e
       left join od.responsaveis r on r.id = e.responsavel_id where e.id = $1`, [id]);
}

/** Acrescenta o passo no fim da fila. */
async function criarEtapa(projetoId, dados, autor) {
  return transacao(async (cliente) => {
    const { rows: pos } = await cliente.query(
      'select coalesce(max(ordem), 0) + 1 as proxima from od.projeto_etapa where projeto_id = $1',
      [projetoId]);
    const { rows } = await cliente.query(
      `insert into od.projeto_etapa (projeto_id, ordem, tipo, titulo, descricao, responsavel_id, prazo)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [projetoId, pos[0].proxima, dados.tipo || 'passo',
       dados.titulo, dados.descricao || null, dados.responsavelId || null, dados.prazo || null]);
    await cliente.query(
      `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
      [projetoId, autor || null,
       `${dados.tipo === 'requisito' ? 'Requisito' : 'Atividade'} adicionado: ${dados.titulo}.`]);
    return rows[0].id;
  }).then(buscarEtapa);
}

/**
 * Cria vários passos de uma vez, no fim da fila — é o que a importação do
 * documento de requisitos usa. Tudo numa transação só: ou entram todos, ou nenhum.
 */
async function criarEtapasEmLote(projetoId, itens, origem, autor) {
  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      'select coalesce(max(ordem), 0) as ultima from od.projeto_etapa where projeto_id = $1',
      [projetoId]);
    let ordem = Number(rows[0].ultima);

    for (const item of itens) {
      ordem++;
      await cliente.query(
        `insert into od.projeto_etapa (projeto_id, ordem, tipo, titulo, descricao)
         values ($1, $2, $3, $4, $5)`,
        [projetoId, ordem, item.tipo === 'passo' ? 'passo' : 'requisito',
         item.titulo, item.descricao || null]);
    }
    await cliente.query(
      `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
      [projetoId, autor || null,
       `${itens.length} requisito(s) importado(s) ${origem ? `do documento "${origem}"` : 'de um texto colado'}.`]);
    return itens.length;
  });
}

async function atualizarEtapa(id, dados, autor) {
  const atual = await buscarEtapa(id);
  if (!atual) return null;

  await transacao(async (cliente) => {
    await cliente.query(
      `update od.projeto_etapa set titulo = $2, descricao = $3, responsavel_id = $4,
              prazo = $5, situacao = coalesce($6::od.situacao_etapa, situacao)
         where id = $1`,
      [id, dados.titulo, dados.descricao || null, dados.responsavelId || null,
       dados.prazo || null, dados.situacao || null]);
    if (dados.situacao && dados.situacao !== atual.situacao) {
      await cliente.query(
        `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
        [atual.projeto_id, autor || null,
         `Atividade ${atual.ordem} (${atual.titulo}): ${atual.situacao} → ${dados.situacao}.`]);
    } else if (dados.titulo !== atual.titulo || (dados.descricao || '') !== (atual.descricao || '')) {
      await cliente.query(
        `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
        [atual.projeto_id, autor || null, `Atividade ${atual.ordem} editada.`]);
    }
  });
  return buscarEtapa(id);
}

/** Troca o passo de lugar com o vizinho (direcao -1 sobe, +1 desce). */
async function moverEtapa(id, direcao) {
  const etapa = await buscarEtapa(id);
  if (!etapa) return null;

  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `select id, ordem from od.projeto_etapa
        where projeto_id = $1 and tipo = $4 and (ordem, id) ${direcao < 0 ? '<' : '>'} ($2, $3)
        order by ordem ${direcao < 0 ? 'desc' : 'asc'}, id ${direcao < 0 ? 'desc' : 'asc'} limit 1`,
      [etapa.projeto_id, etapa.ordem, etapa.id, etapa.tipo]);   // troca só com o mesmo tipo
    if (!rows.length) return false;                     // já está na ponta

    const vizinho = rows[0];
    await cliente.query('update od.projeto_etapa set ordem = $2 where id = $1', [etapa.id, vizinho.ordem]);
    await cliente.query('update od.projeto_etapa set ordem = $2 where id = $1', [vizinho.id, etapa.ordem]);
    // empate de ordem entre passos criados antes: renumera a fila inteira
    await cliente.query(
      `update od.projeto_etapa e set ordem = n.linha
         from (select id, row_number() over (order by ordem, id) as linha
                 from od.projeto_etapa where projeto_id = $1) n
        where n.id = e.id and e.projeto_id = $1`, [etapa.projeto_id]);
    return true;
  });
}

async function removerEtapa(id, autor) {
  const etapa = await buscarEtapa(id);
  if (!etapa) return null;
  await transacao(async (cliente) => {
    await cliente.query('delete from od.projeto_etapa where id = $1', [id]);
    await cliente.query(
      `update od.projeto_etapa e set ordem = n.linha
         from (select id, row_number() over (order by ordem, id) as linha
                 from od.projeto_etapa where projeto_id = $1) n
        where n.id = e.id and e.projeto_id = $1`, [etapa.projeto_id]);
    await cliente.query(
      `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
      [etapa.projeto_id, autor || null, `Atividade removida: ${etapa.titulo}.`]);
  });
  return etapa;
}

/** A qual projeto esse passo pertence? Serve para conferir o escopo. */
async function projetoDaEtapa(id) {
  const linha = await consultarUm('select projeto_id from od.projeto_etapa where id = $1', [id]);
  return linha ? linha.projeto_id : null;
}

/* --------------------------- Documentos --------------------------- */

async function listarAnexos(projetoId) {
  return consultar(
    `select ${CAMPOS_ANEXO} from od.projeto_anexo where projeto_id = $1
      order by (categoria = 'requisitos') desc, criado_em, id`, [projetoId]);
}

async function criarAnexo(projetoId, documento) {
  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `insert into od.projeto_anexo (projeto_id, categoria, nome, tipo, tamanho, dados, enviado_por)
       values ($1, $2, $3, $4, $5, $6, $7) returning ${CAMPOS_ANEXO}`,
      [projetoId, documento.categoria, documento.nome, documento.tipo,
       documento.tamanho, documento.dados, documento.autor || null]);
    await cliente.query(
      `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
      [projetoId, documento.autor || null,
       `${documento.categoria === 'requisitos' ? 'Documento de requisitos' : 'Documento'} anexado: ${documento.nome}.`]);
    return rows[0];
  });
}

async function obterConteudoAnexo(id) {
  return consultarUm(
    'select projeto_id, nome, tipo, dados from od.projeto_anexo where id = $1', [id]);
}

async function projetoDoAnexo(id) {
  const linha = await consultarUm('select projeto_id from od.projeto_anexo where id = $1', [id]);
  return linha ? linha.projeto_id : null;
}

async function removerAnexo(id, autor) {
  return transacao(async (cliente) => {
    const { rows } = await cliente.query(
      'delete from od.projeto_anexo where id = $1 returning projeto_id, nome', [id]);
    if (!rows.length) return null;
    await cliente.query(
      `insert into od.projeto_historico (projeto_id, autor, texto) values ($1, $2, $3)`,
      [rows[0].projeto_id, autor || null, `Documento removido: ${rows[0].nome}.`]);
    return rows[0].nome;
  });
}

async function contarAnexos(projetoId) {
  const { total } = await consultarUm(
    'select count(*)::int as total from od.projeto_anexo where projeto_id = $1', [projetoId]);
  return total;
}

/* ------------------- Projetos disponíveis na OD ------------------- */

/** Lista enxuta para o select do formulário de demanda. */
async function paraSelecao(escopo) {
  const vals = [];
  const onde = recorte(escopo, vals).replace(/^ and /, 'where ');
  return consultar(
    `select p.id, p.codigo, p.nome, p.situacao from od.vw_projetos p ${onde}
      ${onde ? 'and' : 'where'} p.situacao not in ('concluido','cancelado')
      order by p.nome`, vals);
}

module.exports = {
  listar, buscarPorId, buscarFicha, criar, atualizar, mudarSituacao, remover,
  registrarHistorico, sistemaPermitido, empresaDoNovoProjeto, vinculosDaEmpresa, paraSelecao,
  listarEtapas, buscarEtapa, criarEtapa, criarEtapasEmLote, atualizarEtapa, moverEtapa,
  removerEtapa, projetoDaEtapa,
  listarAnexos, criarAnexo, obterConteudoAnexo, projetoDoAnexo, removerAnexo, contarAnexos
};
