/* Q-Niño · interfaz. Depende de js/grover.js (motor en el navegador) y de datos.js (resultados de Qiskit). */
const $ = id => document.getElementById(id);
const Q = window.QNINO || null;
const G = Grover;
const BRIG = ["Médica", "Rescate", "Logística", "Agua y saneamiento", "Comunicaciones", "Albergue"];
const ZON = ["Piura", "Tumbes", "Lambayeque", "Trujillo", "Chosica", "Ica"];
// Coordenadas aproximadas (lat, lon) solo para dibujar el esquema del mapa
const Z = { Piura: [-5.19, -80.63], Tumbes: [-3.57, -80.45], Lambayeque: [-6.70, -79.91], Trujillo: [-8.11, -79.03], Chosica: [-11.94, -76.70], Ica: [-14.07, -75.73], Chiclayo: [-6.77, -79.84], Lima: [-12.05, -77.04], Talara: [-4.58, -81.27], Chimbote: [-9.07, -78.59] };
const COAST = [[-3.4, -80.3], [-4.1, -81.2], [-4.6, -81.3], [-5.1, -81.1], [-5.8, -81.0], [-6.4, -80.2], [-7.0, -79.6], [-8.1, -79.1], [-9.1, -78.6], [-10.1, -78.2], [-11.1, -77.6], [-12.0, -77.15], [-12.8, -76.5], [-13.7, -76.2], [-14.5, -75.9], [-15.4, -75.1]];
const clone = o => JSON.parse(JSON.stringify(o));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const fmtBig = x => x >= 1e6 ? x.toExponential(1).replace("e+", "×10^") : Math.round(x).toLocaleString("es");
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 3200); }

/* ---------------- Casos (ejercicios) ---------------- */
const CASOS = [];
CASOS.push({ id: "guia3", nombre: "Guía del equipo · El Niño, N = 3", nota: "Matrices de la guía estratégica del equipo (supuestos ilustrativos, no datos oficiales).",
  brigadas: ["Médica", "Logística", "Rescate"], zonas: ["Piura", "Chosica", "Tumbes"],
  F: [[0, 8, 2], [8, 0, 5], [2, 5, 0]], D: [[0, 12, 8], [12, 0, 15], [8, 15, 0]] });
if (Q) Object.values(Q.instancias).forEach(i => CASOS.push({ id: "q" + i.n, nombre: `Datos de prueba del equipo · N = ${i.n}`, nota: `Aleatorios, semilla ${Q.semilla}. Verificado con Qiskit ${Q.qiskit}: óptimo ${i.optimo}, ${i.runs.filter(r => r.optimo).length}/${i.runs.length} aciertos.`,
  brigadas: i.brigadas, zonas: i.zonas, F: i.F, D: i.D, qiskit: i }));
[[3, 24], [4, 32]].forEach(([n, opt]) => CASOS.push({ id: "qap10_" + n, nombre: `qap10 · N = ${n} (óptimo de control ${opt})`, nota: "Pendiente: pega aquí las matrices reconstruidas de qap10 y verifica que el óptimo sea " + opt + ".", pendiente: true,
  brigadas: BRIG.slice(0, n), zonas: ZON.slice(0, n), F: [...Array(n)].map(() => Array(n).fill(0)), D: [...Array(n)].map(() => Array(n).fill(0)) }));

/* ---------------- Estado ---------------- */
let base, cur, R = null, stale = false, backend = null, useBackend = false, prevDiffs = new Set(), mapFresh = false;

// Animaciones: activadas por defecto (pedido del equipo); el botón de la cabecera las apaga y la elección se recuerda
const motionPref = (() => { try { return localStorage.getItem("qnino_motion"); } catch { return null; } })();
function setMotion(on) {
  document.documentElement.classList.toggle("motion", on);
  $("motion").setAttribute("aria-pressed", on); $("motion").textContent = on ? "Animaciones: sí" : "Animaciones: no";
}
setMotion(motionPref !== "off");
$("motion").onclick = () => { const on = !document.documentElement.classList.contains("motion"); setMotion(on); try { localStorage.setItem("qnino_motion", on ? "on" : "off"); } catch {} toast(on ? "Animaciones activadas" : "Animaciones desactivadas"); };
const reduced = () => !document.documentElement.classList.contains("motion");
// Contador para los KPIs y orden de entrada (--i) para listas y tarjetas
function countUp(el) {
  const target = parseFloat(el.textContent), dec = (el.textContent.split(".")[1] || "").length;
  if (!isFinite(target) || reduced()) return;
  const t0 = performance.now(), T = 700;
  const step = t => { const k = Math.min(1, (t - t0) / T), e = 1 - (1 - k) ** 3; el.textContent = (target * e).toFixed(dec); if (k < 1) requestAnimationFrame(step); else el.textContent = target.toFixed(dec); };
  requestAnimationFrame(step);
}
const stagger = (sel, cls = "in") => document.querySelectorAll(sel).forEach((el, i) => { el.style.setProperty("--i", i); if (cls) el.classList.add(cls); });

function loadCase(c, silent) {
  base = clone({ nombre: c.nombre, brigadas: c.brigadas, zonas: c.zonas, F: c.F, D: c.D, qiskit: c.qiskit ? true : false, id: c.id });
  cur = clone({ brigadas: c.brigadas, zonas: c.zonas, F: c.F, D: c.D });
  R = null; stale = false; $("results").hidden = true;
  renderEditor(); onChange();
  if (!silent) { show("simulador"); toast(`Cargado: ${c.nombre}`); }
  if (!c.pendiente) solve(true);
}

