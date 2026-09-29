const supabase = require('../db');
const { emitirA } = require('../realtime');
const avisos = require('../avisos');

// Una conversación se identifica por (garaje_id, cliente_id).
// Participantes válidos: el cliente y el dueño del garaje (o un admin).
async function puedeParticipar(garajeId, clienteId, usuario) {
  const { data: garaje } = await supabase
    .from('garajes').select('id, nombre, usuario_id').eq('id', garajeId).single();
  if (!garaje) return { ok: false, status: 404, mensaje: 'Garaje no encontrado' };

  const esCliente = usuario.id === Number(clienteId);
  const esPropietario = usuario.id === garaje.usuario_id;
  if (!esCliente && !esPropietario && usuario.rol !== 'admin') {
    return { ok: false, status: 403, mensaje: 'No participas en esta conversación' };
  }
  return { ok: true, garaje };
}

// GET /api/chat/conversaciones — todas mis conversaciones
// (como cliente que escribió, y como propietario que recibió mensajes).
exports.conversaciones = async (req, res) => {
  // Mensajes donde soy el cliente.
  const { data: comoCliente, error: e1 } = await supabase
    .from('mensajes')
    .select('garaje_id, cliente_id, texto, created_at, garajes(nombre, usuario_id)')
    .eq('cliente_id', req.usuario.id)
    .order('created_at', { ascending: false });
  if (e1) return res.status(500).json({ error: e1.message });

  // Mensajes en mis garajes (soy propietario).
  const { data: misGarajes } = await supabase
    .from('garajes').select('id').eq('usuario_id', req.usuario.id);
  const ids = (misGarajes || []).map((g) => g.id);

  let comoPropietario = [];
  if (ids.length > 0) {
    const { data, error: e2 } = await supabase
      .from('mensajes')
      .select('garaje_id, cliente_id, texto, created_at, garajes(nombre, usuario_id), usuarios!mensajes_cliente_id_fkey(nombre)')
      .in('garaje_id', ids)
      .order('created_at', { ascending: false });
    if (e2) return res.status(500).json({ error: e2.message });
    comoPropietario = data || [];
  }

  // Agrupamos por conversación y nos quedamos con el último mensaje.
  const mapa = new Map();
  for (const m of [...(comoCliente || []), ...comoPropietario]) {
    const clave = `${m.garaje_id}:${m.cliente_id}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        garaje_id: m.garaje_id,
        cliente_id: m.cliente_id,
        garaje_nombre: m.garajes?.nombre || 'Garaje',
        cliente_nombre: m.usuarios?.nombre || null,
        soy_propietario: m.garajes?.usuario_id === req.usuario.id,
        ultimo_mensaje: m.texto,
        fecha: m.created_at,
      });
    }
  }

  const lista = [...mapa.values()].sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha));
  res.status(200).json(lista);
};

// GET /api/chat/:garajeId/:clienteId — mensajes de una conversación
exports.mensajes = async (req, res) => {
  const { garajeId, clienteId } = req.params;
  const permiso = await puedeParticipar(garajeId, clienteId, req.usuario);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.mensaje });

  const { data, error } = await supabase
    .from('mensajes')
    .select('id, emisor_id, texto, created_at')
    .eq('garaje_id', garajeId)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  res.status(200).json({
    garaje: { id: permiso.garaje.id, nombre: permiso.garaje.nombre },
    propietario_id: permiso.garaje.usuario_id,
    mensajes: data,
  });
};

// POST /api/chat/:garajeId/:clienteId — enviar mensaje
exports.enviar = async (req, res) => {
  const { garajeId, clienteId } = req.params;
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  if (texto.length > 500) {
    return res.status(400).json({ error: 'El mensaje no puede superar 500 caracteres' });
  }

  const permiso = await puedeParticipar(garajeId, clienteId, req.usuario);
  if (!permiso.ok) return res.status(permiso.status).json({ error: permiso.mensaje });

  const { data, error } = await supabase
    .from('mensajes')
    .insert([{
      garaje_id: Number(garajeId),
      cliente_id: Number(clienteId),
      emisor_id: req.usuario.id,
      texto,
    }])
    .select('id, emisor_id, texto, created_at');
  if (error) return res.status(500).json({ error: error.message });

  // Tiempo real: solo los dos participantes (cliente y dueño) lo reciben.
  emitirA(
    [Number(clienteId), permiso.garaje.usuario_id],
    `chat:${garajeId}:${clienteId}`,
    data[0],
  );
  // Y si tiene la app cerrada, le llega como notificación.
  avisos.mensajeNuevo({
    garaje: permiso.garaje,
    clienteId: Number(clienteId),
    emisorId: req.usuario.id,
    texto,
  });

  res.status(201).json(data[0]);
};
