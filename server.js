/**
 * OD — Ordem de Demandas | HeuCode
 * Ponto de entrada: sobe o Express, registra as rotas e confere o banco.
 *
 * Duas entradas para a mesma aplicação:
 *   /            sistema principal (administrador vê todas as empresas)
 *   /p/<slug>    portal da empresa (só as OD dela, com login próprio)
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const rotasPagina = require('./src/routes/index');
const rotasApi = require('./src/routes/api');
const { naoEncontrado, tratarErro } = require('./src/middlewares/erros');
const { carregarSessao, resolverPortal } = require('./src/middlewares/auth');
const usuarioModel = require('./src/models/usuarioModel');
const { pool } = require('./src/config/db');

const app = express();
const PORTA = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.disable('x-powered-by');

// muda a cada boot: os links de css/js carregam ?v=<versao> e o navegador
// nunca fica com uma versão velha depois de um deploy
app.locals.versao = Date.now().toString(36);
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '12mb' }));   // imagens chegam em base64
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
/**
 * O JS é servido sob /js/<versao>/... — como os imports são relativos
 * ("./ui.js"), todos os módulos herdam a mesma versão e o navegador nunca
 * mistura um arquivo novo com outro em cache.
 */
// o padrão do :versao evita capturar "/js/arquivo.js" (que tem ponto) como versão
app.use('/js/:versao([a-z0-9]+)', express.static(path.join(__dirname, 'public', 'js'), {
  immutable: true, maxAge: '365d', redirect: false
}));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: EM_PRODUCAO ? '1h' : 0,   // em desenvolvimento, sempre revalida
  etag: true
}));

// a página em si nunca fica em cache: ela aponta para a versão atual dos assets
app.use((req, res, proximo) => {
  if (!/\.[a-z0-9]+$/i.test(req.path)) res.set('Cache-Control', 'no-store');
  proximo();
});

app.use(carregarSessao);

// API do portal: o slug da URL define o recorte, mesmo para o administrador
app.use('/p/:slug/api', resolverPortal, rotasApi);
app.use('/api', rotasApi);
app.use('/', rotasPagina);

app.use(naoEncontrado);
app.use(tratarErro);

(async () => {
  try {
    const { rows } = await pool.query(
      `select count(*)::int as total from information_schema.tables where table_schema = 'od'`);
    if (!rows[0].total) console.warn('[OD] Schema "od" vazio. Rode: npm run db:reset');

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
