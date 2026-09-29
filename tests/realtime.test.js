// Pruebas del canal de tiempo real sin servidor: salas privadas e
// identificación del usuario con el JWT.
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'secreto-de-prueba';
const realtime = require('../src/realtime');

function ioFalso() {
  const registro = [];
  return {
    registro,
    emit: (evento, payload) => registro.push({ a: 'todos', evento, payload }),
    to: (salas) => ({
      emit: (evento, payload) => registro.push({ a: salas, evento, payload }),
    }),
  };
}

test('emitirA manda solo a las salas de esos usuarios, sin repetir', () => {
  const io = ioFalso();
  realtime.setIO(io);
  realtime.emitirA([7, 3, 7, null], 'chat:1:7', { texto: 'hola' });
  expect(io.registro).toEqual([
    { a: ['usuario:7', 'usuario:3'], evento: 'chat:1:7', payload: { texto: 'hola' } },
  ]);
});

test('emitir sigue siendo público para refrescar el mapa', () => {
  const io = ioFalso();
  realtime.setIO(io);
  realtime.emitir('actualizacion', { tipo: 'GARAJE_CREADO' });
  expect(io.registro[0].a).toBe('todos');
});

function socketCon(token) {
  return { handshake: { auth: token ? { token } : {} }, data: {} };
}

test('identificarSocket reconoce al usuario con un token válido', () => {
  const socket = socketCon(jwt.sign({ id: 7, rol: 'usuario' }, 'secreto-de-prueba'));
  const next = jest.fn();
  realtime.identificarSocket(socket, next);
  expect(socket.data.usuario.id).toBe(7);
  expect(next).toHaveBeenCalledWith();
});

test('sin token o con token falso la conexión sigue, pero anónima', () => {
  for (const token of [null, 'no-es-un-jwt', jwt.sign({ id: 7 }, 'otro-secreto')]) {
    const socket = socketCon(token);
    const next = jest.fn();
    realtime.identificarSocket(socket, next);
    expect(socket.data.usuario ?? null).toBeNull();
    expect(next).toHaveBeenCalledWith();
  }
});
