-- =====================================================================
--  OD — Projetos
--
--  Um projeto é o guarda-chuva das demandas: reúne o objetivo, o
--  documento de requisitos e os passos que serão executados para ele
--  acontecer. Segue a mesma partição por empresa das demandas:
--    projeto.empresa_id IS NULL -> projeto interno (só o administrador vê)
--    projeto.empresa_id = X     -> aparece no portal da empresa X
-- =====================================================================

-- ---------- Tipos ----------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'situacao_projeto' and n.nspname = 'od') then
    create type od.situacao_projeto as enum
      ('planejamento','andamento','pausado','concluido','cancelado');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'situacao_etapa' and n.nspname = 'od') then
    create type od.situacao_etapa as enum ('pendente','andamento','concluida','bloqueada');
  end if;
end $$;

-- ---------- Numeração própria (PRJ-2026-0001) ----------
create table if not exists od.numeracao_projeto (
  ano     integer primary key,
  ultimo  integer not null default 0
);

create or replace function od.proximo_codigo_projeto(
  p_prefixo text default 'PRJ',
  p_ano     integer default extract(year from now())::int
) returns text
language plpgsql as $$
declare v_seq integer;
begin
  insert into od.numeracao_projeto (ano, ultimo) values (p_ano, 1)
    on conflict (ano) do update set ultimo = od.numeracao_projeto.ultimo + 1
    returning ultimo into v_seq;
  return p_prefixo || '-' || p_ano || '-' || lpad(v_seq::text, 4, '0');
end $$;

-- ---------- Projeto ----------
create table if not exists od.projeto (
  id              bigserial primary key,
  codigo          text unique,                                   -- gerado pelo gatilho
  nome            text not null check (char_length(btrim(nome)) >= 3),
  objetivo        text,
  empresa_id      integer references od.empresa (id)      on delete cascade,
  sistema_id      integer references od.sistemas (id)     on delete set null,
  solicitante_id  integer references od.solicitantes (id) on delete set null,
  responsavel_id  integer references od.responsaveis (id) on delete set null,
  situacao        od.situacao_projeto not null default 'planejamento',
  prioridade      od.prioridade       not null default 'media',
  inicio_previsto date,
  fim_previsto    date,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  concluido_em    timestamptz,
  constraint chk_projeto_conclusao
    check ((situacao = 'concluido') = (concluido_em is not null)),
  constraint chk_projeto_prazo
    check (fim_previsto is null or inicio_previsto is null or fim_previsto >= inicio_previsto)
);
comment on table od.projeto is
  'Projeto: objetivo, documento de requisitos e passos de execução. empresa_id nulo = interno.';

create index if not exists ix_projeto_empresa   on od.projeto (empresa_id);
create index if not exists ix_projeto_sistema   on od.projeto (sistema_id);
create index if not exists ix_projeto_situacao  on od.projeto (situacao);
create index if not exists ix_projeto_criado_em on od.projeto (criado_em desc);

-- ---------- Passos de execução ----------
create table if not exists od.projeto_etapa (
  id             bigserial primary key,
  projeto_id     bigint not null references od.projeto (id) on delete cascade,
  ordem          integer not null default 1,
  titulo         text not null check (char_length(btrim(titulo)) >= 3),
  descricao      text,
  responsavel_id integer references od.responsaveis (id) on delete set null,
  prazo          date,
  situacao       od.situacao_etapa not null default 'pendente',
  criada_em      timestamptz not null default now(),
  concluida_em   timestamptz,
  constraint chk_etapa_conclusao
    check ((situacao = 'concluida') = (concluida_em is not null))
);
comment on table od.projeto_etapa is
  'Passos que precisam ser executados para o projeto acontecer, na ordem de execução.';

create index if not exists ix_etapa_projeto on od.projeto_etapa (projeto_id, ordem, id);

