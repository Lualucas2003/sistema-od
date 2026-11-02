-- =====================================================================
--  OD — sistemas atribuídos a um usuário
--
--  Sem nenhuma linha aqui, o usuário enxerga todos os sistemas do escopo
--  dele (comportamento padrão). Havendo linhas, o acesso fica restrito
--  a esses sistemas: listagens, quadro, análise e abertura de OD.
-- =====================================================================

create table if not exists od.usuario_sistema (
  usuario_id  integer not null references od.usuario (id)  on delete cascade,
  sistema_id  integer not null references od.sistemas (id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (usuario_id, sistema_id)
);

create index if not exists ix_usuario_sistema_sistema on od.usuario_sistema (sistema_id);

comment on table od.usuario_sistema is
  'Restrição opcional: quais sistemas o usuário enxerga. Vazio = todos do escopo.';

-- Quem está restrito e a quantos sistemas
create or replace view od.vw_usuarios as
select u.id, u.empresa_id, e.nome as empresa, u.nome, u.email, u.perfil, u.ativo,
       u.criado_em, u.ultimo_acesso,
       (select count(*)::int from od.usuario_sistema us where us.usuario_id = u.id) as sistemas_restritos
  from od.usuario u
  left join od.empresa e on e.id = u.empresa_id;
