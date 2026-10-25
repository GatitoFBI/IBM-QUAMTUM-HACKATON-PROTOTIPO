# Compilación optimizada como medida frente al ruido

Segunda campaña independiente: N4, niveles0 y3, 100 semillas42..141 por5perfiles, mismo BBHT y presupuesto, base rz/sx/x/cx, seed_transpiler42, approximation_degree1.0, sin routing.

Se conservan los modelos exactos de qiskit_grover_noise.py. Cada circuito compilado se contrasta con Statevector del original. El nivel0 reproduce los500 registros completos de N4 de la campaña principal y el diagnóstico original; las100 trazas ideales de ambos niveles tienen las mismas muestras, j, umbral y presupuesto.

circuits.csv:50filas, dos niveles×cinco j×cinco perfiles; p_marked,p_invalid,p_before_readout son fracciones0..1. summary.csv:10grupos; runs.csv:1000ejecuciones; steps.csv:todos sus pasos. paired.csv:pares porsemilla; level3_only_success y level0_only_success son discordancias, success_difference_pp es diferencia de puntos porcentuales sobre100, y mcnemar_exact_two_sided_p usa la binomial exacta con p0=1/2 sobre los discordantes. Sus pvalores son exploratorios, sin ajuste por comparar perfiles; no prueban generalización a otras matrices. Los IC de summary son marginales Wilson95%, no de las diferencias.

El diagnóstico marca el óptimo conocido23; su j óptimo no es una política validada de BBHT. El ruido se aplica al circuito compilado común a todos los perfiles de cada nivel. La mejora de compilación preserva el ideal, pero el ruido puede responder de forma distinta porque cambian las puertas y su secuencia.

Reproducir desde la carpeta codigo del paquete:

```sh
.venv-noise/bin/python qiskit_grover_mitigation.py --source-dir . --baseline ../evidencia/original/results.json --output resultados_mitigacion
```

Se necesitan las dependencias de requirements-noise.txt. El JSON registra versiones, hashes, comando original y tiempo; todos los registros se producen con el mismo generador sin modificar la campaña principal.
