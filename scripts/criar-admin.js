/**
 * Cria (ou atualiza a senha de) um administrador do sistema principal.
 * Uso: npm run admin -- "Nome" email@dominio senha
 */
require('dotenv').config();

const { consultarUm } = require('../src/config/db');
const { gerarHash } = require('../src/config/senha');

const [nome, email, senha] = process.argv.slice(2);

if (!nome || !email || !senha) {
  console.error('Uso: npm run admin -- "Nome" email@dominio senha');
  process.exit(1);
}
if (senha.length < 8) {
  console.error('A senha precisa de ao menos 8 caracteres.');
  process.exit(1);
}

(async () => {
  const existente = await consultarUm(
    'select id from od.usuario where empresa_id is null and lower(email) = lower($1)', [email]);

  if (existente) {
    await consultarUm(
      'update od.usuario set nome = $2, senha_hash = $3, ativo = true where id = $1 returning id',
      [existente.id, nome, gerarHash(senha)]);
    await consultarUm('delete from od.sessao where usuario_id = $1 returning token', [existente.id]);
    console.log(`Senha do administrador "${email}" atualizada.`);
  } else {
    await consultarUm(
      `insert into od.usuario (empresa_id, nome, email, senha_hash, perfil)
       values (null, $1, lower($2), $3, 'admin') returning id`,
      [nome, email, gerarHash(senha)]);
    console.log(`Administrador "${email}" criado.`);
  }
  process.exit(0);
})().catch((erro) => {
  console.error('ERRO:', erro.message);
  process.exit(1);
});
