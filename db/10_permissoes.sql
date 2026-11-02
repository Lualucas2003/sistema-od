-- =====================================================================
--  OD — Perfis de acesso e permissões
--
--  Antes, os quatro perfis (admin, gestor, operador, leitor) e o que cada
--  um podia fazer viviam num objeto fixo no código. Agora:
--
--    od.permissao        catálogo do que existe para permitir
--    od.perfil_acesso    o perfil em si (nome, a quem pertence, perfil base)
--    od.perfil_permissao o que cada perfil libera
--    od.usuario.perfil_id qual perfil a conta usa
--
--  A coluna antiga od.usuario.perfil continua existindo e é mantida em dia
--  por gatilho, a partir do `base` do perfil. Ela é a classe de escopo
--  (admin = sistema principal; os demais = uma empresa) e é o que sustenta
--  a constraint chk_perfil_escopo e todas as consultas que já existiam.
--
--  Os quatro perfis viram "perfis do sistema" com exatamente as permissões
--  que o código dava antes — nada muda de comportamento ao aplicar.
--  Pode rodar de novo sem efeito.
-- =====================================================================

-- ---------- Catálogo de permissões ----------
create table if not exists od.permissao (
  chave       text primary key,
  grupo       text not null,
  nome        text not null,
  descricao   text,
  ordem       integer not null default 100,
  -- permissões de dono do sistema: nunca aparecem para um perfil de empresa
  exige_admin boolean not null default false
);
comment on table od.permissao is 'O que existe para ser permitido. Alimenta a tela de perfis.';

insert into od.permissao (chave, grupo, nome, descricao, ordem, exige_admin) values
  ('demanda.ver',        'Demandas', 'Ver demandas',         'Abrir a listagem, o quadro e o detalhe das OD.',        10, false),
  ('demanda.criar',      'Demandas', 'Abrir demanda',        'Registrar uma nova OD e lançar andamentos.',            20, false),
  ('demanda.editar',     'Demandas', 'Editar demanda',       'Alterar os dados e mudar a situação da OD.',            30, false),
  ('demanda.excluir',    'Demandas', 'Excluir demanda',      'Apagar uma OD, com histórico e imagens.',               40, false),
  ('demanda.anexar',     'Demandas', 'Anexar imagens',       'Enviar e remover as imagens da OD.',                    50, false),

  ('projeto.ver',        'Projetos', 'Ver projetos',         'Abrir a lista e o perfil dos projetos.',                60, false),
  ('projeto.criar',      'Projetos', 'Cadastrar projeto',    'Criar projeto, passos e anexar documentos.',            70, false),
  ('projeto.editar',     'Projetos', 'Editar projeto',       'Alterar o projeto, os passos e os documentos.',         80, false),
  ('projeto.excluir',    'Projetos', 'Excluir projeto',      'Apagar um projeto, com passos e documentos.',           90, false),

  ('analise.ver',        'Análise',  'Ver painel e análise', 'Indicadores, gráficos e o quadro de situação.',         100, false),
  ('dados.exportar',     'Análise',  'Exportar dados',       'Baixar a exportação em CSV e o backup em JSON.',        110, false),

  ('usuario.administrar','Administração', 'Contas de acesso', 'Criar, editar e desativar as contas do escopo.',       120, false),
  ('perfil.administrar', 'Administração', 'Perfis e permissões', 'Criar e editar perfis e o que cada um libera.',     130, false),
  ('catalogo.administrar','Administração','Catálogos',        'Solicitantes, responsáveis e tipos de ação.',          140, true),
  ('empresa.administrar','Administração', 'Empresas e sistemas', 'Cadastrar empresas, portais e os sistemas delas.',  150, true),
  ('config.administrar', 'Administração', 'Identificação',    'Nome do órgão e prefixo da numeração das OD.',         160, true),
  ('dados.apagar',       'Administração', 'Apagar dados',     'Apagar todas as demandas e recarregar os exemplos.',   170, true)
on conflict (chave) do update
  set grupo = excluded.grupo, nome = excluded.nome, descricao = excluded.descricao,
      ordem = excluded.ordem, exige_admin = excluded.exige_admin;

-- ---------- Perfis ----------
create table if not exists od.perfil_acesso (
  id         serial primary key,
  nome       text not null check (char_length(btrim(nome)) >= 2),
  descricao  text,
  -- classe de escopo herdada pela conta: admin = sistema principal
  base       od.perfil not null default 'operador',
  empresa_id integer references od.empresa (id) on delete cascade,
  -- perfil de fábrica: pode ser ajustado, mas não excluído
  sistema    boolean not null default false,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  -- só o sistema principal tem perfil de administrador
  constraint chk_perfil_base_admin check (base <> 'admin' or empresa_id is null)
);
comment on table od.perfil_acesso is
  'Perfil de acesso. empresa_id nulo = disponível em todos os portais.';
comment on column od.perfil_acesso.base is
  'Classe de escopo que a conta herda (admin, gestor, operador, leitor).';

