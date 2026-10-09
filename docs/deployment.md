# Despliegue en Render con PostgreSQL de Supabase

## 1. Preparar Supabase

1. Crea el proyecto y conserva la contraseña de la base fuera del repositorio.
2. En **Connect**, copia la cadena del **Session pooler** (puerto 5432) para el servicio persistente de Render. El pooler de sesión funciona también desde redes IPv4. La conexión directa es válida si el entorno de Render puede alcanzar IPv6 o el proyecto tiene la opción IPv4.
3. Usa TLS. El backend valida el certificado; si tu conexión necesita la CA de Supabase, descárgala y establece `DATABASE_CA_PATH` con su ruta en Render. Codifica los caracteres especiales de la contraseña en `DATABASE_URL`.
4. No añadas el esquema `teluria` a los esquemas expuestos por la Data API de Supabase. El navegador solo accede mediante la API de Render.

Referencias: [métodos de conexión de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [seguridad de datos](https://supabase.com/docs/guides/database/secure-data).

## 2. Preparar Render

`render.yaml` configura un servicio Node, `npm ci`, `npm start` y la comprobación `/api/health`. Al arrancar, el servidor aplica las migraciones versionadas con un bloqueo de PostgreSQL antes de abrir el puerto; así funciona también en el plan gratuito de Render. En un servicio de pago puedes añadir `preDeployCommand: npm run db:migrate` para migrar antes de iniciar la nueva versión. Si el repositorio de Git contiene solo `teluria-backend`, usa el archivo tal cual. Si Git usa un monorepo, coloca `render.yaml` en la raíz del repositorio y añade `rootDir: teluria-backend` al servicio.

Configura estas variables secretas en Render:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Cadena de **Session pooler** de Supabase; no se expone al frontend |
| `DATABASE_CA_PATH` | Ruta del certificado CA si se usa un archivo accesible al servicio |
| `TELURIA_ALLOWED_ORIGINS` | Origen HTTPS exacto del frontend; varios separados por coma |
| `TELURIA_FRONTEND_URL` | URL pública del frontend para enlaces de invitación |
| `TELURIA_OWNER_EMAIL` | Correo autorizado para registrar la primera cuenta de una base vacía |
| `NODE_ENV` | `production` (incluido en `render.yaml`) |

Render proporciona `PORT`; el proceso escucha en `0.0.0.0`. La cookie lleva `Secure` en producción. La API permite solo los orígenes listados y exige `Origin` en escrituras autenticadas. La UI usa el rewrite de Next para enviar solicitudes `/api/v1/*` al backend con una cookie de mismo origen. Configura `TELURIA_API_URL` en el despliegue del frontend con la URL HTTPS pública del backend.

Referencias: [servicios web de Render](https://render.com/docs/web-services), [comandos previos al despliegue](https://render.com/docs/deploys), [Blueprint](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks).

## 3. Datos existentes

Antes de importar, haz una copia de `.data/ark.sqlite` junto con sus archivos `-wal` y `-shm`. En la máquina que conserva esos archivos y puede conectarse a Supabase:

```powershell
npm run db:import
npm run db:import -- --apply
```

La primera orden informa cantidades y referencias rotas sin conectarse a Supabase. La segunda aplica todas las filas en una transacción a una base vacía. Usa `--source RUTA` para indicar otro SQLite o el JSON semilla. Las sesiones no se copian; los usuarios y sus hashes de contraseña sí. El archivo original permanece intacto. No ejecutes `--apply` sobre una base que ya contenga datos.

Los despliegues posteriores ejecutan migraciones versionadas e idempotentes. Configura copias de seguridad y prueba una restauración antes de usar datos de producción. Aún faltan recuperación/verificación de correo y almacenamiento externo de archivos para un SaaS público.
