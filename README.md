# Q-Niño · Asignación de brigadas ante El Niño con Grover

Prototipo de la Hackathon Qiskit Fall Fest 2026, para el reto de NTT DATA de asignación cuadrática (QAP).
Decide qué brigada (Médica, Rescate, Logística…) va a qué zona (Piura, Tumbes, Chosica…) minimizando
C(p) = Σ_{i<k} F[i][k] · D[p(i)][p(k)], y lo resuelve con **Grover Adaptive Search** (Dürr–Høyer + BBHT)
simulado con Qiskit.

## Cómo funciona

- **Codificación por índice de permutación:** cada asignación válida es un número de 0 a N!−1 en
  ⌈log₂ N!⌉ qubits (10 qubits para N = 6, en lugar de 36 con el QUBO one-hot). No hay soluciones
  inválidas ni penalizaciones.
- **Grover adaptativo:** se toma un umbral al azar, el oráculo de fase (`DiagonalGate`) marca los índices
  más baratos, la difusión (H · X · MCX · X · H) amplifica sus amplitudes, se mide con `Statevector` y,
  si hay mejora, el umbral baja. Se termina al agotar el presupuesto 22,5·√M + 1,4·log₂²M.
- **Versión honesta:** sin la parada anticipada del código original, que usaba información clásica.

## Ejecutar

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -u qiskit_grover.py   # genera datos.js (~5 min)
.venv\Scripts\python.exe -m pytest -q   # test del núcleo cuántico
.venv\Scripts\python.exe api.py          # web + Qiskit en vivo en http://127.0.0.1:8000
```

Demo publicada: https://q-nino.vercel.app

La web (`index.html`, `css/`, `js/`) también se abre con doble clic. Los datos de referencia salen de
`datos.js`, generado por Qiskit con semilla 42, así que son reproducibles. Si se editan las matrices:
con `api.py` corriendo, la web usa Qiskit en vivo; sin servidor, recalcula en el navegador con
`js/grover.js`, una réplica del mismo algoritmo, y lo indica en la cabecera.

## Estructura

| Archivo | Qué hace |
|---|---|
| `qiskit_grover.py` | Núcleo cuántico: oráculo `DiagonalGate`, difusión, Grover adaptativo, generación de `datos.js` |
| `api.py` | Backend FastAPI: `/api/grover` ejecuta Qiskit con los datos editados y sirve la web |
| `test_grover.py` | Tests: óptimo de N = 3 y amplificación 25/32 con 3 qubits |
| `index.html`, `css/`, `js/app.js` | Interfaz: simulador editable, animación, calculadoras, comparador, ejercicios |
| `js/grover.js` | Réplica del algoritmo en el navegador para recalcular al instante |

## Limitaciones

1. El oráculo es idealizado: marca los estados usando la tabla de costos (N! evaluaciones clásicas).
   Medimos **consultas al oráculo**, no tiempo.
2. El tiempo de simulación no representa el de una QPU.
3. La ventaja teórica en consultas aparece desde N ≈ 7.
4. Las matrices F y D son de prueba (aleatorias, semilla 42). Falta usar qap10 y validar sus óptimos de
   control (24, 32 y 340).

## Créditos

Qiskit 2.6 y NumPy. Algoritmo: Dürr y Høyer (1996); Boyer, Brassard, Høyer y Tapp (1998). Código base de
Grover del equipo. Web y visualizaciones hechas con ayuda de Claude Code (Anthropic).
