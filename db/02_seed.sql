-- =====================================================================
--  OD — Ordem de Demandas | dados de teste
--  Re-executável: limpa apenas as demandas e recria o conjunto.
--  As datas são relativas a now(), então o gráfico mensal sempre tem série.
-- =====================================================================

begin;

truncate od.demanda_historico, od.demandas restart identity;
delete from od.numeracao;

-- ---------- Listas auxiliares ----------
insert into od.sistemas (nome, fixo) values
  ('Não se aplica', true),
  ('Sistema Financeiro', false),
  ('Portal Web', false),
  ('Aplicativo Mobile', false),
  ('Intranet', false),
  ('API / Integração', false),
  ('Sistema de Agendamento', false)
on conflict do nothing;

insert into od.solicitantes (nome) values
  ('Cliente'), ('Equipe interna'), ('Diretoria'), ('Suporte'), ('Comercial'), ('Financeiro')
on conflict do nothing;

insert into od.responsaveis (nome) values
  ('Não atribuído'), ('Ana Paula Torres'), ('Luan Oliveira'),
  ('Marcos Reis'), ('Beatriz Nunes'), ('Rafael Campos')
on conflict do nothing;

-- ---------- Demandas ----------
insert into od.demandas
  (titulo, descricao, solicitante_id, sistema_id, responsavel_id, prioridade, situacao, criada_em, concluida_em)
select v.titulo, v.descricao,
       (select id from od.solicitantes where nome = v.solicitante),
       (select id from od.sistemas     where nome = v.sistema),
       (select id from od.responsaveis where nome = v.responsavel),
       v.prioridade::od.prioridade,
       v.situacao::od.situacao,
       now() - (v.dias_atras || ' days')::interval,
       case when v.situacao = 'concluida'
            then now() - ((v.dias_atras - v.dias_ate) || ' days')::interval end
