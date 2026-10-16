# Detector de símbolos raster: estado experimental

Implementado el 15-10-2026 y ampliado el 16-10-2026 con un ajuste neuronal piloto. No es un detector arquitectónicamente validado.

## Estado actual: ajuste piloto del 16-10-2026

Se entrenó YOLOv8n durante 36 épocas acumuladas, usando 82 muestras derivadas de una imagen de vivienda y tres prototipos CAD revisados visualmente (silla, mesa y planta). Incluye ocho muestras negativas. Son recortes, rotaciones y composiciones, no 82 planos independientes ni el etiquetado completo de los 30 DWG. La anotación es provisional, realizada por el agente, sin revisión independiente de un arquitecto.

El modelo instalado localmente tiene seis clases en orden fijo: `chair,table,sofa,bed,plant,stair`. Se conserva el modelo original como alternativa. Los pesos y fuentes privadas están excluidos de Git. El flujo reproducible, controles y restricciones de licencia están en [training/README.md](../training/README.md).

La prueba desde la plataforma sobre la imagen de vivienda de entrenamiento produjo 28 propuestas: ocho sillas, dos mesas, un sofá, una cama, quince plantas y una escalera. La inferencia completa, incluida la segmentación arquitectónica, tardó 6.9 s en esta ejecución local. Tras inspeccionar los recortes se confirmaron 22 propuestas y se descartaron seis regiones de vegetación duplicadas o demasiado amplias. Se revisó la orientación y se indicó manualmente el tipo caracol de la escalera.

En el proyecto local de demostración quedaron guardadas familias 3D para ocho sillas, dos mesas, un sofá, una cama, nueve plantas y una escalera. Se comprobó la correspondencia de sus posiciones con las cajas originales, aplicando la transformación de la hoja, y la persistencia del modelo, hashes, historial de entrenamiento y decisiones. Esto prueba el recorrido detección → revisión → 3D, no exactitud sobre edificios nuevos. El plano de vivienda participó en el entrenamiento: sus resultados y las métricas de ajuste NO son una evaluación de generalización.

Quedan pendientes anotaciones exhaustivas y revisión arquitectónica independiente, edificios reservados para validación y prueba, reducción de duplicados de vegetación y evaluación de precisión/recobrado/AP por clase. Las alturas, formas detalladas y peldaños siguen siendo aproximaciones. El detector de muebles no corrige por sí mismo los errores de segmentación de muros o asociación de aberturas.

## Referencia histórica: modelo original sin ajuste

Las siguientes secciones documentan el candidato inicial y sus resultados del 15-10-2026. La ausencia de plantas y los cuatro resultados descritos corresponden únicamente a ese candidato, no al piloto de seis clases actual.

### Modelo y límites originales

- Pesos: https://huggingface.co/mudasir13cs/floorcad-yolov8n-detect
- Revisión fija: `02995225d7aed598bc7e0214f5b7f3fe7fe95657`.
- SHA-256 original: `be1a5a404c5ad1c454ba7531e2c16548a6330945319cbf989751ff73578b494c`.
- 35 clases originales, sin cambiar su orden. El adaptador solo publica `chair`, `table`, `sofa`, `bed`, `stair`. No tiene `plant`.
- Licencia declarada de pesos: AGPL-3.0. Anotaciones FloorPlanCAD: CC-BY-NC-4.0 según https://floorplancad.github.io/ . La descarga no otorga derechos comerciales sobre los dibujos. No desplegar comercialmente sin resolver los permisos aplicables.
- Fuera de producción se instala localmente. En producción permanece deshabilitado salvo la opción explícita existente `ARK_ENABLE_RESEARCH_MODELS=1`, que NO constituye autorización de uso comercial.

### Instalación reproducible del candidato original

Guardar el `best.pt` de la revisión indicada como `.data/models/floorcad-symbols-v1/source.pt`. Instalar `scripts/requirements-symbol-export.txt` en un entorno virtual y ejecutar:

```powershell
.venv/Scripts/python scripts/export-floorcad-symbols.py
node scripts/probe-symbols.mjs RUTA_A_IMAGEN
```

La exportación comprueba el hash, limita las clases permitidas en el checkpoint y usa `torch.load(weights_only=True)`. Genera `model.onnx` y `manifest.json`; no se incluyen pesos ni planos privados en Git. Python se necesita para exportar, no para ejecutar la API.

### Ejecución del candidato original en la app

La ruta autenticada existente `POST /api/v1/projects/:id/plan-detection` admite `symbols:true`. Conserva los mismos permisos del diseño, límites de imagen, cola y timeout. Ejecuta segmentación y detección secuencialmente en el worker; libera la sesión anterior antes de cargar la siguiente. CPU: dos hilos. Como máximo diez pasadas de 640×640 (lámina completa y recortes solapados); no se aplica NMS entre clases distintas salvo solapamiento casi completo.

El resultado `symbols` conserva modelo, hashes, umbral fijo 0.35, tiempo, pasadas y cajas en píxeles de la imagen original, independientemente del recorte usado por la segmentación de muros. El argmax considera las 35 clases antes de filtrar; una clase desconocida nunca se renombra como mueble. Las salidas inválidas se rechazan.

En la UI se muestran recortes numerados y puntuación no calibrada. Solo las propuestas confirmadas pasan a familias 3D. No se añaden muebles por nombres de habitaciones. Orientación y tipo de escalera requieren revisión; alturas, peldaños y detalles son aproximaciones. La caja delimita extensión proyectada, no una geometría BIM medida. Las plantas se muestran como no soportadas, no como cero objetos detectados.

Las nuevas hojas raster guardan `analysisImage` aparte de la miniatura de presentación. Las antiguas muestran una advertencia y requieren volver a cargar el archivo original para recuperar los trazos pequeños; no se finge recuperar detalle de la miniatura. La limpieza que elimina píxeles aislados queda desactivada por defecto para no borrar símbolos finos. Cambiarla invalida la propuesta anterior.

### Prueba inicial y criterio de aceptación

En la imagen de vivienda de 1151×1489 proporcionada por el usuario, la prueba directa produjo cuatro propuestas: dos camas, una mesa y una escalera. La inspección muestra una cama correcta, pero también falsos positivos; no detectó las sillas ni el sofá. La prueba con umbralización de imagen empeoró la salida y NO se habilitó. El candidato no supera aceptación como detector automático de esta vivienda. No extrapolar las métricas publicadas del autor a Ark.

La prueba posterior desde la UI, cargando el original sin limpieza, también produjo cuatro propuestas (9.8 s incluyendo segmentación). Se confirmó la cama real y se descartaron las otras tres; la cama pasó a la familia editable en el proyecto local `b7528deb-183b-44e0-958c-10bc9d378ca2`. Se conservó la imagen de análisis completa y las cuatro decisiones. La revisión visual realizada por el agente para esta demostración no sustituye la anotación independiente de un arquitecto y no ingresa automáticamente al entrenamiento.

El lote Larco preparado anteriormente tiene cero recortes con anotación independiente completada. Para entrenar/seleccionar un reemplazo se necesitan anotaciones exhaustivas de estas seis clases, ejemplos negativos y plantas, además de edificios distintos para entrenamiento, validación y prueba. Registrar precisión/recobrado/AP por clase y errores de posición; no considerar una compilación exitosa como evidencia de exactitud. Los cambios revisados en la UI no se convierten automáticamente en verdad terreno.

Pruebas: `node --test test/symbol-detection.test.js`, suite API completa, y en frontend `node scripts/test-symbol-detection.mjs`, `npm run test:raster:neural`.
