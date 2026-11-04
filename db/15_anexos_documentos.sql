-- =====================================================================
--  OD — anexos das demandas aceitam PDF e DOCX, além das imagens
--
--  Imagens continuam com até 3 MB. Documentos chegam a 6 MB (mesmo limite
--  dos documentos de projeto). O conteúdo segue em base64 na coluna dados.
--  Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

alter table od.demanda_anexo drop constraint if exists demanda_anexo_tipo_check;
alter table od.demanda_anexo add constraint demanda_anexo_tipo_check check (tipo in (
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

alter table od.demanda_anexo drop constraint if exists demanda_anexo_tamanho_check;
alter table od.demanda_anexo add constraint demanda_anexo_tamanho_check
  check (tamanho > 0 and tamanho <= 6291456);

comment on column od.demanda_anexo.tipo is
  'MIME do anexo: imagens (até 3 MB), PDF ou DOCX (até 6 MB).';