from (values
-- titulo | descricao | solicitante | sistema | responsavel | prioridade | situacao | dias_atras | dias_ate
 ('Erro 500 ao emitir boleto no fechamento','Na emissão dos boletos do dia 30 o sistema retorna erro 500 e não grava o registro. Ocorre apenas no lote acima de 200 títulos.','Cliente','Sistema Financeiro','Ana Paula Torres','urgente','andamento',9,0),
 ('Lentidão no login do portal','Usuários relatam mais de 20 segundos para autenticar entre 8h e 10h. Fora do pico o login leva 2 segundos.','Suporte','Portal Web','Luan Oliveira','alta','aberta',5,0),
 ('Push de notificações não chega no Android','Notificações funcionam no iOS, mas não são entregues em aparelhos com Android 13 ou superior.','Suporte','Aplicativo Mobile','Marcos Reis','alta','aguardando',14,0),
 ('Nova tela de relatórios gerenciais','Criar painel com indicadores mensais consolidados por unidade, com exportação em PDF.','Diretoria','Não se aplica','Beatriz Nunes','media','andamento',22,0),
 ('Integração com o novo gateway de pagamento','Implementar consumo da API de cobrança do parceiro já homologado, incluindo retentativa automática.','Equipe interna','API / Integração','Luan Oliveira','alta','andamento',18,0),
 ('Exportação de contatos com acentuação quebrada','O CSV exportado pela intranet vem com caracteres trocados ao abrir no Excel.','Equipe interna','Intranet','Rafael Campos','baixa','concluida',40,6),
 ('Agenda permite dois agendamentos no mesmo horário','Em concorrência, dois clientes conseguem reservar o mesmo profissional no mesmo horário.','Cliente','Sistema de Agendamento','Ana Paula Torres','urgente','concluida',52,9),
 ('Recuperação de senha não envia e-mail','O e-mail de redefinição não chega para domínios corporativos; provável bloqueio de SPF.','Suporte','Portal Web','Marcos Reis','alta','concluida',61,4),
 ('Incluir centro de custo no relatório de despesas','O relatório mensal consolidado precisa quebrar os valores por centro de custo.','Financeiro','Sistema Financeiro','Beatriz Nunes','media','concluida',73,12),
 ('Erro de arredondamento no cálculo de comissão','Comissões de 3,5% apresentam diferença de centavos em relação à planilha do comercial.','Comercial','Sistema Financeiro','Rafael Campos','alta','andamento',12,0),
 ('Cadastro de cliente sem validação de CPF','É possível salvar cliente com CPF inválido; incluir validação no formulário e na API.','Equipe interna','Portal Web','Luan Oliveira','media','aberta',7,0),
 ('Aplicativo trava ao abrir a câmera','Ao anexar foto no atendimento, o app fecha sozinho em aparelhos com pouca memória.','Suporte','Aplicativo Mobile','Marcos Reis','alta','aguardando',26,0),
 ('Migrar autenticação para SSO','Unificar o acesso da intranet com a conta corporativa via SSO.','Diretoria','Intranet','Ana Paula Torres','media','aberta',3,0),
 ('Webhook de confirmação duplicando eventos','O parceiro envia o mesmo evento até três vezes; falta idempotência no consumo.','Equipe interna','API / Integração','Luan Oliveira','urgente','andamento',16,0),
 ('Bloquear agendamento em feriado','A agenda precisa considerar o calendário de feriados por unidade.','Cliente','Sistema de Agendamento','Beatriz Nunes','media','aberta',11,0),
 ('Relatório de faturamento não confere com o extrato','Diferença de R$ 1.240,00 no fechamento de agosto entre relatório e extrato bancário.','Financeiro','Sistema Financeiro','Rafael Campos','urgente','aguardando',20,0),
 ('Melhorar contraste da interface do portal','Textos cinza sobre fundo claro reprovam em acessibilidade; ajustar paleta.','Suporte','Portal Web','Beatriz Nunes','baixa','concluida',88,15),
 ('Histórico de atendimento não carrega no app','A aba de histórico fica em branco para clientes com mais de 200 atendimentos.','Cliente','Aplicativo Mobile','Marcos Reis','alta','concluida',95,7),
 ('Criar rotina de backup automático','Agendar backup diário do banco com retenção de 30 dias e alerta em caso de falha.','Equipe interna','Não se aplica','Luan Oliveira','alta','concluida',104,11),
 ('Filtro por período no painel da intranet','Adicionar seleção de intervalo de datas nos indicadores da intranet.','Diretoria','Intranet','Beatriz Nunes','baixa','aberta',30,0),
 ('Timeout na consulta de disponibilidade','A chamada de disponibilidade estoura 30s quando a unidade tem muitos profissionais.','Equipe interna','API / Integração','Ana Paula Torres','alta','andamento',33,0),
 ('Permitir reagendamento pelo cliente','O cliente deve conseguir remarcar o horário até 4 horas antes do atendimento.','Cliente','Sistema de Agendamento','Marcos Reis','media','aberta',24,0),
 ('Nota fiscal emitida com endereço antigo','Após atualização cadastral, a NF continua saindo com o endereço anterior.','Financeiro','Sistema Financeiro','Rafael Campos','alta','concluida',120,9),
 ('Campo de busca ignora acentos','Buscar por "joao" não encontra "João"; normalizar acentuação na consulta.','Suporte','Portal Web','Luan Oliveira','baixa','concluida',131,5),
 ('Padronizar mensagens de erro da API','Respostas de erro seguem formatos diferentes conforme o endpoint.','Equipe interna','API / Integração','Ana Paula Torres','media','cancelada',66,0),
 ('Trocar provedor de SMS','Avaliar a substituição do provedor atual por custo e taxa de entrega.','Diretoria','Não se aplica','Não atribuído','baixa','cancelada',47,0),
 ('Duplicidade de cliente no cadastro','Mesmo cliente aparece duas vezes quando cadastrado pelo app e pelo portal.','Suporte','Aplicativo Mobile','Beatriz Nunes','media','aguardando',38,0),
 ('Painel de metas do comercial','Criar acompanhamento de metas por vendedor com atualização diária.','Comercial','Não se aplica','Não atribuído','media','aberta',2,0),
 ('Exportar agenda para o Google Calendar','Sincronizar os agendamentos confirmados com a agenda do profissional.','Cliente','Sistema de Agendamento','Luan Oliveira','baixa','aberta',44,0),
 ('Log de auditoria de alterações cadastrais','Registrar quem alterou dados sensíveis de cliente, com data e valor anterior.','Diretoria','Intranet','Ana Paula Torres','alta','andamento',57,0),
 ('Corrigir fuso horário nos relatórios','Atendimentos após as 21h aparecem no dia seguinte por conversão errada de fuso.','Financeiro','Sistema Financeiro','Marcos Reis','alta','concluida',150,8),
 ('Reduzir tamanho do app na loja','O pacote passou de 90 MB; remover recursos não utilizados.','Equipe interna','Aplicativo Mobile','Rafael Campos','baixa','concluida',163,21)
) as v(titulo, descricao, solicitante, sistema, responsavel, prioridade, situacao, dias_atras, dias_ate);

-- ---------- Andamentos extras no histórico ----------
insert into od.demanda_historico (demanda_id, registrado_em, autor, texto)
select d.id, d.criada_em + interval '1 day', h.autor, h.texto
from (values
 ('Erro 500 ao emitir boleto no fechamento','Ana Paula Torres','Log analisado: estouro de timeout no serviço de cobrança acima de 200 títulos.'),
 ('Lentidão no login do portal','Luan Oliveira','Identificado gargalo na consulta de permissões; índice em avaliação.'),
 ('Push de notificações não chega no Android','Marcos Reis','Aguardando retorno do fornecedor sobre a mudança de política do Android 13.'),
 ('Integração com o novo gateway de pagamento','Luan Oliveira','Ambiente de homologação liberado pelo parceiro.'),
 ('Webhook de confirmação duplicando eventos','Ana Paula Torres','Chave de idempotência definida; implementação em andamento.'),
 ('Relatório de faturamento não confere com o extrato','Rafael Campos','Solicitado extrato detalhado ao banco para conciliação.')
) as h(titulo, autor, texto)
join od.demandas d on d.titulo = h.titulo;

-- Encerramento registrado nas demandas concluídas.
insert into od.demanda_historico (demanda_id, registrado_em, autor, texto)
select d.id, d.concluida_em, coalesce(r.nome, 'Equipe'), 'Demanda concluída e validada com o solicitante.'
from od.demandas d
left join od.responsaveis r on r.id = d.responsavel_id
where d.situacao = 'concluida';

commit;
