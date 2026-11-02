# Teste de ponta a ponta — OD

```bash
npm run testar
```

O script [scripts/testar-sistema.js](scripts/testar-sistema.js) confere os processos do sistema
pela API, do mesmo jeito que a tela usa. Ele:

1. sobe uma cópia do servidor na porta `3999` (troque com `TESTE_PORTA=...`), sem afetar o
   servidor que já estiver rodando na 3000;
2. cria um administrador temporário (`...@od-teste.invalid`);
3. cadastra três empresas marcadas com `[TESTE xxxx]`, cada uma com sistemas diferentes;
4. percorre os processos abaixo;
5. **apaga tudo o que criou no final**, mesmo que algum passo falhe.

A saída mostra ✔/✘ por verificação e um resumo no fim. Se alguma verificação falhar, o
script termina com código 1.

## O que é verificado

| Área | Verificações |
|---|---|
| **Login** | redirecionamento sem sessão, 401 na API, senha errada recusada, login do administrador, página principal |
| **Leituras gerais** | listas, configuração, painel, análise, projetos, empresas, perfis, usuários, backup |
| **Empresas** | cadastro com 1, 2 e 3 sistemas + gestor; geração do endereço do portal; recusa de nome repetido, e-mail inválido, senha curta e nome vazio; inclusão de sistema; recusa de sistema repetido na mesma empresa; mesmo nome de sistema aceito em outra empresa; edição do contato |
| **Portais** | tela de login com o nome da empresa, login do gestor, só os sistemas da própria empresa, gestor recusado no portal de outra empresa, administrador acessa qualquer portal, portal inexistente responde 404 |
| **Demandas** (em cada empresa) | validação, criação em cada sistema, detalhe, edição, aberta → andamento → aguardando → concluída, histórico, data de conclusão, imagem PNG (envio, recusa de outro formato, download), listagem, busca, filtro, painel e análise do portal |
| **Isolamento** | a empresa A não vê, não edita e não exclui OD da B; não usa sistema da B; não abre imagem da B; sessão de A recusada na API de B; gestor sem acesso a empresas, ao catálogo universal e ao "apagar tudo"; administrador vê tudo, e só o recorte da empresa quando está no portal dela |
| **Contas e permissões** | gestor cria operador e leitor; operador restrito a um sistema; gestor não cria administrador; leitor só consulta; operador cria mas não exclui; restrito não vê nem usa outro sistema; conta desativada não entra; gestor B não mexe em conta de A |
| **Projetos** | criação com passos, datas inválidas, sistema de outra empresa, perfil, isolamento, acréscimo e reordenação de passos, bloqueio de conclusão com passos pendentes, documento de requisitos (envio, formato recusado, leitura, download, importação como passos), prévia de texto colado, remoção de passo, conclusão, OD vinculada (e recusa de vínculo por outra empresa), exclusão do projeto mantendo a OD |
| **Exclusões** | exclusão de demanda; empresa ativa com OD não é excluída; desativação derruba o portal; exclusão pede confirmação em cascata; nada da empresa fica no banco |

## Último resultado

16/09/2026 — **181 de 181 verificações passaram**. O banco ficou limpo depois do teste.

## Atenção: numeração

O teste roda no banco configurado no `.env`. As OD e os projetos criados por ele **consomem
números da sequência** (`od.numeracao` e `od.numeracao_projeto`). Os registros de teste são
apagados, mas os números não voltam: depois de uma rodada, a próxima OD real pula alguns
números. Se isso for um problema, rode o teste num banco separado (outro `DATABASE_URL`).
