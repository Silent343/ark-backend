# Teluria backend

API REST de Ark/Teluria en Node.js. Es un monolito modular: un proceso HTTP, módulos de dominio separados y una base PostgreSQL. El frontend Next.js consume esta API mediante un rewrite de mismo origen.

## Ejecutar localmente

Requiere Node.js 22.5+ y PostgreSQL. En esta carpeta:

```powershell
npm ci
Copy-Item .env.example .env
# Edita DATABASE_URL y TELURIA_OWNER_EMAIL en .env
npm run db:migrate
npm run db:import              # revisión en seco del SQLite existente
npm run db:import -- --apply   # opcional: importa a una base PostgreSQL vacía
npm run dev
```

En el frontend configura `TELURIA_API_URL=http://127.0.0.1:8000` y ejecuta `npm run dev`. `GET /api/health` comprueba la conexión a PostgreSQL.

La importación nunca modifica el SQLite o JSON original. Si el PostgreSQL ya tiene datos, se detiene antes de escribir. No importa sesiones antiguas: cada persona inicia sesión de nuevo. Para crear una instalación sin datos previos, omite `db:import` y registra primero el correo definido en `TELURIA_OWNER_EMAIL`; después, los nuevos registros requieren una invitación vigente.

## Estructura

```text
src/
  modules/<bounded-context>/domain/         reglas e invariantes
  modules/<bounded-context>/application/    casos de uso y políticas
  modules/<bounded-context>/infrastructure/ adaptadores propios cuando hacen falta
  composition/application/                 transacciones entre contextos
  shared/domain/                            identidad y revisión de recursos
  shared/application/                       operaciones CRUD comunes
  shared/infrastructure/postgres/           repositorio, migraciones e importación
  server.js                                 entrega HTTP
migrations/                                 esquema versionado
```

El dominio no importa infraestructura. Los casos de uso reciben un repositorio transaccional; composición coordina flujos que cruzan módulos. Los cambios y las notificaciones se escriben en la misma transacción que el recurso. La bitácora es inmutable en PostgreSQL. No se necesita un bus de eventos para este historial local; un outbox transaccional será adecuado cuando se añadan correo, WebSockets u otros consumidores externos.

## Base de datos y seguridad

Las tablas residen en el esquema privado `teluria`. Proyectos, usuarios, miembros, tareas, versiones, aprobaciones, dependencias, paquetes y destinatarios tienen claves foráneas y restricciones de unicidad. Las asociaciones polimórficas de bitácora y notificaciones conservan identificadores históricos incluso después de borrar un recurso. Las referencias a elementos del plano se verifican dentro del agregado `blueprint`, pues no son filas independientes.

La API usa contraseñas con scrypt, tokens de sesión almacenados como hash, cookie HttpOnly/SameSite, límites de login persistidos en PostgreSQL, permisos por proyecto y rol, ETags/`If-Match`, validación de cuerpos JSON, un límite de 4,3 MB por solicitud y CORS de orígenes explícitos. El código no contiene claves de Supabase.

Para la nomenclatura REST y el mapa de vistas del frontend, consulta [docs/api.md](docs/api.md). Para Render y Supabase, consulta [docs/deployment.md](docs/deployment.md).

## Verificación

```powershell
npm test               # esquema, FK, API e importación real ensayada en PostgreSQL embebido
npm run test:contract  # suites del frontend, si está disponible en la carpeta hermana
```

El almacenamiento de archivos sigue usando `file_data` en los agregados JSONB con máximo de 3 MiB, por compatibilidad con la UI. Para un volumen alto de documentos conviene migrarlo a almacenamiento de objetos con referencias en PostgreSQL. Las preferencias visuales y algunos ajustes del terreno siguen siendo locales al navegador.
