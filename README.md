# OD — Ordem de Demandas | HeuCode

Sistema de abertura e acompanhamento de demandas: cadastro, quadro de situação,
indicadores e análise. Node + Express + PostgreSQL, organizado em **MVC**.

Funciona em duas frentes:

| Entrada | Quem usa | O que enxerga |
|---|---|---|
| `/` | administrador do sistema | todas as demandas, de todas as empresas |
| `/p/<empresa>` | usuários daquela empresa | **somente** as OD da empresa, com login próprio |

## Como rodar

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL
npm run db:reset          # cria o schema e carrega as demandas de teste
npm run admin -- "Seu Nome" voce@dominio.com suasenha    # primeiro administrador
npm start                 # http://localhost:4646
```

| Script | O que faz |
|---|---|
| `npm start` | Sobe o servidor. |
| `npm run dev` | Sobe com reinício automático a cada alteração. |
| `npm run db:schema` | Só a estrutura (tabelas, gatilhos, visões). |
| `npm run db:seed` | Só os dados de teste (recria as demandas). |
| `npm run db:reset` | Estrutura + dados de teste. |
| `npm run admin -- "Nome" email senha` | Cria (ou redefine a senha de) um administrador. |

A lista de arquivos SQL e a ordem em que rodam ficam em `src/config/migracoes.js`.

## Rodando com Docker

```bash
cp .env.example .env                 # preencha DATABASE_URL
docker compose up -d --build         # http://localhost:4646
docker compose exec app npm run admin -- "Seu Nome" voce@dominio.com suasenha
docker compose logs -f app           # acompanhar o servidor
```

- O container lê o `.env` (a `DATABASE_URL`) e expõe a porta **4646**.
- Com `INICIALIZAR_BANCO=true` (já ligado no compose), as tabelas são criadas sozinhas
  quando o schema `od` está vazio. Num banco que já tem as tabelas, nada é reaplicado.
- Para um PostgreSQL local dentro do compose, use no `.env`
  `DATABASE_URL=postgres://od:od@db:5432/od?sslmode=disable` e suba com
  `docker compose --profile banco-local up -d --build`. Os dados ficam no volume `dados-od`.
- Migração nova em banco existente: `docker compose exec app node scripts/aplicar-sql.js db/<arquivo>.sql`.

## Estrutura

```
server.js                     confere o banco (e cria as tabelas, se pedido) e abre a porta
Dockerfile, docker-compose.yml  imagem e serviços do Docker
src/
  app.js                      aplicação Express: views, estáticos, middlewares e rotas
  config/db.js                pool do PostgreSQL (consultar, consultarUm, transacao)
  config/migracoes.js         lista e ordem dos arquivos SQL do banco
  models/                     ── M ── só SQL, sem HTTP
    demandaModel.js             CRUD, filtros, paginação, histórico
    projetoModel.js             projetos, passos de execução e documentos
    anexoModel.js               imagens em base64 (od.demanda_anexo)
    listaModel.js               sistemas / solicitantes / responsáveis
    analiseModel.js             agregações do painel e da análise
    configModel.js              configurações e numeração
    empresaModel.js             empresas (inquilinos) e seus portais
    usuarioModel.js             contas, autenticação e sessões
    perfilModel.js              perfis de acesso e o catálogo de permissões
  lib/                        ── leitura de arquivo, sem HTTP nem SQL
    documentoTexto.js           texto de DOCX/ODT/planilha/PDF/TXT/MD/CSV/RTF
    requisitos.js               do texto para a lista de requisitos
  controllers/                ── C ── validação, regras de resposta
    demandaController.js
    projetoController.js        projeto, passos, documentos e a importação
    listaController.js
    analiseController.js
    configController.js
    paginaController.js         entrega a página já com dados do banco
    authController.js           login, logout e troca de senha
    empresaController.js        empresas e contas de acesso
    perfilController.js         perfis, permissões e as travas contra escalada
  routes/
    index.js                    rota de página
    api.js                      rotas JSON (/api/...)
  middlewares/
    erros.js                    erro 404, 500 e tradução de erros do Postgres
    auth.js                     sessão, permissões e **escopo de empresa**
  views/                      ── V ── EJS
    index.ejs  login.ejs
    partials/                   cabecalho, painel, demandas, formulario,
                                projetos, analise, config, modal
public/
  css/od.css                  tema HeuCode (claro/escuro) e componentes
  js/                         cliente em módulos ES
    api.js                      único ponto que fala com /api
    ui.js                       seletores, formatação, etiquetas, toasts
    graficos.js                 SVG puro: colunas, rosca, barras, empilhado
    anexos.js                   imagens: converte p/ base64, reduz, galeria e visor
    dialogo.js                  confirmações e formulários em diálogo, no visual do
                                sistema (substituem confirm/prompt do navegador);
                                campos text/email/password/select, validação e
                                gerador de senha
    admin.js                    cadastro de empresas e de contas de acesso
    projetos.js                 lista, cadastro e a tela de perfil do projeto
    perfis.js                   perfis e permissões (Configurações)
    painel.js  demandas.js  formulario.js  analise.js  configuracoes.js
    app.js                      navegação (por hash) e ligação dos eventos
db/                           SQL versionado + README do banco
scripts/aplicar-sql.js        aplica os .sql no banco do .env (--schema, --seed ou arquivos)
legado/                       versão anterior em arquivo único (localStorage)
```

