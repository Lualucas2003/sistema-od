/**
 * OD — Ordem de Demandas | HeuCode
 * Ponto de entrada: confere o banco e abre a porta. A aplicação em si
 * (rotas, views, middlewares) está em src/app.js.
 *
 * INICIALIZAR_BANCO=true cria as tabelas quando o schema "od" está vazio —
 * é o que faz o container subir pronto num banco novo. Com tabelas já
 * criadas, nada é reaplicado.
 */
require('dotenv').config();

const app = require('./src/app');
const configModel = require('./src/models/configModel');
const usuarioModel = require('./src/models/usuarioModel');

const PORTA = process.env.PORT || 3000;

(async () => {
  try {
    if (!await configModel.contarTabelas()) {
      if (process.env.INICIALIZAR_BANCO === 'true') {
        console.log('[OD] Schema "od" vazio: criando as tabelas...');
        await configModel.criarSchema((arquivo) => console.log('     ->', arquivo.split(/[\\/]/).pop()));
        console.log('[OD] Tabelas criadas.');
      } else {
        console.warn('[OD] Schema "od" vazio. Rode: npm run db:schema (ou suba com INICIALIZAR_BANCO=true)');
      }
    }

    const admins = await usuarioModel.contarAdmins();
    if (!admins) {
      console.warn('[OD] Nenhum administrador cadastrado.');
      console.warn('     Crie um com: npm run admin -- "Nome" email@dominio senha');
    }
    await usuarioModel.limparSessoes();

    app.listen(PORTA, () => {
      console.log(`\n  OD — Ordem de Demandas`);
      console.log(`  principal: http://localhost:${PORTA}`);
      console.log(`  portais:   http://localhost:${PORTA}/p/<empresa>\n`);
    });
  } catch (erro) {
    console.error('[OD] Não foi possível conectar ao banco:', erro.message);
    process.exit(1);
  }
})();
