-- =====================================================================
--  OD — solicitantes e responsáveis vêm das contas de usuário
--
--  Cada conta (od.usuario) passa a ter um solicitante e um responsável
--  correspondentes, da mesma empresa. Quem cria, renomeia, desativa ou
--  muda de empresa uma conta já atualiza as listas — por gatilho, então
--  nenhuma tela ou script precisa lembrar disso.
--
--  Os itens soltos (usuario_id nulo) continuam no banco porque demandas
--  antigas podem apontar para eles, mas deixam de aparecer nas listas.
--  Conta excluída: o item vira inativo e o nome segue nas demandas já abertas.
--  Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

alter table od.solicitantes
  add column if not exists usuario_id integer references od.usuario (id) on delete set null;
alter table od.responsaveis
  add column if not exists usuario_id integer references od.usuario (id) on delete set null;

create unique index if not exists ux_solicitantes_usuario
  on od.solicitantes (usuario_id) where usuario_id is not null;
create unique index if not exists ux_responsaveis_usuario
  on od.responsaveis (usuario_id) where usuario_id is not null;

-- duas contas com o mesmo nome são pessoas diferentes: a trava de nome
-- repetido vale só para os itens soltos e ativos (sobra de conta excluída fica inativa)
drop index if exists od.ux_solicitantes_nome;
create unique index ux_solicitantes_nome on od.solicitantes (lower(nome)) where usuario_id is null and ativo;
drop index if exists od.ux_responsaveis_nome;
create unique index ux_responsaveis_nome on od.responsaveis (lower(nome)) where usuario_id is null and ativo;

comment on column od.solicitantes.usuario_id is
  'Conta de usuário de onde o item vem. Nulo = item solto (legado), fora das listas.';
comment on column od.responsaveis.usuario_id is
  'Conta de usuário de onde o item vem. Nulo = item solto (legado), fora das listas.';

-- ---------- Sincronia com od.usuario ----------
create or replace function od.fn_usuario_listas() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update od.solicitantes set ativo = false where usuario_id = old.id;
    update od.responsaveis set ativo = false where usuario_id = old.id;
    return old;
  end if;

  update od.solicitantes
     set nome = new.nome, empresa_id = new.empresa_id, ativo = new.ativo
   where usuario_id = new.id;
  if not found then
    insert into od.solicitantes (nome, empresa_id, ativo, usuario_id)
    values (new.nome, new.empresa_id, new.ativo, new.id);
  end if;

  update od.responsaveis
     set nome = new.nome, empresa_id = new.empresa_id, ativo = new.ativo
   where usuario_id = new.id;
  if not found then
    insert into od.responsaveis (nome, empresa_id, ativo, usuario_id)
    values (new.nome, new.empresa_id, new.ativo, new.id);
  end if;
  return new;
end $$;

drop trigger if exists tg_usuario_listas on od.usuario;
create trigger tg_usuario_listas
  after insert or update of nome, empresa_id, ativo on od.usuario
  for each row execute function od.fn_usuario_listas();

drop trigger if exists tg_usuario_listas_exclusao on od.usuario;
create trigger tg_usuario_listas_exclusao
  before delete on od.usuario
  for each row execute function od.fn_usuario_listas();

-- ---------- Contas que já existem ----------
insert into od.solicitantes (nome, empresa_id, ativo, usuario_id)
select u.nome, u.empresa_id, u.ativo, u.id
  from od.usuario u
 where not exists (select 1 from od.solicitantes s where s.usuario_id = u.id);

insert into od.responsaveis (nome, empresa_id, ativo, usuario_id)
select u.nome, u.empresa_id, u.ativo, u.id
  from od.usuario u
 where not exists (select 1 from od.responsaveis r where r.usuario_id = u.id);