-- ---------- Documentos do projeto (base64, como os anexos da demanda) ----------
create table if not exists od.projeto_anexo (
  id          bigserial primary key,
  projeto_id  bigint not null references od.projeto (id) on delete cascade,
  categoria   text not null default 'apoio'
              check (categoria in ('requisitos','apoio')),
  nome        text not null,
  tipo        text not null,                    -- MIME; a validação fica no controller
  tamanho     integer not null check (tamanho > 0 and tamanho <= 6291456),  -- até 6 MB
  dados       text not null,                    -- base64 puro, sem o prefixo "data:"
  enviado_por text,
  criado_em   timestamptz not null default now()
);
comment on column od.projeto_anexo.categoria is
  'requisitos: o documento de requisitos do projeto · apoio: demais arquivos.';

create index if not exists ix_projeto_anexo on od.projeto_anexo (projeto_id, criado_em);

-- Metadados sem a base64 — nenhuma listagem precisa carregar o conteúdo.
create or replace view od.vw_projeto_anexos as
select a.id, a.projeto_id, p.codigo, a.categoria, a.nome, a.tipo, a.tamanho,
       a.enviado_por, a.criado_em, length(a.dados) as bytes_base64
  from od.projeto_anexo a
  join od.projeto p on p.id = a.projeto_id;

-- ---------- Histórico ----------
create table if not exists od.projeto_historico (
  id            bigserial primary key,
  projeto_id    bigint not null references od.projeto (id) on delete cascade,
  registrado_em timestamptz not null default now(),
  autor         text,
  texto         text not null
);
create index if not exists ix_projeto_historico on od.projeto_historico (projeto_id, registrado_em);

-- ---------- Vínculo da demanda com o projeto ----------
alter table od.demandas add column if not exists projeto_id bigint
  references od.projeto (id) on delete set null;
create index if not exists ix_demandas_projeto on od.demandas (projeto_id);

-- ---------- Regras automáticas ----------
-- Gera o código, mantém atualizado_em e sincroniza concluido_em com a situação.
create or replace function od.fn_projeto_antes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.codigo is null then
      new.codigo := od.proximo_codigo_projeto(
        'PRJ', extract(year from coalesce(new.criado_em, now()))::int);
    end if;
  else
    new.atualizado_em := now();
  end if;

  if new.situacao = 'concluido' and new.concluido_em is null then
    new.concluido_em := greatest(new.criado_em, now());
  elsif new.situacao <> 'concluido' then
    new.concluido_em := null;
  end if;

  return new;
end $$;

drop trigger if exists tg_projeto_antes on od.projeto;
create trigger tg_projeto_antes
  before insert or update on od.projeto
  for each row execute function od.fn_projeto_antes();

-- Registra a abertura e cada mudança de situação no histórico.
create or replace function od.fn_projeto_historico() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into od.projeto_historico (projeto_id, registrado_em, texto)
    values (new.id, new.criado_em, format('Projeto %s cadastrado.', new.codigo));
  elsif new.situacao is distinct from old.situacao then
    insert into od.projeto_historico (projeto_id, texto)
    values (new.id, format('Situação alterada de %s para %s.', old.situacao, new.situacao));
  end if;
  return null;
end $$;

drop trigger if exists tg_projeto_historico on od.projeto;
create trigger tg_projeto_historico
  after insert or update on od.projeto
  for each row execute function od.fn_projeto_historico();

-- concluida_em do passo acompanha a situação dele.
create or replace function od.fn_etapa_antes() returns trigger
language plpgsql as $$
begin
  if new.situacao = 'concluida' and new.concluida_em is null then
    new.concluida_em := now();
  elsif new.situacao <> 'concluida' then
    new.concluida_em := null;
  end if;
  return new;
end $$;

drop trigger if exists tg_etapa_antes on od.projeto_etapa;
create trigger tg_etapa_antes
  before insert or update on od.projeto_etapa
  for each row execute function od.fn_etapa_antes();

-- ---------- Visão de consulta ----------
-- Projeto com os nomes resolvidos, o progresso dos passos e o que está anexado.
drop view if exists od.vw_projetos;
create view od.vw_projetos as
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
