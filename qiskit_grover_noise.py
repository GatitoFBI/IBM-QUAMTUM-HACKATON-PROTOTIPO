"""Benchmark reproducible de ruido sintético; no modifica la API ni datos.js.

Cada paso BBHT toma UNA muestra del estado mixto. La caché evita recalcular
distribuciones idénticas, no otorga shots adicionales al algoritmo.
"""
import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import importlib.metadata
from itertools import permutations
import json
import math
from pathlib import Path
import platform
import shlex
import subprocess
import sys
import time

import numpy as np
from qiskit import qasm2, transpile
from qiskit_aer import AerSimulator
from qiskit_aer.noise import (
    NoiseModel, ReadoutError, depolarizing_error, thermal_relaxation_error,
)

import qiskit_grover as original

BASIS = ("rz", "sx", "x", "cx")


@dataclass(frozen=True)
class NoiseProfile:
    name: str
    p1: float = 0.0
    p2: float = 0.0
    readout: float = 0.0
    t1_ns: float | None = None
    t2_ns: float | None = None
    gate1_ns: float = 35.0
    gate2_ns: float = 300.0

    def __post_init__(self):
        if any(not math.isfinite(p) or not 0 <= p <= 1
               for p in (self.p1, self.p2, self.readout)):
            raise ValueError("Los parámetros de ruido deben estar entre 0 y 1")
        if (self.t1_ns is None) != (self.t2_ns is None):
            raise ValueError("T1 y T2 deben proporcionarse juntos")
        if self.t1_ns is not None:
            if (not all(math.isfinite(v) and v > 0 for v in
                        (self.t1_ns, self.t2_ns, self.gate1_ns, self.gate2_ns))
                    or self.t2_ns > 2 * self.t1_ns):
                raise ValueError("Se requiere T1 > 0, 0 < T2 <= 2*T1 y duraciones positivas")


PROFILES = (
    NoiseProfile("ideal"),
    NoiseProfile("leve", .001, .01, .01),
    NoiseProfile("moderado", .005, .03, .03),
    NoiseProfile("fuerte", .01, .1, .05),
)
THERMAL = NoiseProfile("moderado_termico", .005, .03, .03, 100_000, 80_000)


def noise_model(profile, include_readout=False):
    """Rz virtual: sin error. Errores locales tras sx/x/cx, antes de lectura."""
    model = NoiseModel(basis_gates=list(BASIS))
    for gates, width, strength, duration in (
        (["sx", "x"], 1, profile.p1, profile.gate1_ns),
        (["cx"], 2, profile.p2, profile.gate2_ns),
    ):
        error = depolarizing_error(strength, width)
        if profile.t1_ns is not None:
            relaxation = thermal_relaxation_error(profile.t1_ns, profile.t2_ns, duration)
            if width == 2:
                relaxation = relaxation.tensor(relaxation)
            error = error.compose(relaxation)  # despolarización seguida de relajación
        if strength or profile.t1_ns is not None:
            model.add_all_qubit_quantum_error(error, gates)
    if include_readout and profile.readout:
        e = profile.readout
        model.add_all_qubit_readout_error(ReadoutError([[1-e, e], [e, 1-e]]))
    return model


def apply_readout(probabilities, error):
    """Canal clásico independiente P(y|x), bit q = peso 2**q (Qiskit)."""
    p = np.asarray(probabilities, dtype=float).copy()
    size = len(p)
    if size < 2 or size & (size - 1) or not 0 <= error <= 1:
        raise ValueError("Se requiere un vector de tamaño 2**q y error en [0,1]")
    indices = np.arange(size)
    for q in range(size.bit_length() - 1):
        p = (1-error) * p + error * p[indices ^ (1 << q)]
    return p


