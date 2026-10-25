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
  renderEditor(); onChange();
}
function renderEditor() {
  const n = cur.F.length;
  $("dataTitle").textContent = `Datos · ${n} brigadas y ${n} zonas`;
  seg("nSel", [3, 4, 5, 6], n, resize);
  $("names").innerHTML = `<div class="pair"><span></span><span>Brigada</span><span>Zona</span></div>` + [...Array(n)].map((_, i) =>
    `<div class="pair"><span>${i + 1}</span><input type="text" maxlength="24" data-nm="brigadas" data-i="${i}" value="${esc(cur.brigadas[i])}" aria-label="Nombre de la brigada ${i + 1}"><input type="text" maxlength="24" data-nm="zonas" data-i="${i}" value="${esc(cur.zonas[i])}" aria-label="Nombre de la zona ${i + 1}"></div>`).join("");
  const mat = (key, labels) => `<tr><th></th>${labels.map(l => `<th title="${esc(l)}">${esc(l)}</th>`).join("")}</tr>` + cur[key].map((row, i) =>
    `<tr><th title="${esc(labels[i])}">${esc(labels[i])}</th>${row.map((v, k) => `<td><input type="number" min="0" max="999" step="1" data-m="${key}" data-i="${i}" data-k="${k}" value="${v}" ${i === k ? "disabled" : ""} aria-label="${key}[${labels[i]}][${labels[k]}]"></td>`).join("")}</tr>`).join("");
  $("matF").innerHTML = mat("F", cur.brigadas); $("matD").innerHTML = mat("D", cur.zonas);
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.m) {
    const v = t.value === "" ? NaN : Number(t.value), i = +t.dataset.i, k = +t.dataset.k;
    if (!Number.isInteger(v) || v < 0 || v > 999) { $("err").hidden = false; $("err").textContent = `${t.dataset.m}: usa enteros entre 0 y 999.`; return; }
    $("err").hidden = true;
    cur[t.dataset.m][i][k] = v; cur[t.dataset.m][k][i] = v;                // matriz simétrica
    const twin = document.querySelector(`[data-m="${t.dataset.m}"][data-i="${k}"][data-k="${i}"]`); if (twin) twin.value = v;
    onChange();
  } else if (t.dataset.nm) {
    cur[t.dataset.nm][+t.dataset.i] = t.value.trim() || (t.dataset.nm === "brigadas" ? "Brigada " : "Zona ") + (+t.dataset.i + 1);
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
$("randomize").onclick = () => { const n = cur.F.length, r = () => Math.random(); for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { cur.F[i][k] = cur.F[k][i] = 1 + Math.floor(r() * 9); cur.D[i][k] = cur.D[k][i] = 5 + Math.floor(r() * 15); } renderEditor(); onChange(); };
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
    renderResults(); drawMap(); setupAnim(); renderCalcs(); renderCompare();
    if (!quiet) toast(`Listo: óptimo ${R.optimo}, Grover acertó ${R.runs.filter(r => r.optimo).length}/${R.runs.length}`);
  } catch (err) { toast("Error del backend Qiskit: " + err.message + ". Usando el motor del navegador."); useBackend = false; updEngine(); btn.disabled = false; btn.textContent = "Resolver con Grover"; return solve(quiet); }
  btn.disabled = false; btn.textContent = "Resolver con Grover";
}
$("solve").onclick = () => solve(false);
const motorTxt = m => m === "qiskit-servidor" ? `Qiskit ${backend?.qiskit || ""} en vivo` : m === "qiskit-precalculado" ? `Qiskit ${Q.qiskit} · precalculado` : "Motor del navegador (réplica del algoritmo)";
const bestRun = () => R.runs.find(r => r.optimo) || R.runs.reduce((a, b) => b.costo < a.costo ? b : a);

