-- =====================================================================
--  OD — passos e atividades viram uma coisa só: atividades
--
--  Antes havia dois tipos (passo e atividade). Agora são o mesmo item:
--  tudo o que não é requisito é uma atividade e conta no progresso.
--  Os itens marcados como 'atividade' (12_atividades.sql) viram 'passo'.
--  Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

update od.projeto_etapa set tipo = 'passo' where tipo = 'atividade';

alter table od.projeto_etapa drop constraint if exists chk_projeto_etapa_tipo;
alter table od.projeto_etapa
  add constraint chk_projeto_etapa_tipo check (tipo in ('requisito', 'passo'));

comment on column od.projeto_etapa.tipo is
  'requisito = item do documento de requisitos · passo = atividade do projeto (conta no progresso)';

-- Volta a contar todos os itens que não são requisito (mesma visão da 08).
create or replace view od.vw_projetos as
select p.id,
       p.codigo,
       p.nome,
       p.objetivo,
       p.empresa_id,
       e.nome  as empresa,
       p.sistema_id,
       si.nome as sistema,
       p.solicitante_id,
       so.nome as solicitante,
       p.responsavel_id,
       coalesce(re.nome, 'Não atribuído') as responsavel,
       p.situacao,
       p.prioridade,
       p.inicio_previsto,
       p.fim_previsto,
       p.criado_em,
       p.atualizado_em,
       p.concluido_em,
       et.etapas,
       et.etapas_concluidas,
       coalesce(round(100.0 * et.etapas_concluidas / nullif(et.etapas, 0))::int, 0) as progresso,
       ax.documentos,
       ax.tem_requisitos,
       (select count(*)::int from od.demandas d where d.projeto_id = p.id) as demandas,
       case when p.fim_previsto is not null and p.situacao not in ('concluido','cancelado')
            then (p.fim_previsto - current_date) end as dias_para_prazo
  from od.projeto p
  left join od.empresa      e  on e.id  = p.empresa_id
  left join od.sistemas     si on si.id = p.sistema_id
  left join od.solicitantes so on so.id = p.solicitante_id
  left join od.responsaveis re on re.id = p.responsavel_id
  cross join lateral (
    select count(*)::int as etapas,
           (count(*) filter (where situacao = 'concluida'))::int as etapas_concluidas
      from od.projeto_etapa pe where pe.projeto_id = p.id) et
  cross join lateral (
    select count(*)::int as documentos,
           coalesce(bool_or(categoria = 'requisitos'), false) as tem_requisitos
      from od.projeto_anexo pa where pa.projeto_id = p.id) ax;
