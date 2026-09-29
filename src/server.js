const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { setIO, emitirA, identificarSocket, salaDe } = require('./realtime');
const { crearRastreo } = require('./rastreo');
dotenv.config();

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger/config');

const app = express();

// Seguridad con Helmet
app.use(helmet());

// Rate Limiting - 2000 peticiones por 15 minutos.
// La app consulta datos con frecuencia (mapa, garajes, reservas, vehículos),
// por eso el límite es amplio para no frenar el uso normal.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Demasiadas peticiones, intenta en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// CORS
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://actividadesp4.onrender.com',
      'https://timely-klepon-d2c121.netlify.app',
      'https://admirable-dango-13a1f3.netlify.app'
    ];
    // Se permite cualquier sitio de Netlify (deploys de la app web)
    // además de los orígenes de la lista y localhost para desarrollo.
    if (!origin || origin.startsWith('http://localhost') || origin.endsWith('.netlify.app') || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Límite de 6 MB para permitir la subida de fotos de garajes en base64.
app.use(express.json({ limit: '6mb' }));

const sesionesRoutes = require('./routes/sesiones.routes');
const authRoutes = require('./routes/auth');
const garajesRoutes = require('./routes/garajes.routes');
const reservasRoutes = require('./routes/reservas.routes');

app.get('/', (req, res) => {
  res.json({ 
    mensaje: 'IoTGaraje API funcionando',
    version: '1.0.0',
    docs: '/api-docs'
  });
});

app.use('/api/sesiones', sesionesRoutes);
app.use('/auth', authRoutes);
app.use('/api/garajes', garajesRoutes);
app.use('/api/reservas', reservasRoutes);
app.use('/api/chat', require('./routes/chat.routes'));
app.use('/api/vehiculos', require('./routes/vehiculos.routes'));
app.use('/api/dispositivos', require('./routes/dispositivos.routes'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

require('./subscribers/notificaciones');

// --- WebSockets: actualizaciones en tiempo real ---
// Los clientes (app Flutter) se conectan y reciben eventos al instante
// cuando alguien crea un garaje, reserva, cancela o manda un mensaje.
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
setIO(io);
io.use(identificarSocket);

const supabase = require('./db');
const rastreo = crearRastreo({ supabase, emitirA, avisos: require('./avisos') });

io.on('connection', (socket) => {
  const usuario = socket.data.usuario;
  console.log(`[Socket] Cliente conectado: ${socket.id}` +
    (usuario ? ` (usuario ${usuario.id})` : ' (anónimo)'));

  // Cada usuario identificado entra a su sala privada: ahí le llegan sus
  // mensajes de chat y la ubicación de los autos que van a sus garajes.
  if (usuario && usuario.id != null) socket.join(salaDe(usuario.id));

  // Rastreo en vivo: el cliente que va en camino envía su ubicación y el
  // servidor la reenvía solo al dueño del garaje de esa reserva.
  socket.on('ubicacion', (data) => {
    rastreo.reenviar(usuario, 'ubicacion', data).catch((err) =>
      console.error('[Socket] Error en ubicacion:', err.message));
  });

  // El cliente avisa que dejó de compartir (llegó o canceló).
  socket.on('fin_ubicacion', (data) => {
    rastreo.reenviar(usuario, 'fin_ubicacion', data).catch((err) =>
      console.error('[Socket] Error en fin_ubicacion:', err.message));
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Cliente desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));