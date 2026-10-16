# Entrenamiento de reconocimiento de planos

La app combina segmentación de arquitectura con detección de mobiliario. Hay dos flujos: Mask2Former para máscaras revisadas independientemente, y un ajuste piloto de YOLOv8n para sillas, mesas, sofás, camas, plantas y escaleras.

## Piloto de objetos con las fuentes del usuario

### Ampliación del 16-10-2026

Se añadieron dos recortes arquitectónicos de `cs06` (vectores conservados por la app; el DWG original ya no estaba en Descargas), 47 cajas nuevas y ocho prototipos CAD revisados visualmente. El lote ampliado contiene 70 cajas originales, 11 prototipos y 210 muestras derivadas, incluidas 16 negativas. Mantiene tres grupos de origen. Se completaron 18 épocas adicionales: 54 acumuladas, no 54 épocas sobre cada fuente nueva.

`extends` permite repetir el lote anterior durante el ajuste. `heldOutBuildingGroups` impide incorporar el edificio reservado tanto al preparador como al validador de entrenamiento. `rt02` no entró en entrenamiento. `EDIFICIO 4` se volvió a auditar, pero no se etiquetó exhaustivamente ni se usó como una referencia aprobada.

La comparación conservó las etiquetas y el umbral IoU 0.5, sin corregir predicciones: en un recorte de planta de `rt02`, 17/27 → 20/27 coincidencias correctas, con cero falsos positivos en ambos. En un recorte ampliado de cinco objetos, ambos consiguieron cero coincidencias y el candidato produjo cuatro falsos positivos. Agregado: 17 aciertos, 0 falsos positivos, 15 omisiones → 20 aciertos, 4 falsos positivos, 12 omisiones. Dos recortes del mismo edificio, anotados por el agente, no son una evaluación arquitectónica independiente ni una métrica general de precisión.

El candidato se conservó sin promoverlo automáticamente. La app muestra este estado aparte del detector activo. `evaluate_objects.mjs` comprueba cajas/clases uno a uno, guarda hashes y rechaza fuentes usadas por el modelo; `record_object_candidate.mjs` conserva ambas comparaciones. No sustituir el fallo ampliado por un único resultado favorable.

```powershell
node training/evaluate_objects.mjs .data/training/etiquetas-reservadas.json .data/qa/evaluacion-nueva.json .data/training/run-candidato
node training/record_object_candidate.mjs .data/training/run-candidato .data/qa/antes.json .data/qa/despues.json
```

`render_cad_region.mjs` prepara recortes desde vectores con transformación reversible y hash del archivo vectorial. No deduce etiquetas de nombres ni convierte una elevación de una silla en una silla en planta. `cs06` aportó plantas de mobiliario; sus símbolos en elevación se excluyeron.

`prepare_object_pilot.mjs` consume un JSON `ark-object-labels-1` con `classes` en el orden `chair,table,sofa,bed,plant,stair`, anotador, imágenes (ruta, grupo de edificio, cajas en píxeles y regiones negativas) y prototipos CAD seleccionados. Es un flujo provisional, separado del conjunto de referencia independiente. Las fuentes, etiquetas y pesos quedan en `.data/`, fuera de Git.

```powershell
node training/prepare_object_pilot.mjs .data/training/object-pilot-labels-20261016.json .data/training/objects-pilot-nuevo
.venv/Scripts/python training/train_objects.py --manifest .data/training/objects-pilot-nuevo/manifest.json --output .data/training/objetos-run-nuevo --pilot --epochs 12 --threads 4
```

La preparación incluye recortes, rotaciones y composiciones de trazos CAD. Registra el origen de cada muestra, su grupo de edificio y hash; las variaciones no cuentan como nuevos edificios. El validador compara las etiquetas YOLO con las cajas del manifiesto y los hashes de las imágenes. Un recorte negativo no puede intersectar una categoría anotada.

