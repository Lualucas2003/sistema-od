-- =====================================================================
--  OD — Ordem de Demandas | HeuCode
--  Estrutura do banco (PostgreSQL 13+). Idempotente: pode rodar de novo.
--  Tudo vive no schema "od" para não colidir com outros projetos do banco.
-- =====================================================================

create schema if not exists od;

-- ---------- Tipos ----------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'situacao' and n.nspname = 'od') then
    create type od.situacao as enum ('aberta','andamento','aguardando','concluida','cancelada');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'prioridade' and n.nspname = 'od') then
    create type od.prioridade as enum ('baixa','media','alta','urgente');
  end if;
end $$;

-- ---------- Listas auxiliares ----------
create table if not exists od.sistemas (
  id         serial primary key,
  nome       text not null unique,
  fixo       boolean not null default false,   -- a opção neutra "Não se aplica" não pode ser removida
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
comment on table od.sistemas is 'Sistemas existentes que podem ser vinculados a uma demanda.';

create table if not exists od.solicitantes (
  id         serial primary key,
  nome       text not null unique,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists od.responsaveis (
  id         serial primary key,
  nome       text not null unique,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------- Numeração por ano (OD-2026-0001) ----------
create table if not exists od.numeracao (
  ano     integer primary key,
  ultimo  integer not null default 0
);

create or replace function od.proximo_numero(
  p_prefixo text default 'OD',
  p_ano     integer default extract(year from now())::int
) returns text
language plpgsql as $$
declare v_seq integer;
begin
  insert into od.numeracao (ano, ultimo) values (p_ano, 1)
    on conflict (ano) do update set ultimo = od.numeracao.ultimo + 1
    returning ultimo into v_seq;
  return p_prefixo || '-' || p_ano || '-' || lpad(v_seq::text, 4, '0');
end $$;

-- ---------- Demandas ----------
create table if not exists od.demandas (
  id              bigserial primary key,
  numero          text unique,                                  -- gerado pelo trigger
  titulo          text not null check (char_length(btrim(titulo)) >= 5),
  descricao       text not null check (char_length(btrim(descricao)) >= 10),
  solicitante_id  integer not null references od.solicitantes (id) on delete restrict,
  sistema_id      integer not null references od.sistemas (id)     on delete restrict,
  responsavel_id  integer          references od.responsaveis (id) on delete set null,
  prioridade      od.prioridade not null default 'media',
  situacao        od.situacao   not null default 'aberta',
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now(),
  concluida_em    timestamptz,
  constraint chk_conclusao check ((situacao = 'concluida') = (concluida_em is not null)),
  constraint chk_datas     check (concluida_em is null or concluida_em >= criada_em)
);

create index if not exists ix_demandas_situacao    on od.demandas (situacao);
create index if not exists ix_demandas_sistema     on od.demandas (sistema_id);
create index if not exists ix_demandas_responsavel on od.demandas (responsavel_id);
create index if not exists ix_demandas_criada_em   on od.demandas (criada_em desc);

-- ---------- Histórico ----------
create table if not exists od.demanda_historico (
  id             bigserial primary key,
  demanda_id     bigint not null references od.demandas (id) on delete cascade,
  registrado_em  timestamptz not null default now(),
  autor          text,
  texto          text not null
);
create index if not exists ix_historico_demanda on od.demanda_historico (demanda_id, registrado_em);

-- ---------- Regras automáticas ----------
-- Numera a OD, mantém atualizada_em e sincroniza concluida_em com a situação.
create or replace function od.fn_demanda_antes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.numero is null then
      new.numero := od.proximo_numero('OD', extract(year from coalesce(new.criada_em, now()))::int);
    end if;
  else
    new.atualizada_em := now();
  end if;

  if new.situacao = 'concluida' and new.concluida_em is null then
    new.concluida_em := greatest(new.criada_em, now());
  elsif new.situacao <> 'concluida' then
    new.concluida_em := null;
  end if;

  return new;
end $$;

drop trigger if exists tg_demanda_antes on od.demandas;
create trigger tg_demanda_antes
  before insert or update on od.demandas
  for each row execute function od.fn_demanda_antes();

-- Registra abertura e cada mudança de situação no histórico.
create or replace function od.fn_demanda_historico() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into od.demanda_historico (demanda_id, registrado_em, texto)
    values (new.id, new.criada_em,
            format('Demanda registrada por %s.',
                   (select nome from od.solicitantes where id = new.solicitante_id)));
  elsif new.situacao is distinct from old.situacao then
    insert into od.demanda_historico (demanda_id, texto)
    values (new.id, format('Situação alterada de %s para %s.', old.situacao, new.situacao));
  end if;
  return null;
end $$;

drop trigger if exists tg_demanda_historico on od.demandas;
create trigger tg_demanda_historico
  after insert or update on od.demandas
  for each row execute function od.fn_demanda_historico();

-- ---------- Visões de consulta ----------
create or replace view od.vw_demandas as
select d.id,
       d.numero,
       d.titulo,
       d.descricao,
       so.nome as solicitante,
       si.nome as sistema,
       coalesce(re.nome, 'Não atribuído') as responsavel,
       d.prioridade,
       d.situacao,
       d.criada_em,
       d.concluida_em,
       (current_date - d.criada_em::date)                                        as dias_em_aberto,
       case when d.concluida_em is not null
            then (d.concluida_em::date - d.criada_em::date) end                  as dias_ate_conclusao
from od.demandas d
join od.solicitantes so on so.id = d.solicitante_id
join od.sistemas     si on si.id = d.sistema_id
left join od.responsaveis re on re.id = d.responsavel_id;

-- Indicadores usados na aba Análise.
create or replace view od.vw_indicadores as
select count(*)                                                          as total,
       count(*) filter (where situacao in ('aberta','andamento','aguardando')) as em_aberto,
       count(*) filter (where situacao = 'concluida')                     as concluidas,
       count(*) filter (where prioridade = 'urgente'
                          and situacao in ('aberta','andamento','aguardando')) as urgentes_abertas,
       round(100.0 * count(*) filter (where situacao = 'concluida')
             / nullif(count(*), 0), 1)                                    as taxa_conclusao_pct,
       round(avg(concluida_em::date - criada_em::date)
             filter (where concluida_em is not null), 1)                  as dias_medios_conclusao
from od.demandas;

-- Série mensal (aberturas x conclusões) dos últimos 12 meses.
create or replace view od.vw_serie_mensal as
with meses as (
  select generate_series(date_trunc('month', current_date) - interval '11 months',
                         date_trunc('month', current_date), interval '1 month') as mes
)
select m.mes::date as mes,
       (select count(*) from od.demandas d
         where date_trunc('month', d.criada_em) = m.mes)    as abertas,
       (select count(*) from od.demandas d
         where date_trunc('month', d.concluida_em) = m.mes) as concluidas
from meses m
order by m.mes;
