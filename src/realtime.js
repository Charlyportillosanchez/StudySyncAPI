// Canal de tiempo real (WebSockets con socket.io).
//
// Guardamos la instancia de io aquí para que los controladores puedan
// emitir eventos sin importar server.js (evita dependencias circulares).

const jwt = require('jsonwebtoken');

let io = null;

function setIO(instancia) {
  io = instancia;
}

// Sala privada de cada usuario: todas sus sesiones abiertas entran a ella.
function salaDe(usuarioId) {
  return `usuario:${usuarioId}`;
}

// Emite un evento público a todos los clientes conectados. Solo para datos
// que cualquiera puede ver (ej. "se creó un garaje", para refrescar el mapa).
function emitir(evento, payload) {
  if (io) io.emit(evento, payload);
}

// Emite un evento privado solo a las sesiones de esos usuarios
// (chat, ubicación en vivo).
function emitirA(usuarioIds, evento, payload) {
  if (!io) return;
  const salas = [...new Set(
    usuarioIds.filter((id) => id != null).map((id) => salaDe(id)),
  )];
  if (salas.length > 0) io.to(salas).emit(evento, payload);
}

// Middleware de socket.io: identifica al usuario con el JWT que la app
// manda en `auth.token`. Sin token (o vencido) la conexión sigue, pero
// anónima: solo recibe los eventos públicos.
function identificarSocket(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token) {
    try {
      socket.data.usuario = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      socket.data.usuario = null;
    }
  }
  next();
}

module.exports = { setIO, emitir, emitirA, identificarSocket, salaDe };
