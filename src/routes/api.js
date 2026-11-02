/**
 * Rotas da API (JSON) consumidas pela interface.
 * Todas exigem sessão; o recorte por empresa vem de req.escopo.
 *
 *  GET    /api/eu                       usuário da sessão e o que ele pode
 *  POST   /api/eu/senha                 troca a própria senha
 *
 *  GET    /api/demandas                 lista paginada e filtrada
 *  GET    /api/demandas/todas           todas (quadro, exportação CSV)
 *  GET    /api/demandas/:id             detalhe + histórico + imagens
 *  POST   /api/demandas                 cria
 *  PUT    /api/demandas/:id             edita
 *  PATCH  /api/demandas/:id/situacao    muda a situação
 *  POST   /api/demandas/:id/avancar     vai para a próxima etapa
 *  POST   /api/demandas/:id/historico   registra andamento
 *  DELETE /api/demandas/:id             exclui
 *  DELETE /api/demandas                 apaga todas do escopo (administrador)
 *
 *  GET    /api/demandas/:id/anexos      imagens da demanda (só metadados)
 *  POST   /api/demandas/:id/anexos      anexa imagem (conteúdo em base64)
 *  GET    /api/anexos/:id/arquivo       serve a imagem já decodificada
 *  DELETE /api/anexos/:id               remove a imagem
 *
 *  GET    /api/projetos                 projetos do escopo (com filtros)
 *  GET    /api/projetos/selecao         lista enxuta para o select da OD
 *  GET    /api/projetos/:id             perfil: ficha + passos + documentos + histórico
 *  POST   /api/projetos                 cadastra (passos como texto ou { titulo, descricao })
 *  POST   /api/projetos/ler-documento   lê um documento ainda não salvo: nome, objetivo e passos
 *  PUT    /api/projetos/:id             edita
 *  PATCH  /api/projetos/:id/situacao    muda a situação
 *  POST   /api/projetos/:id/avancar     vai para a próxima etapa do projeto
 *  POST   /api/projetos/:id/historico   registra andamento
 *  DELETE /api/projetos/:id             exclui (as demandas ficam, sem o vínculo)
 *
 *  GET/POST /api/projetos/:id/etapas       passos de execução
 *  PUT    /api/etapas/:etapaId             edita o passo
 *  PATCH  /api/etapas/:etapaId/situacao    conclui / reabre o passo
 *  POST   /api/etapas/:etapaId/mover       sobe ou desce na ordem
 *  DELETE /api/etapas/:etapaId             remove o passo
 *
 *  GET    /api/documentos/:anexoId/requisitos  prévia: requisitos lidos do documento
 *  POST   /api/projetos/:id/requisitos/previa  mesma prévia, de um texto colado
 *  POST   /api/projetos/:id/etapas/importar    grava como passos os requisitos escolhidos
 *
 *  GET/POST /api/projetos/:id/documentos   documentos (o de requisitos entre eles)
 *  GET    /api/documentos/:anexoId/arquivo abre ou baixa o documento
 *  DELETE /api/documentos/:anexoId         remove o documento
 *
 *  GET    /api/listas                   sistemas + solicitantes + responsáveis
 *  POST   /api/listas/:tipo             adiciona item (administrador)
 *  PUT    /api/listas/:tipo/:id         renomeia
 *  PATCH  /api/listas/:tipo/:id/ativo   desativa ou reativa (preserva o histórico)
 *  DELETE /api/listas/:tipo/:id         exclui de vez (só desativado e nunca usado)
 *
 *  GET    /api/painel                   indicadores da tela inicial
 *  GET    /api/analise                  indicadores e séries do recorte
 *  GET    /api/analise/projetos         área de projetos da aba Análise
 *  GET/PUT /api/config                  identificação (administrador)
 *  GET    /api/backup                   exporta o escopo em JSON
 *  POST   /api/exemplos                 recarrega as demandas de teste (administrador)
 *
 *  GET/POST/PUT/DELETE /api/empresas    cadastro de empresas (administrador)
 *  GET    /api/empresas/por-email       empresas e sistemas já ligados a um e-mail
 *  GET/POST /api/empresas/:id/sistemas  sistemas cadastrados na empresa
 *  GET    /api/perfis                   perfis do escopo + catalogo de permissoes
 *  GET    /api/perfis/atribuiveis       perfis que podem ser dados a uma conta
 *  GET/POST/PUT/DELETE /api/perfis[/:id]  mantem os perfis de acesso
 *  GET/POST/PUT/DELETE /api/usuarios    contas de acesso (admin ou gestor)
 *  GET    /api/usuarios/sistemas        sistemas que podem ser atribuídos a uma conta
 */
