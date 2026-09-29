/* Season clip: every race of a year on one map, played on one race clock.
 *
 * All races start together at the gun; each track advances by real race time, so
 * they reach the finish in the order of their official times and the longest race
 * ends when the clip ends. Needs Leaflet (window.L) on the page.
 *
 *   SeasonClip.mount(element, data, { seconds: 30 })
 *
 * data comes from season_clip.py: { year, step, races: [{ name, date, type, time,
 * place, field, km, pts: [[lat, lon], ...] }] }, one point every `step` seconds.
 * Colours come from the host page's --road / --gravel / --mtb / --tempo tokens.
 */
(function () {
  const TYPE_VAR = { Road: "--road", Gravel: "--gravel", MTB: "--mtb", TT: "--tempo", TTT: "--tempo", Unknown: "--unknown" };
  const TYPE_FALLBACK = { Road: "#2a78d6", Gravel: "#eb6834", MTB: "#5b8a2e", TT: "#1baf7a", TTT: "#1baf7a", Unknown: "#8a8f99" };
  const TYPE_NAME = { Road: "Landevei", Gravel: "Grus", MTB: "Terreng", TT: "Tempo", TTT: "Lagtempo", Unknown: "Ukjent" };
  const WMS = "https://wms.geonorge.no/skwms1/wms.topograatone";
  const TERRAIN = /h(ø|o|oe)yde|kurve|terreng|relieff|skygge|dybde|contour|hillshade|elevation|terrain/i;
  /** Kartverket's grey topo map without contour lines or terrain: its leaf layers, minus those. "" if unavailable. */
  let plainPromise = null;
  const plainLayers = () => plainPromise || (plainPromise = fetch(`${WMS}?service=WMS&request=GetCapabilities&version=1.3.0`)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((xml) => {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      if (!xml.includes("EPSG:3857")) return "";
      const kid = (el, tag) => [...el.children].find((c) => c.localName === tag);
      const names = [...doc.getElementsByTagNameNS("*", "Layer")]
        .filter((l) => ![...l.children].some((c) => c.localName === "Layer"))
        .map((l) => [kid(l, "Name")?.textContent || "", kid(l, "Title")?.textContent || ""])
        .filter(([n, t]) => n && !TERRAIN.test(n) && !TERRAIN.test(t))
        .map(([n]) => n);
      return names.join(",");
    })
    .catch(() => ""));
  const LENGTHS = [15, 30, 60, 120];
  const FAR_KM = 150; // races this far from the season's centre get their own inset

  const css = `
.sc { display: grid; gap: 12px; font: inherit; color: var(--fg, #15181b); }
.sc-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.sc-btn { font: 600 .9rem/1 var(--body, system-ui); padding: 9px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--line, #e2e5e8); background: var(--panel, #fff); color: var(--fg, #15181b); }
.sc-btn.primary { background: var(--fg, #15181b); color: var(--bg, #fff); border-color: transparent; min-width: 92px; }
.sc-range { flex: 1 1 180px; accent-color: var(--fg, #15181b); }
.sc-len { font: 500 .9rem var(--body, system-ui); color: var(--fg-2, #50565c); display: inline-flex; gap: 6px; align-items: center; }
.sc-len select { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line, #e2e5e8);
  background: var(--panel, #fff); color: var(--fg, #15181b); }
.sc-body { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 12px; }
@media (max-width: 760px) { .sc-body { grid-template-columns: 1fr; } }
.sc-mapwrap { position: relative; border: 1px solid var(--line, #e2e5e8); border-radius: 8px; overflow: hidden;
  aspect-ratio: 4 / 3; min-height: 320px; background: var(--panel, #fff); }
.sc-map { position: absolute; inset: 0; }
.sc-map.leaflet-container { background: var(--grid, #eceef0); }
/* The map is only a backdrop for the coloured tracks: no colour at all, and a little faded. */
.sc-tiles { filter: grayscale(1) contrast(.85) brightness(1.05); }
.sc-tiles.sc-dark { filter: grayscale(1) invert(1) brightness(.8) contrast(.85); }
.sc-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 450; }
.sc-clock { position: absolute; top: 10px; left: 12px; z-index: 460; pointer-events: none;
  font: 700 2.4rem/1 var(--display, "Arial Narrow", sans-serif); font-variant-numeric: tabular-nums;
  color: var(--fg, #15181b); text-shadow: 0 0 6px var(--panel, #fff), 0 0 2px var(--panel, #fff); }
.sc-clock small { display: block; font: 600 .7rem/1.4 var(--body, system-ui); letter-spacing: .12em;
  text-transform: uppercase; color: var(--fg-2, #50565c); }
.sc-inset { position: absolute; right: 10px; bottom: 26px; z-index: 460; width: 150px; height: 150px;
  background: var(--panel, #fff); border: 1px solid var(--line, #e2e5e8); border-radius: 6px; box-shadow: 0 2px 10px rgb(0 0 0 / .12); }
.sc-inset canvas { width: 100%; height: 100%; display: block; }
.sc-inset span { position: absolute; left: 8px; top: 6px; font: 600 .7rem/1.2 var(--body, system-ui); color: var(--fg-2, #50565c); }
.sc-list { background: var(--panel, #fff); border: 1px solid var(--line, #e2e5e8); border-radius: 8px; padding: 10px 0; margin: 0;
  list-style: none; font-size: .88rem; font-variant-numeric: tabular-nums; align-self: start; }
.sc-list ol { list-style: none; margin: 0; padding: 0; }
.sc-list h3 { margin: 0 14px 6px; font: 600 .72rem/1.2 var(--body, system-ui); letter-spacing: .1em; text-transform: uppercase; color: var(--muted, #868c92); }
.sc-list li { display: grid; grid-template-columns: 22px 10px minmax(0, 1fr) auto; gap: 8px; align-items: center;
  padding: 4px 14px; color: var(--muted, #868c92); cursor: default; }
.sc-list li.done { color: var(--fg, #15181b); }
.sc-list li.on { background: var(--grid, #eceef0); }
.sc-list .n { text-align: right; color: var(--muted, #868c92); }
.sc-list .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-list .sw { width: 10px; height: 10px; border-radius: 50%; }
.sc-note { margin: 0; font-size: .85rem; color: var(--muted, #868c92); }
`;

  const hms = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function dark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function colour(el, type) {
    const v = getComputedStyle(el).getPropertyValue(TYPE_VAR[type] || "--road").trim();
    return v || TYPE_FALLBACK[type] || TYPE_FALLBACK.Road;
  }

  function km(a, b) { // equirectangular is plenty at this scale
    const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180), y = b[0] - a[0];
    return Math.hypot(x, y) * 111.2;
  }

  // Position `s` seconds after the gun: interpolated between the step-spaced points.
  function at(race, s, step) {
    const f = Math.min(s, race.time) / step, i = Math.floor(f), p = race.pts;
    if (i >= p.length - 1) return { i: p.length - 1, pos: p[p.length - 1] };
    const a = p[i], b = p[i + 1], k = f - i;
    return { i, pos: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] };
  }

  function mount(root, data, opts = {}) {
    if (!window.L) throw new Error("SeasonClip needs Leaflet on the page");
    if (!document.getElementById("sc-style")) {
      const st = document.createElement("style");
      st.id = "sc-style";
      st.textContent = css;
      document.head.append(st);
    }
    const step = data.step || 5;
    const races = data.races.filter((r) => r.pts && r.pts.length > 1);
    const end = Math.max(...races.map((r) => r.time));
    const byTime = [...races].sort((a, b) => a.time - b.time);

    // Races far from the rest (a trip north, say) go in an inset so the home region stays readable.
    const mids = races.map((r) => r.pts[Math.floor(r.pts.length / 2)]);
    const med = (k) => [...mids].map((m) => m[k]).sort((a, b) => a - b)[Math.floor(mids.length / 2)];
    const centre = [med(0), med(1)];
    const far = new Set(races.filter((r, i) => km(mids[i], centre) > FAR_KM));

    root.innerHTML = `
<div class="sc">
  <div class="sc-bar">
    <button class="sc-btn primary" data-k="play">Spill av</button>
    <button class="sc-btn" data-k="restart">Start på nytt</button>
    <input class="sc-range" data-k="scrub" type="range" min="0" max="${end}" step="1" value="0" aria-label="Rittid">
    <label class="sc-len">Klipp
      <select data-k="len">${LENGTHS.map((n) => `<option value="${n}">${n} s</option>`).join("")}</select></label>
  </div>
  <div class="sc-body">
    <div class="sc-mapwrap">
      <div class="sc-map"></div>
      <canvas class="sc-canvas"></canvas>
      <div class="sc-clock"><small>Rittid</small><span data-k="clock">0:00:00</span></div>
      ${[...far].map((r, i) => `<div class="sc-inset" style="bottom:${26 + i * 160}px" data-inset="${i}"><canvas></canvas><span>${esc(r.name)}</span></div>`).join("")}
    </div>
    <div class="sc-list"><h3>Målgang, ${data.year}</h3><ol>
      ${byTime.map((r) => `<li data-i="${races.indexOf(r)}" title="${esc(`${r.date} · ${TYPE_NAME[r.type] || r.type} · ${r.place}. av ${r.field}`)}">
        <span class="n"></span><span class="sw"></span><span class="nm">${esc(r.name)}</span><span>${hms(r.time)}</span></li>`).join("")}
    </ol></div>
  </div>
  ${data.skipped && data.skipped.length ? `<p class="sc-note">Uten GPS-spor: ${esc(data.skipped.join(", "))}.</p>` : ""}
</div>`;
    const $ = (k) => root.querySelector(`[data-k="${k}"]`);
    const wrap = root.querySelector(".sc-mapwrap");
    const canvas = root.querySelector(".sc-canvas");
    const ctx = canvas.getContext("2d");
    const items = [...root.querySelectorAll(".sc-list li")];
    const insets = [...root.querySelectorAll(".sc-inset canvas")];
    $("len").value = String(LENGTHS.includes(opts.seconds) ? opts.seconds : 30);

    const map = L.map(root.querySelector(".sc-map"), { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: "topright" }).addTo(map);
    // Kartverket's open maps (CC BY 4.0, no key). The backdrop should be plain: no contour lines or terrain, so
    // the visitor's browser reads the grey topo WMS's layer list and asks only for the layers without them.
    // Until that list is in, or if the WMS can't be used, the grey topo tile cache is shown instead.
    // In dark mode the tiles are inverted by the sc-dark class (CSS above).
    const attribution = '&copy; <a href="https://www.kartverket.no/">Kartverket</a> (CC BY 4.0)';
    let tiles, plain = "", errors = 0;
    const setTiles = () => {
      if (tiles) tiles.remove();
      const className = dark() ? "sc-tiles sc-dark" : "sc-tiles";
      tiles = plain
        ? L.tileLayer.wms(WMS, { layers: plain, format: "image/png", version: "1.3.0", maxZoom: 18, className, attribution })
        : L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png", { maxZoom: 18, className, attribution });
      tiles.on("tileerror", () => { if (plain && ++errors > 3) { plain = ""; setTiles(); } });
      tiles.addTo(map);
    };
    setTiles();
    plainLayers().then((names) => { if (names) { plain = names; setTiles(); } });
    const home = races.filter((r) => !far.has(r)).flatMap((r) => r.pts);
    map.fitBounds(L.latLngBounds(home.length ? home : races.flatMap((r) => r.pts)), { padding: [24, 24] });

    let colours = races.map((r) => colour(root, r.type));
    let t = 0, playing = false, last = 0, hover = -1;

    function size(cv) {
      const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [r.width, r.height, c];
    }

    function drawRace(c, r, idx, project, scale) {
      const { i, pos } = at(r, t, step);
      const done = t >= r.time, dim = hover >= 0 && hover !== idx;
      c.lineJoin = c.lineCap = "round";
      c.strokeStyle = colours[idx];
      c.globalAlpha = dim ? 0.06 : 0.2;
      c.lineWidth = 1.5 * scale;
      c.beginPath();
      r.pts.forEach((p, k) => { const [x, y] = project(p); k ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.globalAlpha = dim ? 0.15 : 0.95;
      c.lineWidth = 3 * scale;
      c.beginPath();
      for (let k = 0; k <= i; k++) { const [x, y] = project(r.pts[k]); k ? c.lineTo(x, y) : c.moveTo(x, y); }
      const [hx, hy] = project(pos);
      c.lineTo(hx, hy);
      c.stroke();
      c.globalAlpha = dim ? 0.3 : 1;
      c.beginPath();
      c.arc(hx, hy, (done ? 4 : 5.5) * scale, 0, Math.PI * 2);
      c.fillStyle = done ? getComputedStyle(root).getPropertyValue("--panel").trim() || "#fff" : colours[idx];
      c.fill();
      c.lineWidth = 2 * scale;
      c.strokeStyle = done ? colours[idx] : getComputedStyle(root).getPropertyValue("--panel").trim() || "#fff";
      c.stroke();
      c.globalAlpha = 1;
    }

    function draw() {
      const [w, h, c] = size(canvas);
      c.clearRect(0, 0, w, h);
      const project = (p) => { const q = map.latLngToContainerPoint(p); return [q.x, q.y]; };
      // Finished races underneath, the ones still racing on top.
      const order = races.map((r, k) => k).sort((a, b) => (t >= races[b].time) - (t >= races[a].time) || (a === hover) - (b === hover));
      order.forEach((k) => { if (!far.has(races[k])) drawRace(c, races[k], k, project, 1); });
      [...far].forEach((r, n) => {
        const [iw, ih, ic] = size(insets[n]);
        ic.clearRect(0, 0, iw, ih);
        const lats = r.pts.map((p) => p[0]), lons = r.pts.map((p) => p[1]);
        const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
        const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
        const sc = Math.min((iw - 24) / ((lo1 - lo0) * kx || 1e-6), (ih - 34) / ((la1 - la0) || 1e-6));
        const ox = (iw - (lo1 - lo0) * kx * sc) / 2, oy = 22 + (ih - 34 - (la1 - la0) * sc) / 2;
        drawRace(ic, r, races.indexOf(r), (p) => [ox + (p[1] - lo0) * kx * sc, oy + (la1 - p[0]) * sc], 0.8);
      });
      $("clock").textContent = hms(t);
      $("scrub").value = String(Math.round(t));
      let n = 0;
      items.forEach((li) => {
        const r = races[+li.dataset.i], done = t >= r.time;
        li.classList.toggle("done", done);
        li.classList.toggle("on", +li.dataset.i === hover);
        li.querySelector(".n").textContent = done ? `${++n}.` : "";
        li.querySelector(".sw").style.background = done ? colours[+li.dataset.i] : "transparent";
        li.querySelector(".sw").style.boxShadow = `inset 0 0 0 2px ${colours[+li.dataset.i]}`;
      });
    }

    function frame(now) {
      if (!playing) return;
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      t = Math.min(end, t + dt * (end / +$("len").value));
      draw();
      if (t >= end) return setPlaying(false);
      requestAnimationFrame(frame);
    }

    function setPlaying(on) {
      playing = on;
      $("play").textContent = on ? "Pause" : t >= end ? "Spill igjen" : "Spill av";
      if (on) { if (t >= end) t = 0; last = 0; requestAnimationFrame(frame); }
    }

    $("play").onclick = () => setPlaying(!playing);
    $("restart").onclick = () => { t = 0; draw(); setPlaying(true); };
    $("scrub").oninput = (e) => { t = +e.target.value; setPlaying(false); draw(); };
    items.forEach((li) => {
      li.onmouseenter = () => { hover = +li.dataset.i; draw(); };
      li.onmouseleave = () => { hover = -1; draw(); };
    });
    map.on("move zoom resize", draw);
    const ro = new ResizeObserver(() => { map.invalidateSize(); draw(); });
    ro.observe(wrap);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => { setTiles(); colours = races.map((r) => colour(root, r.type)); draw(); };
    mq.addEventListener("change", retheme);
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    draw();
    if (opts.autoplay) setPlaying(true);
    return {
      map,
      play: () => setPlaying(true), pause: () => setPlaying(false),
      seek: (s) => { t = Math.max(0, Math.min(end, s)); draw(); },
      destroy: () => { playing = false; ro.disconnect(); mo.disconnect(); mq.removeEventListener("change", retheme); map.remove(); root.innerHTML = ""; },
    };
  }

  window.SeasonClip = { mount };
})();
