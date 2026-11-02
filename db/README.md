# Banco de dados — OD (Ordem de Demandas)

Tudo fica no schema **`od`** do banco `projeto-barbearia`, isolado de outros projetos.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `01_schema.sql` | Cria tipos, tabelas, índices, gatilhos e visões. Pode rodar novamente sem quebrar. |
| `02_seed.sql` | Dados de teste. **Apaga e recria** as demandas (`truncate`); as listas auxiliares são preservadas. |
| `03_configuracao.sql` | Configurações (nome do órgão, prefixo) e o gatilho de numeração que as usa. |
| `05_multiempresa.sql` | Empresas, usuários, sessões e o vínculo das demandas com a empresa. |
| `06_usuario_sistema.sql` | Restrição opcional de quais sistemas cada conta enxerga. |
| `07_tipo_acao.sql` | Catálogo de tipos de ação (problemas genéricos) e o vínculo com a demanda. |
| `04_anexos.sql` | Tabela de imagens anexadas (base64) e a visão `od.vw_anexos`. |
| `08_projetos.sql` | Projetos, passos de execução, documentos (requisitos) e o vínculo da OD. |
| `09_catalogos_universais.sql` | Unifica solicitantes e responsáveis num catálogo único do sistema. |
| `10_permissoes.sql` | Perfis de acesso, catálogo de permissões e o vínculo com a conta. |
| `11_requisitos.sql` | Separa, nos itens do projeto, o que é requisito do documento e o que é passo de desenvolvimento. |
| `12_atividades.sql` | Atividades do projeto: itens fora dos passos, que não entram no progresso. |
| `13_unifica_atividades.sql` | Passos e atividades viram uma coisa só; os itens de tipo atividade voltam a passo. |
| `14_usuarios_como_listas.sql` | Solicitantes e responsáveis passam a vir das contas de usuário (gatilho em od.usuario). |
| `backup-od.json` | Cópia dos dados em JSON (gerada por `GET /api/backup`). |

## Como aplicar

```bash
npm run db:reset     # estrutura + configuração + dados de teste
```

Ou direto, na ordem: `01_schema.sql`, `03_configuracao.sql`, `04_anexos.sql`,
`05_multiempresa.sql`, `06_usuario_sistema.sql`, `07_tipo_acao.sql`, `08_projetos.sql`,
`02_seed.sql`. Todos são idempotentes — aplicar de novo não quebra nada.

Para consultar sem escrever `od.` toda hora: `set search_path to od, public;`

## Estrutura

```
od.sistemas          (id, nome, fixo, ativo, empresa_id)   sistemas de cada cliente
od.solicitantes      (id, nome, ativo)                universal: empresa_id sempre nulo
od.responsaveis      (id, nome, ativo)                universal: empresa_id sempre nulo
od.numeracao         (ano, ultimo)                    controla a sequência OD-AAAA-NNNN
od.demandas          (id, numero, titulo, descricao, solicitante_id, sistema_id,
                      responsavel_id, prioridade, situacao, criada_em,
                      atualizada_em, concluida_em)
od.demanda_historico (id, demanda_id, registrado_em, autor, texto)
od.demanda_anexo     (id, demanda_id, nome, tipo, tamanho, largura, altura,
                      dados, criado_em)      imagem em base64 na coluna dados
od.configuracao      (chave, valor)          nome do órgão e prefixo da numeração
od.empresa           (id, nome, slug, documento, contato, ativo)   portal em /p/<slug>
od.usuario           (id, empresa_id, nome, email, senha_hash, perfil, ativo)
                     empresa_id nulo = administrador do sistema principal
od.sessao            (token, usuario_id, expira_em)                cookie httpOnly, 7 dias
od.usuario_sistema   (usuario_id, sistema_id)     vazio = a conta vê todos os sistemas
od.permissao         (chave, grupo, nome, descricao, ordem, exige_admin)
                     catálogo do que existe para permitir
od.perfil_acesso     (id, nome, descricao, base, empresa_id, sistema, ativo)
                     empresa_id nulo = vale em todos os portais · sistema = de fábrica
od.perfil_permissao  (perfil_id, permissao)        o que cada perfil libera
od.usuario.perfil_id                               qual perfil a conta usa
od.tipos_acao        (id, nome, descricao, ordem, empresa_id, ativo)
                     empresa_id nulo = tipo disponível em todos os portais
od.projeto           (id, codigo, nome, objetivo, empresa_id, sistema_id, solicitante_id,
                      responsavel_id, situacao, prioridade, inicio_previsto, fim_previsto,
                      criado_em, atualizado_em, concluido_em)      código PRJ-AAAA-NNNN
od.projeto_etapa     (id, projeto_id, ordem, titulo, descricao, responsavel_id, prazo,
                      situacao, concluida_em)   os passos, na ordem de execução
od.projeto_anexo     (id, projeto_id, categoria, nome, tipo, tamanho, dados, enviado_por)
                     categoria: requisitos | apoio · conteúdo em base64 na coluna dados
od.projeto_historico (id, projeto_id, registrado_em, autor, texto)
od.numeracao_projeto (ano, ultimo)              sequência do código do projeto
od.demandas.projeto_id                          OD aberta dentro de um projeto (opcional)
```

