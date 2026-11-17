-- =====================================================================
--  OD — status escrito do projeto
--
--  Na tabela de projetos, "Última atualização" e "Próximos passos" deixam
--  de ser só automáticos: quem acompanha o projeto escreve, em texto livre,
--  o que aconteceu por último e qual é o próximo passo. Junto ficam a data
--  e o autor desse registro (status_em / status_autor).
--  Cada registro também entra no histórico do projeto.
--  Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

alter table od.projeto add column if not exists ultima_atualizacao text;
alter table od.projeto add column if not exists proximo_passo      text;
alter table od.projeto add column if not exists status_em          timestamptz;
alter table od.projeto add column if not exists status_autor       text;

comment on column od.projeto.ultima_atualizacao is 'Texto livre: o que aconteceu por último no projeto.';
comment on column od.projeto.proximo_passo      is 'Texto livre: qual é o próximo passo do projeto.';
comment on column od.projeto.status_em          is 'Quando o status escrito foi registrado.';
comment on column od.projeto.status_autor       is 'Quem registrou o status escrito.';

-- Mesma visão da 13, com as colunas novas no fim (create or replace só aceita acrescentar).
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
            then (p.fim_previsto - current_date) end as dias_para_prazo,
       p.ultima_atualizacao,
       p.proximo_passo,
       p.status_em,
       p.status_autor
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