En el lote del 16-10-2026 hay 23 cajas sobre una imagen de vivienda y tres prototipos revisados visualmente en DWG (silla, mesa/barra y planta). Las 82 muestras resultantes incluyen ocho negativas. No representan 82 planos independientes ni el etiquetado exhaustivo de los 30 DWG. La vegetación tiene cajas aproximadas y requiere revisión arquitectónica.

Los bloques de silla contienen fragmentos aislados: se conserva el componente conectado del símbolo. El bloque `a_mesa` incluye taburetes: el prototipo de mesa conserva únicamente su contorno cerrado. El bloque de vegetación seleccionado está completo antes del límite de extracción de la lámina; la lámina truncada no se trata como referencia exhaustiva.

El entrenamiento carga pesos con hash fijo y tipos restringidos, transfiere el backbone y los canales de las cinco clases conocidas, e inicializa la categoría planta. Se puede continuar un checkpoint propio verificado con `--initial-run`, `--freeze 0` y una tasa menor. El flujo requiere `--pilot` y no permite afirmar revisión independiente. La ruta `val` que exige la librería apunta al conjunto de ajuste: sus métricas son diagnóstico de ajuste, NO evaluación externa. El conjunto arquitectónico independiente permanece separado y pendiente.

Al terminar se exportan `objects.onnx` y `manifest.json` con hashes, clases, épocas y procedencia. Instalación local sin sobrescribir modelos anteriores:

```powershell
node training/install_object_pilot.mjs .data/training/objetos-run-nuevo ark-objects-pilot-v2
```

La API Node usa ONNX en CPU y sus límites existentes; Python se necesita para entrenar y exportar. El cliente muestra recortes, permite confirmar o descartar y representa las propuestas confirmadas mediante las familias 3D existentes. El ajuste hereda restricciones del preentrenamiento FloorCAD/Ultralytics; permanece experimental y no queda autorizado automáticamente para producción comercial.

Para evaluar generalización se necesitan otros edificios anotados exhaustivamente por personas distintas del preparador del entrenamiento. Reservarlos por edificio antes de crear recortes, comparar precisión/recobrado/AP por clase y errores de ubicación, y probar la conversión 3D sin corregir las predicciones de prueba. No publicar como exactitud las detecciones sobre la vivienda incluida en este piloto.

## Preparar el lote privado

Desde el backend:

```powershell
node scripts/prepare-plan-training.mjs ../teluria-frontend/.data/corpus/larco-final-2026-10-13/review-final/review-batch.json .data/training/larco-pilot
```

Se generan imágenes PNG de los recortes, plantillas de anotación y un manifiesto con hashes, transformación CAD → píxeles y grupo de edificio. Los archivos quedan bajo `.data`, excluidos de Git.

Las anotaciones deben ser polígonos completos, con categoría y revisión. Una caja de un símbolo no sustituye el contorno de un muro. El exportador exige anotador y revisor distintos, recorte confirmado, anotaciones revisadas y comprobación exhaustiva de las clases. Nunca convierte propuestas en verdaderos negativos ni certifica una revisión por sí mismo.

Los 30 archivos de Larco pertenecen al mismo edificio. Sus recortes deben compartir partición. Hace falta un segundo edificio anotado para validación y otro conjunto independiente para prueba. Duplicar o aumentar imágenes no crea nuevos edificios de prueba.

## Validar y entrenar

```powershell
python training/train_mask2former.py --manifest .data/training/larco-pilot/manifest.json --validate-only
```

Este comando no descarga pesos ni necesita PyTorch. Si faltan etiquetas revisadas o validación independiente, se detiene con la razón concreta.

Una vez completada la revisión y las particiones:

```powershell
python -m venv .venv-training
.venv-training/Scripts/python -m pip install -r training/requirements.txt
.venv-training/Scripts/python training/train_mask2former.py --manifest .data/training/approved/manifest.json --output .data/training/ark-mask2former-run1 --epochs 10
```