function renderResults() {
  $("results").hidden = false;
  const q = R.runs.map(r => r.consultas), ok = R.runs.filter(r => r.optimo).length, b = bestRun(), p = R.perms[b.indice];
  $("resEngine").textContent = stale ? "Desactualizado: vuelve a resolver" : motorTxt(R.motor);
  $("kpis").innerHTML = [[R.optimo, `óptimo exacto (fuerza bruta, ${R.M} evaluaciones)`, ""], [b.costo, `mejor costo de Grover · ${ok}/${R.runs.length} aciertos`, "o"], [`${mean(q).toFixed(0)}`, `consultas medias (± ${sd(q).toFixed(0)}) · presupuesto ${R.presupuesto}`, ""], [`${R.qubits}`, `qubits (one-hot necesitaría ${R.n * R.n})`, "o"]]
    .map(k => `<div class="kpi ${k[2]}"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("");
  $("assign").innerHTML = p.map((z, i) => `<div><span>${esc(R.brigadas[i])}</span><span>→</span><b>${esc(R.zonas[z])}</b></div>`).join("");
  const mejoras = b.pasos.filter(s => s.mejora).map(s => s.costo_salida);
  $("steps").innerHTML = [
    `<b>Espacio de búsqueda.</b> ${R.n}! = ${R.M} asignaciones válidas, codificadas en ⌈log₂ ${R.M}⌉ = ${R.qubits} qubits (${2 ** R.qubits} índices; ${2 ** R.qubits - R.M} sobrantes se descartan).`,
    `<b>Fuerza bruta.</b> Evalúa las ${R.M} asignaciones y encuentra C* = ${R.optimo} en ${(R.clasico_s * 1000).toFixed(2)} ms.`,
    `<b>Presupuesto de Grover.</b><div class="formula">22,5·√${R.M} + 1,4·log₂²(${R.M}) = ${R.presupuesto} consultas</div>`,
    `<b>Búsqueda adaptativa.</b> Empieza con umbral ${b.pasos[0].umbral} y mejora ${mejoras.length} veces: ${[b.pasos[0].umbral, ...mejoras].join(" → ")}. Usa ${b.consultas} consultas en ${b.pasos.length} mediciones.`,
    `<b>Resultado.</b> Costo ${b.costo} ${b.optimo ? `<span class="ok">= óptimo ✓</span>` : `<span class="bad">≠ óptimo</span>`}. ${b.consultas < R.M ? `Usó menos consultas que N! (${R.M}).` : `Para N = ${R.n} usó más consultas que N! (${R.M}): la ventaja empieza desde N ≈ 7.`}`
  ].map(s => `<li><span>${s}</span></li>`).join("");
  if (!stale) { stagger("#kpis .kpi"); stagger("#steps li"); stagger("#assign div"); document.querySelectorAll("#kpis .kpi b").forEach(countUp); }
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
function drawMapReal(asg, Fm) {
  if (!LM) { LM = L.map("mapReal", { scrollWheelZoom: false, zoomSnap: .25 }); mapTiles(); LG = L.layerGroup().addTo(LM); }
  LG.clearLayers();
  const n = cur.F.length, pts = cur.zonas.map((z, j) => zoneLatLng(z, j, n)), fresh = mapFresh && asg;
  if (asg) for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++)
    L.polyline([pts[asg[i]], pts[asg[k]]], { color: cssVar("--otono"), weight: 1.5 + 6 * cur.F[i][k] / Fm, opacity: .9, className: "flow" }).addTo(LG);
  cur.zonas.forEach((z, j) => { const b = asg ? asg.indexOf(j) : -1;
    L.circleMarker(pts[j], { radius: b >= 0 ? 9 : 6, color: cssVar("--ink"), weight: 2, fillColor: cssVar(b >= 0 ? "--qiskit" : "--surface"), fillOpacity: 1, className: fresh ? "zpop" : "" })
      .bindTooltip(`<b>${esc(z)}</b>${b >= 0 ? `<br>${esc(cur.brigadas[b])}` : ""}`, { permanent: true, direction: j % 2 ? "left" : "right", offset: [j % 2 ? -10 : 10, 0], className: "ztip" }).addTo(LG); });
  const key = pts.join("|"); if (drawMapReal.key !== key) { LM.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 8 }); drawMapReal.key = key; }
  mapFresh = false;
}
function drawMap() {
  const Fm0 = Math.max(1, ...cur.F.flat()), asg0 = R && !stale && R.n === cur.F.length ? R.perms[bestRun().indice] : null;
  if (window.L) return drawMapReal(asg0, Fm0);
  $("mapReal").hidden = true; $("map").hidden = false;
  $("mapNote").textContent = "Sin conexión al servidor de mapas: se muestra un esquema de la costa, no a escala. Grosor de cada línea = sinergia F.";
  const P = ([la, lo]) => [(lo + 82) * 36, (-la - 3) * 36 + 10], n = cur.F.length;
  const coast = COAST.map(P);
  const pos = cur.zonas.map((z, j) => Z[z] ? P(Z[z]) : (() => { const c = coast[Math.round(2 + j * (coast.length - 4) / Math.max(1, n - 1))]; return [c[0] + 26, c[1]]; })());
  let s = `<path d="M0,0 L${coast.map(p => p.join(",")).join(" L")} L0,470Z" fill="var(--qiskit)" fill-opacity=".10"/><path d="M${coast.map(p => p.join(",")).join(" L")}" fill="none" stroke="var(--qiskit)" stroke-width="2"/>`;
  s += `<text x="16" y="300" fill="var(--qiskit)" font-size="11" transform="rotate(-90 16 300)" letter-spacing="3">OCÉANO PACÍFICO</text>`;
  const asg = R && !stale && R.n === n ? R.perms[bestRun().indice] : null, Fm = Math.max(1, ...cur.F.flat());
  if (asg) for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const [x1, y1] = pos[asg[i]], [x2, y2] = pos[asg[k]];
    s += `<line class="flow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--otono)" stroke-width="${(1 + 5 * cur.F[i][k] / Fm).toFixed(1)}" stroke-opacity=".85"/>`; }
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
let runIdx = 0, frames = [], fi = -1, timer = null;
function setupAnim() {
  $("run").innerHTML = R.runs.map((r, i) => `<option value="${i}">#${i + 1}${r.pasos[0].etapas ? " · animada" : ""} · ${r.consultas} consultas${r.optimo ? " ✓" : ""}</option>`).join("");
  runIdx = Math.max(0, R.runs.findIndex(r => r.pasos[0].etapas)); $("run").value = runIdx;
  $("animEngine").textContent = motorTxt(R.motor); buildFrames();
}
function buildFrames() {
  stop(); const run = R.runs[runIdx]; frames = [];
  run.pasos.forEach((p, s) => { if (p.etapas) p.etapas.forEach((_, k) => frames.push({ s, k })); frames.push({ s, k: "m" }); });
  fi = -1; $("log").innerHTML = "";
  const S = 2 ** R.qubits, anim = !!run.pasos[0].etapas;
  $("amps").style.gridTemplateColumns = `repeat(${S},minmax(0,1fr))`;
  $("amps").innerHTML = `<div class="axis"></div><div class="meanline" id="mean" hidden></div>` + [...Array(S).keys()].map(i => `<div class="bar" id="b${i}" title="${i < R.M ? `#${i} · C = ${R.costos[i]}` : `#${i} sin permutación`}"><div class="up"><i></i></div><div class="dn"><i></i></div></div>`).join("");
  $("ampNote").textContent = anim ? `${S} índices · ${R.qubits} qubits` : `Para N ≥ 5 o ejecuciones sin etapas se muestra solo el resumen`;
  $("amps").style.opacity = anim ? 1 : .5; renderFrame();
}
const stageInfo = e => e.startsWith("Superposición") ? ["Superposición", "H en todos los qubits: todos los índices con la misma amplitud."] : e.startsWith("Oráculo") ? [e, "Fase −1 en los índices más baratos que el umbral."] : [e, "Inversión sobre el promedio: lo que estaba por debajo sube."];
function renderFrame() {
  const run = R.runs[runIdx], S = 2 ** R.qubits;
  if (fi < 0) { $("stN").textContent = "0"; $("stT").textContent = "Listo para empezar"; $("stS").textContent = `Umbral inicial al azar · presupuesto ${R.presupuesto} consultas · N! = ${R.M}`; $("pipe").innerHTML = ""; setBars(Array(S).fill(1 / Math.sqrt(S)), null, null, -1); $("meas").textContent = ""; drawStair(run, -1); updStats(run, -1); return; }
  const f = frames[fi], p = run.pasos[f.s], marked = new Set(R.costos.map((c, i) => c < p.umbral ? i : -1).filter(i => i >= 0)), st = p.etapas ? p.etapas.map(e => e.etapa) : [];
  $("stN").textContent = f.s + 1;
  const stg = document.querySelector(".stage"); stg.classList.remove("tick"); void stg.offsetWidth; stg.classList.add("tick");
  $("pipe").innerHTML = [...st, "Medición"].map((e, k) => `<i class="${(f.k === "m" ? k === st.length : k === f.k) ? "on" : ""}">${e}</i>`).join("");
  if (f.k === "m") {
    $("stT").textContent = p.mejora ? `Medición: ¡mejora! ${p.umbral} → ${p.costo_salida}` : "Medición: sin mejora";
    $("stS").textContent = `j = ${p.j} iteraciones · ${p.marcados} marcados · P(marcado) = ${(p.p_marcados * 100).toFixed(1)} %`;
    setBars(p.etapas ? p.etapas[p.etapas.length - 1].amp : null, marked, p.y, p.salida);
    $("meas").innerHTML = p.salida < R.M ? `Medido: índice ${p.salida} → ${R.perms[p.salida].map((z, i) => esc(R.zonas[z]).slice(0, 3)).join("·")}, costo ${p.costo_salida} ${p.mejora ? "<span class='ok'>✓ nuevo umbral</span>" : "(no mejora)"}` : `Medido: índice ${p.salida}, que no es ninguna asignación: se descarta.`;
    const d = document.createElement("div"); if (p.mejora) d.className = "win"; d.textContent = `#${f.s + 1} j=${p.j} umbral ${p.umbral} → ${p.costo_salida ?? "inválido"}${p.mejora ? " ✓" : ""} · ${p.llamadas} consultas`; $("log").prepend(d);
  } else {
    const e = p.etapas[f.k], [t, sub] = stageInfo(e.etapa), prev = f.k > 0 ? p.etapas[f.k - 1].amp : null;
    $("stT").textContent = t; $("stS").textContent = `Umbral ${p.umbral} · ${p.marcados} marcados · ${sub}`;
    setBars(e.amp, f.k === 0 ? null : marked, p.y, -1, e.etapa.startsWith("Difusión") && prev ? mean(prev) : null); $("meas").textContent = "";
  }
  drawStair(run, f.s); updStats(run, f.s);
}
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
  let g = ""; for (const c of [cmin, (cmin + cmax) / 2, cmax]) g += `<line x1="${pl}" x2="${W - 10}" y1="${Y(c)}" y2="${Y(c)}" stroke="var(--line)"/><text x="${pl - 6}" y="${Y(c) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${Math.round(c)}</text>`;
  g += `<line x1="${pl}" x2="${W - 10}" y1="${Y(cmin)}" y2="${Y(cmin)}" stroke="var(--qiskit)" stroke-dasharray="4 4"/><text x="${W - 12}" y="${Y(cmin) - 4}" text-anchor="end" font-size="9" fill="var(--qiskit)">óptimo ${cmin}</text>`;
  if (R.M <= tope) g += `<line x1="${X(R.M)}" x2="${X(R.M)}" y1="10" y2="${H - pb}" stroke="var(--otono)" stroke-dasharray="2 3"/><text x="${X(R.M) + 3}" y="20" font-size="9" fill="var(--otono-ink)">N! = ${R.M}</text>`;
  g += `<text x="${pl}" y="${H - 8}" font-size="9" fill="var(--muted)">0 consultas</text><text x="${W - 10}" y="${H - 8}" text-anchor="end" font-size="9" fill="var(--muted)">presupuesto ${tope}</text>`;
  if (s >= 0) { let d = `M${X(0)},${Y(run.pasos[0].umbral)}`;
    for (let k = 0; k <= s; k++) { const p = run.pasos[k]; d += ` L${X(p.llamadas)},${Y(p.umbral)} L${X(p.llamadas)},${Y(p.mejora ? p.costo_salida : p.umbral)}`; }
    g += `<path d="${d}" fill="none" stroke="var(--qiskit)" stroke-width="2.5"/>`;
    run.pasos.slice(0, s + 1).forEach(p => { if (p.mejora) g += `<circle cx="${X(p.llamadas)}" cy="${Y(p.costo_salida)}" r="4" fill="var(--otono)"/>`; }); }
  $("stair").innerHTML = g;
}
function updStats(run, s) {
  const p = s >= 0 ? run.pasos[s] : null, q = p ? p.llamadas : 0;
  $("sQ").textContent = q; $("sB").textContent = p ? (p.mejora ? p.costo_salida : p.umbral) : run.pasos[0].umbral; $("sP").textContent = p ? (p.p_marcados * 100).toFixed(0) + " %" : "—";
  $("budBar").style.width = Math.min(100, q / R.presupuesto * 100) + "%"; $("budNF").hidden = R.M > R.presupuesto; $("budNF").style.left = Math.min(100, R.M / R.presupuesto * 100) + "%";
  $("budTxt").textContent = `${q} de ${R.presupuesto} consultas del presupuesto · marca rosa = N! = ${R.M} (lo que revisa la fuerza bruta)${s === run.pasos.length - 1 ? ` · terminó con costo ${run.costo}${run.optimo ? " (óptimo ✓)" : ""}` : ""}`;
}
function next() { if (fi < frames.length - 1) { fi++; renderFrame(); return true; } stop(); return false; }
function play() { if (timer) return stop(); if (fi >= frames.length - 1) { fi = -1; $("log").innerHTML = ""; } $("play").textContent = "⏸ Pausa"; tick(); }
function tick() { if (!next()) return; const f = frames[fi]; timer = setTimeout(tick, (f.k === "m" ? 1100 : 800) * +$("speed").value * (R.runs[runIdx].pasos[0].etapas ? 1 : .3)); }
function stop() { clearTimeout(timer); timer = null; $("play").textContent = "▶ Reproducir"; }
$("play").onclick = play; $("stepB").onclick = () => { stop(); next(); }; $("restart").onclick = buildFrames; $("run").onchange = e => { runIdx = +e.target.value; buildFrames(); };

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
function renderCompare() {
  $("cmpIntro").textContent = Q ? `Referencia: ${Q.repeticiones} ejecuciones por tamaño con Qiskit ${Q.qiskit} (semilla ${Q.semilla}, versión honesta sin parada anticipada), generadas el ${Q.generado}.` : "Sin datos de referencia de Qiskit: ejecuta qiskit_grover.py.";
  if (Q) $("rtab").innerHTML = `<tr><th class="num">N</th><th class="num">Qubits</th><th class="num">N!</th><th class="num">Presupuesto</th><th class="num">Consultas</th><th class="num">Acierto</th><th class="num">t clásico</th><th class="num">t Grover simulado</th></tr>` +
    Object.values(Q.instancias).map(i => { const q = i.runs.map(r => r.consultas); return `<tr><td class="num">${i.n}</td><td class="num">${i.qubits}</td><td class="num">${i.M}</td><td class="num">${i.presupuesto}</td><td class="num"><b>${mean(q).toFixed(0)}</b> ± ${sd(q).toFixed(0)}</td><td class="num ok">${i.runs.filter(r => r.optimo).length}/${i.runs.length}</td><td class="num">${(i.clasico_s * 1000).toFixed(2)} ms</td><td class="num">${mean(i.runs.map(r => r.tiempo_s)).toFixed(2)} s</td></tr>`; }).join("");
  const W = 560, H = 300, pl = 54, pb = 34, ns = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], X = n => pl + (W - pl - 14) * (n - 3) / 11, Y = v => 12 + (H - pb - 12) * (1 - Math.log10(v) / 11);
  let g = ""; for (let e = 0; e <= 11; e++) g += `<line x1="${pl}" x2="${W - 14}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" stroke="var(--line)"/>${e % 2 ? "" : `<text x="${pl - 6}" y="${Y(10 ** e) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">10^${e}</text>`}`;
  ns.forEach(n => g += `<text x="${X(n)}" y="${H - 16}" text-anchor="middle" font-size="9" fill="var(--muted)">${n}</text>`);
  g += `<text x="${(pl + W) / 2}" y="${H - 3}" text-anchor="middle" font-size="9" fill="var(--muted)">N (brigadas y zonas)</text>`;
  const line = (f, c) => `<path d="M${ns.map(n => X(n) + "," + Y(f(n))).join(" L")}" fill="none" stroke="${c}" stroke-width="2.5"/>`;
  g += line(n => G.fact(n), "var(--bad)") + line(n => G.presupuesto(G.fact(n)), "var(--qiskit)");
  const cross = ns.find(n => G.presupuesto(G.fact(n)) < G.fact(n));
  g += `<line x1="${X(cross)}" x2="${X(cross)}" y1="12" y2="${H - pb}" stroke="var(--otono)" stroke-dasharray="4 4"/><text x="${X(cross) + 4}" y="24" font-size="10" fill="var(--ink)" font-weight="600">desde N = ${cross}, Grover consulta menos</text>`;
  if (Q) Object.values(Q.instancias).forEach(i => g += `<circle cx="${X(i.n)}" cy="${Y(mean(i.runs.map(r => r.consultas)))}" r="5" fill="var(--otono)" stroke="var(--surface)" stroke-width="1.5"/>`);
  if (R) g += `<rect x="${X(R.n) - 5}" y="${Y(mean(R.runs.map(r => r.consultas))) - 5}" width="10" height="10" fill="var(--ink)" transform="rotate(45 ${X(R.n)} ${Y(mean(R.runs.map(r => r.consultas)))})"/>`;
  $("logc").innerHTML = g;
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
$("foot").innerHTML = `<b>Q-Niño</b> · Equipo <b>Quantum Action</b>: Jefry Rojas (UNMSM), Sebastian Bimbi, Fabricio Ricapa (UTEC) y Luis Nuñez (UNI) · <a href="https://canva.link/wpcj3x5yovmqfao">Presentación</a> · <a href="https://github.com/GatitoFBI/IBM-QUAMTUM-HACKATON-PROTOTIPO">Repositorio</a> · Hackathon Qiskit Fall Fest 2026 (PUCP · Quantum Hub Perú · IEEE CS PUCP · NTT DATA). Grover Adaptive Search (Dürr y Høyer, 1996; Boyer, Brassard, Høyer y Tapp, 1998) con Qiskit${Q ? " " + Q.qiskit : ""} y NumPy. Datos de prueba y supuestos ilustrativos, no datos oficiales. Web hecha con ayuda de Claude Code. Código: qiskit_grover.py, api.py y js/grover.js.`;

/* ---------------- Navegación, motor y tema ---------------- */
function seg(id, opts, curv, cb) { const el = $(id); el.innerHTML = opts.map(n => `<button type="button" data-v="${n}" aria-pressed="${n === curv}">${n}</button>`).join(""); el.onclick = e => { const b = e.target.closest("button"); if (b) cb(+b.dataset.v); }; }
function show(v) { if (!document.getElementById("v-" + v)) v = "simulador"; document.querySelectorAll("#menu button").forEach(b => b.setAttribute("aria-selected", b.dataset.v === v)); document.querySelectorAll("section.view").forEach(s => s.hidden = s.id !== "v-" + v); stagger(`#v-${v} .card`, null); if (v === "simulador" && LM) setTimeout(() => { LM.invalidateSize(); drawMapReal.key = null; drawMap(); }, 60); if (v !== "animacion") stop(); try { history.replaceState(null, "", "#" + v); } catch {} window.scrollTo({ top: 0 }); }
$("menu").onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.v); };
function updEngine() { const el = $("engine"); el.classList.toggle("live", useBackend);
  $("engineTxt").textContent = useBackend ? `Qiskit ${backend.qiskit} en vivo · servidor local` : backend ? "Navegador (clic para usar Qiskit en vivo)" : Q ? `Navegador · referencia Qiskit ${Q.qiskit}` : "Navegador"; }
$("engine").onclick = () => { if (!backend) return toast("Para Qiskit en vivo: ejecuta python api.py y abre http://127.0.0.1:8000"); useBackend = !useBackend; updEngine(); };
$("theme").onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = d ? "light" : "dark"; mapTiles(); drawMap(); };
(async () => { try { const c = new AbortController(); setTimeout(() => c.abort(), 1500); const r = await fetch("api/salud", { signal: c.signal }); if (r.ok) { backend = await r.json(); useBackend = true; } } catch {} updEngine(); })();

renderExercises(); qCalc();
loadCase(CASOS.find(c => c.id === "q4") || CASOS[0], true);
show(location.hash.slice(1) || "simulador");
