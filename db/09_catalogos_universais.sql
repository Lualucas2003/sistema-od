-- =====================================================================
--  OD — Solicitantes e Responsáveis passam a ser universais
--
--  Antes, cada empresa ganhava a própria cópia ("Cliente" em todo portal,
--  "Não atribuído" em todo portal), e a tela de Catálogos mostrava o mesmo
--  termo repetido, etiquetado com o nome da empresa.
--
--  Agora os dois catálogos funcionam como od.tipos_acao: o administrador
--  cadastra uma vez e o item vale em todos os portais (empresa_id nulo).
--  Sistemas continuam por empresa — são os sistemas reais de cada cliente
--  e é o que separa as demandas entre os portais.
--
--  A unificação escolhe um item canônico por nome (o que já era
--  compartilhado; não havendo, o de menor id), aponta para ele tudo que
--  usava as cópias e só então apaga as cópias. Nenhuma demanda, projeto ou
--  passo é perdido. Pode rodar de novo sem efeito.
-- =====================================================================

-- ---------- Solicitantes ----------
create temp table od_mapa_solicitante as
with canonico as (
  -- o compartilhado ganha; sem ele, o mais antigo
  select lower(nome) as chave,
         (array_agg(id order by (empresa_id is not null), id))[1] as id
    from od.solicitantes
   group by lower(nome))
select s.id as antigo, c.id as novo
  from od.solicitantes s
  join canonico c on c.chave = lower(s.nome)
 where s.id <> c.id;

update od.demandas d set solicitante_id = m.novo
  from od_mapa_solicitante m where d.solicitante_id = m.antigo;
update od.projeto p set solicitante_id = m.novo
  from od_mapa_solicitante m where p.solicitante_id = m.antigo;

delete from od.solicitantes s using od_mapa_solicitante m where s.id = m.antigo;
drop table od_mapa_solicitante;

-- o que sobrou de alguma empresa vira compartilhado
update od.solicitantes set empresa_id = null where empresa_id is not null;

-- ---------- Responsáveis ----------
create temp table od_mapa_responsavel as
with canonico as (
  select lower(nome) as chave,
         (array_agg(id order by (empresa_id is not null), id))[1] as id
    from od.responsaveis
   group by lower(nome))
select r.id as antigo, c.id as novo
  from od.responsaveis r
  join canonico c on c.chave = lower(r.nome)
 where r.id <> c.id;

update od.demandas d set responsavel_id = m.novo
  from od_mapa_responsavel m where d.responsavel_id = m.antigo;
update od.projeto p set responsavel_id = m.novo
  from od_mapa_responsavel m where p.responsavel_id = m.antigo;
update od.projeto_etapa e set responsavel_id = m.novo
  from od_mapa_responsavel m where e.responsavel_id = m.antigo;

delete from od.responsaveis r using od_mapa_responsavel m where r.id = m.antigo;
drop table od_mapa_responsavel;

update od.responsaveis set empresa_id = null where empresa_id is not null;

-- ---------- O nome passa a ser único no sistema inteiro ----------
-- (antes era único por empresa, o que permitia o mesmo termo repetido)
drop index if exists od.ux_solicitantes_nome;
create unique index ux_solicitantes_nome on od.solicitantes (lower(nome));

drop index if exists od.ux_responsaveis_nome;
create unique index ux_responsaveis_nome on od.responsaveis (lower(nome));

comment on column od.solicitantes.empresa_id is
  'Sempre nulo: o catálogo de solicitantes é universal, válido em todos os portais.';
comment on column od.responsaveis.empresa_id is
  'Sempre nulo: o catálogo de responsáveis é universal, válido em todos os portais.';