El entrenamiento calcula IoU por clase sobre validación. La aceptación también requiere evaluar objetos por instancia, relaciones abertura–muro y errores dimensionales antes de sustituir el detector en producción. El checkpoint producido es PyTorch: necesita un adaptador de inferencia o exportación verificada antes de registrarse en el servidor Node. Revisa los términos específicos del checkpoint base y de los datos antes de distribuirlo comercialmente; la licencia del código no decide la de todos los pesos.

El entrenamiento no puede deducir alturas, instalaciones ocultas o materiales que no estén documentados en la imagen. Esa información procede de cotas, cortes, cuadros o confirmación del usuario.

## Piloto de siete clases y control de regresiones

El contrato `ark-objects-pilot-v2` incorpora `vehicle`. Se admiten paquetes legados de seis clases y paquetes de siete, pero sus manifiestos y dimensiones de salida no son intercambiables. Se añadieron cinco coches etiquetados provisionalmente (uno de la vivienda y cuatro en CS06) y un prototipo CAD. RT02 continúa reservado; sus dos recortes son diagnóstico del desarrollo, no un benchmark arquitectónico independiente.

El preparador usa cierre transitivo de recortes para no enseñar fragmentos como objetos completos y letterboxing sin deformar las proporciones. `prototypeSizes` admite hasta seis tamaños entre 24 y 520 px para rasterizar vectores a distintas escalas; las rotaciones y composiciones siguen siendo aumentos de las mismas fuentes. No se cuentan como planos nuevos.

La primera ampliación (278 muestras, 14 épocas adicionales) detectó el coche, pero confundía sillas con mesas en RT02. La segunda pasada (350 muestras, seis épocas, backbone congelado hasta capa 10 y LR 0.00008) redujo ese fallo: 20 aciertos y 4 falsos positivos sobre 32 objetos, frente a 8 y 15 en la primera ampliación. No supera al detector anterior en falsos positivos (17 aciertos y ninguno). Ambas versiones y sus informes se conservan, sin modificar las etiquetas de prueba ni los umbrales para mejorar el resultado.

Instalar en `ark-objects-pilot-v3` o `ark-objects-pilot-v4` deja los pesos como candidatos opt-in. `configuredSymbolModel()` sigue eligiendo el detector anterior; la solicitud puede seleccionar un ID de objetos conocido con `symbolModelId`. El worker verifica el hash y mantiene una sola sesión residente. El cliente verifica que la respuesta corresponda al ID solicitado y exige revisión antes de pasar objetos al 3D.

Los pesos, imágenes, recortes, etiquetas y reportes privados permanecen bajo `.data`, fuera de Git. Hacer push o desplegar el código no instala estos pesos. Las licencias heredadas y la evaluación independiente siguen pendientes para una utilización comercial.

## Piloto de aberturas y regresiones de suelos

`prepare_architecture_pilot.mjs` prepara máscaras de espacios y símbolos desde un JSON privado `ark-architecture-labels-1`. Exige `annotationQuality: agent-provisional`, `independentValidation: false`, grupos separados por edificio y clases explícitas. Las zonas sin anotación usan 255 (IGNORE), nunca negativos implícitos. Conserva hashes, recortes reversibles y superposiciones para revisar. Veinte recortes/rotaciones de una vivienda son una fuente, no veinte edificios.

```powershell
node training/prepare_architecture_pilot.mjs .data/etiquetas-arquitectura.json .data/training/arquitectura-lote-nuevo
.venv/Scripts/python.exe training/train_architecture_pilot.py --manifest .data/training/arquitectura-lote-nuevo/manifest.json --output .data/training/aberturas-run-nuevo --pilot --epochs 48 --threads 4 --lr 0.0003 --size 512 --decoder --preserve-rooms
node training/evaluate_architecture_pilot.mjs .data/training/arquitectura-lote-nuevo .data/qa/aberturas-antes-nuevo.json
node training/evaluate_architecture_pilot.mjs .data/training/arquitectura-lote-nuevo .data/qa/aberturas-despues-nuevo.json .data/training/aberturas-run-nuevo
```

