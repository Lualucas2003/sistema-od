-- =====================================================================
--  OD — imagens anexadas às demandas (guardadas em base64)
-- =====================================================================

create table if not exists od.demanda_anexo (
  id          bigserial primary key,
  demanda_id  bigint not null references od.demandas (id) on delete cascade,
  nome        text not null,
  tipo        text not null check (tipo in ('image/png','image/jpeg','image/webp','image/gif')),
  tamanho     integer not null check (tamanho > 0 and tamanho <= 3145728),  -- até 3 MB
  largura     integer,
  altura      integer,
  dados       text not null,   -- conteúdo em base64, sem o prefixo "data:"
  criado_em   timestamptz not null default now()
);

create index if not exists ix_anexo_demanda on od.demanda_anexo (demanda_id, criado_em);

comment on table  od.demanda_anexo is 'Imagens da demanda, armazenadas em base64 na coluna dados.';
comment on column od.demanda_anexo.dados is 'Base64 puro; o servidor decodifica ao servir /api/anexos/:id/arquivo.';

-- Metadados sem o conteúdo — evita trafegar a base64 quando ela não é necessária.
create or replace view od.vw_anexos as
select a.id, a.demanda_id, d.numero, a.nome, a.tipo, a.tamanho,
       a.largura, a.altura, a.criado_em,
       length(a.dados) as bytes_base64
  from od.demanda_anexo a
  join od.demandas d on d.id = a.demanda_id;
