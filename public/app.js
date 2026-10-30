const PHRASES = ["Oh my", "Alright", "Ask me why", "Technically speaking"];
const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());

let viewing = today();
let cache = store.get("cache", {}); // date -> {phrase: count}, last known server state + pending ops
let pending = store.get("pending", []); // ops not yet saved on the server
let flushing = false;

function counts(date) {
  return cache[date] || Object.fromEntries(PHRASES.map((p) => [p, 0]));
}

function build() {
  $("list").innerHTML = PHRASES.map((p, i) => `
    <section class="card" style="--accent: var(--c${i})">
      <button class="step minus" data-phrase="${p}" data-delta="-1" aria-label="Minus ${p}">−</button>
      <div class="mid"><div class="phrase">${p}</div><div class="count" data-count="${p}">0</div></div>
      <button class="step plus" data-phrase="${p}" data-delta="1" aria-label="Plus ${p}">+</button>
    </section>`).join("");
}

function render(bumped) {
  const c = counts(viewing);
  for (const p of PHRASES) {
    const el = document.querySelector(`[data-count="${p}"]`);
    el.textContent = c[p];
    document.querySelector(`[data-phrase="${p}"][data-delta="-1"]`).disabled = c[p] === 0;
    if (p === bumped) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  }
  $("total").textContent = PHRASES.reduce((s, p) => s + c[p], 0);

  const d = new Date(viewing + "T12:00");
  const diff = Math.round((new Date(today() + "T12:00") - d) / 864e5);
  $("label").textContent = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long" });
  $("date").textContent = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  $("next").disabled = diff <= 0;

  $("sync").textContent = pending.length ? `${pending.length} unsaved` : "Saved";
  $("sync").className = pending.length ? "pending" : "";
}

function applyLocal(op) {
  const c = { ...counts(op.date) };
  c[op.phrase] = Math.max(0, c[op.phrase] + op.delta);
  cache[op.date] = c;
}

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  const ops = pending.slice();
  try {
    const res = await fetch("api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    });
    if (!res.ok) throw new Error(res.status);
    const fresh = await res.json();
    pending = pending.slice(ops.length);
    Object.assign(cache, fresh);
    pending.forEach(applyLocal); // re-apply anything tapped while the request was in flight
    store.set("pending", pending);
    store.set("cache", cache);
  } catch {
    // stay queued; retried on next tap, focus, or reconnect
  } finally {
    flushing = false;
    render();
    if (pending.length && navigator.onLine) setTimeout(flush, 3000);
  }
}

async function load(date) {
  if (pending.some((op) => op.date === date)) return flush();
  try {
    const res = await fetch(`api/day/${date}`, { cache: "no-store" });
    if (!res.ok) return;
    cache[date] = await res.json();
    store.set("cache", cache);
    if (date === viewing) render();
  } catch {}
}

function shift(days) {
  const d = new Date(viewing + "T12:00");
  d.setDate(d.getDate() + days);
  viewing = iso(d);
  render();
  load(viewing);
}

$("list").addEventListener("click", (e) => {
  const btn = e.target.closest(".step");
  if (!btn || btn.disabled) return;
  const op = { date: viewing, phrase: btn.dataset.phrase, delta: Number(btn.dataset.delta) };
  if (op.delta < 0 && counts(viewing)[op.phrase] === 0) return;
  applyLocal(op);
  pending.push(op);
  store.set("pending", pending);
  store.set("cache", cache);
  navigator.vibrate?.(op.delta > 0 ? 12 : [6, 40, 6]);
  render(op.delta > 0 ? op.phrase : null);
  flush();
});

$("prev").onclick = () => shift(-1);
$("next").onclick = () => shift(1);

// Roll over to the new day if the app stays open past midnight.
let lastToday = today();
function refresh() {
  if (today() !== lastToday) {
    if (viewing === lastToday) viewing = today();
    lastToday = today();
  }
  render();
  flush();
  load(viewing);
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
window.addEventListener("online", flush);
setInterval(() => today() !== lastToday && refresh(), 60000);

build();
render();
load(viewing);
flush();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
