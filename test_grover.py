"""Test mínimo del núcleo cuántico: python -m pytest -q"""
import math
from itertools import permutations

import numpy as np
from qiskit.quantum_info import Statevector

from qiskit_grover import circuito_grover, costo_perm, generar_datos, grover_adaptive, resolver_clasico


def test_grover_encuentra_el_optimo_n3():
    F, D = generar_datos(3)
    optimo, _, _ = resolver_clasico(F, D)
    costos = [costo_perm(F, D, p) for p in permutations(range(3))]
    idx, costo, consultas, _ = grover_adaptive(costos, np.random.default_rng(42))
    assert idx < len(costos)          # nunca devuelve un índice sin permutación
    assert costo == optimo == 285.0   # óptimo reportado por el equipo para N = 3
    assert consultas >= 22.5 * math.sqrt(6)


def test_una_iteracion_amplifica_el_marcado():
    # 3 qubits, 1 marcado de 8: una iteración da sin²(3θ) = 25/32
    probs = Statevector(circuito_grover(3, [5], 1)).probabilities()
    assert abs(probs[5] - 25 / 32) < 1e-9
