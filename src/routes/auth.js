const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../db');
const { Resend } = require('resend');
const { pub } = require('../redis/client');

const autenticar = require('../middlewares/autenticar');

const resend = new Resend(process.env.RESEND_API_KEY);

// Genera un código de verificación de 6 dígitos.
function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Envía el código de verificación por email. Devuelve true si se envió.
async function enviarCodigoVerificacion(email, nombre, codigo) {
  try {
    const { error } = await resend.emails.send({
      from: 'AutoSpot <onboarding@resend.dev>',
      to: email,
      subject: `Tu código de verificación: ${codigo}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1A237E">¡Hola ${nombre}!</h2>
          <p>Gracias por registrarte en <b>AutoSpot</b>. Tu código de verificación es:</p>
          <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#FF6F00;text-align:center">${codigo}</p>
          <p style="color:#6B7280">El código vence en 15 minutos. Si no creaste esta cuenta, ignora este correo.</p>
        </div>`,
    });
    return !error;
  } catch (e) {
    return false;
  }
}

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar un nuevo usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Usuario'
 *           example:
 *             nombre: Charly Portillo
 *             email: charly@gmail.com
 *             password: "123456"
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *         content:
 *           application/json:
 *             example:
 *               mensaje: Usuario registrado
 *               usuario:
 *                 id: 1
 *                 nombre: Charly Portillo
 *                 email: charly@gmail.com
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             example:
 *               error: El campo "nombre" es obligatorio
 */
router.post('/register', async (req, res) => {
  const { nombre, email, password } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });
  if (!email) return res.status(400).json({ error: 'El campo "email" es obligatorio' });
  if (!password) return res.status(400).json({ error: 'El campo "password" es obligatorio' });

  // Validaciones básicas
  const emailNormalizado = String(email).trim().toLowerCase();
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado);
  if (!emailValido) return res.status(400).json({ error: 'El email no tiene un formato válido' });
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  // Evitar duplicados con mensaje claro
  const { data: existente } = await supabase
    .from('usuarios').select('id').eq('email', emailNormalizado).maybeSingle();
  if (existente) return res.status(400).json({ error: 'Ya existe una cuenta con ese email' });

  const hash = await bcrypt.hash(password, 10);

  // La cuenta nace SIN verificar; se envía un código de 6 dígitos por email.
  const codigo = generarCodigo();
  const expira = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('usuarios')
    .insert([{
      nombre: String(nombre).trim(),
      email: emailNormalizado,
      password: hash,
      verificado: false,
      rol: 'usuario',
      codigo_verificacion: codigo,
      codigo_expira: expira,
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });

  const enviado = await enviarCodigoVerificacion(
    emailNormalizado, String(nombre).trim(), codigo);

  // Si el email no se pudo enviar (por ejemplo, Resend sin dominio propio
  // solo entrega al correo del dueño de la cuenta), verificamos la cuenta
  // automáticamente para no dejar al usuario bloqueado.
  if (!enviado) {
    await supabase
      .from('usuarios')
      .update({ verificado: true, codigo_verificacion: null, codigo_expira: null })
      .eq('id', data[0].id);
  }

  // Nunca devolver el hash de la contraseña ni el código
  const { password: _omitir, codigo_verificacion: _cod, ...usuarioSeguro } = data[0];
  res.status(201).json({
    mensaje: enviado
      ? 'Usuario registrado. Revisa tu correo para verificar la cuenta.'
      : 'Usuario registrado',
    requiere_verificacion: enviado,
    usuario: { ...usuarioSeguro, verificado: !enviado },
  });
});

/**
 * @swagger
 * /auth/verificar:
 *   post:
 *     summary: Verificar la cuenta con el código enviado por email
 *     tags: [Autenticación]
 */
router.post('/verificar', async (req, res) => {
  const { email, codigo } = req.body;
  if (!email || !codigo) {
    return res.status(400).json({ error: 'Email y código requeridos' });
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', String(email).trim().toLowerCase())
    .single();

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (usuario.verificado) {
    return res.status(200).json({ mensaje: 'La cuenta ya estaba verificada' });
  }
  if (String(usuario.codigo_verificacion) !== String(codigo).trim()) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  if (usuario.codigo_expira && new Date(usuario.codigo_expira) < new Date()) {
    return res.status(400).json({ error: 'El código expiró. Solicita uno nuevo.' });
  }

  await supabase
    .from('usuarios')
    .update({ verificado: true, codigo_verificacion: null, codigo_expira: null })
    .eq('id', usuario.id);

  res.status(200).json({ mensaje: 'Cuenta verificada correctamente' });
});

/**
 * @swagger
 * /auth/reenviar:
 *   post:
 *     summary: Reenviar el código de verificación
 *     tags: [Autenticación]
 */
router.post('/reenviar', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', String(email).trim().toLowerCase())
    .single();

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (usuario.verificado) {
    return res.status(400).json({ error: 'La cuenta ya está verificada' });
  }

  const codigo = generarCodigo();
  await supabase
    .from('usuarios')
    .update({
      codigo_verificacion: codigo,
      codigo_expira: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })
    .eq('id', usuario.id);

  const enviado = await enviarCodigoVerificacion(usuario.email, usuario.nombre, codigo);
  if (!enviado) {
    return res.status(500).json({ error: 'No se pudo enviar el correo. Intenta más tarde.' });
  }
  res.status(200).json({ mensaje: 'Código reenviado, revisa tu correo' });
});

