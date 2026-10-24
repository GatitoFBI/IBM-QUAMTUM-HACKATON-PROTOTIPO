/* Motor de Grover en el navegador.
   Réplica del algoritmo de qiskit_grover.py (Dürr–Høyer + BBHT, versión honesta) para poder
   recalcular al instante cuando el usuario edita los datos. Los resultados oficiales salen de Qiskit:
   datos.js (precalculado) o el backend FastAPI (api.py). Devuelve el mismo formato que Qiskit. */
const Grover = (() => {
  // Mismo orden que itertools.permutations(range(n)): el índice i es la misma permutación en Python y aquí
  function permutaciones(n) {
    const out = [];
    (function rec(pre, rest) {
      if (!rest.length) return out.push(pre);
      rest.forEach((x, i) => rec([...pre, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
    })([], [...Array(n).keys()]);
    return out;
  }

  // C(p) = Σ_{i<k} F[i][k] · D[p(i)][p(k)]: cada par de brigadas se cuenta una vez
  function costo(F, D, p) {
    let c = 0;
    for (let i = 0; i < p.length; i++) for (let k = i + 1; k < p.length; k++) c += F[i][k] * D[p[i]][p[k]];
    return c;
  }

  const presupuesto = M => 22.5 * Math.sqrt(M) + 1.4 * Math.log2(M) ** 2;
  const qubits = M => Math.max(1, Math.ceil(Math.log2(M)));

  function rng(seed) { // mulberry32: reproducible con la misma semilla
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* Vector de estado con amplitudes reales: H^n deja todo en 1/√S; el oráculo cambia el signo de los
     marcados; la difusión es la inversión sobre el promedio a → 2·promedio − a. (El circuito de Qiskit
     H·X·MCX·X·H hace lo mismo salvo una fase global −1, que no se puede observar). */
  function evolucionar(S, marcados, j, guardar) {
    const a = new Float64Array(S).fill(1 / Math.sqrt(S)), etapas = [];
    const foto = e => guardar && etapas.push({ etapa: e, amp: Array.from(a, v => Math.round(v * 1e4) / 1e4) });
    foto("Superposición");
    for (let it = 1; it <= j; it++) {
      for (const i of marcados) a[i] = -a[i];
      foto(`Oráculo ${it}`);
      let s = 0; for (let i = 0; i < S; i++) s += a[i];
      const m = s / S; for (let i = 0; i < S; i++) a[i] = 2 * m - a[i];
      foto(`Difusión ${it}`);
    }
    return { a, etapas };
  }

  function adaptativo(costos, semilla, guardar = false, lam = 6 / 5) {
    const M = costos.length, S = 2 ** qubits(M), tope = presupuesto(M), r = rng(semilla);
    const randint = n => Math.floor(r() * n);
    let y = randint(M), m = 1, llamadas = 0;
    const pasos = [];
    while (llamadas < tope) {
      const marcados = [];
      for (let i = 0; i < M; i++) if (costos[i] < costos[y]) marcados.push(i);
      const j = randint(Math.ceil(m));
      const { a, etapas } = evolucionar(S, marcados, j, guardar);
      let u = r(), salida = 0;                       // "medición": muestreo con P = amplitud²
      while (salida < S - 1 && (u -= a[salida] ** 2) > 0) salida++;
      llamadas += Math.max(j, 1);
      const mejora = salida < M && costos[salida] < costos[y];
      const paso = { y, umbral: costos[y], marcados: marcados.length, j,
        p_marcados: Math.round(marcados.reduce((s, i) => s + a[i] ** 2, 0) * 1e4) / 1e4,
        salida, costo_salida: salida < M ? costos[salida] : null, mejora, llamadas };
      if (guardar) paso.etapas = etapas;
      pasos.push(paso);
      if (mejora) { y = salida; m = 1; } else m = Math.min(lam * m, Math.sqrt(M));
    }
    return { indice: y, costo: costos[y], consultas: llamadas, pasos };
  }

  // Resuelve una instancia completa con el mismo formato que una instancia de datos.js
  function resolver({ brigadas, zonas, F, D }, { semilla = 42, repeticiones = 10 } = {}) {
    const n = F.length, perms = permutaciones(n);
    const t0 = performance.now();
    let optimo = Infinity, perm_opt = null;
    const costos = perms.map(p => { const c = costo(F, D, p); if (c < optimo) { optimo = c; perm_opt = p; } return c; });
    const clasico_s = (performance.now() - t0) / 1000, M = perms.length;
    const runs = [...Array(repeticiones)].map((_, k) => {
      const t = performance.now(), r = adaptativo(costos, semilla + k, n <= 4 && k < 3);
      return { ...r, tiempo_s: (performance.now() - t) / 1000, optimo: Math.abs(r.costo - optimo) < 1e-9 };
    });
    return { n, qubits: qubits(M), M, presupuesto: Math.round(presupuesto(M) * 10) / 10, F, D, brigadas, zonas,
      perms, costos, optimo, perm_opt, clasico_s, evaluaciones: M, runs, motor: "navegador" };
  }

  // Índice ↔ permutación (orden lexicográfico, sistema factorial)
  function indiceAPerm(idx, n) {
    const pool = [...Array(n).keys()], p = [];
    for (let k = n - 1; k >= 0; k--) { const f = fact(k), q = Math.floor(idx / f); idx %= f; p.push(pool.splice(q, 1)[0]); }
    return p;
  }
  function permAIndice(p) {
    const pool = [...Array(p.length).keys()];
    return p.reduce((s, x, i) => { const q = pool.indexOf(x); pool.splice(q, 1); return s + q * fact(p.length - 1 - i); }, 0);
  }
  const fact = n => n < 2 ? 1 : n * fact(n - 1);

  return { permutaciones, costo, presupuesto, qubits, evolucionar, adaptativo, resolver, indiceAPerm, permAIndice, fact };
})();
