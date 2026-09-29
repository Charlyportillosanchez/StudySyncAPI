// Avisos push de AutoSpot: qué se le dice a quién y cuándo.
//
// Cada función devuelve una promesa que nunca falla, así los controladores
// pueden llamarlas sin esperar ni preocuparse por errores de Firebase.
// `datos.tipo` le dice a la app qué pantalla abrir al tocar el aviso.

const { obtenerPush } = require('./push');

function avisar(tarea) {
  return Promise.resolve()
    .then(() => tarea(obtenerPush()))
    .catch((err) => console.error('[Avisos]', err.message));
}

const horasTexto = (h) => `${h} hora${Number(h) === 1 ? '' : 's'}`;

// Al dueño: le llegó una solicitud de reserva.
function reservaNueva(reserva, garaje) {
  return avisar(async (push) => {
    const cliente = await push.nombreDe(reserva.usuario_id);
    return push.enviarA([garaje.usuario_id], {
      titulo: `Nueva reserva en ${garaje.nombre}`,
      cuerpo: `${cliente} reservó ${horasTexto(reserva.horas)}. Tócala para aceptarla o rechazarla.`,
      datos: { tipo: 'reserva_nueva', reserva_id: reserva.id },
    });
  });
}

// Al cliente: el dueño aceptó o rechazó su reserva.
function reservaRevisada(reserva, garajeNombre, aceptada) {
  return avisar((push) => push.enviarA([reserva.usuario_id], aceptada
    ? {
        titulo: '¡Reserva aceptada! ✅',
        cuerpo: `${garajeNombre} te espera. Toca "Voy en camino" cuando salgas.`,
        datos: { tipo: 'reserva_revisada', reserva_id: reserva.id },
      }
    : {
        titulo: 'Reserva rechazada',
        cuerpo: `${garajeNombre} no pudo aceptar tu reserva. Busca otro garaje en el mapa.`,
        datos: { tipo: 'reserva_revisada', reserva_id: reserva.id },
      }));
}

// Al dueño: el cliente canceló.
function reservaCancelada(reserva, garaje) {
  return avisar(async (push) => {
    const cliente = await push.nombreDe(reserva.usuario_id);
    return push.enviarA([garaje.usuario_id], {
      titulo: 'Reserva cancelada',
      cuerpo: `${cliente} canceló su reserva en ${garaje.nombre}.`,
      datos: { tipo: 'reserva_cancelada', reserva_id: reserva.id },
    });
  });
}

// Al otro participante del chat.
function mensajeNuevo({ garaje, clienteId, emisorId, texto }) {
  return avisar(async (push) => {
    const escribeCliente = Number(emisorId) === Number(clienteId);
    const destinatario = escribeCliente ? garaje.usuario_id : Number(clienteId);
    if (destinatario == null || destinatario === Number(emisorId)) return 0;
    const titulo = escribeCliente ? await push.nombreDe(emisorId) : garaje.nombre;
    return push.enviarA([destinatario], {
      titulo: `💬 ${titulo}`,
      cuerpo: texto.length > 140 ? `${texto.slice(0, 137)}…` : texto,
      datos: {
        tipo: 'mensaje',
        garaje_id: garaje.id,
        cliente_id: clienteId,
        titulo,
      },
    });
  });
}

// Al dueño: el cliente tocó "Voy en camino".
function enCamino({ reservaId, clienteId, duenoId, garajeNombre }) {
  return avisar(async (push) => {
    const cliente = await push.nombreDe(clienteId);
    return push.enviarA([duenoId], {
      titulo: `🚗 ${cliente} va en camino`,
      cuerpo: `Toca para ver su auto llegando a ${garajeNombre} en vivo.`,
      datos: { tipo: 'en_camino', reserva_id: reservaId },
    });
  });
}

// Al dueño: el auto llegó al garaje.
function llego({ reservaId, clienteId, duenoId, garajeNombre }) {
  return avisar(async (push) => {
    const cliente = await push.nombreDe(clienteId);
    return push.enviarA([duenoId], {
      titulo: `¡${cliente} llegó! 🅿️`,
      cuerpo: `Está en la puerta de ${garajeNombre}.`,
      datos: { tipo: 'llego', reserva_id: reservaId },
    });
  });
}

module.exports = {
  reservaNueva,
  reservaRevisada,
  reservaCancelada,
  mensajeNuevo,
  enCamino,
  llego,
};
