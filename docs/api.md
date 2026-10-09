# Contrato REST v1 y vistas

Las rutas usan sustantivos plurales en kebab-case. Los campos JSON usan snake_case. Las respuestas JSON son `{ "data": ... }` o `{ "error": { "code", "message" } }`.

| Vista del frontend | Ruta web | Colección de API |
| --- | --- | --- |
| Proyectos | `/projects` | `/api/v1/projects` |
| Resumen | `/projects/{id}` | `/api/v1/projects/{id}` y `/activities` |
| Tareas | `/projects/{id}/tasks` | `/api/v1/projects/{id}/tasks` |
| Planificación | `/projects/{id}/schedule` | `/calendar-events`, `/task-dependencies` |
| Hitos | `/projects/{id}/milestones` | `/milestones` |
| Equipo | `/projects/{id}/team` | `/members`, `/invitations` |
| Plano 2D | `/projects/{id}/editor` | `/blueprints` |
| Estudio 3D y Simulación | `/model`, `/simulation` | `/blueprints` |
| Documentos | `/documents` | `/documents` |
| Entregables | `/deliverables` | `/deliverable-packages` |
| Revisión del cliente | `/approvals` | `/approvals` |
| Conversaciones | `/comments` | `/comments` |
| Presupuesto | `/budget-items` | `/budget-items` |
| Incidencias | `/issues` | `/issues` |
| Panel y reportes | `/reports` | `/reports?locale=es` |
| Bitácora | `/change-log` | `/audit-entries` |
| Notificaciones | `/notifications` | `/notifications` |
| Portal del cliente | `/client-portal` | Recursos autorizados de documentos, paquetes, revisiones y comentarios |

La columna de API omite el prefijo `/api/v1/projects/{id}` después de la primera fila. `GET` lista o lee, `POST` crea, `PATCH` actualiza y `DELETE` elimina donde el dominio lo permite. Una creación devuelve `201` y `Location`; una eliminación devuelve `204`. Los registros individuales devuelven `ETag`; `PATCH`/`DELETE` requieren `If-Match` (`428` si falta, `409` si la revisión cambió). `audit-entries` y `activities` son solo lectura. `change-log` se acepta temporalmente como alias de `audit-entries` para clientes antiguos.

Autenticación: `POST /api/v1/users` registra una cuenta, `GET/POST/DELETE /api/v1/sessions` consulta, inicia o cierra sesión. `GET/POST /api/v1/invitations/{token}` inspecciona o acepta una invitación. Todas las rutas de proyecto exigen sesión y pertenencia; la política de roles se aplica en el servidor. Las rutas de herramientas como `/editor` son vistas web, no recursos CRUD.
