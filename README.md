# StudySync API — IoTGaraje

**Alumno:** Charly Portillo Sanchez  
**Materia:** Programación IV — UPDS 2026

## Descripción
API REST para gestión de sesiones de estudio y garajes con base de datos en la nube, notificaciones en tiempo real y autenticación JWT.

## ¿Por qué Redis y no solo Supabase?

| | Supabase | Redis |
|--|---------|-------|
| **Para qué** | Persistencia de datos | Notificaciones en tiempo real |
| **Velocidad** | Consultas SQL | Microsegundos |
| **Uso** | Guardar datos permanentes | Pub/Sub y caché |
| **Conclusión** | Son complementarios, no competidores |

## Arquitectura

┌─────────────────┐     HTTP/JWT    ┌──────────────────────┐
│  Thunder Client  │ ─────────────► │   API REST (Express)  │
│  Flutter Web App │                │   Render.com          │
└─────────────────┘                └──────┬───────┬────────┘
│       │
┌───────────┘       └───────────┐
│                               │
▼                               ▼
┌─────────────────┐             ┌─────────────────┐
│    Supabase     │             │  Upstash Redis  │
│  PostgreSQL     │             │   Pub/Sub       │
│  (Persistencia) │             │  (Tiempo Real)  │
└─────────────────┘             └────────┬────────┘
│
▼
┌─────────────────┐
│  subscriber.js  │
│ (Notificaciones)│
└─────────────────┘
## Flujo completo
1. Cliente hace POST /api/sesiones con token JWT
2. API valida el token
3. API guarda en Supabase (persistencia)
4. API publica evento en Redis (tiempo real)
5. Subscriber recibe y procesa el evento

## Endpoints

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | /auth/register | Registrar usuario | No |
| POST | /auth/login | Iniciar sesión | No |
| GET | /api/sesiones | Listar sesiones | No |
| GET | /api/sesiones/:id | Obtener sesión | No |
| POST | /api/sesiones | Crear sesión | JWT |
| PUT | /api/sesiones/:id | Actualizar sesión | JWT |
| DELETE | /api/sesiones/:id | Eliminar sesión | JWT |
| GET | /api/garajes | Listar garajes | No |
| POST | /api/garajes | Crear garaje | JWT |
| DELETE | /api/garajes/:id | Eliminar garaje | JWT |
| GET | /api/reservas | Mis reservas | JWT |
| POST | /api/reservas | Crear reserva | JWT |
| PUT | /api/reservas/:id/cancelar | Cancelar reserva | JWT |

## URL de Producción
- **API:** https://actividadesp4.onrender.com
- **Docs:** https://actividadesp4.onrender.com/api-docs
- **App:** https://timely-klepon-d2c121.netlify.app

## Tecnologías
- Node.js + Express
- Supabase (PostgreSQL)
- Upstash Redis (Pub/Sub)
- JWT (Autenticación)
- Swagger (Documentación)
- Render (Despliegue)
- Flutter (App móvil/web)

## Cómo ejecutar localmente
1. Clonar el repositorio
2. Ejecutar `npm install`
3. Crear archivo `.env` con las variables
4. Ejecutar `npm start`
5. En otra terminal: `node subscriber.js`
