# Evidencia de validación

Ejecución local del 25 de octubre de 2026 en macOS ARM64, Python 3.14.7.
Worktree: `grover-noise`, rama `sebasbimbi/test/grover-noise-benchmark`.
HEAD sin modificar: `9a471806931d3e78d749499cd13019d9e300fbb4`.

## Comandos y resultados

```sh
.venv-noise/bin/python -m pytest -q test_grover.py test_grover_noise.py
# 30 passed in 1.11s

.venv-noise/bin/python -m pip check
# No broken requirements found.

git diff --check
# exit 0

git diff --exit-code HEAD -- qiskit_grover.py api.py datos.js js css index.html
# exit 0: original, API, datos y UI intactos

.venv-noise/bin/python -u qiskit_grover_noise.py \
  --sizes 3 4 --repetitions 100 --seed-start 42 --thermal \
  --reference-script /Users/sebasbimbi/Downloads/qiskit_grover.py \
  --output docs/noise
# exit 0; benchmark 3.642316 s, sin el render del gráfico
```

Las 30 pruebas cubren el núcleo existente, equivalencia con Statevector en 1/3/5 qubits, fórmula analítica del barrido, degeneración de N3, aplicación de ruido sobre las puertas compiladas, reutilización del mismo circuito entre perfiles, lectura explícita contra 60.000 mediciones Aer con semilla fija, decaimiento térmico analítico, trazas BBHT idénticas al original para tres casos N3/N4, rechazo de padding, continuidad con conjunto marcado vacío, conservación del presupuesto y oráculos, control aleatorio, Wilson y entradas inválidas. Los 60.000 shots pertenecen sólo a la prueba del canal de lectura: **el benchmark adaptativo sigue tomando una única muestra por paso**.

El error de lectura se validó también como transformación de todas las distribuciones publicadas. El parámetro despolarizante es λ de `E(ρ)=(1−λ)ρ+λ I/(2^n)` para n=1 o n=2 qubits; no es la infidelidad media de una puerta. No se usó calibración hardware, routing ni topología de IBM.

Se probaron por CLI los rechazos de repeticiones cero, semilla negativa, N5 sin autorización `--allow-large` y script de referencia con SHA distinto; los cuatro finalizaron con error antes de ejecutar el benchmark solicitado.

## Repetibilidad y consistencia de los datos

Se repitió el comando completo con salida en `/tmp/grover-noise-reproducibility`. Las dos ejecuciones dieron igualdad exacta de `runs`, `summary`, `sweep` y `distributions` del JSON, y de todos los bytes de `steps.csv`. Los tiempos y la fecha se excluyen de esa comparación.

[data_validation.json](data_validation.json) registra las comprobaciones de 2.000 filas de ejecución (1.000 Grover y 1.000 controles), 61.225 pasos y 337 distribuciones. Se verificó que cada resultado es válido, que cada control comparte inicialización y presupuesto consumido con su Grover, que `sum(max(j,1))`, `sum(j)`, CX, muestras e inválidos coinciden con los agregados, y que sólo el último paso puede superar el presupuesto. Todas las distribuciones suman uno sobre el registro completo, el canal de lectura reproduce sus probabilidades y los barridos ideales coinciden con la fórmula analítica a 1e-12.

SHA-256 del benchmark validado:
`1e35e30bc14e6e43e09e44c5beab1613798d8073886f66475eddb0c1753ff092`.

SHA-256 de `test_grover_noise.py`:
`b6b21321d87f502a95f66205a38edfefc53ab0993fe19f2bee3c96f1b7cf42aa`.

SHA-256 común de Downloads y del original del repositorio:
`c71fdca73a6f9a0d9ae4e179ec83d3b4962fc084b21abc4c18ada240a462e409`.

El coordinador Brain18 revisó independientemente la semántica de BBHT, presupuesto, lectura y padding, y corroboró la fórmula N4/j4. Se incorporaron sus observaciones sobre empates numéricos al seleccionar j, degeneración N3, límites del control uniforme y comando ejecutable. El gráfico se abrió e inspeccionó visualmente.

## Viabilidad de N5 y límites

Una exploración preliminar N5 con una semilla, cinco perfiles y barridos tomó 87,998 s: 43 circuitos compilados, 150 distribuciones y 86,768 s en Aer. No se usa esa única semilla para estimar robustez.

Después se intentó N3/N4/N5 con **100 semillas por perfil**, limitando el proceso a 120 segundos. El intento alcanzó el límite a los 120,010 s; había terminado el perfil ideal de N5 (100/100, 11,18 s), pero todavía no había completado el perfil leve. El proceso fue detenido por `subprocess.run(timeout=120)` y no produjo una campaña completa N5. El [recibo](n5_feasibility.json) y [log](n5_attempt.log) conservan la evidencia. No se añadieron tasas parciales N5 a los resultados principales; se regeneraron N3/N4 completos al terminar el intento.

N6 no se ejecutó. Su estado de densidad de 10 qubits ocupa 16 MiB antes de temporales, pero el costo de aplicar muchos canales a muchos circuitos es la limitación observada; el tamaño del estado por sí solo no garantiza una simulación rápida.

El informe principal contiene únicamente las campañas completas N3/N4. Estos resultados no prueban tolerancia general al ruido ni ventaja cuántica: N3 tiene cuatro óptimos entre seis permutaciones y el control uniforme obtuvo 100/100 en todos los grupos.