const express = require('express');
const anexos = require('../controllers/anexoController');
const demandas = require('../controllers/demandaController');
const listas = require('../controllers/listaController');
const projetos = require('../controllers/projetoController');
const analise = require('../controllers/analiseController');
const config = require('../controllers/configController');
const empresas = require('../controllers/empresaController');
const auth = require('../controllers/authController');
const perfis = require('../controllers/perfilController');
const { exigirLogin, exigir } = require('../middlewares/auth');

const rotas = express.Router();

rotas.use(exigirLogin);

rotas.get('/eu', auth.eu);
rotas.post('/eu/senha', auth.trocarSenha);

rotas.get('/demandas/todas', exigir('demanda.ver'), demandas.listarTudo);
rotas.get('/demandas', exigir('demanda.ver'), demandas.listar);
rotas.post('/demandas', exigir('demanda.criar'), demandas.criar);
rotas.delete('/demandas', exigir('dados.apagar'), demandas.removerTodas);
rotas.get('/demandas/:id', exigir('demanda.ver'), demandas.buscar);
rotas.put('/demandas/:id', exigir('demanda.editar'), demandas.atualizar);
rotas.patch('/demandas/:id/situacao', exigir('demanda.editar'), demandas.mudarSituacao);
rotas.post('/demandas/:id/avancar', exigir('demanda.editar'), demandas.avancar);
rotas.post('/demandas/:id/historico', exigir('demanda.criar'), demandas.registrarAndamento);
rotas.delete('/demandas/:id', exigir('demanda.excluir'), demandas.remover);

rotas.get('/demandas/:id/anexos', exigir('demanda.ver'), anexos.listar);
rotas.post('/demandas/:id/anexos', exigir('demanda.anexar'), anexos.enviar);
rotas.get('/anexos/:anexoId/arquivo', exigir('demanda.ver'), anexos.arquivo);
rotas.delete('/anexos/:anexoId', exigir('demanda.anexar'), anexos.remover);

rotas.get('/projetos/selecao', exigir('projeto.ver'), projetos.paraSelecao);
rotas.get('/projetos', exigir('projeto.ver'), projetos.listar);
rotas.post('/projetos', exigir('projeto.criar'), projetos.criar);
rotas.post('/projetos/ler-documento', exigir('projeto.criar'), projetos.lerDocumento);
rotas.get('/projetos/:id', exigir('projeto.ver'), projetos.buscar);
rotas.put('/projetos/:id', exigir('projeto.editar'), projetos.atualizar);
rotas.patch('/projetos/:id/situacao', exigir('projeto.editar'), projetos.mudarSituacao);
rotas.post('/projetos/:id/avancar', exigir('projeto.editar'), projetos.avancar);
rotas.post('/projetos/:id/historico', exigir('projeto.criar'), projetos.registrarAndamento);
rotas.delete('/projetos/:id', exigir('projeto.excluir'), projetos.remover);

