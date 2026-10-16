# Modelos privados en Supabase Storage y Render

El backend puede instalar un paquete de inferencia fijado por SHA-256 **antes de abrir la API**. No entrena en Render ni necesita Python para inferir. El instalador no descarga modelos nuevos por su nombre: reconstruye exactamente los archivos del paquete elegido, verifica cada fragmento y archivo, valida los manifiestos y activa un directorio de versión inmutable.

Sin `ARK_MODEL_BUNDLE_KEY`, `npm start` conserva el comportamiento anterior. Con un paquete configurado, una instalación fallida detiene el arranque: no usa silenciosamente otra versión. `npm run dev` no ejecuta el instalador.

## 1. Preparar los artefactos en tu equipo

Desde la carpeta del backend:

```powershell
npm run models:prepare
```

Genera `.data/model-bundles/<release>/`, fuera de Git. Solo incluye estos cinco modelos, sus manifiestos, el informe del candidato de objetos y los avisos/licencias:

- `cubicasa-multitask-v1`: referencia del enfoque y modelo base.
- `ark-architecture-pilot-v1`: piloto de aberturas.
- `ark-architecture-pilot-v2`: candidato de espacios/suelos conservando aberturas.
- Carpeta `ark-objects-pilot-v2`: modelo predeterminado de 82 muestras, ID contractual `ark-objects-pilot-v1`.
- Carpeta `ark-objects-pilot-v4`: candidato de 350 muestras, ID contractual `ark-objects-pilot-v2`.

Las versiones de carpeta e ID de objetos son distintas intencionalmente. No se promueve el candidato por instalarlo. No se incluyen planos, bases de datos, imágenes, anotaciones, `.pt`, `.pkl`, Python ni credenciales.

La preparación produce la ruta local y los valores exactos `ARK_MODEL_BUNDLE_KEY` y `ARK_MODEL_BUNDLE_SHA256`. Conserva esos valores juntos. Para una nueva revisión puedes usar `npm run models:prepare -- --release ark-research-nueva-revision`. Si cambia la versión local de Ultralytics, indica su archivo de licencia completo con `--objects-license RUTA_AL_LICENSE`.