**O caminho de uma requisição**: `rota → controller → model → PostgreSQL`.
O controller nunca escreve SQL; o model nunca conhece `req`/`res`.

## Isolamento entre empresas

`req.escopo` é a única fonte de verdade sobre o que a requisição enxerga:

```
{ empresaId: null }  administrador — sem recorte
{ empresaId: 7 }     usuário da empresa 7 — só as demandas dela
```

O escopo é montado pelo middleware a partir da **sessão** (e do slug, em `/p/<empresa>`),
nunca de um `empresa_id` vindo do corpo ou da query. Todos os models recebem esse escopo
e o aplicam **no SQL** — nada é filtrado depois, em memória.

### O que é da empresa e o que é universal

| Catálogo | Alcance |
|---|---|
| **Sistemas** | **da empresa** — são os sistemas reais de cada cliente, e é o vínculo do sistema com a empresa que separa as demandas entre os portais |
| Solicitantes | **universal** — um único catálogo, mantido pelo administrador, válido em todos os portais |
| Responsáveis | **universal** |
| Tipos de ação | **universal** (uma empresa ainda pode criar tipos próprios) |

Antes, cada empresa nova ganhava a própria cópia de "Cliente" e "Não atribuído", e a tela de
Catálogos mostrava o mesmo termo repetido com o nome da empresa ao lado. Hoje o nome é único
no sistema inteiro (índice `lower(nome)`) e um portal novo já nasce enxergando o catálogo.
Quem está num portal continua **vendo** esses itens sem poder alterá-los — mantê-los é do
administrador.

### Recorte por sistema (opcional)

Além da empresa, uma conta pode ficar limitada a **sistemas específicos**
(`od.usuario_sistema`). Sem nenhuma linha, ela enxerga todos os sistemas da empresa;
havendo, o escopo passa a `{ empresaId, sistemasIds }` e o recorte entra no SQL de
listagens, quadro, análise, anexos e na validação de abertura de OD.

### Perfis e permissões

Quem pode o quê não está mais fixo no código: um **perfil** é um nome com um conjunto de
**permissões**, e cada conta aponta para um perfil (`Configurações › Perfis e permissões`).

| Grupo | Permissões |
|---|---|
| Demandas | `demanda.ver` · `demanda.criar` · `demanda.editar` · `demanda.excluir` · `demanda.anexar` |
| Projetos | `projeto.ver` · `projeto.criar` · `projeto.editar` · `projeto.excluir` |
| Análise | `analise.ver` · `dados.exportar` |
| Administração | `usuario.administrar` · `perfil.administrar` · `catalogo.administrar`\* · `empresa.administrar`\* · `config.administrar`\* · `dados.apagar`\* |

\* Só entram em perfil de administrador — há uma trava no banco (`tg_perfil_permissao`), não só
na aplicação.

Os quatro perfis de fábrica continuam existindo, com exatamente as permissões que o código
dava antes, e não podem ser excluídos:

| Perfil do sistema | Base de escopo | Pode |
|---|---|---|
| **Administrador** | sistema principal | tudo, sempre — não é editável, para ninguém se trancar do lado de fora |
| **Gestor** | uma empresa | as OD e os projetos da empresa, as contas dela e os perfis dela |
| **Operador** | uma empresa | abrir, editar e movimentar OD e projetos |
| **Leitor** | uma empresa | apenas consultar |