rotas.post('/projetos/:id/etapas/importar', exigir('projeto.criar'), projetos.importarEtapas);
rotas.post('/projetos/:id/requisitos/previa', exigir('projeto.criar'), projetos.previaDeTexto);
rotas.get('/projetos/:id/etapas', exigir('projeto.ver'), projetos.listarEtapas);
rotas.post('/projetos/:id/etapas', exigir('projeto.criar'), projetos.criarEtapa);
rotas.put('/etapas/:etapaId', exigir('projeto.editar'), projetos.atualizarEtapa);
rotas.patch('/etapas/:etapaId/situacao', exigir('projeto.editar'), projetos.mudarSituacaoEtapa);
rotas.post('/etapas/:etapaId/mover', exigir('projeto.editar'), projetos.moverEtapa);
rotas.delete('/etapas/:etapaId', exigir('projeto.editar'), projetos.removerEtapa);

rotas.get('/projetos/:id/documentos', exigir('projeto.ver'), projetos.listarDocumentos);
rotas.post('/projetos/:id/documentos', exigir('projeto.criar'), projetos.enviarDocumento);
rotas.get('/documentos/:anexoId/requisitos', exigir('projeto.ver'), projetos.previaRequisitos);
rotas.get('/documentos/:anexoId/arquivo', exigir('projeto.ver'), projetos.arquivoDocumento);
rotas.delete('/documentos/:anexoId', exigir('projeto.editar'), projetos.removerDocumento);

rotas.get('/listas', listas.listarTodas);
rotas.get('/listas/:tipo', listas.listar);
// as listas auxiliares são mantidas pelo administrador; a empresa só usa
rotas.post('/listas/:tipo', exigir('catalogo.administrar'), listas.criar);
rotas.put('/listas/:tipo/:id', exigir('catalogo.administrar'), listas.renomear);
rotas.patch('/listas/:tipo/:id/ativo', exigir('catalogo.administrar'), listas.alternarAtivo);
rotas.delete('/listas/:tipo/:id', exigir('catalogo.administrar'), listas.remover);

rotas.get('/painel', exigir('analise.ver'), analise.painel);
rotas.get('/analise/projetos', exigir('analise.ver'), analise.projetos);
rotas.get('/analise', exigir('analise.ver'), analise.analise);

rotas.get('/config', config.obter);
rotas.put('/config', exigir('config.administrar'), config.salvar);
rotas.get('/backup', exigir('dados.exportar'), config.exportar);
rotas.post('/exemplos', exigir('dados.apagar'), config.carregarExemplos);

rotas.get('/empresas/por-email', exigir('empresa.administrar'), empresas.porEmail);
rotas.get('/empresas', exigir('empresa.administrar'), empresas.listar);
rotas.post('/empresas', exigir('empresa.administrar'), empresas.criar);
rotas.get('/empresas/:id/sistemas', exigir('empresa.administrar'), empresas.sistemas);
rotas.post('/empresas/:id/sistemas', exigir('empresa.administrar'), empresas.adicionarSistema);
rotas.put('/empresas/:id', exigir('empresa.administrar'), empresas.atualizar);
rotas.delete('/empresas/:id', exigir('empresa.administrar'), empresas.remover);

rotas.get('/perfis/atribuiveis', exigir('usuario.administrar'), perfis.atribuiveis);
rotas.get('/perfis', exigir('perfil.administrar'), perfis.listar);
rotas.post('/perfis', exigir('perfil.administrar'), perfis.criar);
rotas.get('/perfis/:id', exigir('perfil.administrar'), perfis.buscar);
rotas.put('/perfis/:id', exigir('perfil.administrar'), perfis.atualizar);
rotas.delete('/perfis/:id', exigir('perfil.administrar'), perfis.remover);

rotas.get('/usuarios/sistemas', exigir('usuario.administrar'), empresas.sistemasDoEscopo);
rotas.get('/usuarios', exigir('usuario.administrar'), empresas.listarUsuarios);
rotas.post('/usuarios', exigir('usuario.administrar'), empresas.criarUsuario);
rotas.put('/usuarios/:id', exigir('usuario.administrar'), empresas.atualizarUsuario);
rotas.delete('/usuarios/:id', exigir('usuario.administrar'), empresas.removerUsuario);

module.exports = rotas;