create unique index if not exists ux_perfil_acesso_nome
  on od.perfil_acesso (coalesce(empresa_id, 0), lower(nome));
create index if not exists ix_perfil_acesso_empresa on od.perfil_acesso (empresa_id);

create table if not exists od.perfil_permissao (
  perfil_id integer not null references od.perfil_acesso (id) on delete cascade,
  permissao text    not null references od.permissao (chave) on delete cascade,
  primary key (perfil_id, permissao)
);

-- ---------- Vínculo da conta com o perfil ----------
alter table od.usuario add column if not exists perfil_id integer
  references od.perfil_acesso (id) on delete restrict;
create index if not exists ix_usuario_perfil on od.usuario (perfil_id);

-- A coluna antiga `perfil` segue a base do perfil escolhido; assim a
-- constraint chk_perfil_escopo e o resto do sistema continuam valendo.
create or replace function od.fn_usuario_perfil() returns trigger
language plpgsql as $$
begin
  if new.perfil_id is not null then
    select base into new.perfil from od.perfil_acesso where id = new.perfil_id;
  end if;
  return new;
end $$;

drop trigger if exists tg_usuario_perfil on od.usuario;
create trigger tg_usuario_perfil
  before insert or update on od.usuario
  for each row execute function od.fn_usuario_perfil();

-- Defesa em profundidade: permissão de dono do sistema (exige_admin) não
-- entra em perfil de empresa, nem que a aplicação erre.
create or replace function od.fn_perfil_permissao() returns trigger
language plpgsql as $$
declare v_base od.perfil; v_admin boolean;
begin
  select base into v_base from od.perfil_acesso where id = new.perfil_id;
  select exige_admin into v_admin from od.permissao where chave = new.permissao;
  if v_admin and v_base <> 'admin' then
    raise exception 'A permissão "%" é exclusiva do administrador do sistema.', new.permissao
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists tg_perfil_permissao on od.perfil_permissao;
create trigger tg_perfil_permissao
  before insert or update on od.perfil_permissao
  for each row execute function od.fn_perfil_permissao();

-- ---------- Os quatro perfis de fábrica ----------
-- Mesmas permissões que o código dava antes: aplicar isto não muda nada.
insert into od.perfil_acesso (nome, descricao, base, sistema) values
  ('Administrador', 'Dono do sistema principal: enxerga todas as empresas e faz tudo.', 'admin', true),
  ('Gestor',        'Administra a empresa: as OD, os projetos e as contas do portal.',  'gestor', true),
  ('Operador',      'Abre, edita e movimenta as OD e os projetos da empresa.',          'operador', true),
  ('Leitor',        'Só consulta: não altera nada.',                                    'leitor', true)
on conflict do nothing;

-- Administrador: tudo o que existir no catálogo, sempre.
insert into od.perfil_permissao (perfil_id, permissao)
select p.id, pe.chave from od.perfil_acesso p cross join od.permissao pe
 where p.sistema and p.base = 'admin'
on conflict do nothing;

insert into od.perfil_permissao (perfil_id, permissao)
select p.id, c.chave
  from od.perfil_acesso p
  join (values
      ('gestor','demanda.ver'), ('gestor','demanda.criar'), ('gestor','demanda.editar'),
      ('gestor','demanda.excluir'), ('gestor','demanda.anexar'),
      ('gestor','projeto.ver'), ('gestor','projeto.criar'), ('gestor','projeto.editar'),
      ('gestor','projeto.excluir'),
      ('gestor','analise.ver'), ('gestor','dados.exportar'),
      ('gestor','usuario.administrar'), ('gestor','perfil.administrar'),

      ('operador','demanda.ver'), ('operador','demanda.criar'), ('operador','demanda.editar'),
      ('operador','demanda.anexar'),
      ('operador','projeto.ver'), ('operador','projeto.criar'), ('operador','projeto.editar'),
      ('operador','analise.ver'), ('operador','dados.exportar'),

      ('leitor','demanda.ver'), ('leitor','projeto.ver'), ('leitor','analise.ver'),
      ('leitor','dados.exportar')
    ) as c(base, chave) on c.base = p.base::text
 where p.sistema and p.base <> 'admin'
on conflict do nothing;

-- ---------- Contas existentes apontam para o perfil de fábrica ----------
update od.usuario u set perfil_id = p.id
  from od.perfil_acesso p
 where p.sistema and p.base = u.perfil and u.perfil_id is null;

-- ---------- Visão de conferência ----------
create or replace view od.vw_perfis as
select p.id, p.nome, p.descricao, p.base, p.empresa_id, e.nome as empresa,
       p.sistema, p.ativo, p.criado_em,
       (select count(*)::int from od.perfil_permissao pp where pp.perfil_id = p.id) as permissoes,
       (select count(*)::int from od.usuario u where u.perfil_id = p.id) as contas,
       coalesce((select json_agg(pp.permissao order by pp.permissao)
                   from od.perfil_permissao pp where pp.perfil_id = p.id), '[]'::json) as chaves
  from od.perfil_acesso p
  left join od.empresa e on e.id = p.empresa_id;
