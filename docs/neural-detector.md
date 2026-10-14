# Detector neuronal local (investigación)

La API autenticada /api/v1/projects/:id/plan-detection acepta GET (capacidades disponibles) y POST {image, modelId}. La autorización de edición del proyecto permanece obligatoria. Nunca enviar credenciales o rutas locales en el cuerpo.

Modelos conocidos: openbim-m2-unet (4 etiquetas), cubicasa-multitask-v1 (13, incluido fondo) y el candidato legado yytsi-resnet34-unet. La disponibilidad requiere model.onnx y manifest.json válidos. Los modelos no se descargan ni exportan en npm install/build/start.

## Instalación CubiCasa explícita

Con Node y el entorno Python de exportación instalado según scripts/requirements-neural-export.txt:

```powershell
node scripts/download-cubicasa-model.mjs
.venv\Scripts\python scripts/export-cubicasa-model.py --directory .data/models/cubicasa-multitask-v1
npm run dev
```

El descargador fija revisión y SHA-256 de checkpoint, fuente y licencia oficiales; no reemplaza archivos existentes. Python utiliza weights_only=True, verifica la fuente fijada y exporta las cabezas rooms/icons. La normalización es RGB [-1,1]. El worker comprueba el hash ONNX antes de abrirlo. .data, los pesos y .venv están fuera de Git.

Fuente primaria y licencia: [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k), revisión c34440266665a11f4484eb06cd2e4b7d72ad76c1. Código/dataset CC-BY-NC-4.0: integración experimental, no autorización comercial. [OpenBIM](https://github.com/Chunling1/OpenBIM-FloorPlan-AI/releases/tag/v1.0.0) usa CubiCasa5K en entrenamiento; MIT en el código no resuelve por sí solo los derechos de los pesos.

## Render / producción

- Por defecto NODE_ENV=production deshabilita los modelos de investigación.
- ARK_ENABLE_RESEARCH_MODELS=1 es una habilitación explícita de investigación, no una recomendación comercial.
- Provisionar ONNX + manifiesto adyacente + licencias como artefactos privados del servidor. Hacer push no instala los modelos.
- Se descubren .data/models/openbim-m2-v1 y .data/models/cubicasa-multitask-v1. ARK_NEURAL_MODEL_PATH admite otra ruta conocida con manifiesto adyacente. Reiniciar tras instalar.
- Una sesión residente, dos hilos CPU, una inferencia activa y máximo dos solicitudes activas/pendientes por proceso. Cambio de modelo libera la sesión anterior.
- Cancelación activa rechaza al cliente pero retiene el turno hasta que termina ORT o su watchdog de 90 s; no inicia inferencias concurrentes.
- Cuerpo acotado; imagen máxima 16 MP/6000 px por lado. El frontend envía recortes de 512 px.
- No presupone memoria suficiente en 512 MB. Smoke local observó ~389 MiB RSS; no representa el pico bajo carga del backend. Medir antes de provisionar. Cuotas por usuario y cola distribuida siguen pendientes.

No devuelve un BIM ni alturas. Las salidas son máscaras semánticas y scores softmax no calibrados. El frontend extrae propuestas, verifica anfitriones y exige dimensiones/aprobación antes de compilar objetos 3D.

## Pruebas

```powershell
npm test
# Opt-in; pesos instalados y una imagen proporcionada
node scripts/check-neural-models.mjs path/to/plan.png
```

El smoke comprueba ambas inferencias, taxonomía, máscara acotada, cancelación, exclusión mutua y cola. Guarda imágenes/reporte en .data/qa ignorado. No mide precisión ni entrena el modelo. La exactitud debe evaluarse con planos anotados independientemente y particiones por edificio.
