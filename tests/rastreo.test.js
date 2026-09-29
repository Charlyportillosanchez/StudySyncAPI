// Pruebas del rastreo en vivo sin base de datos ni servidor real.
const { crearRastreo, DURACION_CACHE_MS } = require('../src/rastreo');

// Reserva 10: cliente 7, garaje del dueño 3, activa.
// Reserva 11: cliente 7, garaje del dueño 3, finalizada.
const reservas = {
  10: { id: 10, usuario_id: 7, estado: 'activa', garajes: { usuario_id: 3 } },
  11: { id: 11, usuario_id: 7, estado: 'finalizada', garajes: { usuario_id: 3 } },
};

function supabaseFalso() {
  const falso = { consultas: 0 };
  falso.from = () => ({
    select: () => ({
      eq: (_, id) => ({
        single: async () => {
          falso.consultas++;
          return { data: reservas[id] || null };
        },
      }),
    }),
  });
  return falso;
}

function preparar() {
  const supabase = supabaseFalso();
  const enviados = [];
  let reloj = 0;
  const rastreo = crearRastreo({
    supabase,
    emitirA: (ids, evento, payload) => enviados.push({ ids, evento, payload }),
    ahora: () => reloj,
  });
  return {
    rastreo,
    supabase,
    enviados,
    avanzar: (ms) => { reloj += ms; },
  };
}

const cliente = { id: 7 };
const intruso = { id: 99 };

test('la ubicación del cliente llega solo al dueño del garaje', async () => {
  const { rastreo, enviados } = preparar();
  const ok = await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 10, lat: -17.78, lng: -63.18, rumbo: 90 });
  expect(ok).toBe(true);
  expect(enviados).toEqual([{
    ids: [3],
    evento: 'ubicacion',
    payload: { reservaId: 10, lat: -17.78, lng: -63.18, rumbo: 90 },
  }]);
});

test('nadie más puede mandar ubicación en nombre de otra reserva', async () => {
  const { rastreo, enviados } = preparar();
  expect(await rastreo.reenviar(intruso, 'ubicacion',
    { reservaId: 10, lat: -17.78, lng: -63.18 })).toBe(false);
  expect(await rastreo.reenviar(null, 'ubicacion',
    { reservaId: 10, lat: -17.78, lng: -63.18 })).toBe(false);
  expect(enviados).toHaveLength(0);
});

test('no se reenvía ubicación de reservas no activas ni datos inválidos', async () => {
  const { rastreo, enviados } = preparar();
  expect(await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 11, lat: -17.78, lng: -63.18 })).toBe(false);
  expect(await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 10, lat: 'hola', lng: -63.18 })).toBe(false);
  expect(await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 10, lat: 200, lng: -63.18 })).toBe(false);
  expect(await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 999, lat: -17.78, lng: -63.18 })).toBe(false);
  expect(enviados).toHaveLength(0);
});

test('no se reenvían campos extra que mande el emisor', async () => {
  const { rastreo, enviados } = preparar();
  await rastreo.reenviar(cliente, 'ubicacion',
    { reservaId: 10, lat: -17.78, lng: -63.18, spam: '<script>' });
  expect(enviados[0].payload).toEqual({ reservaId: 10, lat: -17.78, lng: -63.18 });
});

test('fin_ubicacion avisa al dueño si el auto llegó, aunque la reserva ya no esté activa', async () => {
  const { rastreo, enviados } = preparar();
  await rastreo.reenviar(cliente, 'fin_ubicacion', { reservaId: 11, llego: true });
  expect(enviados).toEqual([{
    ids: [3], evento: 'fin_ubicacion', payload: { reservaId: 11, llego: true },
  }]);
});

test('consulta la base una vez por minuto por reserva, no en cada ubicación', async () => {
  const { rastreo, supabase, avanzar } = preparar();
  for (let i = 0; i < 30; i++) {
    await rastreo.reenviar(cliente, 'ubicacion', { reservaId: 10, lat: -17.78, lng: -63.18 });
    avanzar(1000);
  }
  expect(supabase.consultas).toBe(1);
  avanzar(DURACION_CACHE_MS);
  await rastreo.reenviar(cliente, 'ubicacion', { reservaId: 10, lat: -17.78, lng: -63.18 });
  expect(supabase.consultas).toBe(2);
});

test('un id de reserva inventado tampoco consulta la base en cada intento', async () => {
  const { rastreo, supabase } = preparar();
  for (let i = 0; i < 10; i++) {
    await rastreo.reenviar(intruso, 'ubicacion', { reservaId: 555, lat: 0, lng: 0 });
  }
  expect(supabase.consultas).toBe(1);
});