/**
 * @swagger
 * /auth/perfil:
 *   get:
 *     summary: Datos del usuario autenticado
 *     tags: [Autenticación]
 */
router.get('/perfil', autenticar, async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email, telefono, rol, verificado, created_at')
    .eq('id', req.usuario.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.status(200).json(data);
});

/**
 * @swagger
 * /auth/perfil:
 *   put:
 *     summary: Actualizar nombre, teléfono o contraseña
 *     tags: [Autenticación]
 */
router.put('/perfil', autenticar, async (req, res) => {
  const { nombre, telefono, passwordActual, passwordNueva } = req.body;
  const cambios = {};

  if (nombre !== undefined) {
    if (String(nombre).trim().length < 3) {
      return res.status(400).json({ error: 'El nombre debe tener al menos 3 caracteres' });
    }
    cambios.nombre = String(nombre).trim();
  }
  if (telefono !== undefined) {
    cambios.telefono = String(telefono).trim() || null;
  }

  // Cambio de contraseña: requiere la contraseña actual.
  if (passwordNueva) {
    if (String(passwordNueva).length < 6) {
      return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });
    }
    const { data: usuario } = await supabase
      .from('usuarios').select('password').eq('id', req.usuario.id).single();
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    const valido = await bcrypt.compare(String(passwordActual || ''), usuario.password);
    if (!valido) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    cambios.password = await bcrypt.hash(String(passwordNueva), 10);
  }

  if (Object.keys(cambios).length === 0) {
    return res.status(400).json({ error: 'No hay cambios para guardar' });
  }

  const { data, error } = await supabase
    .from('usuarios')
    .update(cambios)
    .eq('id', req.usuario.id)
    .select('id, nombre, email, telefono, rol, verificado, created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ mensaje: 'Perfil actualizado', usuario: data[0] });
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión y obtener token JWT
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Login'
 *           example:
 *             email: charly@gmail.com
 *             password: "123456"
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             example:
 *               token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *               refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Credenciales inválidas
 *         content:
 *           application/json:
 *             example:
 *               error: Credenciales inválidas
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', String(email).trim().toLowerCase())
    .single();

  if (error || !data) return res.status(401).json({ error: 'Credenciales inválidas' });

  const valido = await bcrypt.compare(password, data.password);
  if (!valido) return res.status(401).json({ error: 'Credenciales inválidas' });

  // Cuentas sin verificar no pueden iniciar sesión.
  if (data.verificado === false) {
    return res.status(403).json({
      error: 'Tu cuenta no está verificada. Revisa tu correo.',
      no_verificado: true,
    });
  }

  const token = jwt.sign(
    { id: data.id, email: data.email, rol: data.rol },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  const refreshToken = jwt.sign(
    { id: data.id, email: data.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(200).json({ token, refreshToken });
});

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Obtener nuevo token usando refresh token
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Nuevo token generado
 *         content:
 *           application/json:
 *             example:
 *               token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Token expirado o inválido
 *         content:
 *           application/json:
 *             example:
 *               error: Token expirado, inicia sesión nuevamente
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });

  try {
    const blacklisted = await pub.get(`blacklist:${refreshToken}`);
    if (blacklisted) return res.status(401).json({ error: 'Token inválido' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (!data) return res.status(401).json({ error: 'Usuario no encontrado' });

    const newToken = jwt.sign(
      { id: data.id, email: data.email, rol: data.rol },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({ token: newToken });
  } catch (e) {
    res.status(401).json({ error: 'Token expirado, inicia sesión nuevamente' });
  }
});

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Cerrar sesión y agregar token a blacklist
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Sesión cerrada
 *         content:
 *           application/json:
 *             example:
 *               mensaje: Sesión cerrada correctamente
 */
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });

  await pub.setex(`blacklist:${refreshToken}`, 7 * 24 * 60 * 60, 'blacklisted');

  res.status(200).json({ mensaje: 'Sesión cerrada correctamente' });
});

module.exports = router;