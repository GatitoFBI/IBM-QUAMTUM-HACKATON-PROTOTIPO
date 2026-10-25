"""Grover Adaptive Search (Dürr–Høyer + BBHT) para el QAP de brigadas ante El Niño.

Genera datos.js con resultados reales de Qiskit para la web:
  python -u qiskit_grover.py                    (todos los tamaños, ~8 min)
  python qiskit_grover.py --datos datos.json    (los datos copiados desde la web)

Basado en el código del equipo (untitled6.py), en su versión honesta: sin la parada
anticipada `if not marcados: break`, así que cada ejecución termina solo al agotar
el presupuesto de consultas de Dürr–Høyer.
"""
import json
import math
import time
from itertools import permutations
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import DiagonalGate
from qiskit.quantum_info import Statevector

SEMILLA = 42
REPETICIONES = 10
N_LISTA = [3, 4, 5, 6]
N_ANIMADOS = (3, 4)      # tamaños donde guardamos las amplitudes de cada etapa
RUNS_ANIMADOS = 3        # cuántas ejecuciones animadas por tamaño

# Nombres para la historia; las matrices son las de prueba del equipo (aleatorias, semilla 42)
BRIGADAS = ["Médica", "Rescate", "Logística", "Agua y saneamiento", "Comunicaciones", "Albergue"]
ZONAS = ["Piura", "Tumbes", "Lambayeque", "Trujillo", "Chosica", "Ica"]


def generar_datos(n):
    """Matrices simétricas F (sinergia entre brigadas) y D (horas entre zonas), diagonal 0."""
    rng = np.random.default_rng(SEMILLA + n)
    F = np.triu(rng.integers(1, 10, size=(n, n)), 1)
    D = np.triu(rng.integers(5, 20, size=(n, n)), 1)
    return F + F.T, D + D.T


def costo_perm(F, D, perm):
    """C(p) = Σ_{i<k} F[i][k] · D[p(i)][p(k)]; cada par se cuenta una vez (de ahí el /2)."""
    p = list(perm)
    return float((F * D[np.ix_(p, p)]).sum() / 2.0)


def resolver_clasico(F, D):
    mejor, mejor_perm, ev = float("inf"), None, 0
    for perm in permutations(range(len(F))):
        c = costo_perm(F, D, perm)
        ev += 1
        if c < mejor:
            mejor, mejor_perm = c, perm
    return mejor, mejor_perm, ev


# ---------------------------------------------------------------- circuitos
def oraculo(n_qubits, marcados):
    """Oráculo de fase: −1 en cada índice cuyo costo es menor que el umbral (idealizado)."""
    fase = np.ones(2 ** n_qubits, dtype=complex)
    fase[list(marcados)] = -1
    return DiagonalGate(fase)


def difusion(n_qubits):
    """Inversión sobre el promedio 2|s⟩⟨s| − I con H · X · (Z multicontrolada) · X · H."""
    qc = QuantumCircuit(n_qubits)
    qc.h(range(n_qubits))
    qc.x(range(n_qubits))
    if n_qubits > 1:
        qc.h(n_qubits - 1)
        qc.mcx(list(range(n_qubits - 1)), n_qubits - 1)
        qc.h(n_qubits - 1)
    else:
        qc.z(0)
    qc.x(range(n_qubits))
    qc.h(range(n_qubits))
    return qc


def circuito_grover(n_qubits, marcados, iteraciones):
    """H^n seguido de `iteraciones` × (oráculo + difusión)."""
    qc = QuantumCircuit(n_qubits)
    qc.h(range(n_qubits))
    orc, dif = oraculo(n_qubits, marcados), difusion(n_qubits)
    for _ in range(iteraciones):
        qc.append(orc, range(n_qubits))
        qc.compose(dif, inplace=True)
    return qc


def etapas(n_qubits, marcados, iteraciones):
    """Amplitudes después de cada etapa, para animarlas en la web (todas son reales)."""
    h = QuantumCircuit(n_qubits)
    h.h(range(n_qubits))
    sv = Statevector.from_label("0" * n_qubits).evolve(h)
    out = [("Superposición", sv)]
    orc, dif = oraculo(n_qubits, marcados), difusion(n_qubits)
    for it in range(iteraciones):
        sv = sv.evolve(orc)
        out.append((f"Oráculo {it + 1}", sv))
        sv = sv.evolve(dif)
        out.append((f"Difusión {it + 1}", sv))
    return [{"etapa": e, "amp": [round(float(a), 4) for a in np.real(s.data)]} for e, s in out]


# ---------------------------------------------------------------- Grover adaptativo
def presupuesto(M):
    return 22.5 * math.sqrt(M) + 1.4 * math.log2(M) ** 2