class DistributionCache:
    """Compila una vez por (q, marcados, j), comparte circuito entre perfiles."""
    def __init__(self, profiles=PROFILES, transpiler_seed=42):
        self.transpiler_seed = transpiler_seed
        self.compiled = {}
        self.distributions = {}
        self.backends = {
            p: AerSimulator(method="density_matrix", noise_model=noise_model(p),
                            max_parallel_threads=1, max_parallel_experiments=1)
            for p in profiles
        }
        self.compile_seconds = 0.0
        self.simulate_seconds = 0.0
        self.hits = 0

    def circuit(self, qubits, marked, iterations):
        key = (qubits, tuple(sorted(set(marked))), iterations)
        if iterations < 0 or any(i < 0 or i >= 2**qubits for i in key[1]):
            raise ValueError("Índices marcados o iteraciones inválidos")
        if key not in self.compiled:
            start = time.perf_counter()
            qc = transpile(original.circuito_grover(qubits, key[1], iterations),
                           basis_gates=list(BASIS), optimization_level=0,
                           seed_transpiler=self.transpiler_seed)
            ops = dict(qc.count_ops())
            if set(ops) - set(BASIS):
                raise RuntimeError(f"Puertas sin descomponer: {ops}")
            metrics = {
                "circuit_sha256": hashlib.sha256(qasm2.dumps(qc).encode()).hexdigest(),
                "qubits": qubits, "marked": list(key[1]), "j": iterations,
                "depth": qc.depth(), "cx": ops.get("cx", 0),
                "physical_1q": ops.get("sx", 0) + ops.get("x", 0),
                "virtual_rz": ops.get("rz", 0), "operations": ops,
            }
            self.compiled[key] = (qc, metrics)
            self.compile_seconds += time.perf_counter() - start
        return self.compiled[key]

    def get(self, qubits, marked, iterations, profile):
        key = (qubits, tuple(sorted(set(marked))), iterations, profile)
        qc, metrics = self.circuit(*key[:3])
        if key not in self.distributions:
            start = time.perf_counter()
            saved = qc.copy()
            saved.save_probabilities(label="probabilities")
            result = self.backends[profile].run(saved, shots=1).result()
            if not result.success or result.results[0].metadata["method"] != "density_matrix":
                raise RuntimeError(f"Aer no completó density_matrix: {result.status}")
            before_readout = np.asarray(result.data(0)["probabilities"], dtype=float)
            if (not np.all(np.isfinite(before_readout)) or before_readout.min() < -1e-10
                    or abs(before_readout.sum() - 1) > 1e-9):
                raise RuntimeError("Distribución inválida devuelta por Aer")
            # Sólo corregimos redondeo en TODO el espacio, nunca condicionamos a índices válidos.
            before_readout = np.maximum(before_readout, 0)
            before_readout /= before_readout.sum()
            observed = apply_readout(before_readout, profile.readout)
            observed /= observed.sum()
            observed.setflags(write=False)
            self.distributions[key] = (observed, before_readout)
            self.simulate_seconds += time.perf_counter() - start
        else:
            self.hits += 1
        return self.distributions[key][0], metrics


