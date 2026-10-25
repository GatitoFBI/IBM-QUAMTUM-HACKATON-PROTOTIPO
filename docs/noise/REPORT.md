# Grover con ruido sintético: resultados reproducibles

Se probó el script original sin modificarlo. Estos escenarios son sintéticos; no son calibraciones ni ejecuciones de hardware IBM.

Ejecución UTC: 2026-10-25T15:23:53.166001+00:00. 100 semillas por N/perfil, desde 42.
Tiempo del benchmark (sin render del gráfico): 3.64 s; compilación 0.36 s; simulación Aer 2.36 s.

## Método

Se importan generar_datos, costo_perm, presupuesto y circuito_grover del original. Cada distribución corresponde a una matriz de densidad exacta; cada paso BBHT toma una sola muestra con NumPy. No se escoge el mejor de varios shots. La caché sólo reutiliza distribuciones idénticas.

Se descomponen DiagonalGate y mcx en rz/sx/x/cx, optimization_level=0, sin coupling_map ni routing. Cada (qubits, marcados, j) se compila una vez para todos los perfiles. Rz es virtual y no lleva error; sx/x llevan despolarización 1q y cx despolarización 2q. El parámetro p es λ en E(ρ)=(1−λ)ρ+λ I/2^d, no la infidelidad media de puerta.

save_probabilities se guarda ANTES de medir: no incorpora el error clásico de lectura. Aplicamos explícitamente P(y|x) como flips independientes de probabilidad readout por bit, después del canal cuántico. Las pruebas comparan con medidas Aer que sí incluyen ReadoutError. No se inventan amplitudes de estados mixtos.

Se conserva el bucle original: umbral inicial uniforme válido, j uniforme en [0, ceil(m)), lambda=6/5, m máximo sqrt(N!), reinicio de m tras mejorar. Se sigue hasta agotar presupuesto incluso con marcados vacío. Salidas >= N! se rechazan, consumen presupuesto y nunca se renormaliza sobre válidos.

Presupuesto original: suma max(j,1), con el posible exceso del último paso. Llamadas de oráculo: suma j. Circuitos: número de pasos/mediciones. CX, sx/x, Rz y profundidad se contabilizan por separado; profundidad suma es suma de profundidades de circuitos, no latencia física. La tabla de costos y la inicialización se excluyen del presupuesto, igual que en el original.

El control random_matched usa el MISMO umbral inicial y exactamente tantas propuestas uniformes en 2^q como unidades de presupuesto consumió su ejecución Grover emparejada. Cada propuesta cuesta una consulta lógica, también si cae en padding. Usa SeedSequence([semilla,N,1]); no usa el resultado óptimo para parar. No ejecuta oráculos ni circuitos cuánticos. Es un control de uniformidad del registro, no el mejor algoritmo clásico: una búsqueda clásica puede muestrear directamente entre N! índices válidos y evitar padding. Comparación de consultas abstractas, no de tiempo o costo físico ni prueba de ventaja cuántica.

Las mismas semillas se reutilizan entre perfiles (comparaciones emparejadas); los IC Wilson 95% describen la tasa marginal entre semillas de UNA instancia fija por N, no una población de QAP ni un intervalo de diferencias entre perfiles.

## Perfiles

| Perfil | p1 | p2 | Lectura por bit | T1/T2 (ns) |
|---|---:|---:|---:|---|
| ideal | 0.0 | 0.0 | 0.0 | None/None |
| leve | 0.001 | 0.01 | 0.01 | None/None |
| moderado | 0.005 | 0.03 | 0.03 | None/None |
| fuerte | 0.01 | 0.1 | 0.05 | None/None |
| moderado_termico | 0.005 | 0.03 | 0.03 | 100000/80000 |

El perfil térmico, cuando se incluye, compone despolarización seguida de relajación independiente: T1=100 μs, T2=80 μs, sx/x=35 ns, cx=300 ns por ambos qubits, población excitada de equilibrio 0. No modela tiempos ociosos, reset, crosstalk, conectividad ni calibraciones reales.

## Búsqueda adaptativa y control