A `base` do perfil é a **classe de escopo** que a conta herda (`od.usuario.perfil`, mantida por
gatilho): `admin` = sistema principal, os demais = uma empresa. É ela que sustenta o isolamento
descrito acima; as permissões dizem o que a conta faz **dentro** desse escopo.

**A tela** separa os perfis em blocos recolhiveis, um por dono — *Perfis do sistema*, *Todos os
portais* e um bloco para **cada empresa cadastrada**, que aparece assim que a empresa é criada
(mesmo antes de ter perfil algum). Cada bloco tem o proprio botao de criar, entao ja fica claro
para quem o perfil novo vai valer; o navegador lembra quais blocos ficaram abertos. O gestor ve
so dois: o do sistema e o da empresa dele.

**Quem mantém os perfis**: o administrador cria perfis globais (valem em todos os portais) ou de
uma empresa específica; o gestor cria e edita os da própria empresa. Duas travas impedem
escalada de privilégio:

1. ninguém concede permissão que a própria conta não tem — na tela ela aparece marcada como
   *"sua conta não tem"* e travada, e o servidor descarta o que passar mesmo assim;
2. um gestor não altera perfil global nem o de administrador, e pedir base `admin` vira
   `operador`.

Tirar uma permissão de um perfil vale para **todas** as contas que o usam, na próxima tela que
elas carregarem. `req.pode` traz uma chave por permissão (`req.pode['demanda.criar']`) e as
rotas a exigem com `exigir('demanda.criar')`.

No portal de uma empresa, **Configurações se resume a "Usuários" e "Perfis e permissões"** —
o gestor cadastra as contas do portal e monta os perfis delas, e nada mais. As listas auxiliares (sistemas, solicitantes,
responsáveis), a identificação e a área de dados ficam só com o administrador, tanto na tela
quanto na API. A aba Configurações nem aparece para operador e leitor.

Senhas com **scrypt** (`node:crypto`), sessão em cookie `httpOnly` de 7 dias guardada em
`od.sessao`. Trocar a senha encerra as sessões abertas daquele usuário.

## API

| Método | Rota | Para quê |
|---|---|---|
| GET | `/api/demandas` | lista com filtros, ordenação e paginação |
| GET | `/api/demandas/todas` | tudo (quadro e exportação CSV) |
| GET | `/api/demandas/:id` | detalhe + histórico |
| POST | `/api/demandas` | abre uma OD |
| PUT | `/api/demandas/:id` | edita (registra o que mudou no histórico) |
| PATCH | `/api/demandas/:id/situacao` | muda a situação |
| POST | `/api/demandas/:id/avancar` | próxima etapa do fluxo |
| POST | `/api/demandas/:id/historico` | registra andamento |
| DELETE | `/api/demandas/:id` · `/api/demandas` | exclui uma · apaga todas |
| GET/POST | `/api/demandas/:id/anexos` | lista (metadados) · anexa imagem em base64 |
| GET | `/api/anexos/:id/arquivo` | devolve a imagem decodificada (use no `src` da `<img>`) |
| DELETE | `/api/anexos/:id` | remove a imagem |
| GET | `/api/projetos` | projetos do escopo, com filtros |
| GET | `/api/projetos/selecao` | lista enxuta para o campo "Projeto" da OD |
| GET | `/api/projetos/:id` | perfil: ficha + passos + documentos + histórico + OD |
| POST/PUT | `/api/projetos[/:id]` | cadastra · edita |
| PATCH | `/api/projetos/:id/situacao` | muda a situação |
| POST | `/api/projetos/:id/avancar` | próxima etapa (só conclui com todos os passos feitos) |
| POST | `/api/projetos/:id/historico` | registra andamento |
| DELETE | `/api/projetos/:id` | exclui (as OD ficam, sem o vínculo) |
| GET/POST | `/api/projetos/:id/etapas` | passos de execução |
| PUT/DELETE | `/api/etapas/:id` | edita · remove o passo |
| PATCH | `/api/etapas/:id/situacao` | conclui ou reabre o passo |
| POST | `/api/etapas/:id/mover` | sobe ou desce na ordem (`{ direcao }`) |
| GET | `/api/documentos/:id/requisitos` | prévia: requisitos lidos daquele documento |
| POST | `/api/projetos/:id/requisitos/previa` | mesma prévia, de um texto colado |
| POST | `/api/projetos/:id/etapas/importar` | grava como passos os requisitos escolhidos |
| GET/POST | `/api/projetos/:id/documentos` | documentos (o de requisitos entre eles) |
| GET | `/api/documentos/:id/arquivo` | abre (ou baixa, com `?download=1`) |
| DELETE | `/api/documentos/:id` | remove o documento |
| GET/POST/PUT/DELETE | `/api/listas[/:tipo[/:id]]` | listas auxiliares |
| GET | `/api/painel` | indicadores da tela inicial |
| GET | `/api/analise?meses=6&sistema=&situacao=&prioridade=&responsavel=` | indicadores e séries do recorte |
| GET | `/api/analise/projetos?meses=6&sistema=&responsavel=` | área de projetos da aba Análise |
| GET/PUT | `/api/config` | nome do órgão e prefixo da numeração |
| GET | `/api/backup` | exporta tudo em JSON |
| POST | `/api/exemplos` | recarrega as demandas de teste |
| GET | `/api/eu` · POST `/api/eu/senha` | usuário da sessão · troca da própria senha |
| GET/POST/PUT/DELETE | `/api/empresas[/:id]` | empresas e seus portais (administrador) |
| GET/POST/PUT/DELETE | `/api/usuarios[/:id]` | contas de acesso (admin ou gestor) |
| GET | `/api/perfis` | perfis do escopo + catálogo de permissões |
| GET | `/api/perfis/atribuiveis?empresaId=` | perfis que podem ser dados a uma conta |
| POST/PUT/DELETE | `/api/perfis[/:id]` | mantém os perfis de acesso |
| GET | `/api/usuarios/sistemas` | sistemas atribuíveis a uma conta |