def adaptive_run(costs, rng, cache, profile, lam=6/5):
    """Mismo bucle BBHT que grover_adaptive; instrumentación sin criterio de parada nuevo."""
    if not len(costs) or not np.all(np.isfinite(costs)) or not math.isfinite(lam) or lam <= 1:
        raise ValueError("Costos finitos no vacíos y lambda > 1 requeridos")
    size = len(costs)
    qubits = max(1, math.ceil(math.log2(size)))
    limit = original.presupuesto(size)
    y = int(rng.integers(0, size))
    initial = y
    m, charged, oracle_calls = 1.0, 0, 0
    steps = []
    optimum = min(costs)  # sólo instrumentación: NO determina control ni parada
    first_hit = 0 if costs[y] == optimum else None
    while charged < limit:
        marked = [i for i in range(size) if costs[i] < costs[y]]
        j = int(rng.integers(0, math.ceil(m)))
        probs, metrics = cache.get(qubits, marked, j, profile)
        outcome = int(rng.choice(len(probs), p=probs / probs.sum()))
        charged += max(j, 1)
        oracle_calls += j
        improves = outcome < size and costs[outcome] < costs[y]
        steps.append({
            "step": len(steps) + 1, "y": y, "threshold": float(costs[y]),
            "m": m, "marked_count": len(marked), "j": j, "outcome": outcome,
            "invalid": outcome >= size, "improves": bool(improves),
            "budget_used": charged, "oracle_calls": oracle_calls,
            "p_marked": float(probs[marked].sum()), "p_invalid": float(probs[size:].sum()),
            "circuit_sha256": metrics["circuit_sha256"], "depth": metrics["depth"],
            "cx": metrics["cx"], "physical_1q": metrics["physical_1q"],
            "virtual_rz": metrics["virtual_rz"],
        })
        if improves:
            y, m = outcome, 1.0
            if first_hit is None and costs[y] == optimum:
                first_hit = charged
        else:
            m = min(lam * m, math.sqrt(size))
    return {
        "initial_index": initial, "index": y, "cost": float(costs[y]),
        "optimal": bool(costs[y] == optimum), "gap": float(costs[y] - optimum),
        "gap_relative": float((costs[y] - optimum) / abs(optimum)) if optimum else None,
        "budget_limit": limit, "budget_used": charged, "oracle_calls": oracle_calls,
        "samples": len(steps), "circuits": len(steps), "first_optimal_budget": first_hit,
        "invalid_count": sum(s["invalid"] for s in steps),
        "invalid_fraction": sum(s["invalid"] for s in steps) / len(steps),
        "cx_total": sum(s["cx"] for s in steps),
        "physical_1q_total": sum(s["physical_1q"] for s in steps),
        "virtual_rz_total": sum(s["virtual_rz"] for s in steps),
        "depth_sum": sum(s["depth"] for s in steps),
        "depth_max": max(s["depth"] for s in steps), "steps": steps,
    }


def random_control(costs, rng, budget_used, initial_index):
    """Una propuesta uniforme en 2**q por unidad del presupuesto realmente consumido.

    Comparador de consultas lógicas, no de puertas físicas. La inicialización es
    la misma y gratuita en ambos. El padding se rechaza y consume presupuesto.
    """
    if budget_used < 1 or not 0 <= initial_index < len(costs):
        raise ValueError("Presupuesto o índice inicial inválido")
    size = len(costs)
    dimension = 2 ** max(1, math.ceil(math.log2(size)))
    y, invalid = initial_index, 0
    optimum = min(costs)
    first_hit = 0 if costs[y] == optimum else None
    for used in range(1, budget_used + 1):
        outcome = int(rng.integers(0, dimension))
        invalid += outcome >= size
        if outcome < size and costs[outcome] < costs[y]:
            y = outcome
            if first_hit is None and costs[y] == optimum:
                first_hit = used
    return {
        "initial_index": initial_index, "index": y, "cost": float(costs[y]),
        "optimal": bool(costs[y] == optimum), "gap": float(costs[y] - optimum),
        "gap_relative": float((costs[y] - optimum) / abs(optimum)) if optimum else None,
        "budget_limit": original.presupuesto(size), "budget_used": budget_used,
        "oracle_calls": 0, "samples": budget_used, "circuits": 0,
        "first_optimal_budget": first_hit, "invalid_count": invalid,
        "invalid_fraction": invalid / budget_used, "cx_total": 0,
        "physical_1q_total": 0, "virtual_rz_total": 0, "depth_sum": 0, "depth_max": 0,
    }


def wilson(successes, total):
    if total < 1 or not 0 <= successes <= total:
        raise ValueError("Se requiere 0 <= éxitos <= total y total > 0")
    z = 1.959963984540054
    p = successes / total
    denom = 1 + z*z / total
    middle = (p + z*z / (2*total)) / denom
    radius = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / denom
    return (0.0 if successes == 0 else max(0.0, middle-radius),
            1.0 if successes == total else min(1.0, middle+radius))


