"""Regresiones científicas: probabilidades, lectura, control BBHT y presupuesto."""
import math
from itertools import permutations

import numpy as np
import pytest
pytest.importorskip("qiskit_aer", reason="Instalar requirements-noise.txt para las pruebas de ruido")

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator

import qiskit_grover as original
from qiskit_grover_noise import (
    BASIS, PROFILES, THERMAL, DistributionCache, NoiseProfile, adaptive_run,
    apply_readout, noise_model, random_control, summarize, wilson,
)


@pytest.fixture(scope="module")
def cache():
    return DistributionCache(PROFILES + (THERMAL,))


@pytest.mark.parametrize("qubits,marked,j", [
    (1, [1], 1), (3, [], 3), (3, [5], 0), (3, [5], 1),
    (3, [1, 4], 2), (5, [2], 3), (5, [], 4),
])
def test_ideal_matches_original_statevector(cache, qubits, marked, j):
    p, metrics = cache.get(qubits, marked, j, PROFILES[0])
    expected = Statevector(original.circuito_grover(qubits, marked, j)).probabilities()
    np.testing.assert_allclose(p, expected, atol=1e-12)
    assert set(metrics["operations"]) <= set(BASIS)


def test_noise_acts_on_compiled_gates_and_reuses_same_circuit(cache):
    ideal, metrics = cache.get(3, [5], 1, PROFILES[0])
    noisy, noisy_metrics = cache.get(3, [5], 1, PROFILES[3])
    assert abs(ideal[5] - 25/32) < 1e-12
    assert noisy[5] < ideal[5] - .1
    assert noisy_metrics is metrics
    assert metrics["cx"] > 0 and metrics["physical_1q"] > 0
    assert set(noise_model(PROFILES[3]).noise_instructions) == {"sx", "x", "cx"}
    again, _ = cache.get(3, [5], 1, PROFILES[3])
    assert again is noisy
    assert not again.flags.writeable


@pytest.mark.parametrize("n", [3, 4])
def test_optimum_sweep_matches_analytic_grover_probability(cache, n):
    F, D = original.generar_datos(n)
    costs = [original.costo_perm(F, D, p) for p in permutations(range(n))]
    marked = [i for i, c in enumerate(costs) if c == min(costs)]
    qubits = math.ceil(math.log2(len(costs)))
    theta = math.asin(math.sqrt(len(marked)/2**qubits))
    if n == 3:
        assert marked == [1, 3, 4, 5] and len(marked)/2**qubits == .5
    for j in range(math.ceil(math.sqrt(len(costs))) + 2):
        probs, _ = cache.get(qubits, marked, j, PROFILES[0])
        assert abs(probs[marked].sum() - math.sin((2*j+1)*theta)**2) < 1e-12


def test_readout_channel_on_known_basis_state():
    raw = np.zeros(8)
    raw[1] = 1
    e = .2
    expected = [e**((i ^ 1).bit_count()) * (1-e)**(3-(i ^ 1).bit_count()) for i in range(8)]
    np.testing.assert_allclose(apply_readout(raw, e), expected, atol=1e-15)
    np.testing.assert_allclose(apply_readout(raw, 1), np.eye(8)[6])
    np.testing.assert_allclose(apply_readout(np.ones(8)/8, e), np.ones(8)/8)


def test_explicit_readout_agrees_with_aer_measurements():
    profile = NoiseProfile("readout_check", .005, .02, .2)
    cache = DistributionCache((profile,))
    expected, _ = cache.get(3, [5], 1, profile)
    qc, _ = cache.circuit(3, [5], 1)
    backend = AerSimulator(method="density_matrix", noise_model=noise_model(profile, include_readout=True),
                           max_parallel_threads=1)
    saved = qc.copy()
    saved.save_probabilities()
    raw = np.asarray(backend.run(saved, shots=1).result().data(0)["probabilities"])
    # ReadoutError has no effect on save_probabilities without measurements.
    np.testing.assert_allclose(expected, apply_readout(raw, profile.readout), atol=1e-12)
    assert raw[5] - expected[5] > .1
    measured = qc.copy()
    measured.measure_all()
    shots = 60_000
    counts = backend.run(measured, shots=shots, seed_simulator=1207).result().get_counts()
    observed = np.array([counts.get(format(i, "03b"), 0)/shots for i in range(8)])
    np.testing.assert_allclose(observed, expected, atol=.008)