Los archivos ONNX se dividen en fragmentos de **4 MiB**. Se suben como objetos binarios, sin cambiar los bytes originales. Esto evita necesitar una subida individual de unos 70 MB por cada modelo de arquitectura y mantiene las solicitudes bajo los 6 MB recomendados para subidas estándar. [Supabase: subidas estándar](https://supabase.com/docs/guides/storage/uploads/standard-uploads).

## 2. Configurar Supabase (lo hace el propietario)

1. Copia la **Project URL** HTTPS estándar desde Supabase (`https://<ref>.supabase.co`, sin `/storage` ni `/rest/v1`).
2. En **Settings → API Keys**, crea o copia una **secret key** de servidor (`sb_secret_...`). No uses una publishable/anon key. La alternativa legada es `SUPABASE_SERVICE_ROLE_KEY`, pero configura solo una de las dos.
3. Guarda estos valores localmente, nunca en Git ni en el frontend:

```powershell
Copy-Item config/models-storage.env.example .env.models
```

Edita `.env.models` con tu URL, clave y los dos valores exactos que imprimió `models:prepare`. El archivo está ignorado por Git. No lo envíes por chat.

4. Crea el bucket privado con el comando siguiente, o desde **Storage → New bucket**, nombre `ark-models`, **Public desactivado**, límite por archivo de al menos 4 MiB y MIME binario/JSON permitidos:

```powershell
node --env-file=.env.models scripts/setup-model-storage.mjs --apply
```

Sin `--apply` solo muestra el plan. El comando crea un bucket **privado**, con límite de 6 MiB y tipos binario/JSON/texto. No crea políticas para `anon` o `authenticated`, ni vuelve privado automáticamente un bucket público: si ya es público, se detiene antes de transferir archivos. Las claves de servidor tienen acceso elevado; mantenlas exclusivamente en equipos y servicios que controlas. [Claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [acceso a Storage](https://supabase.com/docs/guides/storage/security/access-control).

## 3. Subir el paquete privado

Sustituye `<release>` por la carpeta exacta que imprimió la preparación:

```powershell
node --env-file=.env.models scripts/publish-model-bundle.mjs --bundle .data/model-bundles/<release>
node --env-file=.env.models scripts/publish-model-bundle.mjs --bundle .data/model-bundles/<release> --apply
```

El primer comando es una inspección local, sin subida. El segundo publica los fragmentos y **el índice al final**. Verifica previamente los archivos, reutiliza objetos idénticos y nunca sobrescribe una versión diferente (`x-upsert: false`). Si una subida se interrumpe, repite el mismo comando. La estructura remota será `ark-models/releases/<release>/bundle.json` y `parts/<hash>.bin` bajo ese mismo prefijo. No cambies las rutas a mano ni hagas público el bucket.

## 4. Configurar Render

Mantén **Build Command** `npm ci` y usa **Start Command** `npm start`, no `node src/server.js`: el arranque nuevo es el que instala los modelos. En un servicio ya creado, modificar `render.yaml` por sí solo no sustituye necesariamente los valores que configuraste manualmente en el Dashboard; compruébalos.

Añade estas variables en **Environment** del backend:

| Variable | Valor |
| --- | --- |
| `SUPABASE_URL` | Tu Project URL HTTPS |
| `SUPABASE_SECRET_KEY` | Tu secret key de servidor; secreto solo en Render |
| `ARK_MODEL_BUCKET` | `ark-models` |
| `ARK_ENABLE_RESEARCH_MODELS` | `1` (opt-in experimental; no concede derechos comerciales) |
| `ARK_MODEL_BUNDLE_KEY` | La clave exacta de `bundle.json` impresa al preparar/publicar |
| `ARK_MODEL_BUNDLE_SHA256` | El hash exacto de 64 caracteres, de la misma versión |

Conserva `NODE_ENV=production`, `DATABASE_URL` y todas las variables existentes de IAM/CORS/TLS. Storage es un servicio distinto: **no reemplaces `DATABASE_URL` con la Project URL**. No pongas estas claves en Vercel, `NEXT_PUBLIC_*`, el navegador ni una URL. Las claves modernas se envían solo como `apikey`; la alternativa JWT legada también usa Authorization. No se siguen redirecciones con credenciales y los errores no imprimen respuestas remotas ni claves.

Opcionalmente, en un servicio de pago monta un disco en `/var/data` y establece:

```env
ARK_MODELS_CACHE_DIR=/var/data/ark-model-cache
```

Sin disco usa `.data/model-cache`: recupera el paquete cuando falte la caché. Esto permite trabajar con almacenamiento efímero, pero cada descarga completa consume aproximadamente 236 MB de transferencia para esta versión. El disco persistente solo está disponible en ejecución, no durante build/pre-deploy; por eso la instalación ocurre al arrancar. Los servicios gratuitos no admiten discos persistentes. [Render: discos](https://render.com/docs/disks), [servicios gratuitos](https://render.com/docs/free).

Deja espacio para la versión anterior y la nueva, además del staging. Mide la RAM real de ONNX y del backend antes de dimensionar el servicio: el tamaño del paquete no es su consumo de RAM y no garantiza que quepa en 512 MB. El instalador procesa fragmentos secuencialmente y no carga el paquete entero en memoria. La inferencia conserva una sesión residente y su cola existente.

No combines el paquete fijado con `ARK_NEURAL_MODEL_PATH` o `ARK_MODELS_DIR`: podrían anular la versión verificada. Para cambiar el lugar de la caché usa únicamente `ARK_MODELS_CACHE_DIR`.

## 5. Verificar y comparar con local

1. Publica esta actualización del backend en GitHub y despliega esa revisión en Render.
2. El arranque debe registrar `ark-model-bundle-ready` con el hash esperado y después abrir la API. `/api/health` conserva su comprobación de base de datos; **por sí solo no demuestra que un modelo esté seleccionado**.
3. Con sesión y acceso de edición a un proyecto, `GET /api/v1/projects/<id>/plan-detection` debe mostrar `bundle.sha256`, `bundle.verified=true`, los modelos disponibles y sus hashes.
4. Desde la app publicada selecciona **Ark · suelos y aberturas (candidato)** y, al repetir mobiliario, **Candidato · coches y mobiliario**. Instalar pesos no cambia automáticamente los modelos predeterminados.
5. Compara la misma imagen original, preparación, escala, modelos, umbrales y decisiones de revisión. La salida local guardada tenía falsos positivos descartados manualmente; no equivale a una predicción totalmente automática. ONNX sobre Linux/CPU puede presentar pequeñas diferencias numéricas que deben verificarse.

El paquete **no migra proyectos, usuarios, imágenes, calibraciones ni decisiones de revisión** de la base local a Supabase. Eso se trata por separado. No entrena en el arranque ni valida la exactitud arquitectónica. Las restricciones de licencia heredadas siguen vigentes.

## Recuperación

- `401/403`: revisa que sea la secret key del mismo proyecto, solo en el servidor.
- Bucket público: crea uno privado distinto; el instalador no debilita su seguridad.
- `413` o rechazo de MIME: permite fragmentos de 4 MiB, binario y JSON en el bucket.
- Índice ausente: termina la publicación; no basta subir `manifest.json`.
- Hash distinto o caché dañada: no modifica la versión anterior ni abre la API con pesos alternativos. Conserva la evidencia, revisa el paquete y vuelve a fijar una versión válida.
- Para rollback, configura la **pareja** clave/hash de una publicación anterior, sin reescribirla. El instalador conserva versiones previas; el borrado de cachés antiguas debe planificarse explícitamente.