Sob um portal, as mesmas rotas existem com o prefixo do slug —
`/p/barbearia-do-ze/api/demandas` — e aí o recorte vale até para o administrador.

## Telas

- **Painel** — total, abertas, em andamento, urgentes e concluídas no mês, com as
  demandas recentes e a distribuição por situação e por sistema.
- **Demandas** — busca, quatro filtros, ordenação por coluna e paginação (feitas no banco).
- **Tipo de ação** — categoria da demanda (`od.tipos_acao`), com um catálogo de 11 problemas
  genéricos de sistema já cadastrado (erro, lentidão, dado incorreto, falha de integração,
  acesso, relatório, melhoria, nova funcionalidade, configuração, dúvida e manutenção).
  Os tipos sem empresa valem para todos os portais; cada empresa pode criar os seus.
  Vira filtro na listagem e na Análise, além de um gráfico próprio.
- **Nova OD** — numeração automática `OD-AAAA-NNNN`; solicitante e sistema vêm das listas;
  imagens podem ser arrastadas para o formulário e sobem junto com a OD.
- **Detalhe da OD** (`#od/12` abre direto) — ficha, galeria de imagens, andamentos e histórico.
- **Projetos** — cartões com o progresso de cada projeto (passos concluídos, documentos e OD
  ligadas), com os mesmos filtros da listagem de demandas.
- **Novo projeto** — nome, objetivo, sistema, responsável, prazos, os **passos** já na ordem de
  execução (uma linha por passo, com + para acrescentar) e o **documento de requisitos**, que
  pode ser arrastado para o formulário. O código sai automático: `PRJ-AAAA-NNNN`.
- **Perfil do projeto** (`#projeto/7`) — a tela onde o projeto acontece:
  - indicadores de progresso, documentos, OD ligadas e entrega prevista;
  - **documento de requisitos** — área para arrastar o arquivo, com abrir/baixar/remover, mais
    uma lista separada para documentos de apoio (PDF, DOC/DOCX, ODT, RTF, TXT, MD, CSV,
    planilhas, apresentações, imagens ou ZIP — até 6 MB cada, 12 por projeto);
  - **importação automática** — ao anexar o documento de requisitos, o sistema lê o arquivo e
    já propõe um passo para cada requisito encontrado (veja abaixo);
  - **passos para o projeto acontecer** — lista numerada que dá para concluir num clique (✓),
    reordenar (▲▼), editar (responsável, prazo, detalhe e situação) e remover. O progresso do
    projeto é a fração de passos concluídos;
  - ficha, demandas vinculadas (clicam direto na OD) e histórico com registro de andamento.
