// Notificaciones push con Firebase Cloud Messaging (FCM).
//
// La credencial se lee de la variable de entorno FIREBASE_SERVICE_ACCOUNT
// (el JSON de la cuenta de servicio de Firebase, configurado en Render).
// Si no está, los avisos simplemente no se envían: la API sigue igual.
//
// Cada teléfono registra su token en la tabla `dispositivos`
// (ver migracion_notificaciones.sql).

// Si el token ya no sirve (app desinstalada, sesión cerrada...), se borra.
const TOKENS_INVALIDOS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

function mensajeriaDesdeEntorno() {
  const credencial = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!credencial) {
    console.warn('[Push] Falta FIREBASE_SERVICE_ACCOUNT: no se enviarán notificaciones');
    return null;
  }
  try {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    return getMessaging(initializeApp({ credential: cert(JSON.parse(credencial)) }));
  } catch (err) {
    console.error('[Push] La credencial de Firebase no es válida:', err.message);
    return null;
  }
}

function crearPush({ supabase, mensajeria }) {
  // La mensajería se crea recién cuando hace falta (y una sola vez).
  let msg;
  const obtenerMensajeria = () => {
    if (msg === undefined) msg = typeof mensajeria === 'function' ? mensajeria() : mensajeria;
    return msg;
  };

  // Guarda el token de un teléfono. Si ese teléfono ya estaba registrado
  // con otra cuenta, pasa a la cuenta actual.
  async function guardarToken(usuarioId, token, plataforma) {
    const { error } = await supabase.from('dispositivos').upsert(
      {
        token,
        usuario_id: usuarioId,
        plataforma: plataforma || null,
        actualizado: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) throw new Error(error.message);
  }

  async function borrarToken(usuarioId, token) {
    const { error } = await supabase
      .from('dispositivos').delete().eq('token', token).eq('usuario_id', usuarioId);
    if (error) throw new Error(error.message);
  }

  // Envía un aviso a todos los teléfonos de esos usuarios. Devuelve cuántos
  // lo recibieron. Nunca lanza error: un aviso fallido no debe romper la API.
  async function enviarA(usuarioIds, { titulo, cuerpo, datos = {} }) {
    try {
      const ids = [...new Set(usuarioIds.filter((id) => id != null))];
      const mensajeria = ids.length ? obtenerMensajeria() : null;
      if (!mensajeria) return 0;

      const { data: filas } = await supabase
        .from('dispositivos').select('token').in('usuario_id', ids);
      const tokens = [...new Set((filas || []).map((f) => f.token))];
      if (tokens.length === 0) return 0;

      // FCM solo acepta textos en `data`.
      const datosTexto = Object.fromEntries(
        Object.entries(datos)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      );
      const respuesta = await mensajeria.sendEachForMulticast({
        tokens,
        notification: { title: titulo, body: cuerpo },
        data: datosTexto,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      const invalidos = respuesta.responses
        .map((r, i) => (!r.success && TOKENS_INVALIDOS.has(r.error?.code) ? tokens[i] : null))
        .filter(Boolean);
      if (invalidos.length > 0) {
        await supabase.from('dispositivos').delete().in('token', invalidos);
      }
      return respuesta.successCount;
    } catch (err) {
      console.error('[Push] No se pudo enviar el aviso:', err.message);
      return 0;
    }
  }

  async function nombreDe(usuarioId) {
    const { data } = await supabase
      .from('usuarios').select('nombre').eq('id', usuarioId).single();
    return data?.nombre || 'Un cliente';
  }

  return { guardarToken, borrarToken, enviarA, nombreDe };
}

// Instancia que usa la app (Supabase real + credencial de Render). Se crea
// al primer uso, así los tests pueden importar este archivo sin la base.
let instancia;
function obtenerPush() {
  if (!instancia) {
    instancia = crearPush({
      supabase: require('./db'),
      mensajeria: mensajeriaDesdeEntorno,
    });
  }
  return instancia;
}

module.exports = { crearPush, obtenerPush };