| N | Perfil | Algoritmo | Éxitos | IC 95% | Gap medio | Presupuesto medio | Oráculos medios | Circuitos medios | Inválidos |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| 3 | fuerte | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 46.66 | 50.17 | 25.61% |
| 3 | fuerte | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 0.00 | 0.00 | 24.78% |
| 3 | ideal | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 46.66 | 50.17 | 25.61% |
| 3 | ideal | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 0.00 | 0.00 | 24.78% |
| 3 | leve | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 46.66 | 50.17 | 25.61% |
| 3 | leve | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 0.00 | 0.00 | 24.78% |
| 3 | moderado | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 46.66 | 50.17 | 25.61% |
| 3 | moderado | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 0.00 | 0.00 | 24.78% |
| 3 | moderado_termico | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 46.66 | 50.17 | 25.67% |
| 3 | moderado_termico | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 65.22 | 0.00 | 0.00 | 24.78% |
| 4 | fuerte | grover | 88/100 | [80.19%, 93.00%] | 1.280 | 140.89 | 120.71 | 72.71 | 25.42% |
| 4 | fuerte | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 140.89 | 0.00 | 0.00 | 25.51% |
| 4 | ideal | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 140.85 | 122.24 | 70.91 | 24.48% |
| 4 | ideal | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 140.85 | 0.00 | 0.00 | 25.54% |
| 4 | leve | grover | 100/100 | [96.30%, 100.00%] | 0.000 | 141.02 | 121.38 | 71.92 | 24.54% |
| 4 | leve | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 141.02 | 0.00 | 0.00 | 25.53% |
| 4 | moderado | grover | 94/100 | [87.52%, 97.22%] | 0.600 | 141.00 | 120.74 | 72.82 | 25.16% |
| 4 | moderado | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 141.00 | 0.00 | 0.00 | 25.52% |
| 4 | moderado_termico | grover | 90/100 | [82.56%, 94.48%] | 1.000 | 140.94 | 120.74 | 73.04 | 24.96% |
| 4 | moderado_termico | random_matched | 100/100 | [96.30%, 100.00%] | 0.000 | 140.94 | 0.00 | 0.00 | 25.50% |

## Amplificación del conjunto óptimo

![Barrido de j](amplification.png)

El barrido usa todos los índices óptimos como marcados y j=0…ceil(sqrt(N!))+1. Es un diagnóstico del circuito con conocimiento clásico del óptimo, no una búsqueda adicional. Las probabilidades son exactas para el modelo y no requieren IC de shots.

| N | Perfil | j* ideal | P(óptimo) en j* | Uniforme | CX en j* | Profundidad en j* |
|---|---|---:|---:|---:|---:|---:|
| 3 | ideal | 0 | 0.500000 | 0.500000 | 0 | 3 |
| 3 | leve | 0 | 0.500000 | 0.500000 | 0 | 3 |
| 3 | moderado | 0 | 0.500000 | 0.500000 | 0 | 3 |
| 3 | fuerte | 0 | 0.500000 | 0.500000 | 0 | 3 |
| 3 | moderado_termico | 0 | 0.500000 | 0.500000 | 0 | 3 |
| 4 | ideal | 4 | 0.999182 | 0.031250 | 264 | 737 |
| 4 | leve | 4 | 0.125333 | 0.031250 | 264 | 737 |
| 4 | moderado | 4 | 0.032482 | 0.031250 | 264 | 737 |
| 4 | fuerte | 4 | 0.031250 | 0.031250 | 264 | 737 |
| 4 | moderado_termico | 4 | 0.031191 | 0.031250 | 264 | 737 |

El máximo ideal se selecciona con empate numérico a 1e-12 a favor del primer j. La comparación de arriba fija siempre ese MISMO j y circuito para todos los perfiles.

Como diagnóstico adicional, el mejor j de cada perfil dentro del barrido (sin cambiar el algoritmo adaptativo) es:

| N | Perfil | j del máximo propio | P(óptimo) máxima |
|---|---|---:|---:|
| 3 | ideal | 0 | 0.500000 |
| 3 | leve | 0 | 0.500000 |
| 3 | moderado | 0 | 0.500000 |
| 3 | fuerte | 0 | 0.500000 |
| 3 | moderado_termico | 2 | 0.500383 |
| 4 | ideal | 4 | 0.999182 |
| 4 | leve | 2 | 0.196655 |
| 4 | moderado | 1 | 0.060617 |
| 4 | fuerte | 1 | 0.031693 |
| 4 | moderado_termico | 1 | 0.052194 |

## Interpretación y límites

N=3: óptimo 285, 4 índices óptimos entre 6 permutaciones (4/8 del registro). Éxito final: fuerte: 100/100; ideal: 100/100; leve: 100/100; moderado: 100/100; moderado_termico: 100/100.

