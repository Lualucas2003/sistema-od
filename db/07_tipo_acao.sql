-- =====================================================================
--  OD — tipo de ação (categoria da demanda)
--
--  Lista de problemas genéricos de sistema, para classificar a OD além da
--  prioridade e do sistema. Os tipos com empresa_id nulo são compartilhados
--  (valem em todos os portais); uma empresa pode criar os seus próprios.
-- =====================================================================

create table if not exists od.tipos_acao (
  id         serial primary key,
  nome       text not null,
  descricao  text,
  ordem      integer not null default 100,
  empresa_id integer references od.empresa (id) on delete cascade,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create unique index if not exists ux_tipos_acao_nome
  on od.tipos_acao (coalesce(empresa_id, 0), lower(nome));
create index if not exists ix_tipos_acao_empresa on od.tipos_acao (empresa_id);

comment on table od.tipos_acao is
  'Categoria da demanda: que tipo de problema ou pedido é. empresa_id nulo = disponível para todos.';

alter table od.demandas add column if not exists tipo_acao_id integer
  references od.tipos_acao (id) on delete set null;
create index if not exists ix_demandas_tipo_acao on od.demandas (tipo_acao_id);

-- ---------- Catálogo inicial de problemas genéricos de sistema ----------
insert into od.tipos_acao (nome, descricao, ordem) values
  ('Erro / falha no sistema',    'Algo deixou de funcionar ou apresenta mensagem de erro.',          10),
  ('Lentidão ou travamento',     'O sistema responde devagar, congela ou cai.',                      20),
  ('Dado incorreto',             'Informação gravada, calculada ou exibida de forma errada.',        30),
  ('Falha de integração',        'Comunicação com outro sistema ou serviço não funciona.',           40),
  ('Acesso ou permissão',        'Login, bloqueio de conta ou permissão indevida.',                  50),
  ('Relatório ou exportação',    'Relatório não gera, sai incompleto ou com número divergente.',     60),
  ('Melhoria / ajuste',          'O sistema funciona, mas precisa de um ajuste no comportamento.',   70),
  ('Nova funcionalidade',        'Recurso que ainda não existe e precisa ser desenvolvido.',         80),
  ('Configuração / cadastro',    'Parametrização, cadastro de dados ou ajuste de configuração.',     90),
  ('Dúvida / orientação',        'Pedido de explicação sobre como usar o sistema.',                 100),
  ('Manutenção programada',      'Atualização, backup, migração ou tarefa planejada.',              110)
on conflict do nothing;

-- Visão com o tipo já resolvido
drop view if exists od.vw_demandas;
create view od.vw_demandas as
select d.id,
       d.numero,
       d.titulo,
       d.descricao,
       e.nome  as empresa,
       d.empresa_id,
       so.nome as solicitante,
       si.nome as sistema,
       ta.nome as tipo_acao,
       coalesce(re.nome, 'Não atribuído') as responsavel,
       d.prioridade,
       d.situacao,
       d.criada_em,
       d.concluida_em,
       (current_date - d.criada_em::date)                       as dias_em_aberto,
       case when d.concluida_em is not null
            then (d.concluida_em::date - d.criada_em::date) end as dias_ate_conclusao
from od.demandas d
join od.solicitantes so on so.id = d.solicitante_id
join od.sistemas     si on si.id = d.sistema_id
left join od.tipos_acao  ta on ta.id = d.tipo_acao_id
left join od.responsaveis re on re.id = d.responsavel_id
left join od.empresa e on e.id = d.empresa_id;