def test_thermal_relaxation_matches_excited_state_decay():
    profile = NoiseProfile("thermal_only", t1_ns=100, t2_ns=80, gate1_ns=35)
    qc = QuantumCircuit(1)
    qc.x(0)
    qc.save_probabilities()
    backend = AerSimulator(method="density_matrix", noise_model=noise_model(profile), max_parallel_threads=1)
    probs = backend.run(qc, shots=1).result().data(0)["probabilities"]
    assert abs(probs[1] - math.exp(-35/100)) < 1e-12


@pytest.mark.parametrize("n,seed", [(3, 42), (3, 56), (4, 42)])
def test_adaptive_ideal_reproduces_original_trace_and_budget(cache, n, seed):
    F, D = original.generar_datos(n)
    costs = [original.costo_perm(F, D, p) for p in permutations(range(n))]
    idx, cost, charged, steps = original.grover_adaptive(costs, np.random.default_rng(seed))
    run = adaptive_run(costs, np.random.default_rng(seed), cache, PROFILES[0])
    assert (run["index"], run["cost"], run["budget_used"]) == (idx, cost, charged)
    assert [(s["j"], s["outcome"], s["y"]) for s in run["steps"]] == [(s["j"], s["salida"], s["y"]) for s in steps]
    assert run["budget_used"] == sum(max(s["j"], 1) for s in run["steps"])
    assert run["oracle_calls"] == sum(s["j"] for s in run["steps"])
    assert run["budget_used"] >= original.presupuesto(len(costs))
    assert run["budget_used"] - max(run["steps"][-1]["j"], 1) < original.presupuesto(len(costs))
    assert run["circuits"] == len(steps)


class PaddingOnly:
    def get(self, qubits, marked, iterations, profile):
        probs = np.zeros(2**qubits)
        probs[-1] = 1.0
        return probs, {"circuit_sha256": "test", "depth": 1, "cx": 0, "physical_1q": 1, "virtual_rz": 0}


@pytest.mark.parametrize("costs", [[30., 10., 20.], [10., 20., 30.]])
def test_padding_rejected_and_empty_marked_does_not_stop(costs):
    run = adaptive_run(costs, np.random.default_rng(42), PaddingOnly(), PROFILES[0])
    assert run["initial_index"] == run["index"] == 0
    assert run["invalid_fraction"] == 1
    assert all(not s["improves"] for s in run["steps"])
    assert run["budget_used"] >= original.presupuesto(3)
    assert len(run["steps"]) > 1
    if costs[0] == min(costs):
        assert all(s["marked_count"] == 0 for s in run["steps"])


def test_random_control_consumes_exact_budget_and_keeps_padding():
    class AlwaysPadding:
        calls = 0
        def integers(self, low, high):
            assert (low, high) == (0, 4)
            self.calls += 1
            return 3
    rng = AlwaysPadding()
    run = random_control([30., 10., 20.], rng, 67, 0)
    assert rng.calls == run["budget_used"] == run["samples"] == 67
    assert run["invalid_fraction"] == 1 and run["index"] == 0
    assert run["circuits"] == run["oracle_calls"] == 0
    assert not run["optimal"]


def test_wilson_bounds_and_summary_denominators():
    lo, hi = wilson(100, 100)
    assert abs(lo - .9630065017930143) < 1e-12 and hi == 1
    lo, hi = wilson(0, 100)
    assert lo == 0 and abs(hi - .03699349820698568) < 1e-12
    rows = []
    for seed, budget in enumerate((10, 100)):
        r = random_control([1., 2., 3.], np.random.default_rng(seed), budget, 0)
        rows.append({"n": 3, "profile": "ideal", "algorithm": "random_matched", **r})
    s = summarize(rows)[0]
    assert s["invalid_fraction_pooled"] == sum(r["invalid_count"] for r in rows)/110
    assert s["budget_used_mean"] == 55


@pytest.mark.parametrize("params", [{"p1": -1}, {"p2": float("nan")}, {"readout": 2},
                                    {"t1_ns": 10}, {"t1_ns": 10, "t2_ns": 21}])
def test_invalid_profiles_rejected(params):
    with pytest.raises(ValueError):
        NoiseProfile("invalid", **params)


@pytest.mark.parametrize("costs,lam", [([], 1.2), ([float("nan")], 1.2), ([1, 2], 1)])
def test_invalid_adaptive_inputs_rejected(cache, costs, lam):
    with pytest.raises(ValueError):
        adaptive_run(costs, np.random.default_rng(1), cache, PROFILES[0], lam)
