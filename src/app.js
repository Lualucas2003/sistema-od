/**
 * Aplicação Express: views, arquivos estáticos, middlewares e rotas.
 * Não conecta no banco nem abre porta — isso fica com o server.js.
 *
 * Duas entradas para a mesma aplicação:
 *   /            sistema principal (administrador vê todas as empresas)
 *   /p/<slug>    portal da empresa (só as OD dela, com login próprio)
 */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const rotasPagina = require('./routes/index');
const rotasApi = require('./routes/api');
const { naoEncontrado, tratarErro } = require('./middlewares/erros');
const { carregarSessao, resolverPortal } = require('./middlewares/auth');

const RAIZ = path.join(__dirname, '..');
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// muda a cada boot: os links de css/js carregam ?v=<versao> e o navegador
// nunca fica com uma versão velha depois de um deploy
app.locals.versao = Date.now().toString(36);

app.use(express.json({ limit: '12mb' }));   // imagens chegam em base64
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
/**
 * O JS é servido sob /js/<versao>/... — como os imports são relativos
 * ("./ui.js"), todos os módulos herdam a mesma versão e o navegador nunca
 * mistura um arquivo novo com outro em cache.
 */
// o padrão do :versao evita capturar "/js/arquivo.js" (que tem ponto) como versão
app.use('/js/:versao([a-z0-9]+)', express.static(path.join(RAIZ, 'public', 'js'), {
  immutable: true, maxAge: '365d', redirect: false
}));
app.use(express.static(path.join(RAIZ, 'public'), {
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

module.exports = app;
