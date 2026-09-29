// Pruebas de las notificaciones push sin Firebase ni base de datos reales.
const { crearPush } = require('../src/push');

// Base falsa: solo lo que usa push.js sobre la tabla `dispositivos`.
function supabaseFalso(filas) {
  const falso = { filas: [...filas], borrados: [] };
  falso.from = () => ({
    select: () => ({
      in: async (_, ids) => ({ data: falso.filas.filter((f) => ids.includes(f.usuario_id)) }),
    }),
    delete: () => ({
      in: async (_, tokens) => {
        falso.borrados.push(...tokens);
        falso.filas = falso.filas.filter((f) => !tokens.includes(f.token));
        return {};
      },
    }),
  });
  return falso;
}

function mensajeriaFalsa(errores = {}) {
  const falsa = { enviados: [] };
  falsa.sendEachForMulticast = async (mensaje) => {
    falsa.enviados.push(mensaje);
    const responses = mensaje.tokens.map((t) =>
      errores[t] ? { success: false, error: { code: errores[t] } } : { success: true });
    return { responses, successCount: responses.filter((r) => r.success).length };
  };
  return falsa;
}

const aviso = { titulo: 'Nueva reserva', cuerpo: 'Lucía reservó 2 horas', datos: { tipo: 'reserva_nueva', reserva_id: 22 } };

test('envía el aviso a todos los teléfonos del usuario', async () => {
  const supabase = supabaseFalso([
    { usuario_id: 3, token: 'telefono-a' },
    { usuario_id: 3, token: 'telefono-b' },
    { usuario_id: 9, token: 'de-otra-persona' },
  ]);
  const mensajeria = mensajeriaFalsa();
  const push = crearPush({ supabase, mensajeria });

  expect(await push.enviarA([3], aviso)).toBe(2);
  const enviado = mensajeria.enviados[0];
  expect(enviado.tokens).toEqual(['telefono-a', 'telefono-b']);
  expect(enviado.notification).toEqual({ title: 'Nueva reserva', body: 'Lucía reservó 2 horas' });
  // FCM solo acepta textos en `data`.
  expect(enviado.data).toEqual({ tipo: 'reserva_nueva', reserva_id: '22' });
});

test('borra los teléfonos que ya no existen (app desinstalada)', async () => {
  const supabase = supabaseFalso([
    { usuario_id: 3, token: 'vigente' },
    { usuario_id: 3, token: 'desinstalada' },
  ]);
  const mensajeria = mensajeriaFalsa({ desinstalada: 'messaging/registration-token-not-registered' });
  const push = crearPush({ supabase, mensajeria });

  expect(await push.enviarA([3], aviso)).toBe(1);
  expect(supabase.borrados).toEqual(['desinstalada']);
});

test('sin credencial de Firebase no envía nada y no rompe', async () => {
  const supabase = supabaseFalso([{ usuario_id: 3, token: 'telefono-a' }]);
  const push = crearPush({ supabase, mensajeria: () => null });
  expect(await push.enviarA([3], aviso)).toBe(0);
});

test('si Firebase falla, devuelve 0 en vez de lanzar el error', async () => {
  const supabase = supabaseFalso([{ usuario_id: 3, token: 'telefono-a' }]);
  const mensajeria = { sendEachForMulticast: async () => { throw new Error('Firebase caído'); } };
  const push = crearPush({ supabase, mensajeria });
  const consola = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(await push.enviarA([3], aviso)).toBe(0);
  consola.mockRestore();
});

test('un usuario sin teléfonos registrados no genera envío', async () => {
  const supabase = supabaseFalso([]);
  const mensajeria = mensajeriaFalsa();
  const push = crearPush({ supabase, mensajeria });
  expect(await push.enviarA([3], aviso)).toBe(0);
  expect(mensajeria.enviados).toHaveLength(0);
});