El encoder y las estadísticas de batch normalization quedan congelados. `--decoder` ajusta las últimas convoluciones y la reconstrucción de píxeles. `--preserve-rooms` entrena solo aberturas y exporta un decodificador de espacios original separado, compartiendo el encoder: evita que aprender ventanas reescriba la segmentación del suelo. El checkpoint base y el código tienen hashes fijados; la carga PyTorch usa `weights_only=True`. Los candidatos se instalan sin sobrescribir el detector anterior, con `install_architecture_pilot.mjs`, únicamente tras inspeccionar regresiones. No cambian el modelo predeterminado.

La evaluación conserva los mismos píxeles, máscaras y enfoque derivado del modelo base para ambos candidatos. Verifica hashes y exclusión de grupos; cuando se preservan espacios comprueba también la igualdad de logits. Informa IoU/recobrado/precisión de píxeles sobre máscaras parciales, no AP de instancias, exactitud dimensional o calidad BIM. CS06 está reservado para este ajuste arquitectónico, aunque se utilizó previamente para el detector separado de objetos. Es un diagnóstico de desarrollo con etiquetas del agente, no validación independiente.

Los ensayos de cabeza sola y de decodificador completo del 16-10-2026 introdujeron superficies fuera del edificio y falsos positivos de ventana. Se conservaron sus artefactos e informes, pero no se activaron. La instalación experimental conserva las restricciones CC-BY-NC del preentrenamiento CubiCasa; este piloto no resuelve una licencia comercial.

El candidato de aberturas completó 48 épocas sobre 20 muestras derivadas de una vivienda. En CS06 reservado para este ajuste, la IoU de píxeles de ventana pasó de 0.163 a 0.431, el recobrado de 0.212 a 0.697 y la precisión de 0.413 a 0.530. Sobre la vivienda de entrenamiento, la IoU pasó de 0 a 0.624; no es una métrica de generalización. Las máscaras de espacios produjeron logits idénticos al modelo original en ambos diagnósticos (diferencia máxima 0). Persisten falsos positivos y omisiones; el artefacto `ed7707a4837b2d4091e1a2321fcc764954d98a2b76c50036aa6e57c50718743a` quedó como piloto opcional, no como detector predeterminado. Los informes privados `architecture-openings-before-20261016.json` y `architecture-openings-after-20261016.json` registran la misma región y hash de etiquetas.

La segunda rama `ark-architecture-pilot-v2` usa `--opening-run .data/training/run-aberturas-verificado` en lugar de `--preserve-rooms`. Ajusta únicamente el decodificador de espacios; exporta el decodificador de aberturas del piloto verificado sin entrenarlo de nuevo. El manifiesto identifica ambos checkpoints y las épocas por rama. `evaluate_architecture_pilot.mjs` comprueba que los logits de símbolos no cambien contra el piloto de aberturas. Esto permite comparar mejoras del suelo sin aceptar regresiones silenciosas de ventanas. El candidato se instala en otro directorio, sin sobrescribir v1 ni modificar el modelo predeterminado.

Esta rama completó otras 48 épocas con las mismas 20 muestras derivadas. La IoU de suelo en la vivienda de entrenamiento pasó de 0.883 a 0.957, con precisión 0.984 y recobrado 0.972. En la máscara parcial reservada de CS06 bajó ligeramente de 0.968 a 0.961: no es una mejora general demostrada. Los logits de símbolos se conservaron exactamente (diferencia máxima 0), y las métricas de ventanas permanecieron iguales. Se conserva como candidato opcional, artefacto `d5f311714a5ec9e96d10e39aa363f8d40aba327ddf10249051b5c46e9724c426`; no se promueve automáticamente. El informe privado `architecture-floors-after-20261016.json` documenta también esa regresión.
