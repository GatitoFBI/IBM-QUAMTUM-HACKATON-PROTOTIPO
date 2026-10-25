# Q-Niño · Material para la final

Pitch de cuatro minutos para cuatro voces, con demo breve, aporte del prototipo y contexto climático respaldado por fuentes oficiales. Preparado el 25 de octubre de 2026.

**Estado:** borrador para ensayo. Falta integrar los resultados N ≥ 14 del equipo y realizar un ensayo cronometrado. El guion reserva ese bloque y apunta a terminar en 3:45, con 15 segundos de margen.

| Material | Contenido |
|---|---|
| [Diapositivas del pitch](slides/README.md) | Seis pantallas en PowerPoint editable, PDF y HTML sin conexión, con notas por expositor |
| [Guion de cuatro minutos](guion_4min_ES.txt) | Sebastian: apertura y cierre; Jefry: modelo y resultados; Luis: implementación y demo; Fabricio: aporte y oportunidad |
| [Respuestas para el jurado](apoyo_jurado_ES.txt) | Modelo, Qiskit, comparación clásica, procedencia y escalabilidad |
| [Diapositiva de ventajas y explicación del hardware](ventajas_y_hardware_ES.txt) | Aporte actual, oportunidades y locución sugerida |
| [Fuentes oficiales](FUENTES_OFICIALES_ES.txt) | Estaciones, fechas, unidades, procedimiento y alcance |
| [Relación entre datos y modelo](modelo_y_fuentes_ES.txt) | Qué falta para convertir observaciones climáticas en escenarios logísticos |
| [Paquete de datos oficiales](Q_Nino_Datos_Oficiales.zip) | Originales, 730 observaciones seleccionadas, CSV, auditoría, script y manifiesto SHA-256 |

## Evidencia utilizada

| Estación SENAMHI | Año | Registros sin faltantes | Precipitación acumulada |
|---|---|---|---|
| [Miraflores, Piura · 000207](https://www.senamhi.gob.pe/site/descarga-datos/descarga/?cod=000207) | 1998 | 365 | 1.857,7 mm |
| [Puerto Pizarro, Tumbes · 000132](https://www.senamhi.gob.pe/site/descarga-datos/descarga/?cod=000132) | 1998 | 365 | 2.433,6 mm |

Los totales son cálculos propios sobre el histograma oficial, agrupando los valores por su etiqueta explícita de año. Son observaciones históricas de estaciones puntuales. No representan promedios regionales ni lluvia actual. El cálculo no requiere inferir el día o el mes; los valores faltantes no se convierten en cero.

El [Comunicado ENFEN 18-2026, del 16 de octubre de 2026](https://enfen.imarpe.gob.pe/download/comunicado-oficial-enfen-n-18-2026/), aporta el contexto de alerta y pronóstico regional. Un pronóstico no acredita precipitación observada ni una carretera bloqueada. Revisar el comunicado vigente si cambia la fecha de presentación.

**Relación con el prototipo:** estas fuentes sustentan el contexto del pitch. Las matrices F/D de la demo y sus resultados N = 3–6 siguen siendo sintéticos. Integrar lluvia, rutas, capacidades y prioridades requiere una transformación documentada y calibrada.

## Reproducir los totales

Desde la raíz del repositorio, con Python 3 y `unzip`:

```sh
shasum -a 256 docs/final/Q_Nino_Datos_Oficiales.zip
unzip docs/final/Q_Nino_Datos_Oficiales.zip -d /tmp/q-nino-datos-final
python3 /tmp/q-nino-datos-final/Q_Nino_Datos_Oficiales/export_official_pitch_data.py --verify-only
```

SHA-256 del ZIP:

```text
19a72ccffcd741b483d1c75e3aadb3c087601810de65912dd57ed56e253494cb
```

El script usa la biblioteca estándar de Python. Lee los dos HTML originales, comprueba 365 valores sin faltantes por estación y recalcula 1.857,7 mm y 2.433,6 mm. La salida esperada indica `PASS` y `rows: 730`. Esta comprobación reproduce los totales; no ejecuta Qiskit ni valida el rendimiento del optimizador.

El archivo `MANIFEST.json` del ZIP contiene el tamaño y SHA-256 de sus 11 archivos de evidencia. La auditoría completa incluida también describe fuentes exploratorias que quedan fuera del paquete; su inclusión no convierte esas afirmaciones opcionales en resultados del pitch. La [comprobación anual adicional](SENAMHI_ANNUAL_CHECK.json) y la [ilustración de escenarios uniformes](uniform_scenario_check.json) están disponibles por separado. Esta última verifica una propiedad algebraica, no una calibración meteorológica.

## Mensaje para presentar

Q-Niño permite revisar una asignación, su coste y su comparación clásica. La oportunidad es repetir esa decisión cuando cambien las rutas o la información disponible. La reducción de consultas de Grover es una ventaja teórica para búsqueda sin estructura; convertirla en ahorro operativo exige medir el trabajo completo.

El tiempo del simulador no estima el de una QPU. Una QPU evita simular explícitamente el vector de estado, pero el tiempo total depende también del oráculo, los circuitos compilados, las repeticiones y el procesamiento clásico. No hay una medición en hardware en los resultados aquí documentados. Véase la [guía de IBM sobre tiempo de ejecución](https://quantum.cloud.ibm.com/docs/en/guides/estimate-job-run-time).

Los registros pequeños revisados contienen 40 resultados óptimos en 40 ejecuciones de cuatro instancias sintéticas. Eso no demuestra éxito universal ni sustituye la comparación N ≥ 14 pendiente. La cifra histórica de unas cinco consultas en N = 4 corresponde a otra versión, con parada anticipada; no se usa como ahorro total del prototipo actual.

[Volver al repositorio y al vídeo de la demo](../../README.md)