def summarize(rows):
    summaries = []
    keys = sorted({(r["n"], r["profile"], r["algorithm"]) for r in rows})
    for n, profile, algorithm in keys:
        group = [r for r in rows if (r["n"], r["profile"], r["algorithm"]) == (n, profile, algorithm)]
        successes = sum(r["optimal"] for r in group)
        low, high = wilson(successes, len(group))
        summary = {"n": n, "profile": profile, "algorithm": algorithm,
                   "runs": len(group), "successes": successes, "success_rate": successes/len(group),
                   "wilson95_low": low, "wilson95_high": high,
                   "invalid_fraction_pooled": sum(r["invalid_count"] for r in group)/sum(r["samples"] for r in group)}
        for key in ("gap", "budget_used", "oracle_calls", "circuits", "samples",
                    "cx_total", "physical_1q_total", "virtual_rz_total", "depth_sum", "depth_max"):
            summary[key + "_mean"] = float(np.mean([r[key] for r in group]))
        gaps = [r["gap_relative"] for r in group if r["gap_relative"] is not None]
        summary["gap_relative_mean"] = float(np.mean(gaps)) if gaps else None
        first = [r["first_optimal_budget"] for r in group if r["first_optimal_budget"] is not None]
        summary["first_optimal_budget_mean_successes_only"] = float(np.mean(first)) if first else None
        summaries.append(summary)
    return summaries


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def benchmark(sizes, repetitions, seed_start, profiles, transpiler_seed, output, reference=None):
    output.mkdir(parents=True, exist_ok=True)
    benchmark_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    source = Path(original.__file__)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    reference_hash = hashlib.sha256(reference.read_bytes()).hexdigest() if reference else None
    if reference and reference_hash != source_hash:
        raise ValueError("El script de referencia difiere del importado; no se ejecutó el benchmark")
    start = time.perf_counter()
    cache = DistributionCache(profiles, transpiler_seed)
    runs, steps, sweep, instances = [], [], [], []
    for n in sizes:
        instance_start = time.perf_counter()
        F, D = original.generar_datos(n)
        costs = [original.costo_perm(F, D, p) for p in permutations(range(n))]
        size = len(costs)
        qubits = max(1, math.ceil(math.log2(size)))
        optimal_indices = [i for i, c in enumerate(costs) if c == min(costs)]
        for profile in profiles:
            profile_start = time.perf_counter()
            for seed in range(seed_start, seed_start + repetitions):
                labels = {"n": n, "profile": profile.name, "seed": seed}
                run = adaptive_run(costs, np.random.default_rng(seed), cache, profile)
                steps.extend({**labels, **s} for s in run.pop("steps"))
                runs.append({**labels, "algorithm": "grover", **run})
                control = random_control(costs, np.random.default_rng(np.random.SeedSequence([seed, n, 1])),
                                         run["budget_used"], run["initial_index"])
                runs.append({**labels, "algorithm": "random_matched", **control})
            for j in range(math.ceil(math.sqrt(size)) + 2):
                p, metrics = cache.get(qubits, optimal_indices, j, profile)
                theta = math.asin(math.sqrt(len(optimal_indices) / 2**qubits))
                sweep.append({"n": n, "profile": profile.name, "j": j,
                              "marked_count": len(optimal_indices), "uniform": len(optimal_indices)/2**qubits,
                              "p_marked": float(p[optimal_indices].sum()), "p_invalid": float(p[size:].sum()),
                              "ideal_formula": math.sin((2*j+1)*theta)**2,
                              **{k: metrics[k] for k in ("circuit_sha256", "depth", "cx", "physical_1q", "virtual_rz")}})
            selected = [r for r in runs if r["n"] == n and r["profile"] == profile.name and r["algorithm"] == "grover"]
            print(f"N={n} {profile.name}: {sum(r['optimal'] for r in selected)}/{repetitions}; "
                  f"{time.perf_counter()-profile_start:.2f}s", flush=True)
        instances.append({"n": n, "M": size, "qubits": qubits, "F": F.tolist(), "D": D.tolist(),
                          "costs": costs, "optimum": min(costs), "optimal_indices": optimal_indices,
                          "budget_limit": original.presupuesto(size), "seconds": time.perf_counter()-instance_start})
    summaries = summarize(runs)
    distributions = []
    for (q, marked, j, profile), (p, before) in cache.distributions.items():
        _, metrics = cache.circuit(q, marked, j)
        distributions.append({**metrics, "profile": profile.name,
                              "probabilities_before_readout": before.tolist(), "probabilities": p.tolist()})
    metadata = {
        "generated_utc": datetime.now(timezone.utc).isoformat(), "command": shlex.join([sys.executable, *sys.argv]),
        "python": sys.version, "interpreter": sys.executable, "platform": platform.platform(),
        "versions": {p: importlib.metadata.version(p) for p in ("qiskit", "qiskit-aer", "numpy", "pytest", "matplotlib")},
        "original_sha256": source_hash, "reference_sha256": reference_hash,
        "reference_matches": reference_hash == source_hash if reference else None,
        "benchmark_sha256": benchmark_hash,
        "seed_start": seed_start, "repetitions": repetitions, "transpiler_seed": transpiler_seed,
        "basis_gates": BASIS, "optimization_level": 0, "coupling_map": None,
        "method": "density_matrix", "max_parallel_threads": 1, "lambda_bbht": 6/5,
        "profiles": [asdict(p) for p in profiles], "unique_compiled_circuits": len(cache.compiled),
        "unique_distributions": len(cache.distributions), "cache_hits": cache.hits,
        "compile_seconds": cache.compile_seconds, "simulate_seconds": cache.simulate_seconds,
        "benchmark_seconds": time.perf_counter()-start,
        "unrun_sizes": [n for n in (3, 4, 5, 6) if n not in sizes],
    }
    result = {"metadata": metadata, "instances": instances, "summary": summaries, "sweep": sweep,
              "runs": runs, "distributions": distributions}
    if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != benchmark_hash:
        raise RuntimeError("El benchmark cambió durante la ejecución; repetir para obtener evidencia consistente")
    (output / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    for name, rows in (("runs.csv", runs), ("steps.csv", steps), ("summary.csv", summaries), ("sweep.csv", sweep)):
        write_csv(output/name, rows)
    frozen = subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True)
    (output / "environment.txt").write_text(frozen, encoding="utf-8")
    write_report(result, output)
    return result


