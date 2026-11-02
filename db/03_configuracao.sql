-- =====================================================================
--  OD — configurações do sistema (chave/valor)
-- =====================================================================

create table if not exists od.configuracao (
  chave         text primary key,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

insert into od.configuracao (chave, valor) values
  ('org', 'HeuCode'),
  ('prefixo', 'OD')
on conflict (chave) do nothing;

-- O prefixo da numeração passa a vir da configuração, não fixo no código.
create or replace function od.fn_demanda_antes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.numero is null then
      new.numero := od.proximo_numero(
        coalesce((select valor from od.configuracao where chave = 'prefixo'), 'OD'),
        extract(year from coalesce(new.criada_em, now()))::int);
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