Esta instancia es degenerada: la mitad del registro está marcada. θ=π/4 y sin²((2j+1)θ)=1/2 para cualquier j entero. La curva ideal NO amplifica el conjunto óptimo; un éxito final alto aquí no prueba tolerancia al ruido. N4, con óptimo único, permite observar la pérdida de amplificación con claridad.

N=4: óptimo 202, 1 índices óptimos entre 24 permutaciones (1/32 del registro). Éxito final: fuerte: 88/100; ideal: 100/100; leve: 100/100; moderado: 94/100; moderado_termico: 90/100.

Una tasa final alta no demuestra robustez de la amplificación: el presupuesto permite muchos reintentos y el control uniforme también puede encontrar el óptimo. Hay que leer conjuntamente el barrido por circuito, las consultas, el control y los IC; no inferir ventaja cuántica a partir del éxito final.

Sólo se prueban las matrices reproducibles del original (semilla de datos 42+N). Los costos están precomputados exhaustivamente; el oráculo de fase no implementa aritmética reversible del QAP. Las puertas reportadas corresponden a su descomposición matemática, no a un circuito QAP completo en una QPU.

Tamaños sin campaña completa en este conjunto: [5, 6]. Una matriz de densidad necesita 16·4^q bytes sólo para su estado: N=3/4/5/6 usa q=3/5/7/10 y 1 KiB/16 KiB/256 KiB/16 MiB, más temporales. El costo de canales, síntesis y muchos umbrales/j crece fuertemente; los resultados no se extrapolan a tamaños sin campaña completa. Las pruebas de viabilidad adicionales, si se hicieron, se documentan en VALIDATION.md.

Caché: 80 circuitos compilados, 337 distribuciones, 60948 reutilizaciones. Los tiempos dependen del orden de perfiles (ideal paga compilación compartida); no comparar velocidades entre perfiles ni contra hardware.

## Reproducibilidad y archivos

Python: `3.14.7`. Versiones: `{"qiskit": "2.6.1", "qiskit-aer": "0.17.2", "numpy": "2.5.4", "pytest": "9.1.1", "matplotlib": "3.11.2"}`. Dependencias completas instaladas: [environment.txt](environment.txt).
SHA-256 original: `c71fdca73a6f9a0d9ae4e179ec83d3b4962fc084b21abc4c18ada240a462e409`.
SHA-256 referencia Downloads: `c71fdca73a6f9a0d9ae4e179ec83d3b4962fc084b21abc4c18ada240a462e409`. Coinciden: `True`.
SHA-256 benchmark: `1e35e30bc14e6e43e09e44c5beab1613798d8073886f66475eddb0c1753ff092`. Semilla del transpiler: 42.

Comando ejecutado (usando el intérprete de .venv-noise):

```sh
/Users/sebasbimbi/.codus/brains/brain-mvnyexyp276/grover-noise/.venv-noise/bin/python qiskit_grover_noise.py --sizes 3 4 --repetitions 100 --seed-start 42 --thermal --reference-script /Users/sebasbimbi/Downloads/qiskit_grover.py --output docs/noise
```

Desde la raíz: `python3 -m venv .venv-noise`, `.venv-noise/bin/python -m pip install -r requirements-noise.txt`; para fijar también transitivas usar `-r docs/noise/environment.txt`. Pruebas: `.venv-noise/bin/python -m pytest -q test_grover.py test_grover_noise.py`.

[results.json](results.json) contiene versiones, parámetros, matrices, costos, resumen, todas las ejecuciones, probabilidades antes/después de lectura y SHA de circuitos. [runs.csv](runs.csv) contiene todas las ejecuciones; [steps.csv](steps.csv) todos los pasos adaptativos; [summary.csv](summary.csv) los agregados; [sweep.csv](sweep.csv) el barrido. La fracción inválida agregada se pondera por el número de muestras. El tiempo de primera llegada al óptimo es diagnóstico y nunca causa parada; su media excluye fracasos, que se reportan aparte.

Documentación oficial consultada: [modelos de ruido](https://qiskit.github.io/qiskit-aer/tutorials/3_building_noise_models.html), [AerSimulator](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.AerSimulator.html), [canal despolarizante](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.noise.depolarizing_error.html), [relajación térmica](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.noise.thermal_relaxation_error.html). La documentación publicada muestra Aer 0.18.0; la ejecución y pruebas fijan y validan Aer 0.17.2 instalado.
