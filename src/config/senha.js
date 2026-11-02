/**
 * Hash de senha com scrypt (biblioteca padrão do Node, sem dependência extra).
 * Formato guardado: scrypt$<N>$<salt-hex>$<hash-hex>
 */
const crypto = require('crypto');

const CUSTO = 16384;      // N do scrypt
const TAMANHO = 64;

function gerarHash(senha) {
  const salt = crypto.randomBytes(16);
  const derivada = crypto.scryptSync(String(senha), salt, TAMANHO, { N: CUSTO });
  return `scrypt$${CUSTO}$${salt.toString('hex')}$${derivada.toString('hex')}`;
}

/** Comparação em tempo constante; nunca lança para entrada malformada. */
function conferir(senha, guardado) {
  try {
    const [algoritmo, custo, saltHex, hashHex] = String(guardado).split('$');
    if (algoritmo !== 'scrypt') return false;
    const derivada = crypto.scryptSync(String(senha), Buffer.from(saltHex, 'hex'),
      hashHex.length / 2, { N: Number(custo) });
    return crypto.timingSafeEqual(derivada, Buffer.from(hashHex, 'hex'));
  } catch (erro) {
    return false;
  }
}

const novoToken = () => crypto.randomBytes(32).toString('hex');

/** Transforma um nome em slug de URL: "Padaria do Zé" -> "padaria-do-ze". */
function gerarSlug(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

module.exports = { gerarHash, conferir, novoToken, gerarSlug };
