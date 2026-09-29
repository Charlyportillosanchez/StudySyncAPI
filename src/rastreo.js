// Rastreo en vivo del auto (lo que la app llama "Voy en camino").
//
// Antes el servidor reenviaba cada ubicación a TODOS los conectados, así
// que cualquiera podía ver dónde estaba cualquier cliente. Ahora:
//   - solo se acepta la ubicación que envía el cliente dueño de la reserva,
//   - y solo se reenvía al propietario del garaje de esa reserva.
//
// Se recibe una ubicación por segundo por auto, así que los datos de cada
// reserva se guardan un minuto en memoria para no consultar la base cada vez.

const DURACION_CACHE_MS = 60 * 1000;

// El aviso push "va en camino" se manda una vez por viaje (no con cada
// ubicación); si vuelve a salir después de este tiempo, se avisa de nuevo.
const PAUSA_AVISO_MS = 30 * 60 * 1000;

const sinAvisos = { enCamino: () => {}, llego: () => {} };

function crearRastreo({ supabase, emitirA, avisos = sinAvisos, ahora = () => Date.now() }) {
  const cache = new Map();
  const ultimoAviso = new Map();

  async function datosReserva(reservaId) {
    const guardado = cache.get(reservaId);
    if (guardado && guardado.vence > ahora()) return guardado.info;

    const { data } = await supabase
      .from('reservas')
      .select('id, usuario_id, estado, garajes(usuario_id, nombre)')
      .eq('id', reservaId)
      .single();

    const info = data
      ? {
          clienteId: data.usuario_id,
          duenoId: data.garajes?.usuario_id ?? null,
          garajeNombre: data.garajes?.nombre || 'tu garaje',
          activa: data.estado === 'activa',
        }
      : null;
    // También se recuerda "no existe" para que un id inventado no
    // provoque una consulta por segundo.
    cache.set(reservaId, { info, vence: ahora() + DURACION_CACHE_MS });
    return info;
  }

  function numeroEn(valor, min, max) {
    const n = Number(valor);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  // Devuelve true si el evento se reenvió al dueño del garaje.
  async function reenviar(usuario, evento, data) {
    if (!usuario || usuario.id == null || !data) return false;
    const reservaId = Number(data.reservaId);
    if (!Number.isInteger(reservaId)) return false;

    const info = await datosReserva(reservaId);
    if (!info || info.clienteId !== usuario.id || info.duenoId == null) {
      return false;
    }

    if (evento === 'ubicacion') {
      if (!info.activa) return false;
      const lat = numeroEn(data.lat, -90, 90);
      const lng = numeroEn(data.lng, -180, 180);
      if (lat == null || lng == null) return false;
      const rumbo = numeroEn(data.rumbo, 0, 360);
      const velocidad = numeroEn(data.velocidad, 0, 100);
      // Se reenvía solo lo que la app usa (nada de campos extra del emisor).
      emitirA([info.duenoId], 'ubicacion', {
        reservaId,
        lat,
        lng,
        ...(rumbo != null ? { rumbo } : {}),
        ...(velocidad != null ? { velocidad } : {}),
      });

      const avisado = ultimoAviso.get(reservaId);
      if (avisado == null || ahora() - avisado > PAUSA_AVISO_MS) {
        ultimoAviso.set(reservaId, ahora());
        avisos.enCamino(datosAviso(reservaId, info));
      }
      return true;
    }

    if (evento === 'fin_ubicacion') {
      emitirA([info.duenoId], 'fin_ubicacion', {
        reservaId,
        ...(data.llego === true ? { llego: true } : {}),
      });
      ultimoAviso.delete(reservaId);
      if (data.llego === true) avisos.llego(datosAviso(reservaId, info));
      return true;
    }

    return false;
  }

  function datosAviso(reservaId, info) {
    return {
      reservaId,
      clienteId: info.clienteId,
      duenoId: info.duenoId,
      garajeNombre: info.garajeNombre,
    };
  }

  return { reenviar, datosReserva };
}

module.exports = { crearRastreo, DURACION_CACHE_MS, PAUSA_AVISO_MS };