/* ---------------- Editor ---------------- */
function resize(n) {
  const old = cur.F.length;
  cur.brigadas = [...Array(n)].map((_, i) => cur.brigadas[i] ?? base.brigadas[i] ?? BRIG[i] ?? `Brigada ${i + 1}`);
  cur.zonas = [...Array(n)].map((_, i) => cur.zonas[i] ?? base.zonas[i] ?? ZON[i] ?? `Zona ${i + 1}`);
  const grow = (M, b, def) => [...Array(n)].map((_, i) => [...Array(n)].map((_, k) => i === k ? 0 : (i < old && k < old ? M[i][k] : (b[i]?.[k] ?? def))));
  cur.F = grow(cur.F, base.F, 5); cur.D = grow(cur.D, base.D, 10);
  renderEditor({ count: true }); onChange();
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const PAL = ["--qiskit", "--otono", "--qiskit-2", "--ok", "--qiskit", "--otono"];
const PIN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>`;
// Opciones para elegir: el usuario no escribe nada
const BRIG_OPC = [...BRIG, "Bomberos", "Defensa Civil", "Ingeniería", "Psicología", "Policía"];
const ZON_OPC = [...ZON, "Sullana", "Talara", "Chiclayo", "Chimbote", "Lima"];
Z.Sullana = [-4.90, -80.69];
const RANGO = { F: { min: 0, max: 10, u: "", chips: [["Ninguna", 0], ["Baja", 2], ["Media", 5], ["Alta", 9]] },
                D: { min: 1, max: 30, u: " h", chips: [["Cerca", 4], ["Media", 12], ["Lejos", 20]] } };
let lastN = null, selCell = { F: [0, 1], D: [0, 1] };
// opts.count: animar los contadores · opts.shuffle: cascada en todas las celdas
function renderEditor(opts = {}) {
  const n = cur.F.length, M = G.fact(n), q = G.qubits(M), from = lastN && n > lastN ? lastN : n; lastN = n;
  $("dataTitle").textContent = `Datos del problema · ${n} brigadas y ${n} zonas`;
  $("dataChip").innerHTML = `<b class="cnt">${M}</b> asignaciones posibles (${n}!) · <b class="cnt">${q}</b> qubits con Grover (one-hot: ${n * n})`;
  if (opts.count) document.querySelectorAll("#dataChip .cnt").forEach(countUp);
  seg("nSel", [3, 4, 5, 6], n, resize); $("nSel").style.setProperty("--x", n - 3);
  // cada lista deshabilita lo que ya eligió otra fila
  const opt = (list, key, i) => { const used = new Set(cur[key].filter((_, j) => j !== i)), all = list.includes(cur[key][i]) ? list : [cur[key][i], ...list];
    return all.map(o => `<option ${o === cur[key][i] ? "selected" : ""} ${used.has(o) ? "disabled" : ""}>${esc(o)}</option>`).join(""); };
  $("names").innerHTML = `<div class="pair head"><span></span><span>Brigada</span><span></span><span>Zona</span></div>` + [...Array(n)].map((_, i) =>
    `<div class="pair ${i >= from ? "grow" : ""}" style="--i:${i}"><span class="av" style="--c:var(${PAL[i]});--t:var(${PAL[i] === "--otono" ? "--on-otono" : "--on-qiskit"})">${esc((cur.brigadas[i] || "?")[0])}</span>` +
    `<select data-nm="brigadas" data-i="${i}" aria-label="Brigada ${i + 1}">${opt(BRIG_OPC, "brigadas", i)}</select>` +
    `<span class="pin" title="Zona ${i + 1}">${PIN}</span><select data-nm="zonas" data-i="${i}" aria-label="Zona ${i + 1}">${opt(ZON_OPC, "zonas", i)}</select></div>`).join("");
  const mat = (key, labels) => `<tr><th></th>${labels.map((l, k) => `<th title="${esc(l)}" data-col="${k}">${esc(l)}</th>`).join("")}</tr>` + cur[key].map((row, i) =>
    `<tr><th title="${esc(labels[i])}" data-row="${i}">${esc(labels[i])}</th>${row.map((v, k) => i === k ? `<td><span class="dg">—</span></td>` :
      `<td><button type="button" class="cell ${i >= from || k >= from ? "grow" : ""} ${opts.shuffle ? "shuf" : ""}" style="--i:${opts.shuffle ? i * n + k : i + k}" data-m="${key}" data-i="${i}" data-k="${k}" aria-label="${key}: ${esc(labels[i])} con ${esc(labels[k])}">${v}</button></td>`).join("")}</tr>`).join("");
  $("matF").innerHTML = mat("F", cur.brigadas); $("matD").innerHTML = mat("D", cur.zonas);
  heat("F"); heat("D"); paintSel("F"); paintSel("D");
}
// Mapa de calor: --h (0–1) según el valor relativo al máximo de la matriz
function heat(key) {
  const mx = Math.max(1, ...cur[key].flat());
  document.querySelectorAll(`.cell[data-m="${key}"]`).forEach(el => el.style.setProperty("--h", (cur[key][+el.dataset.i][+el.dataset.k] / mx).toFixed(2)));
}
// Celda elegida: se resaltan ella, su pareja simétrica, su fila y su columna, y debajo aparece su control
function paintSel(key) {
  const n = cur.F.length; let [i, k] = selCell[key]; if (i >= n || k >= n || i === k) { [i, k] = [0, 1]; selCell[key] = [i, k]; }
  const L = key === "F" ? cur.brigadas : cur.zonas, r = RANGO[key], v = cur[key][i][k], tb = $(key === "F" ? "matF" : "matD");
  tb.querySelectorAll(".cell").forEach(b => { const a = +b.dataset.i, c = +b.dataset.k; b.classList.toggle("sel", (a === i && c === k) || (a === k && c === i)); });
  tb.querySelectorAll("th.hl").forEach(t => t.classList.remove("hl"));
  [`th[data-row="${i}"]`, `th[data-col="${k}"]`, `th[data-row="${k}"]`, `th[data-col="${i}"]`].forEach(q => tb.querySelector(q)?.classList.add("hl"));
  $("ce" + key).innerHTML = `<div class="cel"><span><b>${esc(L[i])}</b> ↔ <b>${esc(L[k])}</b></span><span class="cv" id="cv${key}">${v}${r.u}</span></div>
    <input type="range" min="${r.min}" max="${r.max}" step="1" value="${v}" data-range="${key}" aria-label="${key} entre ${esc(L[i])} y ${esc(L[k])}">
    <div class="chips">${r.chips.map(([t, x]) => `<button type="button" class="chipv ${x === v ? "on" : ""}" data-set="${key}" data-v="${x}">${t} · ${x}${r.u}</button>`).join("")}</div>`;
}
function setCell(key, v) {
  const [i, k] = selCell[key]; if (cur[key][i][k] === v) return;
  cur[key][i][k] = cur[key][k][i] = v;
  $(key === "F" ? "matF" : "matD").querySelectorAll(".cell.sel").forEach(b => { b.textContent = v; b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
  $("cv" + key).textContent = v + RANGO[key].u;
  document.querySelectorAll(`[data-set="${key}"]`).forEach(c => c.classList.toggle("on", +c.dataset.v === v));
  heat(key); onChange();
}
document.addEventListener("click", e => {
  const c = e.target.closest(".cell"); if (c) { selCell[c.dataset.m] = [+c.dataset.i, +c.dataset.k]; paintSel(c.dataset.m); return; }
  const s = e.target.closest("[data-set]"); if (s) { setCell(s.dataset.set, +s.dataset.v); const rg = document.querySelector(`[data-range="${s.dataset.set}"]`); if (rg) rg.value = s.dataset.v; }
});
document.addEventListener("input", e => { if (e.target.dataset?.range) setCell(e.target.dataset.range, +e.target.value); });
// D estimada desde el mapa: distancia en línea recta × 1,3 (rodeo de la carretera) a 60 km/h
const haversine = ([a, b], [c, d]) => { const r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
$("estD").onclick = () => {
  const n = cur.F.length, P = cur.zonas.map((z, j) => zoneLatLng(z, j, n));
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) cur.D[i][k] = cur.D[k][i] = Math.min(30, Math.max(1, Math.round(haversine(P[i], P[k]) * 1.3 / 60)));
  renderEditor({ shuffle: true }); onChange(); toast("Horas estimadas: distancia en línea recta × 1,3, a 60 km/h");
};
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.m) {
    const v = t.value === "" ? NaN : Number(t.value), i = +t.dataset.i, k = +t.dataset.k;
    if (!Number.isInteger(v) || v < 0 || v > 999) { $("err").hidden = false; $("err").textContent = `${t.dataset.m}: usa enteros entre 0 y 999.`; return; }
    $("err").hidden = true;
    cur[t.dataset.m][i][k] = v; cur[t.dataset.m][k][i] = v;                // matriz simétrica
    heat(t.dataset.m);
    const twin = document.querySelector(`[data-m="${t.dataset.m}"][data-i="${k}"][data-k="${i}"]`); if (twin) twin.value = v;
    onChange();
  } else if (t.dataset.nm) {
    cur[t.dataset.nm][+t.dataset.i] = t.value.trim() || (t.dataset.nm === "brigadas" ? "Brigada " : "Zona ") + (+t.dataset.i + 1);
    if (t.dataset.nm === "brigadas") { const av = t.parentElement.querySelector(".av"); if (av) av.textContent = (t.value.trim() || "?")[0]; }
    onChange(true);
  }
});
document.addEventListener("change", e => { if (e.target.dataset.nm) { renderEditor(); onChange(true); } });

function diffs() {
  const out = [], n = cur.F.length, bn = base.F.length;
  if (n !== bn) out.push(`N: ${bn} → ${n}`);
  ["brigadas", "zonas"].forEach(key => cur[key].forEach((v, i) => { if (i < bn && base[key][i] !== v) out.push(`${key === "brigadas" ? "Brigada" : "Zona"} ${i + 1}: «${base[key][i]}» → «${v}»`); else if (i >= bn) out.push(`${key === "brigadas" ? "Brigada" : "Zona"} ${i + 1} nueva: «${v}»`); }));
  ["F", "D"].forEach(m => { const L = m === "F" ? cur.brigadas : cur.zonas; for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
    const b = i < bn && k < bn ? base[m][i][k] : null, v = cur[m][i][k];
    if (b === null) out.push(`${m}[${L[i]}, ${L[k]}] nuevo par: ${v}`); else if (b !== v) out.push(`${m}[${L[i]}, ${L[k]}]: ${b} → ${v}`); } });
  return out;
}
function onChange(namesOnly) {
  const d = diffs(), n = cur.F.length, bn = base.F.length;
  $("nChanges").textContent = d.length + (d.length === 1 ? " cambio" : " cambios");
  $("baseName").textContent = `Datos cargados: ${base.nombre}`;
  $("changes").innerHTML = d.length ? d.map(x => `<div class="${prevDiffs.has(x) ? "" : "new"}">${esc(x)}</div>`).join("") : `<div class="none">Sin cambios: son los datos tal como se cargaron.</div>`;
  prevDiffs = new Set(d);
  document.querySelectorAll("[data-m]").forEach(el => { const m = el.dataset.m, i = +el.dataset.i, k = +el.dataset.k, b = i < bn && k < bn ? base[m][i][k] : null; el.classList.toggle("changed", i !== k && b !== cur[m][i][k]); });
  document.querySelectorAll("[data-nm]").forEach(el => { const i = +el.dataset.i; el.classList.toggle("changed", i >= bn || base[el.dataset.nm][i] !== cur[el.dataset.nm][i]); });
  if (R && !namesOnly) { stale = true; $("resEngine").textContent = "Desactualizado: vuelve a resolver"; }
  if (R && namesOnly) { R.brigadas = [...cur.brigadas]; R.zonas = [...cur.zonas]; renderResults(); }
  drawMap();
}
$("restore").onclick = () => { cur = clone({ brigadas: base.brigadas, zonas: base.zonas, F: base.F, D: base.D }); renderEditor(); onChange(); toast("Datos restaurados"); };
$("randomize").onclick = () => { const n = cur.F.length, r = () => Math.random(); for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { cur.F[i][k] = cur.F[k][i] = 1 + Math.floor(r() * 9); cur.D[i][k] = cur.D[k][i] = 5 + Math.floor(r() * 15); } renderEditor({ shuffle: true }); onChange(); toast("Matrices aleatorias generadas"); };
$("export").onclick = () => {
  const txt = JSON.stringify({ brigadas: cur.brigadas, zonas: cur.zonas, F: cur.F, D: cur.D, semilla: +$("seed").value, repeticiones: +$("reps").value }, null, 1);
  const ok = () => toast("Copiado. Guárdalo como datos.json y ejecuta: python qiskit_grover.py --datos datos.json");
  try { navigator.clipboard.writeText(txt).then(ok, () => { console.log(txt); toast("No se pudo copiar: los datos están en la consola del navegador"); }); } catch { console.log(txt); }
};

/* ---------------- Resolver ---------------- */
function normalizaFase(inst) { // El circuito de Qiskit agrega una fase global −1 en cada difusión: no es observable, la quitamos para dibujar
  if (inst._norm) return inst; inst._norm = true;
  inst.runs.forEach(r => r.pasos.forEach(p => p.etapas?.forEach(e => { const k = +(e.etapa.match(/\d+/) || [0])[0], s = e.etapa.startsWith("Difusión") ? (-1) ** k : e.etapa.startsWith("Oráculo") ? (-1) ** (k - 1) : 1; if (s < 0) e.amp = e.amp.map(a => -a); })));
  return inst;
}
const sameAsQiskit = () => { const c = CASOS.find(x => x.id === base.id); return c?.qiskit && !diffs().length && +$("seed").value === Q.semilla && +$("reps").value === Q.repeticiones ? c.qiskit : null; };
async function solve(quiet) {
  const reps = Math.max(1, Math.min(20, +$("reps").value || 10)), semilla = +$("seed").value || 0, n = cur.F.length;
  if (cur.F.every(r => r.every(v => v === 0)) || cur.D.every(r => r.every(v => v === 0))) { if (!quiet) toast("Completa las matrices F y D antes de resolver"); return; }
  const btn = $("solve"); btn.disabled = true;
  try {
    const pre = sameAsQiskit();
    if (useBackend && backend) {
      btn.innerHTML = `<span class="spinner"></span> Qiskit simulando ${G.qubits(G.fact(n))} qubits…`;
      const res = await fetch("api/grover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brigadas: cur.brigadas, zonas: cur.zonas, F: cur.F, D: cur.D, semilla, repeticiones: n >= 6 ? Math.min(reps, 3) : reps }) });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      R = normalizaFase(await res.json()); R.motor = "qiskit-servidor";
    } else if (pre) { R = normalizaFase(clone(pre)); R.motor = "qiskit-precalculado"; }
    else { btn.innerHTML = `<span class="spinner"></span> Calculando…`; await new Promise(r => setTimeout(r, 20)); R = G.resolver(clone(cur), { semilla, repeticiones: reps }); }
    R.brigadas = [...cur.brigadas]; R.zonas = [...cur.zonas]; stale = false; mapFresh = true;
    renderResults(); drawMap(); setupAnim(); renderCalcs(); renderCompare(); renderFormulas(false);
    if (!quiet) toast(`Listo: óptimo ${R.optimo}, Grover acertó ${R.runs.filter(r => r.optimo).length}/${R.runs.length}`);
  } catch (err) { toast("Error del backend Qiskit: " + err.message + ". Usando el motor del navegador."); useBackend = false; updEngine(); btn.disabled = false; btn.textContent = "Resolver con Grover"; return solve(quiet); }
  btn.disabled = false; btn.textContent = "Resolver con Grover";
}
$("solve").onclick = () => solve(false);
const motorTxt = m => m === "qiskit-servidor" ? `Qiskit ${backend?.qiskit || ""} en vivo` : m === "qiskit-precalculado" ? `Qiskit ${Q.qiskit} · precalculado` : "Motor del navegador (réplica del algoritmo)";
const bestRun = () => R.runs.find(r => r.optimo) || R.runs.reduce((a, b) => b.costo < a.costo ? b : a);

function renderResults() {
  $("results").hidden = false;
  const q = R.runs.map(r => r.consultas), ok = R.runs.filter(r => r.optimo).length, nr = R.runs.length, b = bestRun(), p = R.perms[b.indice];
  const qm = mean(q), gap = R.optimo ? (b.costo / R.optimo - 1) * 100 : 0, anim = !stale;
  $("resEngine").textContent = stale ? "Desactualizado: vuelve a resolver" : motorTxt(R.motor);

  // Veredicto con un check que se dibuja
  const good = b.optimo;
  $("rVerdict").className = "rverdict " + (good ? "good" : "warn");
  $("rVerdict").innerHTML = `<svg class="vcheck" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/>${good ? `<path d="M15 27l7 7 15-16"/>` : `<path d="M26 14v16M26 37v1"/>`}</svg>
    <div><b>${good ? "Grover encontró la asignación óptima" : "Grover no llegó al óptimo en esta ejecución"}</b>
    <span>Costo ${b.costo}${good ? ` = mínimo exacto` : ` frente a ${R.optimo} del exacto (${gap.toFixed(1)} % más)`} · ${ok} de ${nr} ejecuciones acertaron · ${R.n}! = ${R.M} asignaciones posibles</span></div>`;

  // Tarjetas con mini gráficos
  const bar = (label, v, max, cls = "") => `<div class="mbar ${cls}"><span>${label}</span><i style="--w:${Math.max(3, Math.min(100, v / max * 100)).toFixed(1)}%"></i><b>${Number(v).toLocaleString("es", { maximumFractionDigits: 1 })}</b></div>`;
  const C = 2 * Math.PI * 26, mq = Math.max(qm, R.presupuesto, R.M);
  $("kpis").innerHTML = `
    <div class="tile"><span class="tl">Costo óptimo</span><b class="big cnt">${R.optimo}</b>
      ${bar("Grover", b.costo, Math.max(b.costo, R.optimo), "q")}${bar("Exacto", R.optimo, Math.max(b.costo, R.optimo))}<span class="ts">brecha ${gap.toFixed(1)} %</span></div>
    <div class="tile"><span class="tl">Aciertos</span><div class="donut"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="trk"/><circle cx="32" cy="32" r="26" class="val" style="--c:${C.toFixed(1)};--o:${(C * (1 - ok / nr)).toFixed(1)}"/></svg><b><span class="cnt">${ok}</span>/${nr}</b></div>
      <span class="ts">ejecuciones que hallaron el óptimo</span></div>
    <div class="tile"><span class="tl">Consultas al oráculo</span><b class="big cnt">${qm.toFixed(0)}</b>
      ${bar("Grover", Math.round(qm), mq, "q")}${bar("Presupuesto", R.presupuesto, mq, "p")}${bar("N!", R.M, mq)}<span class="ts">± ${sd(q).toFixed(0)} entre ejecuciones</span></div>
    <div class="tile"><span class="tl">Qubits</span><b class="big cnt">${R.qubits}</b>
      ${bar("Índice", R.qubits, R.n * R.n, "q")}${bar("One-hot", R.n * R.n, R.n * R.n)}<span class="ts">${R.n * R.n - R.qubits} qubits menos que el QUBO</span></div>`;

  // Asignación con avatares y pines
  $("assign").innerHTML = p.map((z, i) => `<div class="ra" style="--i:${i}"><span class="av" style="--c:var(${PAL[i]});--t:var(${PAL[i] === "--otono" ? "--on-otono" : "--on-qiskit"})">${esc(R.brigadas[i][0])}</span><span class="rb">${esc(R.brigadas[i])}</span><span class="rarr" aria-hidden="true"></span><span class="pin">${PIN}</span><b>${esc(R.zonas[z])}</b></div>`).join("");

  // Pares que más aportan: F × D de cada par en la asignación encontrada
  const pairs = []; for (let i = 0; i < R.n; i++) for (let k = i + 1; k < R.n; k++) pairs.push({ i, k, f: R.F[i][k], d: R.D[p[i]][p[k]], c: R.F[i][k] * R.D[p[i]][p[k]] });
  pairs.sort((x, y) => y.c - x.c); const top = pairs.slice(0, 3), mx = top[0]?.c || 1;
  $("rPairs").innerHTML = top.map((x, n) => `<div class="rp" style="--i:${n}"><div class="rpt"><span>${esc(R.brigadas[x.i])} · ${esc(R.brigadas[x.k])}</span><b>${x.c}</b></div>
    <div class="rpb"><i style="--w:${(x.c / mx * 100).toFixed(1)}%"></i></div><span class="ts">F ${x.f} × D ${x.d} h · ${(x.c / b.costo * 100).toFixed(0)} % del costo total</span></div>`).join("");

  const mejoras = b.pasos.filter(s => s.mejora).map(s => s.costo_salida);
  $("steps").innerHTML = [
    `<b>Espacio de búsqueda.</b> ${R.n}! = ${R.M} asignaciones válidas, codificadas en ⌈log₂ ${R.M}⌉ = ${R.qubits} qubits (${2 ** R.qubits} índices; ${2 ** R.qubits - R.M} sobrantes se descartan).`,
    `<b>Fuerza bruta.</b> Evalúa las ${R.M} asignaciones y encuentra C* = ${R.optimo} en ${(R.clasico_s * 1000).toFixed(2)} ms.`,
    `<b>Presupuesto de Grover.</b><div class="formula">22,5·√${R.M} + 1,4·log₂²(${R.M}) = ${R.presupuesto} consultas</div>`,
    `<b>Búsqueda adaptativa.</b> Empieza con umbral ${b.pasos[0].umbral} y mejora ${mejoras.length} ${mejoras.length === 1 ? "vez" : "veces"}: <span class="chain">${[b.pasos[0].umbral, ...mejoras].map(v => `<i>${v}</i>`).join("→")}</span> Usa ${b.consultas} consultas en ${b.pasos.length} mediciones.`,
    `<b>Resultado.</b> Costo ${b.costo} ${b.optimo ? `<span class="ok">= óptimo ✓</span>` : `<span class="bad">≠ óptimo</span>`}. ${b.consultas < R.M ? `Usó menos consultas que N! (${R.M}).` : `Para N = ${R.n} usó más consultas que N! (${R.M}): la ventaja empieza desde N ≈ 7.`}`
  ].map(s => `<li><span>${s}</span></li>`).join("");

  if (anim) {
    const r = $("results"); r.classList.remove("play"); void r.offsetWidth; r.classList.add("play");
    stagger("#kpis .tile", null); stagger("#steps li"); document.querySelectorAll("#kpis .cnt").forEach(countUp);
  }
}

/* ---------------- Mapa ---------------- */
/* Mapa real con Leaflet y teselas de OpenStreetMap/CARTO; sin Leaflet (sin internet) se usa el esquema SVG */
let LM = null, LG = null, LT = null;
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const isDark = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function mapTiles() { // OpenStreetMap estándar; en modo oscuro se oscurece con un filtro CSS (.mapreal.dark)
  if (!LM) return; $("mapReal").classList.toggle("dark", isDark());
  if (!LT) LT = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 13,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>' }).addTo(LM);
}
const zoneLatLng = (z, j, n) => Z[z] || (() => { const c = COAST[Math.round(2 + j * (COAST.length - 4) / Math.max(1, n - 1))]; return [c[0], c[1] + 0.6]; })();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { mapTiles(); if (LM) drawMap(); });
function drawMapReal(asg, Fm) {
  if (!LM) { LM = L.map("mapReal", { scrollWheelZoom: false, zoomSnap: .25 }); mapTiles(); LG = L.layerGroup().addTo(LM); let rh = 0; new ResizeObserver(() => { const h = $("mapReal").offsetHeight; if (Math.abs(h - rh) < 4) return; rh = h; LM.invalidateSize(); drawMapReal.key = null; drawMap(); }).observe($("mapReal")); }
  LG.clearLayers();
  const n = cur.F.length, pts = cur.zonas.map((z, j) => zoneLatLng(z, j, n)), fresh = mapFresh && asg;
  if (asg) for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++)
    L.polyline([pts[asg[i]], pts[asg[k]]], { color: cssVar("--otono"), weight: 1.5 + 6 * cur.F[i][k] / Fm, opacity: stale ? .6 : .9, dashArray: stale ? "6 8" : null, className: stale ? "flow stale" : "flow" }).addTo(LG);
  cur.zonas.forEach((z, j) => { const b = asg ? asg.indexOf(j) : -1;
    L.circleMarker(pts[j], { radius: b >= 0 ? 9 : 6, color: cssVar("--ink"), weight: 2, fillColor: cssVar(b >= 0 ? "--qiskit" : "--surface"), fillOpacity: 1, className: fresh ? "zpop" : "" })
      .bindTooltip(`<b>${esc(z)}</b>${b >= 0 ? `<br>${esc(cur.brigadas[b])}` : ""}`, { permanent: true, direction: j % 2 ? "left" : "right", offset: [j % 2 ? -10 : 10, 0], className: "ztip" }).addTo(LG); });
  const key = pts.join("|"); if (drawMapReal.key !== key) { LM.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 8 }); drawMapReal.key = key; }
  mapFresh = false;
}
/* Datos clave del escenario bajo el mapa: se actualizan con cada cambio */
function renderMapStats() {
  const n = cur.F.length, pts = cur.zonas.map((z, j) => zoneLatLng(z, j, n));
  let fi = [0, 1], di = [0, 1], span = 0, si = [0, 1];
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
    if (cur.F[i][k] > cur.F[fi[0]][fi[1]]) fi = [i, k];
    if (cur.D[i][k] > cur.D[di[0]][di[1]]) di = [i, k];
    const km = haversine(pts[i], pts[k]); if (km > span) { span = km; si = [i, k]; }
  }
  const asg = lastAsg(), c = asg ? G.costo(cur.F, cur.D, asg) : null;
  const items = [
    ["Par más coordinado", `${esc(cur.brigadas[fi[0]])} · ${esc(cur.brigadas[fi[1]])}`, `F = <b class="cnt">${cur.F[fi[0]][fi[1]]}</b>`, "--otono"],
    ["Tramo más largo", `${esc(cur.zonas[di[0]])} ↔ ${esc(cur.zonas[di[1]])}`, `<b class="cnt">${cur.D[di[0]][di[1]]}</b> h`, "--qiskit-2"],
    ["Zonas más alejadas", `${esc(cur.zonas[si[0]])} ↔ ${esc(cur.zonas[si[1]])}`, `<b class="cnt">${Math.round(span)}</b> km`, "--qiskit"],
    ["Costo de la asignación", asg ? (stale ? "la anterior, con tus cambios: vuelve a resolver" : "la que encontró Grover") : "resuelve para calcularlo", asg ? `C = <b class="cnt">${c}</b>` : "—", "--ok"]];
  $("mStats").innerHTML = items.map(([t, s, v, col], i) => `<div class="ms" style="--c:var(${col});--i:${i}"><span class="mt2">${t}</span><b class="mv">${v}</b><span class="ms2">${s}</span></div>`).join("");
  if (mapFresh) document.querySelectorAll("#mStats .cnt").forEach(countUp);   // solo al resolver
}
// Tras editar, el mapa sigue mostrando la última asignación (punteada) hasta que se vuelva a resolver
const lastAsg = () => R && R.n === cur.F.length ? R.perms[bestRun().indice] : null;
function drawMap() {
  renderMapStats();
  const Fm0 = Math.max(1, ...cur.F.flat()), asg0 = lastAsg();
  if (window.L) return drawMapReal(asg0, Fm0);
  $("mapReal").hidden = true; $("map").hidden = false;
  $("mapNote").textContent = "Sin conexión al servidor de mapas: se muestra un esquema de la costa, no a escala. Grosor de cada línea = sinergia F.";
  const P = ([la, lo]) => [(lo + 82) * 36, (-la - 3) * 36 + 10], n = cur.F.length;
  const coast = COAST.map(P);
  const pos = cur.zonas.map((z, j) => Z[z] ? P(Z[z]) : (() => { const c = coast[Math.round(2 + j * (coast.length - 4) / Math.max(1, n - 1))]; return [c[0] + 26, c[1]]; })());
  let s = `<path d="M0,0 L${coast.map(p => p.join(",")).join(" L")} L0,470Z" fill="var(--qiskit)" fill-opacity=".10"/><path d="M${coast.map(p => p.join(",")).join(" L")}" fill="none" stroke="var(--qiskit)" stroke-width="2"/>`;
  s += `<text x="16" y="300" fill="var(--qiskit)" font-size="11" transform="rotate(-90 16 300)" letter-spacing="3">OCÉANO PACÍFICO</text>`;
  const asg = lastAsg(), Fm = Math.max(1, ...cur.F.flat());
  if (asg) for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const [x1, y1] = pos[asg[i]], [x2, y2] = pos[asg[k]];
    s += `<line class="flow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--otono)" stroke-width="${(1 + 5 * cur.F[i][k] / Fm).toFixed(1)}" stroke-opacity="${stale ? .55 : .85}"${stale ? ` stroke-dasharray="5 6"` : ""}/>`; }
  cur.zonas.forEach((z, j) => { const [x, y] = pos[j], b = asg ? asg.indexOf(j) : -1;
    s += `<circle cx="${x}" cy="${y}" r="${b >= 0 ? 9 : 6}" fill="${b >= 0 ? "var(--qiskit)" : "var(--surface)"}" stroke="var(--ink)" stroke-width="1.5"/><text x="${x + 14}" y="${y + 4}" font-size="11" font-weight="600" fill="var(--ink)" style="font-family:var(--sans)">${esc(z)}</text>${b >= 0 ? `<text x="${x + 14}" y="${y + 17}" font-size="9" fill="var(--muted)">${esc(cur.brigadas[b])}</text>` : ""}`; });
  if (!asg) s += `<text x="150" y="455" text-anchor="middle" font-size="10" fill="var(--muted)">Resuelve para ver la asignación</text>`;
  $("map").innerHTML = s;
  if (mapFresh && asg) { // al resolver: las zonas aparecen una tras otra y las líneas se encienden
    mapFresh = false; const m = $("map"); m.classList.remove("fresh"); void m.getBoundingClientRect();
    m.querySelectorAll("circle").forEach((c, i) => c.style.setProperty("--i", i)); m.classList.add("fresh");
    clearTimeout(drawMap.t); drawMap.t = setTimeout(() => m.classList.remove("fresh"), 1800);
  }
}

/* ---------------- Animación de Grover ---------------- */
let runIdx = 0, frames = [], fi = -1, timer = null, spd = 1;
const SPEEDS = [[.5, "0,5×"], [1, "1×"], [2, "2×"]];
function speedSeg() {
  $("speedSeg").innerHTML = SPEEDS.map(([v, t]) => `<button type="button" data-spd="${v}" aria-pressed="${v === spd}">${t}</button>`).join("");
}
$("speedSeg").onclick = e => { const b = e.target.closest("[data-spd]"); if (!b) return; spd = +b.dataset.spd; speedSeg(); };
speedSeg();
function setupAnim() {
  $("run").innerHTML = R.runs.map((r, i) => `<option value="${i}">#${i + 1}${r.pasos[0].etapas ? " · animada" : ""} · ${r.consultas} consultas${r.optimo ? " ✓" : ""}</option>`).join("");
  runIdx = Math.max(0, R.runs.findIndex(r => r.pasos[0].etapas)); $("run").value = runIdx;
  $("animEngine").textContent = motorTxt(R.motor); buildFrames();
}
function buildFrames() {
  stop(); const run = R.runs[runIdx]; frames = [];
  run.pasos.forEach((p, s) => { if (p.etapas) p.etapas.forEach((_, k) => frames.push({ s, k })); frames.push({ s, k: "m" }); });
  fi = -1;
  const S = 2 ** R.qubits, anim = !!run.pasos[0].etapas;
  $("amps").style.gridTemplateColumns = `repeat(${S},minmax(0,1fr))`;
  $("amps").innerHTML = `<div class="axis"></div><div class="meanline" id="mean" hidden></div>` + [...Array(S).keys()].map(i => `<div class="bar" id="b${i}" title="${i < R.M ? `#${i} · C = ${R.costos[i]}` : `#${i} sin permutación`}"><div class="up"><i></i></div><div class="dn"><i></i></div></div>`).join("");
  $("ampNote").textContent = anim ? `${S} índices · ${R.qubits} qubits` : `Para N ≥ 5 o ejecuciones sin etapas se muestra solo el resumen`;
  $("amps").style.opacity = anim ? 1 : .5;
  $("scrub").max = frames.length; renderFrame();
}
const stageInfo = e => e.startsWith("Superposición") ? ["Superposición", "H en todos los qubits: todos los índices con la misma amplitud."] : e.startsWith("Oráculo") ? [e, "Fase −1 en los índices más baratos que el umbral."] : [e, "Inversión sobre el promedio: lo que estaba por debajo sube."];
// Barra de etapas: 4 nodos con la etapa actual resaltada y la iteración en curso
function renderStepper(cur, p, it) {
  const itTxt = () => !p ? null : !p.j ? "j = 0: sin iteraciones" : it ? `iteración ${it} de ${p.j}` : `${p.j} ${p.j === 1 ? "iteración" : "iteraciones"}`;
  const sub = [`H en los ${R.qubits} qubits`, itTxt() ?? "fase −1 a los marcados", itTxt() ?? "inversión sobre el promedio", p && cur === 3 ? `P(marcado) ${(p.p_marcados * 100).toFixed(0)} %` : "se mide un índice"];
  $("pipe").innerHTML = ["Superposición", "Oráculo", "Difusión", "Medición"].map((t, k) =>
    `<li class="${k < cur ? "done" : k === cur ? "cur" : ""}"><span class="dot">${k + 1}</span><b>${t}</b><span>${sub[k]}</span></li>`).join("");
}
// Registro de mediciones hasta el cuadro actual (la más reciente arriba)
function renderLog() {
  const run = R.runs[runIdx], last = fi >= 0 ? frames[fi] : null, upto = last ? (last.k === "m" ? last.s : last.s - 1) : -1;
  $("log").innerHTML = run.pasos.slice(0, upto + 1).map((p, s) => `<div class="${p.mejora ? "win" : ""} ${s === upto && last?.k === "m" ? "new" : ""}">#${s + 1} j=${p.j} umbral ${p.umbral} → ${p.costo_salida ?? "inválido"}${p.mejora ? " ✓" : ""} · ${p.llamadas} consultas</div>`).reverse().join("");
}
function renderFrame() {
  const run = R.runs[runIdx], S = 2 ** R.qubits;
  $("scrub").value = fi + 1; $("scrubTxt").textContent = `${fi + 1} / ${frames.length}`;
  $("ampCta").hidden = fi >= 0 || !!timer;
  renderLog();
  if (fi < 0) {
    $("stN").textContent = "0"; $("stT").textContent = "Listo para empezar"; $("stS").textContent = `Umbral inicial al azar · presupuesto ${R.presupuesto} consultas · N! = ${R.M}`;
    renderStepper(-1, null, 0); setBars(Array(S).fill(1 / Math.sqrt(S)), null, null, -1); setGauge(null); $("meas").textContent = ""; drawStair(run, -1); updStats(run, -1); return;
  }
  const f = frames[fi], p = run.pasos[f.s], marked = new Set(R.costos.map((c, i) => c < p.umbral ? i : -1).filter(i => i >= 0));
  $("stN").textContent = f.s + 1;
  const stg = document.querySelector(".stage"); stg.classList.remove("tick"); void stg.offsetWidth; stg.classList.add("tick");
  if (f.k === "m") {
    renderStepper(3, p, p.j);
    $("stT").textContent = p.mejora ? `Medición: ¡mejora! ${p.umbral} → ${p.costo_salida}` : "Medición: sin mejora";
    $("stS").textContent = `j = ${p.j} iteraciones · ${p.marcados} marcados · P(marcado) = ${(p.p_marcados * 100).toFixed(1)} %`;
    setBars(p.etapas ? p.etapas[p.etapas.length - 1].amp : null, marked, p.y, p.salida); setGauge(p.p_marcados);
    $("meas").innerHTML = p.salida < R.M ? `Medido: índice ${p.salida} → ${R.perms[p.salida].map(z => esc(R.zonas[z]).slice(0, 3)).join("·")}, costo ${p.costo_salida} ${p.mejora ? "<span class='ok'>✓ nuevo umbral</span>" : "(no mejora)"}` : `Medido: índice ${p.salida}, que no es ninguna asignación: se descarta.`;
  } else {
    const e = p.etapas[f.k], [t, sub] = stageInfo(e.etapa), prev = f.k > 0 ? p.etapas[f.k - 1].amp : null, it = +(e.etapa.match(/\d+/) || [0])[0];
    renderStepper(e.etapa.startsWith("Superposición") ? 0 : e.etapa.startsWith("Oráculo") ? 1 : 2, p, it);
    $("stT").textContent = t; $("stS").textContent = `Umbral ${p.umbral} · ${p.marcados} marcados · ${sub}`;
    setBars(e.amp, f.k === 0 ? null : marked, p.y, -1, e.etapa.startsWith("Difusión") && prev ? mean(prev) : null);
    setGauge([...marked].reduce((s, i) => s + e.amp[i] ** 2, 0)); $("meas").textContent = "";
  }
  drawStair(run, f.s); updStats(run, f.s);
}
function setGauge(pv) { $("pgBar").style.width = pv == null ? "0%" : (pv * 100).toFixed(1) + "%"; $("pgVal").textContent = pv == null ? "—" : (pv * 100).toFixed(1) + " %"; }
function setBars(amps, marked, best, hit, avg) {
  const S = 2 ** R.qubits, mx = amps ? Math.max(...amps.map(Math.abs), 1e-9) : 1;
  for (let i = 0; i < S; i++) { const b = $("b" + i); if (!b) continue; const a = amps ? amps[i] : 0;
    b.className = "bar " + (i >= R.M ? "vo" : i === best ? "best" : marked && marked.has(i) ? "mk" : "va") + (i === hit ? " hit" : "");
    b.querySelector(".up i").style.height = (a > 0 ? a / mx * 100 : 0) + "%"; b.querySelector(".dn i").style.height = (a < 0 ? -a / mx * 100 : 0) + "%"; }
  const m = $("mean"); if (avg == null || !amps) m.hidden = true; else { m.hidden = false; m.style.top = `calc(6px + ${50 - avg / mx * 50}%)`; }
}
function drawStair(run, s) {
  const W = 420, H = 220, pl = 44, pb = 28, tope = R.presupuesto, cmax = Math.max(...R.costos), cmin = R.optimo;
  const X = q => pl + (W - pl - 10) * Math.min(q, tope) / tope, Y = c => 10 + (H - pb - 10) * (cmax - c) / (cmax - cmin || 1);
  let g = `<defs><linearGradient id="stairFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--qiskit)" stop-opacity=".28"/><stop offset="1" stop-color="var(--qiskit)" stop-opacity="0"/></linearGradient></defs>`;
  for (const c of [cmin, (cmin + cmax) / 2, cmax]) g += `<line x1="${pl}" x2="${W - 10}" y1="${Y(c)}" y2="${Y(c)}" stroke="var(--line)"/><text x="${pl - 6}" y="${Y(c) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${Math.round(c)}</text>`;
  g += `<line x1="${pl}" x2="${W - 10}" y1="${Y(cmin)}" y2="${Y(cmin)}" stroke="var(--qiskit)" stroke-dasharray="4 4"/><text x="${W - 12}" y="${Y(cmin) - 4}" text-anchor="end" font-size="9" fill="var(--qiskit)">óptimo ${cmin}</text>`;
  if (R.M <= tope) g += `<line x1="${X(R.M)}" x2="${X(R.M)}" y1="10" y2="${H - pb}" stroke="var(--otono)" stroke-dasharray="2 3"/><text x="${X(R.M) + 3}" y="20" font-size="9" fill="var(--otono-ink)">N! = ${R.M}</text>`;
  g += `<text x="${pl}" y="${H - 8}" font-size="9" fill="var(--muted)">0 consultas</text><text x="${W - 10}" y="${H - 8}" text-anchor="end" font-size="9" fill="var(--muted)">presupuesto ${tope}</text>`;
  if (s >= 0) {
    let d = `M${X(0)},${Y(run.pasos[0].umbral)}`, x = X(0), y = Y(run.pasos[0].umbral);
    for (let k = 0; k <= s; k++) { const p = run.pasos[k]; x = X(p.llamadas); y = Y(p.mejora ? p.costo_salida : p.umbral); d += ` L${x},${Y(p.umbral)} L${x},${y}`; }
    g += `<path d="${d} L${x},${H - pb} L${X(0)},${H - pb}Z" fill="url(#stairFill)"/><path d="${d}" fill="none" stroke="var(--qiskit)" stroke-width="2.5" stroke-linejoin="round"/>`;
    run.pasos.slice(0, s + 1).forEach(p => { if (p.mejora) g += `<circle class="imp" cx="${X(p.llamadas)}" cy="${Y(p.costo_salida)}" r="4.5" fill="var(--otono)"/>`; });
    g += `<circle class="cur" cx="${x}" cy="${y}" r="6" fill="var(--qiskit)" stroke="var(--surface)" stroke-width="2"/>`;
  }
  $("stair").innerHTML = g;
}
function updStats(run, s) {
  const p = s >= 0 ? run.pasos[s] : null, q = p ? p.llamadas : 0;
  $("sQ").textContent = q; $("sB").textContent = p ? (p.mejora ? p.costo_salida : p.umbral) : run.pasos[0].umbral; $("sP").textContent = p ? (p.p_marcados * 100).toFixed(0) + " %" : "—";
  $("budBar").style.width = Math.min(100, q / R.presupuesto * 100) + "%"; $("budNF").hidden = R.M > R.presupuesto; $("budNF").style.left = Math.min(100, R.M / R.presupuesto * 100) + "%";
  $("budTxt").textContent = `${q} de ${R.presupuesto} consultas del presupuesto · marca rosa = N! = ${R.M} (lo que revisa la fuerza bruta)${s === run.pasos.length - 1 ? ` · terminó con costo ${run.costo}${run.optimo ? " (óptimo ✓)" : ""}` : ""}`;
}
function next() { if (fi < frames.length - 1) { fi++; renderFrame(); return true; } stop(); return false; }
function prev() { stop(); if (fi >= 0) { fi--; renderFrame(); } }
function play() { if (timer) return stop(); if (fi >= frames.length - 1) fi = -1; $("play").textContent = "⏸"; $("play").classList.add("on"); $("ampCta").hidden = true; tick(); }
function tick() { if (!next()) return; const f = frames[fi]; timer = setTimeout(tick, (f.k === "m" ? 1100 : 800) / spd * (R.runs[runIdx].pasos[0].etapas ? 1 : .3)); }
function stop() { clearTimeout(timer); timer = null; $("play").textContent = "▶"; $("play").classList.remove("on"); }
$("play").onclick = play; $("ampCta").onclick = play; $("stepB").onclick = () => { stop(); next(); }; $("prevB").onclick = prev; $("restart").onclick = buildFrames;
$("run").onchange = e => { runIdx = +e.target.value; buildFrames(); };
$("scrub").oninput = e => { stop(); fi = +e.target.value - 1; renderFrame(); };
// Atajos: espacio reproduce o pausa; ← y → retroceden o avanzan un paso
document.addEventListener("keydown", e => {
  if ($("v-animacion").hidden || /SELECT|INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === " ") { e.preventDefault(); play(); } else if (e.key === "ArrowRight") { stop(); next(); } else if (e.key === "ArrowLeft") prev();
});

/* ---------------- Calculadoras ---------------- */
document.getElementById("ctabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; document.querySelectorAll("#ctabs button").forEach(x => x.setAttribute("aria-selected", x === b)); document.querySelectorAll("[data-cpanel]").forEach(p => p.hidden = p.dataset.cpanel !== b.dataset.c); };
let cAsg = null;
function renderCalcs() {
  const n = cur.F.length; if (!cAsg || cAsg.length !== n) cAsg = R && R.n === n ? [...R.perms[bestRun().indice]] : [...Array(n).keys()];
  const sel = (id, a) => a.map((z, i) => `<label class="f">${esc(cur.brigadas[i])}<select data-${id}="${i}">${cur.zonas.map((zn, j) => `<option value="${j}" ${j === z ? "selected" : ""}>${esc(zn)}</option>`).join("")}</select></label>`).join("");
  $("cAsg").innerHTML = sel("ca", cAsg); costCalc();
  $("xAsg").innerHTML = sel("xa", cAsg); idxFromPerm();
  qCalc(); iterSetup();
}
function costCalc() {
  const n = cAsg.length, dup = new Set(cAsg).size !== n; let rows = "", tot = 0;
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const f = cur.F[i][k], d = cur.D[cAsg[i]][cAsg[k]]; tot += f * d; rows += `<tr><td>${esc(cur.brigadas[i])} · ${esc(cur.brigadas[k])}</td><td>${esc(cur.zonas[cAsg[i]])} · ${esc(cur.zonas[cAsg[k]])}</td><td class="num">${f}</td><td class="num">${d}</td><td class="num">${f * d}</td></tr>`; }
  const opt = R && R.n === n && !stale ? R.optimo : null;
  $("cPairs").innerHTML = `<tr><th>Par de brigadas</th><th>Sus zonas</th><th class="num">F</th><th class="num">D</th><th class="num">F × D</th></tr>${rows}<tr><td colspan="4"><b>C(p) total</b>${dup ? ` <span class="bad">· inválida: una zona tiene dos brigadas</span>` : opt != null ? ` · óptimo ${opt}${tot === opt ? ' <span class="ok">✓ es el óptimo</span>' : ` (${((tot / opt - 1) * 100).toFixed(0)} % más)`}` : ""}</td><td class="num"><b>${tot}</b></td></tr>`;
}
function idxFromPerm() { const n = cAsg.length; if (new Set(cAsg).size !== n) { $("xOut").innerHTML = `<span class="bad">Asignación inválida: cada zona debe tener una sola brigada.</span>`; return; } const i = G.permAIndice(cAsg); $("xI").value = i; idxOut(i); }
function idxOut(i) { const n = cur.F.length, M = G.fact(n), q = G.qubits(M); if (!(i >= 0 && i < 2 ** q)) return; if (i >= M) { $("xOut").innerHTML = `Índice ${i} = ${i.toString(2).padStart(q, "0")} (binario, ${q} qubits): <b>no corresponde a ninguna asignación</b> (solo hay ${M}). Si una medición lo devuelve, se descarta.`; return; }
  const p = G.indiceAPerm(i, n); $("xOut").innerHTML = `Índice ${i} → binario <b>${i.toString(2).padStart(q, "0")}</b> (${q} qubits)<br>${p.map((z, b) => `${esc(cur.brigadas[b])} → ${esc(cur.zonas[z])}`).join(" · ")}<br>C(p) = <b>${G.costo(cur.F, cur.D, p)}</b>`; }
$("xI").oninput = e => { const n = cur.F.length, i = Math.floor(+e.target.value); if (i >= 0 && i < G.fact(n)) { cAsg = G.indiceAPerm(i, n); $("xAsg").querySelectorAll("select").forEach((s, b) => s.value = cAsg[b]); } idxOut(i); };
document.addEventListener("change", e => { if (e.target.dataset.ca !== undefined) { cAsg[+e.target.dataset.ca] = +e.target.value; costCalc(); } if (e.target.dataset.xa !== undefined) { cAsg[+e.target.dataset.xa] = +e.target.value; idxFromPerm(); } });
function qCalc() { const n = Math.max(2, Math.min(20, Math.floor(+$("qN").value || 2))), M = G.fact(n), q = G.qubits(M), b = G.presupuesto(M);
  $("qOut").innerHTML = [[fmtBig(M), "N! asignaciones"], [n * n, "qubits one-hot (N²)"], [q, "qubits por índice"], [fmtBig(b), "presupuesto de Grover"]].map((k, i) => `<div class="kpi ${i % 2 ? "o" : ""}"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("");
  $("qF").innerHTML = `⌈log₂(${n}!)⌉ = ⌈${Math.log2(M).toFixed(2)}⌉ = ${q} qubits → 2^${q} = ${fmtBig(2 ** q)} índices, ${fmtBig(2 ** q - M)} sobrantes<br>presupuesto ÷ N! = ${(b / M).toPrecision(3)} ${b < M ? "→ Grover consulta menos que la fuerza bruta" : "→ todavía consulta más que la fuerza bruta"}`; }
$("qN").oninput = qCalc;
let iCost = null;
function iterSetup() { const n = cur.F.length; iCost = G.permutaciones(n).map(p => G.costo(cur.F, cur.D, p)); const u = [...new Set(iCost)].sort((a, b) => a - b);
  $("iU").innerHTML = u.map(c => `<option value="${c}">umbral ${c} → ${iCost.filter(x => x < c).length} marcados</option>`).join(""); $("iU").selectedIndex = Math.min(1, u.length - 1);
  const M = iCost.length, S = 2 ** G.qubits(M); $("iJ").max = Math.ceil(Math.sqrt(M)) + 1; $("iAmps").style.gridTemplateColumns = `repeat(${S},minmax(0,1fr))`;
  $("iAmps").innerHTML = `<div class="axis"></div>` + [...Array(S).keys()].map(i => `<div class="bar" id="ib${i}"><div class="up"><i></i></div><div class="dn"><i></i></div></div>`).join(""); iterCalc(); }
function iterCalc() {
  const c = +$("iU").value, j = +$("iJ").value, M = iCost.length, S = 2 ** G.qubits(M), mk = iCost.map((x, i) => x < c ? i : -1).filter(i => i >= 0), set = new Set(mk);
  $("iJv").textContent = j; const { a } = G.evolucionar(S, mk, j, false), mx = Math.max(...Array.from(a, Math.abs), 1e-9);
  a.forEach((v, i) => { const b = $("ib" + i); b.className = "bar " + (i >= M ? "vo" : set.has(i) ? "mk" : "va"); b.querySelector(".up i").style.height = (v > 0 ? v / mx * 100 : 0) + "%"; b.querySelector(".dn i").style.height = (v < 0 ? -v / mx * 100 : 0) + "%"; });
  const k = mk.length, P = mk.reduce((s, i) => s + a[i] ** 2, 0), th = Math.asin(Math.sqrt(k / S)), T = k ? Math.sin((2 * j + 1) * th) ** 2 : 0;
  $("iP").textContent = (P * 100).toFixed(1) + " %"; $("iT").textContent = (T * 100).toFixed(1) + " %";
  const W = 420, H = 170, pl = 34, pb = 22, J = +$("iJ").max, X = x => pl + (W - pl - 10) * x / J, Y = y => 8 + (H - pb - 8) * (1 - y);
  let g = ""; for (const y of [0, .5, 1]) g += `<line x1="${pl}" x2="${W - 10}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--line)"/><text x="${pl - 5}" y="${Y(y) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${y * 100}%</text>`;
  if (k) { let d = ""; for (let x = 0; x <= J; x += .05) d += (d ? " L" : "M") + X(x) + "," + Y(Math.sin((2 * x + 1) * th) ** 2); g += `<path d="${d}" fill="none" stroke="var(--qiskit)" stroke-width="2"/>`; }
  for (let jj = 0; jj <= J; jj++) { const t = k ? Math.sin((2 * jj + 1) * th) ** 2 : 0; g += `<circle cx="${X(jj)}" cy="${Y(t)}" r="${jj === j ? 7 : 3.5}" fill="${jj === j ? "var(--otono)" : "var(--qiskit)"}"/><text x="${X(jj)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="var(--muted)">${jj}</text>`; }
  $("iCurve").innerHTML = g;
  $("iTxt").innerHTML = k ? `${k} de ${S} índices marcados → θ = asin(√(${k}/${S})) = ${th.toFixed(3)} rad. Mejor j ≈ π/(4θ) − ½ ≈ <b>${Math.max(0, Math.round(Math.PI / (4 * th) - .5))}</b>. Con más iteraciones la probabilidad vuelve a bajar: por eso BBHT elige j al azar y lo va subiendo.` : "Ningún índice cuesta menos que este umbral: no hay nada que amplificar.";
}
$("iU").onchange = iterCalc; $("iJ").oninput = iterCalc;

/* ---------------- Comparador ---------------- */
const SUP = s => String(s).replace(/[0-9]/g, d => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d]);
const fmtN = x => x >= 1e9 ? (x / 1e9).toLocaleString("es", { maximumFractionDigits: 1 }) + " mil millones" : x >= 1e6 ? (x / 1e6).toLocaleString("es", { maximumFractionDigits: 1 }) + " millones" : Math.round(x).toLocaleString("es");
function renderCompare() {
  $("cmpIntro").textContent = Q ? `Referencia: ${Q.repeticiones} ejecuciones por tamaño con Qiskit ${Q.qiskit} (semilla ${Q.semilla}, versión honesta sin parada anticipada), generadas el ${Q.generado}.` : "Sin datos de referencia de Qiskit: ejecuta qiskit_grover.py.";
  const ns = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], NF = n => G.fact(n), BU = n => G.presupuesto(G.fact(n));
  const cross = ns.find(n => BU(n) < NF(n)), inst = Q ? Object.values(Q.instancias) : [];
  const tot = inst.flatMap(i => i.runs), okAll = tot.filter(r => r.optimo).length, maxI = inst[inst.length - 1];

  // Datos clave
  $("cmpKpis").innerHTML = [
    ["Cruce", `N = <span class="cnt">${cross}</span>`, "desde aquí Grover consulta menos que la fuerza bruta"],
    ["Con N = 14", `<span class="cnt">${Math.round(NF(14) / BU(14)).toLocaleString("es")}</span>×`, `menos consultas: ${fmtN(BU(14))} frente a ${fmtN(NF(14))}`],
    ["Aciertos medidos", `<span class="cnt">${okAll}</span>/${tot.length}`, `ejecuciones con Qiskit que hallaron el óptimo`],
    ["Qubits simulados", `hasta <span class="cnt">${maxI ? maxI.qubits : "—"}</span>`, maxI ? `N = ${maxI.n}; el QUBO one-hot necesitaría ${maxI.n * maxI.n}` : ""]]
    .map(([t, v, s], i) => `<div class="tile" style="--i:${i}"><span class="tl">${t}</span><b class="big">${v}</b><span class="ts">${s}</span></div>`).join("");

  // Filas de resultados con barra Grover vs N!
  $("rtab").innerHTML = inst.map((i, k) => { const q = i.runs.map(r => r.consultas), qm = mean(q), mx = Math.max(qm, i.M), ok = i.runs.filter(r => r.optimo).length;
    return `<div class="rr" style="--i:${k}"><div class="rh"><b class="rn">N = ${i.n}</b><span class="badge ${ok === i.runs.length ? "ok" : "o"}">${ok}/${i.runs.length} óptimos</span></div>
      <div class="rbars"><div class="mbar q"><span>Grover</span><i style="--w:${(qm / mx * 100).toFixed(1)}%"></i><b>${qm.toFixed(0)} ± ${sd(q).toFixed(0)}</b></div>
      <div class="mbar"><span>N!</span><i style="--w:${(i.M / mx * 100).toFixed(1)}%"></i><b>${i.M}</b></div></div>
      <span class="ts">${i.qubits} qubits · presupuesto ${i.presupuesto} · clásico ${(i.clasico_s * 1000).toFixed(2)} ms · Grover simulado ${mean(i.runs.map(r => r.tiempo_s)).toFixed(2)} s</span></div>`; }).join("");

  // ¿Cuántas veces menos consulta? (barras divergentes, escala log)
  const RW = 420, RH = ns.length * 20 + 20, mid = 160, sc = 26;
  let r = `<line x1="${mid}" x2="${mid}" y1="4" y2="${RH - 14}" stroke="var(--muted)" stroke-opacity=".6"/>`;
  r += `<text x="${mid - 6}" y="${RH - 2}" text-anchor="end" font-size="9" fill="var(--muted)">← Grover consulta más</text><text x="${mid + 6}" y="${RH - 2}" font-size="9" fill="var(--muted)">Grover consulta menos →</text>`;
  ns.forEach((n, k) => { const ratio = NF(n) / BU(n), l = Math.log10(ratio), y = 8 + k * 20, w = Math.abs(l) * sc, win = ratio >= 1;
    r += `<text x="24" y="${y + 11}" font-size="10" fill="var(--ink)" text-anchor="end">${n}</text>`;
    r += `<rect class="rbar" style="--i:${k}" x="${win ? mid : mid - w}" y="${y + 2}" width="${Math.max(2, w)}" height="12" rx="3" fill="var(${win ? "--ok" : "--otono"})" fill-opacity="${win ? .85 : .7}"/>`;
    r += `<text x="${win ? mid + w + 5 : mid - w - 5}" y="${y + 11}" font-size="9" fill="var(--muted)" text-anchor="${win ? "start" : "end"}">${win ? `${ratio >= 100 ? Math.round(ratio).toLocaleString("es") : ratio.toLocaleString("es", { maximumFractionDigits: 1 })}× menos` : `${(1 / ratio).toLocaleString("es", { maximumFractionDigits: 1 })}× más`}</text>`; });
  r += `<text x="4" y="11" font-size="9" fill="var(--muted)">N</text>`;
  $("ratio").setAttribute("viewBox", `0 0 ${RW} ${RH}`); $("ratio").innerHTML = r;

  // Gráfico principal: líneas que se dibujan, zona de ventaja y detalle al pasar el mouse
  const W = 560, H = 320, pl = 54, pb = 38, X = n => pl + (W - pl - 16) * (n - 3) / 11, Y = v => 14 + (H - pb - 14) * (1 - Math.log10(v) / 11);
  let g = "";
  for (let e = 0; e <= 11; e++) g += `<line x1="${pl}" x2="${W - 16}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" stroke="var(--line)" stroke-opacity=".7"/>${e % 2 ? "" : `<text x="${pl - 8}" y="${Y(10 ** e) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">10${SUP(e)}</text>`}`;
  ns.forEach(n => g += `<text x="${X(n)}" y="${H - 20}" text-anchor="middle" font-size="10" fill="var(--muted)">${n}</text>`);
  g += `<text x="${(pl + W) / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--muted)">N (brigadas y zonas)</text>`;
  const pts = f => ns.map(n => [X(n), Y(f(n))]), pN = pts(NF), pB = pts(BU), ci = ns.indexOf(cross);
  // zona de ventaja: entre N! (arriba) y el presupuesto (abajo) desde el cruce
  const zone = [...pN.slice(ci - 1), ...pB.slice(ci - 1).reverse()];
  g += `<polygon class="zone" points="${zone.map(p => p.join(",")).join(" ")}" fill="var(--ok)" fill-opacity=".12"/>`;
  g += `<text class="zone" x="${X(11)}" y="${Y(1e7)}" font-size="11" font-weight="600" fill="var(--ok)" text-anchor="middle">zona de ventaja de Grover</text>`;
  const path = (p, c, cls) => `<path class="ln ${cls}" pathLength="1" d="M${p.map(q => q.join(",")).join(" L")}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  g += path(pN, "var(--bad)", "l1") + path(pB, "var(--qiskit)", "l2");
  g += `<line x1="${X(cross)}" x2="${X(cross)}" y1="14" y2="${H - pb}" stroke="var(--otono)" stroke-dasharray="4 4"/><g class="xlab"><rect x="${X(cross) + 6}" y="16" width="196" height="22" rx="11" fill="var(--surface)" stroke="var(--otono)"/><text x="${X(cross) + 104}" y="31" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">desde N = ${cross}, Grover consulta menos</text></g>`;
  inst.forEach((i, k) => g += `<circle class="pt" style="--i:${k}" cx="${X(i.n)}" cy="${Y(mean(i.runs.map(r => r.consultas)))}" r="6" fill="var(--otono)" stroke="var(--surface)" stroke-width="2"/>`);
  if (R) { const x = X(R.n), y = Y(mean(R.runs.map(r => r.consultas))); g += `<polygon class="pt" points="${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>`; }
  g += `<line id="cguide" x1="0" x2="0" y1="14" y2="${H - pb}" stroke="var(--ink)" stroke-opacity=".35" hidden/><circle id="cgN" r="5" fill="var(--bad)" hidden/><circle id="cgB" r="5" fill="var(--qiskit)" hidden/>`;
  g += `<rect id="chit" x="${pl}" y="0" width="${W - pl - 16}" height="${H - pb}" fill="transparent"/>`;
  const svg = $("logc"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = g;
  svg.classList.remove("play"); void svg.getBoundingClientRect(); svg.classList.add("play");

  // Detalle al pasar el mouse: N, N!, presupuesto y la razón
  const tip = $("ctip");
  svg.onpointermove = e => {
    const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * W, n = Math.max(3, Math.min(14, Math.round(3 + (x - pl) / ((W - pl - 16) / 11))));
    const gx = X(n), me = inst.find(i => i.n === n), ratio = NF(n) / BU(n);
    ["cguide", "cgN", "cgB"].forEach(id => $(id).hidden = false);
    $("cguide").setAttribute("x1", gx); $("cguide").setAttribute("x2", gx);
    $("cgN").setAttribute("cx", gx); $("cgN").setAttribute("cy", Y(NF(n))); $("cgB").setAttribute("cx", gx); $("cgB").setAttribute("cy", Y(BU(n)));
    tip.hidden = false; tip.style.left = `${gx / W * 100}%`;
    tip.innerHTML = `<b>N = ${n}</b><span><i style="background:var(--bad)"></i>N! = ${fmtN(NF(n))}</span><span><i style="background:var(--qiskit)"></i>presupuesto = ${fmtN(BU(n))}</span>${me ? `<span><i style="background:var(--otono)"></i>medido = ${mean(me.runs.map(r => r.consultas)).toFixed(0)}</span>` : ""}<em class="${ratio >= 1 ? "ok" : ""}">${ratio >= 1 ? `Grover: ${ratio >= 100 ? Math.round(ratio).toLocaleString("es") : ratio.toLocaleString("es", { maximumFractionDigits: 1 })}× menos` : `Grover: ${(1 / ratio).toLocaleString("es", { maximumFractionDigits: 1 })}× más`}</em>`;
  };
  svg.onpointerleave = () => { tip.hidden = true; ["cguide", "cgN", "cgB"].forEach(id => $(id).hidden = true); };
  if (!reduced()) document.querySelectorAll("#cmpKpis .cnt").forEach(countUp);
}

/* ---------------- Ejercicios y glosario ---------------- */
function renderExercises() {
  $("exs").innerHTML = CASOS.map((c, i) => { const n = c.F.length, solved = !c.pendiente ? (() => { let best = Infinity; G.permutaciones(n).forEach(p => best = Math.min(best, G.costo(c.F, c.D, p))); return best; })() : null;
    return `<div class="card ex"><div class="h"><h3>${esc(c.nombre)}</h3><span class="badge ${c.qiskit ? "q" : c.pendiente ? "o" : ""}">${c.qiskit ? "Qiskit" : c.pendiente ? "Pendiente" : "Guía"}</span></div>
    <p class="muted small">${esc(c.nota)}</p><p class="small">${esc(c.brigadas.join(", "))}<br>→ ${esc(c.zonas.join(", "))}</p>
    ${solved != null ? `<p class="small">Respuesta: óptimo <b>${solved}</b> entre ${G.fact(n)} asignaciones.</p>` : ""}
    <button class="btn ${c.pendiente ? "" : "main"}" type="button" data-case="${i}">Cargar en el simulador</button></div>`; }).join("");
}
document.addEventListener("click", e => { const b = e.target.closest("[data-case]"); if (b) loadCase(CASOS[+b.dataset.case]); const g = e.target.closest("[data-go]"); if (g) show(g.dataset.go); });
$("gl").innerHTML = [["QAP", "Problema de asignación cuadrática: asignar N elementos a N ubicaciones; el costo depende de pares de asignaciones."],
  ["F", "Matriz de flujo o sinergia entre brigadas (cuánto necesitan coordinarse)."], ["D", "Matriz de distancias: horas de viaje entre zonas."], ["p", "Permutación: p(i) es la zona de la brigada i."],
  ["N!", "Número de asignaciones posibles; lo que revisa la fuerza bruta."], ["Índice", "Número de 0 a N!−1 que identifica una permutación; se guarda en binario en ⌈log₂ N!⌉ qubits."],
  ["Oráculo", "Operación que cambia el signo (fase −1) de los estados que cumplen la condición: costo menor que el umbral. Aquí es idealizado."],
  ["Difusión", "Inversión sobre el promedio 2|s⟩⟨s| − I; amplifica los estados marcados."], ["Consulta", "Una aplicación del oráculo; métrica para comparar con las N! evaluaciones clásicas."],
  ["Umbral", "Mejor costo encontrado hasta el momento; el oráculo marca lo que lo mejora."], ["BBHT", "Boyer, Brassard, Høyer y Tapp: elegir al azar el número de iteraciones cuando no se sabe cuántos estados están marcados."],
  ["Dürr–Høyer", "Algoritmo para encontrar el mínimo con Grover en O(√M) consultas."]].map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("");
$("circ").textContent = Q?.instancias?.[3]?.circuito_texto || "Ejecuta qiskit_grover.py para ver el circuito.";

/* Fórmulas: cada una con su significado y un valor de ejemplo que cambia con N */
function renderFormulas(animate) {
  const n = +$("fN").value, M = G.fact(n), q = G.qubits(M), S = 2 ** q, b = G.presupuesto(M);
  const th = Math.asin(Math.sqrt(1 / S)), p1 = Math.sin(3 * th) ** 2, jopt = Math.max(0, Math.round(Math.PI / (4 * th) - .5)), pj = Math.sin((2 * jopt + 1) * th) ** 2;
  const num = (x, d = 0) => `<b class="fv" data-v="${x}" data-d="${d}">${Number(x).toLocaleString("es", { maximumFractionDigits: d, minimumFractionDigits: d })}</b>`;
  $("fNv").textContent = n;
  const F = [
    ["Costo de una asignación", `C(p) = Σ<sub>i&lt;k</sub> F<sub>ik</sub> · D<sub>p(i) p(k)</sub>`, "Por cada par de brigadas: su sinergia por las horas entre sus zonas. Es lo que se minimiza.",
      R ? `Datos actuales (N = ${R.n}): mínimo C* = ${num(R.optimo)}` : "Resuelve en el Simulador para ver el mínimo."],
    ["Qubits de la codificación", `q = ⌈log<sub>2</sub> N!⌉`, "Cada asignación válida es un número de 0 a N!−1 guardado en binario.",
      `N = ${n}: ${num(q)} qubits frente a ${num(n * n)} del QUBO one-hot`],
    ["Presupuesto de Dürr–Høyer", `T = 22,5·√M + 1,4·log<sub>2</sub><sup>2</sup> M, &nbsp; M = N!`, "Consultas al oráculo tras las cuales se detiene la búsqueda adaptativa.",
      `N = ${n}: ${num(b)} consultas frente a ${num(M)} evaluaciones de la fuerza bruta${b < M ? ` (${num(M / b, 1)} veces menos)` : " (aún más que N!)"}`],
    ["Amplificación de amplitud", `θ = asin √(k / S), &nbsp; P(j) = sin<sup>2</sup>((2j+1)·θ)`, "Probabilidad de medir un índice marcado tras j iteraciones; k marcados de S = 2<sup>q</sup> índices.",
      `N = ${n}, k = 1: una iteración multiplica la probabilidad por ${num(p1 * S, 2)}${p1 >= .001 ? ` (de ${num(100 / S, 2)} % a ${num(p1 * 100, 1)} %)` : ` (de 1/${S.toLocaleString("es")} a ≈ ${num(p1 * S, 2)}/${S.toLocaleString("es")})`}`],
    ["Iteraciones óptimas", `j* ≈ π / (4θ) − ½`, "Con más iteraciones la probabilidad se pasa de largo y vuelve a bajar.",
      `N = ${n}, k = 1: j* = ${num(jopt)} → P = ${num(pj * 100, 1)} %`],
    ["Regla BBHT", `j ~ U{0, …, ⌈m⌉−1}; &nbsp; sin mejora: m ← min(1,2·m, √M)`, "Como no se sabe cuántos índices están marcados, j se elige al azar y el rango crece poco a poco.",
      `N = ${n}: m crece hasta √M = ${num(Math.sqrt(M), 1)}`]];
  $("formulas").innerHTML = F.map(([t, f, d, v], i) => `<li style="--i:${i}"><span class="fn">${i + 1}</span><div><span class="ft">${t}</span><div class="fm">${f}</div><p>${d}</p><p class="fx">${v}</p></div></li>`).join("");
  if (animate) document.querySelectorAll("#formulas .fv").forEach(el => countUpTo(el, +el.dataset.v, +el.dataset.d));
}
function countUpTo(el, target, dec) {
  if (reduced() || !isFinite(target)) return;
  const t0 = performance.now(), T = 600, fmt = x => x.toLocaleString("es", { maximumFractionDigits: dec, minimumFractionDigits: dec });
  const step = t => { const k = Math.min(1, (t - t0) / T), e = 1 - (1 - k) ** 3; el.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
$("fN").oninput = () => renderFormulas(true);
renderFormulas(false);

/* Circuito de una iteración (N = 3): el mismo de qiskit_grover.py, dibujado por etapas */
(function drawCircuit() {
  const ys = [58, 108, 158], x0 = 46, x1 = 715;
  const ST = [ // etapa, color, desde, hasta
    ["1 · Superposición", "--qiskit-2", 52, 156], ["2 · Oráculo", "--otono", 166, 266],
    ["3 · Difusión", "--qiskit", 276, 606], ["4 · Medición", "--ok", 616, 712]];
  let s = ST.map(([t, c, a, b]) => `<rect class="cstage" x="${a}" y="14" width="${b - a}" height="172" rx="10" fill="var(${c})" fill-opacity=".09" stroke="var(${c})" stroke-opacity=".35"/>
    <text x="${(a + b) / 2}" y="30" text-anchor="middle" font-size="11" font-weight="600" fill="var(${c === "--otono" ? "--otono-ink" : c})">${t}</text>`).join("");
  ys.forEach((y, q) => s += `<text x="${x0 - 12}" y="${y + 4}" text-anchor="end" font-size="13" fill="var(--ink)">q${q}</text><line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="1.5"/>`);
  const gate = (x, q, t, c = "--qiskit-2") => `<rect x="${x - 14}" y="${ys[q] - 14}" width="28" height="28" rx="5" fill="var(${c})"/><text x="${x}" y="${ys[q] + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--on-pucp)">${t}</text>`;
  const col = (x, t, c) => ys.map((_, q) => gate(x, q, t, c)).join("");
  s += col(104, "H");
  s += `<rect x="176" y="${ys[0] - 18}" width="80" height="${ys[2] - ys[0] + 36}" rx="7" fill="var(--otono)"/><text x="216" y="${ys[1] - 4}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--on-otono)">Oráculo</text><text x="216" y="${ys[1] + 13}" text-anchor="middle" font-size="10" fill="var(--on-otono)">fase −1</text>`;
  s += col(304, "H", "--qiskit") + col(348, "X", "--qiskit") + gate(392, 2, "H", "--qiskit");
  s += `<line x1="436" x2="436" y1="${ys[0]}" y2="${ys[2]}" stroke="var(--qiskit)" stroke-width="2"/>${[0, 1].map(q => `<circle cx="436" cy="${ys[q]}" r="5" fill="var(--qiskit)"/>`).join("")}<circle cx="436" cy="${ys[2]}" r="12" fill="var(--surface)" stroke="var(--qiskit)" stroke-width="2"/><line x1="424" x2="448" y1="${ys[2]}" y2="${ys[2]}" stroke="var(--qiskit)" stroke-width="2"/><line x1="436" x2="436" y1="${ys[2] - 12}" y2="${ys[2] + 12}" stroke="var(--qiskit)" stroke-width="2"/>`;
  s += gate(480, 2, "H", "--qiskit") + col(524, "X", "--qiskit") + col(568, "H", "--qiskit");
  s += ys.map(y => `<rect x="647" y="${y - 14}" width="34" height="28" rx="5" fill="var(--surface)" stroke="var(--ok)" stroke-width="1.5"/><path d="M653 ${y + 7} A11 11 0 0 1 675 ${y + 7}" fill="none" stroke="var(--ok)" stroke-width="1.5"/><line x1="664" y1="${y + 7}" x2="672" y2="${y - 6}" stroke="var(--ok)" stroke-width="1.5"/>`).join("");
  $("circSvg").innerHTML = s;

  const k = 1; // ejemplo: un solo índice mejora el umbral (el caso donde mejor se ve la amplificación)
  $("circSteps").innerHTML = [
    ["--qiskit-2", "Superposición", "<code>qc.h</code> en los 3 qubits: los 2³ = 8 índices quedan con la misma amplitud (6 asignaciones válidas y 2 índices sobrantes)."],
    ["--otono", "Oráculo", "<code>DiagonalGate</code> pone fase −1 en los índices que cuestan menos que el umbral (en el ejemplo, uno solo). Su probabilidad todavía no cambia: solo su signo."],
    ["--qiskit", "Difusión", "<code>h</code> · <code>x</code> · (<code>h</code> + <code>mcx</code> + <code>h</code> = Z multicontrolada) · <code>x</code> · <code>h</code>: refleja las amplitudes respecto al promedio y las marcadas crecen."],
    ["--ok", "Medición", "<code>Statevector</code> da las probabilidades y se toma un índice. Si cuesta menos que el umbral, el umbral baja y se repite."]]
    .map(([c, t, d]) => `<li style="--c:var(${c})"><b>${t}</b><span>${d}</span></li>`).join("");
  const th = Math.asin(Math.sqrt(k / 8)), p1 = Math.sin(3 * th) ** 2;
  $("circProb").innerHTML = `Ejemplo: si solo 1 de los 8 índices mejora el umbral, medirlo pasa de 1/8 = ${(100 / 8).toFixed(1)} % a sin²(3θ) = <b>${(p1 * 100).toFixed(1)} %</b> con una sola iteración (θ = asin √(1/8)).`;
})();
$("foot").innerHTML = `<b>Q-Niño</b> · Equipo <b>Quantum Action</b>: Jefry Rojas (UNMSM), Sebastian Bimbi, Fabricio Ricapa (UTEC) y Luis Nuñez (UNI) · <a href="https://canva.link/wpcj3x5yovmqfao">Presentación</a> · <a href="https://github.com/GatitoFBI/IBM-QUAMTUM-HACKATON-PROTOTIPO">Repositorio</a> · Hackathon Qiskit Fall Fest 2026 (PUCP · Quantum Hub Perú · IEEE CS PUCP · NTT DATA). Grover Adaptive Search (Dürr y Høyer, 1996; Boyer, Brassard, Høyer y Tapp, 1998) con Qiskit${Q ? " " + Q.qiskit : ""} y NumPy. Datos de prueba y supuestos ilustrativos, no datos oficiales. Web hecha con ayuda de Claude Code. Código: qiskit_grover.py, api.py y js/grover.js.`;

/* ---------------- Navegación, motor y tema ---------------- */
function seg(id, opts, curv, cb) { const el = $(id); el.innerHTML = opts.map(n => `<button type="button" data-v="${n}" aria-pressed="${n === curv}">${n}</button>`).join(""); el.onclick = e => { const b = e.target.closest("button"); if (b) cb(+b.dataset.v); }; }
function show(v) { if (!document.getElementById("v-" + v)) v = "simulador"; document.querySelectorAll("#menu button").forEach(b => b.setAttribute("aria-selected", b.dataset.v === v)); document.querySelectorAll("section.view").forEach(s => s.hidden = s.id !== "v-" + v); stagger(`#v-${v} .card`, null); if (v === "comparador") renderCompare(); if (v === "simulador" && LM) setTimeout(() => { LM.invalidateSize(); drawMapReal.key = null; drawMap(); }, 60); if (v !== "animacion") stop(); try { history.replaceState(null, "", "#" + v); } catch {} window.scrollTo({ top: 0 }); }
$("menu").onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.v); };
function updEngine() { const el = $("engine"); el.classList.toggle("live", useBackend);
  $("engineTxt").textContent = useBackend ? `Qiskit ${backend.qiskit} en vivo · servidor local` : backend ? "Navegador (clic para usar Qiskit en vivo)" : Q ? `Navegador · referencia Qiskit ${Q.qiskit}` : "Navegador"; }
$("engine").onclick = () => { if (!backend) return toast("Para Qiskit en vivo: ejecuta python api.py y abre http://127.0.0.1:8000"); useBackend = !useBackend; updEngine(); };
/* Temas: el de Qiskit Fall Fest (automático) queda por defecto; la elección se recuerda */
const TEMAS = [
  ["fallfest", "Qiskit Fall Fest", "automático: claro u oscuro según el sistema", null, null, ["#31125F", "#FF7EB5", "#D4BCFF"]],
  ["fallfest-claro", "Qiskit Fall Fest · claro", "siempre claro", null, "light", ["#31125F", "#FF7EB5", "#FCE6F3"]],
  ["fallfest-oscuro", "Qiskit Fall Fest · oscuro", "siempre oscuro", null, "dark", ["#C4A5FF", "#FF7EB5", "#170A22"]],
  ["andino", "Andino", "cochinilla, ocre y verde", "andino", "light", ["#8E1B3A", "#E9A23B", "#2F7D5B"]],
  ["atardecer", "Atardecer", "terracota, rosa y ámbar", "atardecer", "light", ["#9A3412", "#DB2777", "#F59E0B"]],
  ["lavanda", "Lavanda", "violeta y rosa suave", "lavanda", "light", ["#6D28D9", "#A855F7", "#EC4899"]],
  ["menta", "Menta", "verde agua y rosa", "menta", "light", ["#0F766E", "#059669", "#F472B6"]],
  ["noche", "Noche cuántica", "oscuro con violeta neón", "noche", "dark", ["#C084FC", "#F0ABFC", "#0B0614"]],
  ["contraste", "Alto contraste", "negro, amarillo y blanco", "contraste", "dark", ["#FFD60A", "#FF4D8D", "#000000"]]];
let temaActual = (() => { try { return localStorage.getItem("qnino_tema") || "fallfest"; } catch { return "fallfest"; } })();
function aplicarTema(id, animar) {
  const t = TEMAS.find(x => x[0] === id) || TEMAS[0], r = document.documentElement;
  if (animar) { document.body.classList.add("retheme"); setTimeout(() => document.body.classList.remove("retheme"), 600); }
  if (t[3]) r.dataset.palette = t[3]; else delete r.dataset.palette;
  if (t[4]) r.dataset.theme = t[4]; else delete r.dataset.theme;
  temaActual = t[0]; try { localStorage.setItem("qnino_tema", t[0]); } catch {}
  $("tmenu").innerHTML = `<h4>Elige un tema</h4>` + TEMAS.map(([k, n, d, , , sw]) => `<button type="button" class="topt" role="menuitemradio" aria-checked="${k === temaActual}" data-tema="${k}"><span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join("")}</span><span>${n}<small>${d}</small></span><span class="ck">✓</span></button>`).join("");
  if (typeof mapTiles === "function") { mapTiles(); if (LM) drawMap(); }
}
const abrirTemas = abrir => { $("tmenu").hidden = !abrir; $("theme").setAttribute("aria-expanded", abrir); };
$("theme").onclick = e => { e.stopPropagation(); abrirTemas($("tmenu").hidden); };
$("tmenu").onclick = e => { const b = e.target.closest("[data-tema]"); if (!b) return; aplicarTema(b.dataset.tema, true); abrirTemas(false); toast(`Tema: ${TEMAS.find(x => x[0] === b.dataset.tema)[1]}`); };
document.addEventListener("click", e => { if (!e.target.closest(".tpick")) abrirTemas(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") abrirTemas(false); });
aplicarTema(temaActual, false);
(async () => { try { const c = new AbortController(); setTimeout(() => c.abort(), 1500); const r = await fetch("api/salud", { signal: c.signal }); if (r.ok) { backend = await r.json(); useBackend = true; } } catch {} updEngine(); })();

renderExercises(); qCalc();
loadCase(CASOS.find(c => c.id === "q4") || CASOS[0], true);
show(location.hash.slice(1) || "simulador");