- **Análise** — barra de filtros (período, sistema, situação, prioridade, responsável) que
  recalcula **todos** os indicadores e gráficos no banco; clicar numa barra ou fatia liga/desliga
  o filtro correspondente. Gráficos de aberturas × conclusões, situação, prioridade, sistemas e
  carga por responsável, uma **área de Projetos** (abaixo) e o quadro kanban — tudo seguindo
  os mesmos filtros.
  O recorte fica no endereço — `#analise?sistema=Portal%20Web&situacao=aberta` abre a visão pronta.
- **Análise › Projetos** — como andam os projetos do mesmo recorte: indicadores (ativos,
  progresso médio, atrasados, quantos já têm o documento de requisitos e quantas OD saíram
  deles), a distribuição por situação, os passos de execução por situação e a lista de
  **andamento de cada projeto** — barra de progresso, passos concluídos, OD ligadas e selo de
  atraso — que abre o perfil num clique. Ali valem só o **período**, o **sistema** e o
  **responsável**: situação, prioridade e tipo de ação são filtros da demanda, não do projeto.
  A janela de período conta os projetos abertos nela **mais** todos os que continuam em aberto,
  para que um projeto antigo ainda rodando não suma do acompanhamento.
### Do documento de requisitos para os passos

Anexou o documento de requisitos? O sistema lê o arquivo, monta a lista de requisitos e
abre uma conferência com tudo marcado — você desmarca o que não for passo e confirma.
Também dá para disparar depois, pelo ⚡ de qualquer documento, ou colar o texto direto
(**📋 Colar requisitos**), útil quando o PDF é digitalizado.

| O que ele lê | Como reconhece um requisito |
|---|---|
| DOCX, ODT, ODP, PPTX, XLSX, ODS | parágrafos e células (são ZIP com XML dentro) |
| PDF | texto dos fluxos de conteúdo; PDF de imagem avisa que não dá e sugere colar |
| TXT, MD, CSV, RTF, HTML, XML | direto do arquivo |

Reconhece código de requisito (`RF01`, `RNF-2`, `US 3`), lista numerada (`1.`, `1.2`), letra
(`a)`), marcador (`-`, `•`, `*`) e título markdown. Quando o documento tem uma seção de
requisitos (*Requisitos*, *Escopo*, *Funcionalidades*, *Histórias de usuário*...), lê só ela —
sumário, glossário, referências e cabeçalho de página ficam de fora. Linha quebrada no meio
emenda no requisito anterior; requisito comprido vira título curto com o texto inteiro no
detalhe do passo. Planilha e CSV entram como tabela: uma linha por requisito. Não havendo
marcação nenhuma, cada linha vira um item — e a conferência avisa que foi assim.

Os passos entram no fim da lista, na ordem do documento, e o histórico registra de onde vieram.

A OD ganhou um campo opcional **Projeto**: a demanda aberta a partir de um projeto aparece
  no perfil dele, e o detalhe da OD traz o link de volta.
- **Configurações** — **Empresas e sistemas** (cadastro da empresa, que gera o portal e o link
  para o cliente, com os sistemas dele cadastrados ali mesmo — um campo por sistema, com + para
  acrescentar quantos precisar, e mais outros depois pelo cartão da empresa; o ✎ do cartão permite editar nome, endereço do portal, documento e contato), **Usuários**, **Catálogos** (solicitantes, responsáveis e tipos
  de ação), identificação e área de dados. O que aparece depende do perfil.

### Desativar é a trava; excluir vem depois

A regra vale para itens das listas auxiliares e para empresas:

1. **Enquanto está ativo, não se exclui.** O botão ⏸ **desativa**: o item some dos
   formulários (ou o portal para de aceitar acesso), mas nada é apagado e dá para
   reativar (▶) a qualquer momento.
2. **Depois de desativado, a exclusão fica liberada** — inclusive quando ainda há demandas
   vinculadas. Nesse caso ela é **em cascata**: apaga as demandas, o histórico e as imagens
   delas. O diálogo informa exatamente quanto será perdido e o servidor só executa com a
   confirmação explícita (`?cascata=1`).

Excluir uma empresa desativada leva junto demandas, contas de acesso e os sistemas dela
(solicitantes e responsáveis não pertencem a empresa nenhuma).
Não é possível desativar o último item ativo de uma lista, senão não daria para abrir
demandas; e o sistema fixo "Não — demanda nova" nunca é desativado nem excluído.

O banco (schema `od`), os gatilhos e as visões estão documentados em [db/README.md](db/README.md).
