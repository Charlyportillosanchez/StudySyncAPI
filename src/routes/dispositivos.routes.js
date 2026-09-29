// Registro de teléfonos para las notificaciones push.
const express = require('express');
const router = express.Router();
const autenticar = require('../middlewares/autenticar');
const { obtenerPush } = require('../push');

// El token de Firebase de un teléfono es un texto largo sin espacios.
function tokenValido(token) {
  return typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}

// POST /api/dispositivos — { token, plataforma } del teléfono con sesión.
router.post('/', autenticar, async (req, res) => {
  const { token, plataforma } = req.body || {};
  if (!tokenValido(token)) return res.status(400).json({ error: 'Token de notificaciones inválido' });
  try {
    await obtenerPush().guardarToken(
      req.usuario.id,
      token,
      ['android', 'ios', 'web'].includes(plataforma) ? plataforma : null,
    );
    res.status(201).json({ mensaje: 'Teléfono registrado para notificaciones' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dispositivos — { token } al cerrar sesión en ese teléfono.
router.delete('/', autenticar, async (req, res) => {
  const { token } = req.body || {};
  if (!tokenValido(token)) return res.status(400).json({ error: 'Token de notificaciones inválido' });
  try {
    await obtenerPush().borrarToken(req.usuario.id, token);
    res.status(200).json({ mensaje: 'Teléfono dado de baja' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