`situacao` do projeto: `planejamento · andamento · pausado · concluido · cancelado`
`situacao` do passo:   `pendente · andamento · concluida · bloqueada`

`situacao`: `aberta · andamento · aguardando · concluida · cancelada`
`prioridade`: `baixa · media · alta · urgente`
`perfil`: `admin · gestor · operador · leitor` — é a **base de escopo**, mantida em dia pelo
gatilho `tg_usuario_perfil` a partir de `od.perfil_acesso.base`. O que a conta pode fazer vem
de `od.perfil_permissao`; `tg_perfil_permissao` recusa permissão `exige_admin` em perfil que
não seja de administrador.

**Partição por empresa**: `demandas.empresa_id` nulo = demanda interna (só o administrador
vê); preenchido = aparece no portal daquela empresa. As listas auxiliares seguem a mesma
coluna — dentro de um portal aparecem só os itens da própria empresa, mais o sistema fixo
"Não — demanda nova".

### Automatismos (gatilhos)

- **Numeração**: ao inserir sem `numero`, gera `OD-<ano da criação>-<sequencial>`.
- **Conclusão**: `concluida_em` é preenchida ao marcar `concluida` e zerada ao reabrir —
  a constraint `chk_conclusao` garante que os dois campos nunca se contradigam.
- **Histórico**: a abertura e toda mudança de situação viram registro em `od.demanda_historico`.
- **`atualizada_em`** é atualizada a cada `update`.

### Visões

| Visão | Serve para |
|---|---|
| `od.vw_demandas` | Demandas com os nomes já resolvidos + dias em aberto / até a conclusão. |
| `od.vw_indicadores` | Os KPIs da aba Análise (total, em aberto, taxa de conclusão, tempo médio). |
| `od.vw_serie_mensal` | Aberturas × conclusões dos últimos 12 meses, pronto para o gráfico. |
| `od.vw_anexos` | Imagens com número da OD e tamanho, **sem** a coluna base64. |
| `od.vw_projetos` | Projeto com nomes resolvidos, progresso dos passos, documentos e OD ligadas. |
| `od.vw_projeto_anexos` | Documentos do projeto com o código dele, **sem** a coluna base64. |
| `od.vw_perfis` | Perfil com a empresa resolvida, quantas permissões e quantas contas usam. |

## Consultas rápidas

```sql
select * from od.vw_indicadores;
select * from od.vw_serie_mensal;
select numero, titulo, sistema, responsavel, situacao, dias_em_aberto
  from od.vw_demandas where situacao <> 'concluida' order by dias_em_aberto desc;

-- abrir uma demanda (o número sai sozinho)
insert into od.demandas (titulo, descricao, solicitante_id, sistema_id, responsavel_id, prioridade)
values ('Título da demanda', 'Descrição detalhada do problema.',
        (select id from od.solicitantes where nome = 'Cliente'),
        (select id from od.sistemas     where nome = 'Portal Web'),
        (select id from od.responsaveis where nome = 'Ana Paula Torres'), 'alta');
```

> As imagens ficam em `od.demanda_anexo.dados` como base64. Para não pesar as consultas,
> nenhuma listagem seleciona essa coluna: a tela usa `GET /api/anexos/:id/arquivo`, que
> decodifica e devolve o binário com o `Content-Type` correto.
