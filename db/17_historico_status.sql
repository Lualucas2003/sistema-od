-- =====================================================================
--  OD — histórico do status escrito do projeto
--
--  Cada "Salvar status" vira um registro em od.projeto_status (o que
--  aconteceu por último + o próximo passo, com data e autor). As colunas
--  da 16 em od.projeto continuam guardando o status atual, que é o que a
--  tabela de projetos mostra.
--  O status atual de cada projeto (se houver) entra como primeiro registro.
--  Idempotente: pode rodar de novo sem quebrar nem duplicar.
-- =====================================================================

create table if not exists od.projeto_status (
  id                 bigserial primary key,
  projeto_id         bigint not null references od.projeto (id) on delete cascade,
  ultima_atualizacao text,
  proximo_passo      text,
  autor              text,
  registrado_em      timestamptz not null default now()
);
comment on table od.projeto_status is
  'Histórico do status escrito do projeto: um registro a cada vez que o status é salvo.';

create index if not exists ix_projeto_status on od.projeto_status (projeto_id, registrado_em desc);

-- o status que já estava salvo vira o primeiro card do histórico
insert into od.projeto_status (projeto_id, ultima_atualizacao, proximo_passo, autor, registrado_em)
select p.id, p.ultima_atualizacao, p.proximo_passo, p.status_autor, p.status_em
  from od.projeto p
 where p.status_em is not null
   and not exists (select 1 from od.projeto_status s where s.projeto_id = p.id);
