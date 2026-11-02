-- =====================================================================
--  OD — partição por empresa (multi-inquilino) + login e perfis
--
--  Regra de isolamento: toda demanda pertence a uma empresa.
--    demandas.empresa_id IS NULL  -> demanda interna, só o administrador vê
--    demandas.empresa_id = X      -> aparece no portal da empresa X
--  As listas auxiliares seguem a mesma ideia; empresa_id NULL nelas
--  significa "compartilhada" (ex.: "Não se aplica", "Não atribuído").
-- =====================================================================

create table if not exists od.empresa (
  id         serial primary key,
  nome       text not null,
  slug       text not null unique
             check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  documento  text,
  contato    text,
  ativo      boolean not null default true,
  criada_em  timestamptz not null default now()
);
comment on table od.empresa is 'Empresa/cliente com portal próprio em /p/<slug>.';

-- Vínculo das demandas e das listas com a empresa
alter table od.demandas      add column if not exists empresa_id integer references od.empresa (id) on delete restrict;
alter table od.sistemas      add column if not exists empresa_id integer references od.empresa (id) on delete cascade;
alter table od.solicitantes  add column if not exists empresa_id integer references od.empresa (id) on delete cascade;
alter table od.responsaveis  add column if not exists empresa_id integer references od.empresa (id) on delete cascade;

create index if not exists ix_demandas_empresa     on od.demandas (empresa_id);
create index if not exists ix_sistemas_empresa     on od.sistemas (empresa_id);
create index if not exists ix_solicitantes_empresa on od.solicitantes (empresa_id);
create index if not exists ix_responsaveis_empresa on od.responsaveis (empresa_id);

-- nomes únicos dentro da empresa (e entre os compartilhados)
drop index if exists od.ux_sistemas_nome;
alter table od.sistemas     drop constraint if exists sistemas_nome_key;
alter table od.solicitantes drop constraint if exists solicitantes_nome_key;
alter table od.responsaveis drop constraint if exists responsaveis_nome_key;
create unique index if not exists ux_sistemas_nome     on od.sistemas (coalesce(empresa_id, 0), lower(nome));
create unique index if not exists ux_solicitantes_nome on od.solicitantes (coalesce(empresa_id, 0), lower(nome));
create unique index if not exists ux_responsaveis_nome on od.responsaveis (coalesce(empresa_id, 0), lower(nome));

-- ---------- Usuários e sessões ----------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'perfil' and n.nspname = 'od') then
    create type od.perfil as enum ('admin','gestor','operador','leitor');
  end if;
end $$;

create table if not exists od.usuario (
  id             serial primary key,
  empresa_id     integer references od.empresa (id) on delete cascade,
  nome           text not null,
  email          text not null check (position('@' in email) > 1),
  senha_hash     text not null,
  perfil         od.perfil not null default 'operador',
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  ultimo_acesso  timestamptz,
  -- administrador do sistema principal não pertence a empresa; o inverso também vale
  constraint chk_perfil_escopo check ((empresa_id is null) = (perfil = 'admin'))
);
create unique index if not exists ux_usuario_email
  on od.usuario (coalesce(empresa_id, 0), lower(email));

comment on column od.usuario.perfil is
  'admin: sistema principal · gestor: administra a empresa · operador: abre e atualiza OD · leitor: só consulta';

create table if not exists od.sessao (
  token       text primary key,
  usuario_id  integer not null references od.usuario (id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  agente      text
);
create index if not exists ix_sessao_usuario on od.sessao (usuario_id);

-- ---------- Visão com a empresa resolvida ----------
drop view if exists od.vw_demandas;
create view od.vw_demandas as
select d.id,
       d.numero,
       d.titulo,
       d.descricao,
       e.nome as empresa,
       d.empresa_id,
       so.nome as solicitante,
       si.nome as sistema,
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
left join od.responsaveis re on re.id = d.responsavel_id
left join od.empresa e on e.id = d.empresa_id;

-- A demanda herda a empresa do sistema escolhido quando não vier definida.
create or replace function od.fn_demanda_empresa() returns trigger
language plpgsql as $$
begin
  if new.empresa_id is null then
    select empresa_id into new.empresa_id from od.sistemas where id = new.sistema_id;
  end if;
  return new;
end $$;

drop trigger if exists tg_demanda_empresa on od.demandas;
create trigger tg_demanda_empresa
  before insert or update of sistema_id on od.demandas
  for each row execute function od.fn_demanda_empresa();
