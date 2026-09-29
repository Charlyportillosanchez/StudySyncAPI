const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AutoSpot API',
      version: '1.0.0',
      description: `
## API REST para gestión de sesiones de estudio y garajes

### Autenticación
Esta API usa **JWT Bearer Token**. Para usar los endpoints protegidos:
1. Registrate en **/auth/register**
2. Haz login en **/auth/login**
3. Copia el token recibido
4. Clic en **Authorize** arriba a la derecha
5. Escribe: \`Bearer tu_token_aqui\`

### Rate Limiting
Máximo **100 peticiones** por IP cada 15 minutos. Responde **429** si se supera el límite.
      `,
      contact: {
        name: 'Charly Portillo Sanchez',
        email: 'charly@gmail.com'
      }
    },
    servers: [
      {
        url: 'https://actividadesp4.onrender.com',
        description: 'Servidor de producción'
      },
      {
        url: 'http://localhost:3000',
        description: 'Servidor local'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Ingresa el token JWT obtenido del endpoint /auth/login'
        }
      },
      schemas: {
        Usuario: {
          type: 'object',
          properties: {
            nombre: { type: 'string', example: 'Charly Portillo' },
            email: { type: 'string', example: 'charly@gmail.com' },
            password: { type: 'string', example: '123456' }
          },
          required: ['nombre', 'email', 'password']
        },
        Login: {
          type: 'object',
          properties: {
            email: { type: 'string', example: 'charly@gmail.com' },
            password: { type: 'string', example: '123456' }
          },
          required: ['email', 'password']
        },
        Sesion: {
          type: 'object',
          properties: {
            tema: { type: 'string', example: 'Repaso de estructuras de datos' },
            materia: { type: 'string', example: 'Programación IV' },
            fecha: { type: 'string', example: '2026-05-28' }
          },
          required: ['tema', 'materia', 'fecha']
        },
        Garaje: {
          type: 'object',
          properties: {
            nombre: { type: 'string', example: 'Garaje Centro' },
            direccion: { type: 'string', example: '1er Anillo, Av. Monseñor Rivero' },
            anillo: { type: 'integer', example: 1 },
            precio_hora: { type: 'number', example: 5 },
            latitud: { type: 'number', example: -17.783721 },
            longitud: { type: 'number', example: -63.182136 }
          },
          required: ['nombre', 'direccion', 'anillo', 'precio_hora']
        },
        Reserva: {
          type: 'object',
          properties: {
            garaje_id: { type: 'integer', example: 1 },
            horas: { type: 'integer', example: 2 }
          },
          required: ['garaje_id', 'horas']
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Token requerido' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);