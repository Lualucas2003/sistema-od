/**
 * Rotas de página (View).
 *
 *   /                   sistema principal (administrador)
 *   /entrar             login do sistema principal
 *   /p/:slug            portal da empresa — só as OD dela
 *   /p/:slug/entrar     login daquele portal
 *
 * O portal e o principal compartilham a mesma tela; o que muda é o escopo
 * montado pelo middleware e o que cada perfil pode fazer.
 */
const express = require('express');
const paginaController = require('../controllers/paginaController');
const authController = require('../controllers/authController');
const { exigirLogin, resolverPortal } = require('../middlewares/auth');

const rotas = express.Router();

// ---- sistema principal ----
rotas.get('/entrar', authController.formulario);
rotas.post('/entrar', authController.entrar);
rotas.post('/sair', authController.sair);
rotas.get('/sair', authController.sair);
rotas.get('/', exigirLogin, paginaController.inicio);

// ---- portal da empresa ----
rotas.get('/p/:slug/entrar', resolverPortal, authController.formulario);
rotas.post('/p/:slug/entrar', resolverPortal, authController.entrar);
rotas.all('/p/:slug/sair', resolverPortal, authController.sair);
rotas.get('/p/:slug', resolverPortal, exigirLogin, paginaController.inicio);

module.exports = rotas;
