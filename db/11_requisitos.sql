-- =====================================================================
--  OD — requisitos x passos de desenvolvimento
--
--  Os itens do projeto (od.projeto_etapa) passam a ter um tipo:
--    requisito  o que foi combinado no documento (RF01, RNF02...)
--    passo      tarefa de desenvolvimento para o projeto acontecer
--  Os dois continuam contando no progresso do projeto.
--  Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

alter table od.projeto_etapa
  add column if not exists tipo text not null default 'passo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_projeto_etapa_tipo') then
    alter table od.projeto_etapa
      add constraint chk_projeto_etapa_tipo check (tipo in ('requisito', 'passo'));
  end if;
end $$;

-- o que já foi importado do documento com código (RF01 — ..., RNF02 — ...) é requisito
update od.projeto_etapa
   set tipo = 'requisito'
 where tipo = 'passo'
   and titulo ~ '^(RF|RNF|REQ|US|HU)-?[0-9]+(\.[0-9]+)* — ';

comment on column od.projeto_etapa.tipo is
  'requisito = item do documento de requisitos · passo = tarefa de desenvolvimento';