def grover_adaptive(costos, rng, lam=6 / 5, guardar_etapas=False):
    """Busca el mínimo de `costos` (indexado por permutación). Devuelve (y, costo, consultas, pasos)."""
    M = len(costos)
    n_q = max(1, math.ceil(math.log2(M)))
    tope = presupuesto(M)
    y = int(rng.integers(0, M))            # umbral inicial: una permutación al azar
    m, llamadas, pasos = 1.0, 0, []
    while llamadas < tope:
        marcados = [i for i in range(M) if costos[i] < costos[y]]
        j = int(rng.integers(0, math.ceil(m)))         # nº aleatorio de iteraciones (BBHT)
        qc = circuito_grover(n_q, marcados, j)
        probs = Statevector(qc).probabilities()        # simulación exacta con Qiskit
        salida = int(rng.choice(len(probs), p=probs / probs.sum()))   # "medición"
        llamadas += max(j, 1)
        mejora = salida < M and costos[salida] < costos[y]
        paso = {"y": y, "umbral": costos[y], "marcados": len(marcados), "j": j,
                "p_marcados": round(float(probs[marcados].sum()) if marcados else 0.0, 4),
                "salida": salida, "costo_salida": costos[salida] if salida < M else None,
                "mejora": bool(mejora), "llamadas": llamadas}
        if guardar_etapas:
            paso["etapas"] = etapas(n_q, marcados, j)
        pasos.append(paso)
        if mejora:
            y, m = salida, 1.0
        else:
            m = min(lam * m, math.sqrt(M))
    return y, costos[y], llamadas, pasos


def laboratorio(costos, n_q):
    """Amplitudes para cada umbral posible y cada nº de iteraciones (explorador de la web)."""
    M = len(costos)
    j_max = math.ceil(math.sqrt(M)) + 1
    lab = []
    for c in sorted(set(costos)):
        marcados = [i for i in range(M) if costos[i] < c]
        lab.append({"umbral": c, "marcados": marcados,
                    "amp": [[round(float(a), 4) for a in np.real(Statevector(circuito_grover(n_q, marcados, j)).data)]
                            for j in range(j_max + 1)]})
    return lab


def resolver_instancia(F, D, brigadas, zonas, semilla=SEMILLA, repeticiones=REPETICIONES):
    """Fuerza bruta + `repeticiones` ejecuciones de Grover adaptativo. Mismo formato que usa la web."""
    F, D = np.asarray(F), np.asarray(D)
    n = len(F)
    t0 = time.perf_counter()
    mejor, perm_opt, ev = resolver_clasico(F, D)
    t_cl = time.perf_counter() - t0
    perms = list(permutations(range(n)))
    costos = [costo_perm(F, D, p) for p in perms]   # tabla que usa el oráculo idealizado
    n_q = max(1, math.ceil(math.log2(len(perms))))
    rng = np.random.default_rng(semilla)
    runs = []
    for r in range(repeticiones):
        t0 = time.perf_counter()
        idx, c, q, pasos = grover_adaptive(costos, rng, guardar_etapas=n in N_ANIMADOS and r < RUNS_ANIMADOS)
        runs.append({"indice": idx, "costo": c, "consultas": q, "tiempo_s": round(time.perf_counter() - t0, 3),
                     "optimo": abs(c - mejor) < 1e-9, "pasos": pasos})
    qs = [r["consultas"] for r in runs]
    print(f"N={n} qubits={n_q} óptimo={mejor} | consultas {np.mean(qs):.0f}±{np.std(qs):.0f} "
          f"| acierto {sum(r['optimo'] for r in runs)}/{repeticiones} | {np.mean([r['tiempo_s'] for r in runs]):.2f}s")
    return {"n": n, "qubits": n_q, "M": len(perms), "presupuesto": round(presupuesto(len(perms)), 1),
            "F": F.tolist(), "D": D.tolist(), "brigadas": list(brigadas), "zonas": list(zonas),
            "perms": [list(p) for p in perms], "costos": costos,
            "optimo": mejor, "perm_opt": list(perm_opt), "clasico_s": round(t_cl, 5), "evaluaciones": ev,
            "runs": runs}


if __name__ == "__main__":
    import argparse
    import qiskit

    ap = argparse.ArgumentParser(description="Grover Adaptive Search para el QAP de brigadas")
    ap.add_argument("--datos", help="JSON copiado desde la web (botón «Copiar datos para Qiskit»)")
    args = ap.parse_args()
    if args.datos:  # resolver solo los datos editados en la web
        d = json.loads(Path(args.datos).read_text(encoding="utf-8"))
        inst = resolver_instancia(d["F"], d["D"], d["brigadas"], d["zonas"], d.get("semilla", SEMILLA), d.get("repeticiones", REPETICIONES))
        b = min(inst["runs"], key=lambda r: r["costo"])
        print("Mejor asignación:", {inst["brigadas"][i]: inst["zonas"][z] for i, z in enumerate(inst["perms"][b["indice"]])})
        raise SystemExit

    salida = {"qiskit": qiskit.__version__, "generado": time.strftime("%Y-%m-%d %H:%M"),
              "semilla": SEMILLA, "repeticiones": REPETICIONES, "instancias": {}}
    for n in N_LISTA:
        F, D = generar_datos(n)
        inst = resolver_instancia(F, D, BRIGADAS[:n], ZONAS[:n])
        costos, n_q = inst["costos"], inst["qubits"]
        if n in N_ANIMADOS:
            inst["lab"] = laboratorio(costos, n_q)
        if n == 3:
            ejemplo = [costos.index(min(costos))]   # un solo índice marcado, como en la web
            inst["circuito_texto"] = str(circuito_grover(n_q, ejemplo, 1).draw(output="text", fold=-1))
        salida["instancias"][n] = inst

    out = Path(__file__).with_name("datos.js")
    out.write_text("window.QNINO = " + json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print("OK →", out, f"({out.stat().st_size / 1024:.0f} KB)")