def write_report(result, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    meta = result["metadata"]
    fig, axes = plt.subplots(1, len(result["instances"]), figsize=(6*len(result["instances"]), 4), squeeze=False)
    for ax, instance in zip(axes[0], result["instances"]):
        for profile in meta["profiles"]:
            rows = [r for r in result["sweep"] if r["n"] == instance["n"] and r["profile"] == profile["name"]]
            ax.plot([r["j"] for r in rows], [r["p_marked"] for r in rows], "o-", label=profile["name"])
        ax.axhline(len(instance["optimal_indices"])/2**instance["qubits"], color="0.4", linestyle="--", label="uniforme k/2^q")
        ax.set(title=f"N={instance['n']} · {instance['qubits']} qubits · k={len(instance['optimal_indices'])}",
               xlabel="Iteraciones j", ylabel="P(medir algún óptimo)", ylim=(0, 1.04))
        ax.grid(alpha=.2)
        ax.legend(fontsize=8)
    fig.suptitle("Grover: amplificación por circuito bajo ruido sintético")
    fig.tight_layout()
    fig.savefig(output / "amplification.png", dpi=180)
    plt.close(fig)
    lines = ["# Grover con ruido sintético: resultados reproducibles", "",
             "Se probó el script original sin modificarlo. Estos escenarios son sintéticos; no son calibraciones ni ejecuciones de hardware IBM.", "",
             f"Ejecución UTC: {meta['generated_utc']}. {meta['repetitions']} semillas por N/perfil, desde {meta['seed_start']}.",
             f"Tiempo del benchmark (sin render del gráfico): {meta['benchmark_seconds']:.2f} s; compilación {meta['compile_seconds']:.2f} s; simulación Aer {meta['simulate_seconds']:.2f} s.", "",
             "## Método", "",
             "Se importan generar_datos, costo_perm, presupuesto y circuito_grover del original. Cada distribución corresponde a una matriz de densidad exacta; cada paso BBHT toma una sola muestra con NumPy. No se escoge el mejor de varios shots. La caché sólo reutiliza distribuciones idénticas.", "",
             "Se descomponen DiagonalGate y mcx en rz/sx/x/cx, optimization_level=0, sin coupling_map ni routing. Cada (qubits, marcados, j) se compila una vez para todos los perfiles. Rz es virtual y no lleva error; sx/x llevan despolarización 1q y cx despolarización 2q. El parámetro p es λ en E(ρ)=(1−λ)ρ+λ I/2^d, no la infidelidad media de puerta.", "",
             "save_probabilities se guarda ANTES de medir: no incorpora el error clásico de lectura. Aplicamos explícitamente P(y|x) como flips independientes de probabilidad readout por bit, después del canal cuántico. Las pruebas comparan con medidas Aer que sí incluyen ReadoutError. No se inventan amplitudes de estados mixtos.", "",
             "Se conserva el bucle original: umbral inicial uniforme válido, j uniforme en [0, ceil(m)), lambda=6/5, m máximo sqrt(N!), reinicio de m tras mejorar. Se sigue hasta agotar presupuesto incluso con marcados vacío. Salidas >= N! se rechazan, consumen presupuesto y nunca se renormaliza sobre válidos.", "",
             "Presupuesto original: suma max(j,1), con el posible exceso del último paso. Llamadas de oráculo: suma j. Circuitos: número de pasos/mediciones. CX, sx/x, Rz y profundidad se contabilizan por separado; profundidad suma es suma de profundidades de circuitos, no latencia física. La tabla de costos y la inicialización se excluyen del presupuesto, igual que en el original.", "",
             "El control random_matched usa el MISMO umbral inicial y exactamente tantas propuestas uniformes en 2^q como unidades de presupuesto consumió su ejecución Grover emparejada. Cada propuesta cuesta una consulta lógica, también si cae en padding. Usa SeedSequence([semilla,N,1]); no usa el resultado óptimo para parar. No ejecuta oráculos ni circuitos cuánticos. Es un control de uniformidad del registro, no el mejor algoritmo clásico: una búsqueda clásica puede muestrear directamente entre N! índices válidos y evitar padding. Comparación de consultas abstractas, no de tiempo o costo físico ni prueba de ventaja cuántica.", "",
             "Las mismas semillas se reutilizan entre perfiles (comparaciones emparejadas); los IC Wilson 95% describen la tasa marginal entre semillas de UNA instancia fija por N, no una población de QAP ni un intervalo de diferencias entre perfiles.", "",
             "## Perfiles", "", "| Perfil | p1 | p2 | Lectura por bit | T1/T2 (ns) |", "|---|---:|---:|---:|---|" ]
    for p in meta["profiles"]:
        lines.append(f"| {p['name']} | {p['p1']} | {p['p2']} | {p['readout']} | {p['t1_ns']}/{p['t2_ns']} |")
    lines += ["", "El perfil térmico, cuando se incluye, compone despolarización seguida de relajación independiente: T1=100 μs, T2=80 μs, sx/x=35 ns, cx=300 ns por ambos qubits, población excitada de equilibrio 0. No modela tiempos ociosos, reset, crosstalk, conectividad ni calibraciones reales.", "",
              "## Búsqueda adaptativa y control", "", "| N | Perfil | Algoritmo | Éxitos | IC 95% | Gap medio | Presupuesto medio | Oráculos medios | Circuitos medios | Inválidos |", "|---|---|---|---:|---|---:|---:|---:|---:|---:|"]
    for s in result["summary"]:
        lines.append(f"| {s['n']} | {s['profile']} | {s['algorithm']} | {s['successes']}/{s['runs']} | [{100*s['wilson95_low']:.2f}%, {100*s['wilson95_high']:.2f}%] | {s['gap_mean']:.3f} | {s['budget_used_mean']:.2f} | {s['oracle_calls_mean']:.2f} | {s['circuits_mean']:.2f} | {100*s['invalid_fraction_pooled']:.2f}% |")
    lines += ["", "## Amplificación del conjunto óptimo", "", "![Barrido de j](amplification.png)", "",
              "El barrido usa todos los índices óptimos como marcados y j=0…ceil(sqrt(N!))+1. Es un diagnóstico del circuito con conocimiento clásico del óptimo, no una búsqueda adicional. Las probabilidades son exactas para el modelo y no requieren IC de shots.", "",
              "| N | Perfil | j* ideal | P(óptimo) en j* | Uniforme | CX en j* | Profundidad en j* |", "|---|---|---:|---:|---:|---:|---:|"]
    for instance in result["instances"]:
        ideal = [r for r in result["sweep"] if r["n"] == instance["n"] and r["profile"] == "ideal"]
        peak = max(r["p_marked"] for r in ideal)
        best = next(r for r in ideal if math.isclose(r["p_marked"], peak, rel_tol=0, abs_tol=1e-12))
        for row in result["sweep"]:
            if row["n"] == instance["n"] and row["j"] == best["j"]:
                lines.append(f"| {row['n']} | {row['profile']} | {row['j']} | {row['p_marked']:.6f} | {row['uniform']:.6f} | {row['cx']} | {row['depth']} |")
    lines += ["", "El máximo ideal se selecciona con empate numérico a 1e-12 a favor del primer j. La comparación de arriba fija siempre ese MISMO j y circuito para todos los perfiles.", "",
              "Como diagnóstico adicional, el mejor j de cada perfil dentro del barrido (sin cambiar el algoritmo adaptativo) es:", "",
              "| N | Perfil | j del máximo propio | P(óptimo) máxima |", "|---|---|---:|---:|"]
    for instance in result["instances"]:
        for profile in meta["profiles"]:
            rows = [r for r in result["sweep"] if r["n"] == instance["n"] and r["profile"] == profile["name"]]
            peak = max(r["p_marked"] for r in rows)
            best = next(r for r in rows if math.isclose(r["p_marked"], peak, rel_tol=0, abs_tol=1e-12))
            lines.append(f"| {instance['n']} | {profile['name']} | {best['j']} | {best['p_marked']:.6f} |")
    lines += ["", "## Interpretación y límites", ""]
    for instance in result["instances"]:
        n, k = instance["n"], len(instance["optimal_indices"])
        outcomes = [f"{s['profile']}: {s['successes']}/{s['runs']}" for s in result["summary"] if s["n"] == n and s["algorithm"] == "grover"]
        lines += [f"N={n}: óptimo {instance['optimum']:g}, {k} índices óptimos entre {instance['M']} permutaciones ({k}/{2**instance['qubits']} del registro). Éxito final: " + "; ".join(outcomes) + ".", ""]
        if k == 2**(instance["qubits"]-1):
            lines += ["Esta instancia es degenerada: la mitad del registro está marcada. θ=π/4 y sin²((2j+1)θ)=1/2 para cualquier j entero. La curva ideal NO amplifica el conjunto óptimo; un éxito final alto aquí no prueba tolerancia al ruido. N4, con óptimo único, permite observar la pérdida de amplificación con claridad.", ""]
    lines += [
              "Una tasa final alta no demuestra robustez de la amplificación: el presupuesto permite muchos reintentos y el control uniforme también puede encontrar el óptimo. Hay que leer conjuntamente el barrido por circuito, las consultas, el control y los IC; no inferir ventaja cuántica a partir del éxito final.", "",
              "Sólo se prueban las matrices reproducibles del original (semilla de datos 42+N). Los costos están precomputados exhaustivamente; el oráculo de fase no implementa aritmética reversible del QAP. Las puertas reportadas corresponden a su descomposición matemática, no a un circuito QAP completo en una QPU.", "",
              f"Tamaños sin campaña completa en este conjunto: {meta['unrun_sizes']}. Una matriz de densidad necesita 16·4^q bytes sólo para su estado: N=3/4/5/6 usa q=3/5/7/10 y 1 KiB/16 KiB/256 KiB/16 MiB, más temporales. El costo de canales, síntesis y muchos umbrales/j crece fuertemente; los resultados no se extrapolan a tamaños sin campaña completa. Las pruebas de viabilidad adicionales, si se hicieron, se documentan en VALIDATION.md.", "",
              f"Caché: {meta['unique_compiled_circuits']} circuitos compilados, {meta['unique_distributions']} distribuciones, {meta['cache_hits']} reutilizaciones. Los tiempos dependen del orden de perfiles (ideal paga compilación compartida); no comparar velocidades entre perfiles ni contra hardware.", "",
              "## Reproducibilidad y archivos", "",
              f"Python: `{platform.python_version()}`. Versiones: `{json.dumps(meta['versions'])}`. Dependencias completas instaladas: [environment.txt](environment.txt).",
              f"SHA-256 original: `{meta['original_sha256']}`.",
              f"SHA-256 referencia Downloads: `{meta['reference_sha256']}`. Coinciden: `{meta['reference_matches']}`.",
              f"SHA-256 benchmark: `{meta['benchmark_sha256']}`. Semilla del transpiler: {meta['transpiler_seed']}.", "",
              "Comando ejecutado (usando el intérprete de .venv-noise):", "", "```sh", meta["command"], "```", "",
              "Desde la raíz: `python3 -m venv .venv-noise`, `.venv-noise/bin/python -m pip install -r requirements-noise.txt`; para fijar también transitivas usar `-r docs/noise/environment.txt`. Pruebas: `.venv-noise/bin/python -m pytest -q test_grover.py test_grover_noise.py`.", "",
              "[results.json](results.json) contiene versiones, parámetros, matrices, costos, resumen, todas las ejecuciones, probabilidades antes/después de lectura y SHA de circuitos. [runs.csv](runs.csv) contiene todas las ejecuciones; [steps.csv](steps.csv) todos los pasos adaptativos; [summary.csv](summary.csv) los agregados; [sweep.csv](sweep.csv) el barrido. La fracción inválida agregada se pondera por el número de muestras. El tiempo de primera llegada al óptimo es diagnóstico y nunca causa parada; su media excluye fracasos, que se reportan aparte.", "",
              "Documentación oficial consultada: [modelos de ruido](https://qiskit.github.io/qiskit-aer/tutorials/3_building_noise_models.html), [AerSimulator](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.AerSimulator.html), [canal despolarizante](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.noise.depolarizing_error.html), [relajación térmica](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.noise.thermal_relaxation_error.html). La documentación publicada muestra Aer 0.18.0; la ejecución y pruebas fijan y validan Aer 0.17.2 instalado.", ""]
    (output / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sizes", type=int, nargs="+", choices=(3, 4, 5, 6), default=[3, 4])
    parser.add_argument("--repetitions", type=int, default=100)
    parser.add_argument("--seed-start", type=int, default=42)
    parser.add_argument("--transpiler-seed", type=int, default=42)
    parser.add_argument("--thermal", action="store_true", help="Añadir moderado con T1/T2 sintéticos")
    parser.add_argument("--allow-large", action="store_true", help="Permitir N5/N6; costo de simulación elevado")
    parser.add_argument("--output", type=Path, default=Path("docs/noise"))
    parser.add_argument("--reference-script", type=Path, help="Verificar igualdad SHA-256 con el script recibido")
    args = parser.parse_args()
    if args.repetitions < 1 or args.seed_start < 0 or args.transpiler_seed < 0:
        parser.error("Repeticiones > 0 y semillas >= 0 requeridas")
    if max(args.sizes) > 4 and not args.allow_large:
        parser.error("N5/N6 requieren --allow-large por costo de simulación")
    profiles = PROFILES + ((THERMAL,) if args.thermal else ())
    benchmark(sorted(set(args.sizes)), args.repetitions, args.seed_start, profiles,
              args.transpiler_seed, args.output, args.reference_script)


if __name__ == "__main__":
    main()
