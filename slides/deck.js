const S = [...document.querySelectorAll(".slide")], deck = document.getElementById("deck");
const isPitch = document.body.dataset.presentation === "pitch";
const stage = document.getElementById("stage");
const video = document.getElementById("pitchVideo");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let cur = 0, t0 = null;

// Escala el lienzo de 1600×900 a la ventana
function fit() {
  const width = isPitch ? stage.clientWidth : innerWidth;
  const height = isPitch ? stage.clientHeight : innerHeight;
  const k = Math.min(width / 1600, height / 900);
  deck.style.transform = `translate(-50%, -50%) scale(${k})`;
}
addEventListener("resize", fit); fit();

if (isPitch) {
  const hud = document.getElementById("hud");
  hud.setAttribute("role", "navigation");
  hud.setAttribute("aria-label", "Diapositivas del pitch");
  const position = document.createElement("span");
  position.id = "position";
  position.setAttribute("role", "status");
  position.setAttribute("aria-live", "polite");
  position.setAttribute("aria-atomic", "true");
  document.getElementById("bNext").after(position);
  document.getElementById("bPrev").setAttribute("aria-label", "Diapositiva anterior");
  document.getElementById("bNext").setAttribute("aria-label", "Diapositiva siguiente");
  document.getElementById("bNotes").setAttribute("aria-controls", "notes");
  document.getElementById("bNotes").setAttribute("aria-expanded", "false");
  S.forEach((slide, i) => {
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "diapositiva");
    if (!slide.hasAttribute("aria-label")) slide.setAttribute("aria-label", `${i + 1} de ${S.length}`);
    // Number the combined deck without altering its source content.
    const number = slide.querySelector(".foot b");
    if (number) number.textContent = `${String(i + 1).padStart(2, "0")} / ${String(S.length).padStart(2, "0")}`;
  });
  video.addEventListener("error", () => { document.getElementById("videoError").hidden = false; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) video.pause(); });
  addEventListener("pagehide", () => video.pause());
}

// Partículas y lluvia (decorativas)
document.querySelectorAll(".dots").forEach(d => { for (let i = 0; i < 26; i++) { const e = document.createElement("i"); e.style.left = Math.random() * 100 + "%"; e.style.top = 40 + Math.random() * 60 + "%"; e.style.animationDelay = -Math.random() * 9 + "s"; e.style.animationDuration = 7 + Math.random() * 6 + "s"; d.appendChild(e); } });
document.querySelectorAll(".rain").forEach(r => { for (let i = 0; i < 40; i++) { const e = document.createElement("i"); e.style.left = Math.random() * 100 + "%"; e.style.animationDelay = -Math.random() * 1.1 + "s"; e.style.animationDuration = .8 + Math.random() * .6 + "s"; r.appendChild(e); } });

// Contadores
const fmt = (v, dec) => { const [i, d] = v.toFixed(dec).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d ? "," + d : ""); };   // 1.857,7
function counters(sl) {
  sl.querySelectorAll("[data-count]").forEach(el => {
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0), wait = +(el.dataset.delay || 900), dur = 1300;
    if (isPitch && reducedMotion.matches) { el.textContent = fmt(to, dec); return; }
    el.textContent = fmt(0, dec); clearTimeout(el._t);
    el._t = setTimeout(() => { const s = performance.now(); const step = now => { const k = Math.min(1, Math.max(0, (now - s) / dur)), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e, dec); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, wait);
  });
}

// Ciclo del diagrama de Grover: la etapa activa recorre el bucle
let pipeTimer = null, pipeDelay = null;
function pipe(on) {
  clearTimeout(pipeDelay);
  clearInterval(pipeTimer); const st = [...document.querySelectorAll("#pipe .st")]; st.forEach(s => s.classList.remove("hot"));
  if (!on || (isPitch && reducedMotion.matches)) return; let i = 0;
  pipeDelay = setTimeout(() => { pipeTimer = setInterval(() => { st.forEach(s => s.classList.remove("hot")); st[i % st.length].classList.add("hot"); i++; }, 1100); }, 1600);
}

function go(n) {
  n = Math.max(0, Math.min(S.length - 1, n));
  if (isPitch) {
    if (n === cur && S[n].classList.contains("on")) return;
    if (n !== 1) video.pause();
    if (n !== cur && S[cur].contains(document.activeElement)) {
      document.getElementById(n > cur ? "bNext" : "bPrev").focus();
    }
    S.forEach((slide, i) => {
      slide.inert = i !== n;
      slide.setAttribute("aria-hidden", String(i !== n));
    });
    document.getElementById("bPrev").disabled = n === 0;
    document.getElementById("bNext").disabled = n === S.length - 1;
    const position = document.getElementById("position");
    position.textContent = `${n + 1} / ${S.length}`;
    position.setAttribute("aria-label", `Diapositiva ${n + 1} de ${S.length}`);
  }
  S.forEach((s, i) => { if (i !== n) s.classList.remove("on"); });
  const s = S[n]; s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");   // reinicia las entradas
  cur = n; counters(s); pipe(!!s.querySelector("#pipe"));
  document.getElementById("bar").style.width = ((n + 1) / S.length * 100) + "%";
  document.getElementById("nSlide").textContent = `Diapositiva ${n + 1} / ${S.length}`;
  document.getElementById("nText").replaceChildren(...s.dataset.notes.split("\n").map(text => {
    const p = document.createElement("p"); p.textContent = text; return p;
  }));
  history.replaceState(null, "", "#" + (n + 1));
}
const next = () => go(cur + 1), prev = () => go(cur - 1);
addEventListener("keydown", e => {
  if (isPitch) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (e.target.closest('video, input, textarea, select, [contenteditable="true"]')) return;
    if ([" ", "Enter"].includes(e.key) && e.target.closest('button, a, [role="button"]')) return;
    if (e.key === "Escape" && !document.getElementById("notes").hidden) { notes(); return; }
  }
  if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
  else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === "Home") { e.preventDefault(); go(0); }
  else if (e.key === "End") { e.preventDefault(); go(S.length - 1); }
  else if (e.key.toLowerCase() === "f") full();
  else if (e.key.toLowerCase() === "n") notes();
});
stage.addEventListener("click", e => { if (isPitch || e.target.closest("a")) return; (e.clientX < innerWidth * .25 ? prev : next)(); });
function full() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); }
function notes() {
  const n = document.getElementById("notes"); n.hidden = !n.hidden;
  if (isPitch) document.getElementById("bNotes").setAttribute("aria-expanded", String(!n.hidden));
  if (!t0) t0 = Date.now();
}
document.getElementById("bPrev").onclick = prev; document.getElementById("bNext").onclick = next;
document.getElementById("bNotes").onclick = notes; document.getElementById("bFull").onclick = full;
setInterval(() => { if (!t0) return; const s = Math.floor((Date.now() - t0) / 1000); document.getElementById("nTime").textContent = `${String(s / 60 | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")} / 04:00`; }, 500);
setTimeout(() => document.getElementById("help").style.opacity = 0, 6000);
go(isPitch ? 0 : (parseInt(location.hash.slice(1)) || 1) - 1);
