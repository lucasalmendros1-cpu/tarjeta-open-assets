/*
 * Orbit carousel — rendered image sequences (Blender / Cycles), driven by time + scroll.
 *
 * The cards were recreated in Blender from Referencias/motion_cards with the same
 * kind of light (soft window key through blinds, lilac room bounce, fill, rim),
 * an 85mm lens with light depth of field and real motion blur (render/build_scene.py).
 * Every card has its own height, lean, tip, facing and its own slow motion.
 *
 * Two sequences:
 *  - INTRO (108 frames @24fps): the orbit is dealt out like a train — cards appear one
 *    at a time at the same spot (front-right), growing 0 → 100%, and set off along the
 *    ring; each new one appears behind the previous. Ends on loop frame 0, at loop speed.
 *  - LOOP (480 frames, seamless): 180° of ring rotation. Played by a slow drift plus
 *    the page scroll (down = forward, up = back), so the cards move together (ring)
 *    and individually (their own motion) as you scroll.
 * Neighbouring frames are cross-faded so motion stays continuous at any speed.
 */
(() => {
"use strict";
const { gsap, ScrollTrigger } = window;
const orbitEl = document.querySelector("[data-orbit]");
if (!gsap || !ScrollTrigger || !orbitEl) return;

/* Where the frames live. In Webflow they are served from an external host (CDN), set on
   the canvas element:  <div data-orbit-canvas data-seq-base="https://cdn.example.com/seq/">
   The host must send  Access-Control-Allow-Origin  (frames are fetched, not <img>). */
const SEQ_BASE = (() => {
  const b = (document.querySelector("[data-orbit-canvas]") || {}).dataset?.seqBase || "assets/seq/";
  return b.endsWith("/") ? b : b + "/";
})();
gsap.registerPlugin(ScrollTrigger);

/* Phones get a lighter copy of the same frames (1000×500 in seq/m/): the canvas there is
   ~1000 device px wide anyway, and each frame costs ~2.5× less to download and decode. */
const SMALL = Math.min(window.innerWidth, (window.screen && window.screen.width) || Infinity) <= 820;
const SEQ_DIR = SMALL ? SEQ_BASE + "m/" : SEQ_BASE;
/* Phones also play every other frame (240 + 54) and cross-fade between them: half the
   download (the motion is complete much sooner on a fresh load) and half the decoding. */
const STEP = SMALL ? 2 : 1;
const name = (prefix, i) => `${SEQ_DIR}${prefix}${String(i * STEP).padStart(3, "0")}.webp`;
const LOOP = { count: 480 / STEP, src: (i) => name("f_", i) };
const INTRO = { count: 108 / STEP, src: (i) => name("intro_", i) };
const INTRO_FPS = 24 / STEP;
const DEG_PER_FRAME = 180 / LOOP.count;  // 0.375° per loop frame: ~24 real frames/s at the idle drift
const IDLE_SPEED = 9;      // deg/s (= 24 loop frames per second, same pace the intro ends on)
const SWEEP = 200;         // deg added while the section travels through the viewport
const FRAME_ASPECT = 2;    // rendered at 1600×800
const CONTENT_H = 0.70;    // share of the frame height the band maps to (lower = bigger cards)

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const section = orbitEl;
const pin = section.querySelector("[data-orbit-pin]");
const host = section.querySelector("[data-orbit-canvas]");
const title = section.querySelector("[data-orbit-title]");
const lead = section.querySelector("[data-orbit-lead]");
const sheen = title.querySelector(".text-gradient");

/* ---------------- Title: split "Crédito" into letters ---------------- */
const splitEl = title.querySelector("[data-split]");
splitEl.innerHTML = [...splitEl.textContent].map((c) => `<span class="ch">${c}</span>`).join("");
document.documentElement.classList.add("js-anim");

/* ---------------- Canvas ---------------- */
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
host.appendChild(canvas);
host.style.opacity = "0";

/* ---------------- Frames ---------------- */
// Frames are kept as compressed Blobs (~50 KB each). Decoding hundreds up front would
// hold gigabytes of bitmaps; instead a small window is decoded on demand (see below).
// Blobs (not <img>) because createImageBitmap(blob) decodes off the main thread in
// every browser, while createImageBitmap(img) can decode on the main thread.
for (const seq of [LOOP, INTRO]) { seq.imgs = new Array(seq.count).fill(null); seq.ready = new Uint8Array(seq.count); }
function queueFor(seq, steps) {
  const order = [], seen = new Set();
  for (const step of steps) for (let i = 0; i < seq.count; i += step) if (!seen.has(i)) { seen.add(i); order.push([seq, i]); }
  return order;
}
let loadingStarted = false;
function startLoading() {
  if (loadingStarted) return;
  loadingStarted = true;
  // intro first (it plays first, in order), then the loop coarse → fine
  const queue = [...queueFor(INTRO, [1]), ...queueFor(LOOP, [32, 16, 8, 4, 2, 1])];
  let inFlight = 0;
  const next = () => {
    while (inFlight < 6 && queue.length) {
      const [seq, i] = queue.shift();
      inFlight++;
      fetch(seq.src(i))
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((blob) => { seq.imgs[i] = blob; seq.ready[i] = 1; dirty = true; pump(); })
        .catch(() => {})
        .finally(() => { inFlight--; next(); });
    }
  };
  next();
}
const introReady = () => INTRO.ready.every(Boolean);

/* ---------------- Layout: cards just step on "Crédito", above the lead ----------------
 * Performance: the canvas covers only the frame (not the whole viewport) and its
 * backing store never exceeds the render's own resolution (1600 px wide) — on a
 * Retina screen a 2× canvas would push ~4× the pixels for zero extra detail. */
const SRC_W = SMALL ? 1000 : 1600;
let rect = { x: 0, y: 0, w: 0, h: 0 }, bw = 0, bh = 0;   // bw/bh: backing size in px
/* Portrait screens: the cards are limited by the width, so with the title at the top and
   the lead at the bottom of a tall screen there was empty space around them. There the
   group is centred and the lead sits just as far below the title as the cards need. */
const MAX_W = 1.25;                     // the frame may be this much wider than the screen
let overTop = 0, overBottom = 0;        // how far the card band reaches over the title / towards the lead
function fitGap(w, h) {
  if (window.innerHeight <= window.innerWidth) {
    pin.classList.remove("is-compact"); lead.style.marginTop = "";
    overTop = h * 0.1; overBottom = h * 0.015;
    return;
  }
  pin.classList.add("is-compact");
  const band = (w * MAX_W / FRAME_ASPECT) * CONTENT_H;   // card band height at full width
  overTop = band * 0.12; overBottom = band * 0.14;       // the cards just step on "Crédito", air above the lead
  lead.style.marginTop = Math.max(24, Math.round(band - overTop + overBottom)) + "px";
}
function layout() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  fitGap(w, h);
  const pr = pin.getBoundingClientRect();
  const top = title.getBoundingClientRect().bottom - pr.top - overTop;
  const bottom = lead.getBoundingClientRect().top - pr.top - overBottom;
  let fh = Math.max(160, bottom - top) / CONTENT_H;
  let fw = fh * FRAME_ASPECT;
  if (fw > w * MAX_W) { fw = w * MAX_W; fh = fw / FRAME_ASPECT; }   // the frame has empty margins at the sides
  rect = { x: (w - fw) / 2, y: (top + bottom) / 2 - fh / 2, w: fw, h: fh };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(dpr, SRC_W / fw);              // device px per css px, capped at the source
  const nbw = Math.round(fw * scale), nbh = Math.round(fh * scale);
  Object.assign(canvas.style, {
    position: "absolute", left: rect.x + "px", top: rect.y + "px",
    width: fw + "px", height: fh + "px",
  });
  if (nbw !== bw || nbh !== bh) {
    bw = nbw; bh = nbh;
    canvas.width = bw; canvas.height = bh;
    ctx.imageSmoothingQuality = "high";
    flushBitmaps();                                    // decoded sizes depend on the backing size
  }
  dirty = true;
}

/* ---------------- Decoding off the main thread ----------------
 * drawImage() on a compressed image decodes it synchronously on the main thread
 * (10–20 ms per 1600×800 WebP on a laptop) — twice per refresh with the cross-fade.
 * Instead, frames around the play head are decoded ahead of time with
 * createImageBitmap (off-thread), already at the exact size they are drawn, and
 * kept in a small cache (~24 frames). Drawing a bitmap is a plain GPU blit. */
const BMP_CAP = 40, AHEAD = 14, FAR = 40, BEHIND = 5, MAX_DECODES = 4;
const bmps = new Map();          // key -> ImageBitmap
const decodingKeys = new Set();
let wanted = [];                 // [seq, i] in priority order
const keyOf = (seq, i) => (seq === LOOP ? "l" : "i") + i;
let resizeOK = true;

function flushBitmaps() {
  for (const b of bmps.values()) b.close && b.close();
  bmps.clear();
}
function want(seq, base, dir, wrap) {
  const list = [];
  const push = (i) => {
    if (wrap) i = ((i % seq.count) + seq.count) % seq.count;
    else if (i < 0 || i >= seq.count) return;
    list.push([seq, i]);
  };
  // dense right ahead, then every other frame further out: when the scroll runs fast
  // the play head lands on something already decoded instead of decoding on the spot
  push(base); push(base + dir);
  for (let d = 2; d <= AHEAD; d++) push(base + dir * d);
  for (let d = 1; d <= BEHIND; d++) push(base - dir * d);
  for (let d = AHEAD + 2; d <= FAR; d += 2) push(base + dir * d);
  // near the end of the intro, warm up the loop frames it hands over to
  if (seq === INTRO && base + AHEAD >= INTRO.count) {
    for (let j = 0; j <= base + AHEAD - INTRO.count + 1; j++) list.push([LOOP, j]);
  }
  wanted = list;
  pump();
}
function pump() {
  if (!bw) return;
  for (const [seq, i] of wanted) {
    if (decodingKeys.size >= MAX_DECODES) break;
    const k = keyOf(seq, i);
    if (bmps.has(k) || decodingKeys.has(k) || !seq.ready[i]) continue;
    decodingKeys.add(k);
    const w0 = bw, h0 = bh;
    const opts = resizeOK ? { resizeWidth: bw, resizeHeight: bh, resizeQuality: "high" } : undefined;
    createImageBitmap(seq.imgs[i], opts)
      .catch(() => { resizeOK = false; return createImageBitmap(seq.imgs[i]); })
      .then((b) => {
        decodingKeys.delete(k);
        if (w0 !== bw || h0 !== bh) { b.close && b.close(); return pump(); }   // layout changed meanwhile
        bmps.set(k, b);
        evict();
        dirty = true;
        pump();
      })
      .catch(() => { decodingKeys.delete(k); });
  }
}
function evict() {
  if (bmps.size <= BMP_CAP) return;
  const keep = new Set(wanted.map(([s, i]) => keyOf(s, i)));
  for (const [k, b] of bmps) {
    if (bmps.size <= BMP_CAP) break;
    if (!keep.has(k)) { b.close && b.close(); bmps.delete(k); }
  }
}
// Best drawable for frame i: its bitmap, else the closest decoded bitmap of the same
// sequence (a frame or two off is invisible in motion — a 100 ms decode stall is not).
function source(seq, i, wrap) {
  const b = bmps.get(keyOf(seq, i));
  if (b) return { src: b, exact: true };
  let best = null, bestD = Infinity;
  const prefix = seq === LOOP ? "l" : "i";
  for (const [k, bm] of bmps) {
    if (k[0] !== prefix) continue;
    let d = Math.abs(+k.slice(1) - i);
    if (wrap) d = Math.min(d, seq.count - d);
    if (d < bestD) { bestD = d; best = bm; }
  }
  return best ? { src: best, exact: false } : null;   // nothing decoded yet: keep the canvas as is
}

/* ---------------- Drawing ---------------- */
let lastBase = -1, lastDir = 1;
function draw(seq, frameF, wrap) {
  const base = Math.floor(frameF);
  const frac = frameF - base;
  if (base !== lastBase) {
    if (lastBase >= 0) {
      let d = base - lastBase;
      if (wrap && Math.abs(d) > seq.count / 2) d -= Math.sign(d) * seq.count;
      if (d) lastDir = Math.sign(d);
    }
    lastBase = base;
    want(seq, base, lastDir, wrap);
  }
  const A = source(seq, base, wrap);
  if (!A) return;
  ctx.clearRect(0, 0, bw, bh);
  const n = wrap ? (base + 1) % seq.count : Math.min(base + 1, seq.count - 1);
  const B = n !== base && frac > 0.001 && A.exact ? bmps.get(keyOf(seq, n)) : null;
  if (B) {
    // True cross-fade: A·(1−f) + B·f. Additive ('lighter') on the premultiplied
    // canvas keeps colour and alpha linear, so nothing pops when f wraps to 0.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1 - frac;
    ctx.drawImage(A.src, 0, 0, bw, bh);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = frac;
    ctx.drawImage(B, 0, 0, bw, bh);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalAlpha = 1;
    ctx.drawImage(A.src, 0, 0, bw, bh);
  }
}

/* ---------------- Motion ---------------- */
// mode: "hidden" → "intro" → "loop"
const state = { mode: "hidden", introStart: 0, idle: 0, scroll: 0, scrollTarget: 0 };
let dirty = true, lastKey = "";

function frame(now, dt) {
  state.scroll += (state.scrollTarget - state.scroll) * (1 - Math.exp(-dt * 3.5));

  if (state.mode === "intro") {
    const f = ((now - state.introStart) / 1000) * INTRO_FPS;
    if (f >= INTRO.count - 1) {
      // hand-off: the intro's last frame is loop frame 0 — start the loop exactly there
      state.mode = "loop";
      state.idle = -state.scroll;
      lastBase = -1;
    } else {
      const key = "i" + f.toFixed(3);
      if (dirty || key !== lastKey) { draw(INTRO, f, false); lastKey = key; dirty = false; }
      return;
    }
  }
  if (state.mode !== "loop") return;
  if (!reduce) state.idle -= IDLE_SPEED * dt;
  const angle = state.idle + state.scroll;
  const f = ((((-angle) / DEG_PER_FRAME) % LOOP.count) + LOOP.count) % LOOP.count;
  const key = "l" + f.toFixed(3);
  if (dirty || key !== lastKey) { draw(LOOP, f, true); lastKey = key; dirty = false; }
}

let running = false, last = 0;
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.064, (now - last) / 1000);
  last = now;
  frame(now, dt);
  requestAnimationFrame(loop);
}
function startLoop() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(loop); }
function stopLoop() { running = false; }

// Start fetching well before the section is reached, but not while the hero video is still
// downloading: the section sits right under the hero, and ~600 frame requests competing
// with the video made the first screen slow. Wait for the video (or a scroll, or 6 s).
let heroSettled = false, nearSection = false;
const settle = () => { if (heroSettled) return; heroSettled = true; if (nearSection) startLoading(); };
const heroVideo = document.querySelector("[data-hero-video]");
if (!heroVideo || heroVideo.readyState >= 4) heroSettled = true;
else {
  heroVideo.addEventListener("canplaythrough", settle, { once: true });
  heroVideo.addEventListener("error", settle, { once: true });
  setTimeout(settle, 6000);
  const onScroll = () => { if (window.scrollY > window.innerHeight * 0.25) { window.removeEventListener("scroll", onScroll); settle(); } };
  window.addEventListener("scroll", onScroll, { passive: true });
}
new IntersectionObserver(([e]) => { nearSection = e.isIntersecting; if (nearSection && heroSettled) startLoading(); }, { rootMargin: "200% 0px" }).observe(section);
// render only while visible
new IntersectionObserver(([e]) => { e.isIntersecting ? startLoop() : stopLoop(); }, { rootMargin: "10% 0px" }).observe(section);

/* ---------------- GSAP: pin, scroll rotation, entrance ---------------- */
// The section sticks for one extra viewport: title, cards and lead stay together.
ScrollTrigger.create({ trigger: section, start: "top top", end: "+=100%", pin: pin, pinSpacing: true, anticipatePin: 1 });

// Rotation follows the whole journey through the section (incl. the pinned part).
ScrollTrigger.create({
  trigger: section, start: "top bottom", end: "bottom top",
  onUpdate: (self) => {
    if (reduce) return;
    state.scrollTarget = -(self.progress - 0.5) * SWEEP;
    sheen.style.setProperty("--sheen", `${self.progress * 100}%`);
  },
});

// Entrance: the rendered intro does the work (cards scale in one by one, forming the orbit).
let introWait = 0;
function enterCards() {
  gsap.killTweensOf(host);
  clearTimeout(introWait);
  if (reduce) {
    state.mode = "loop"; state.idle = -state.scroll; dirty = true;
    gsap.to(host, { opacity: 1, duration: 0.6, ease: "power1.out" });
    return;
  }
  gsap.set(host, { opacity: 1, y: 0 });
  const begin = () => { state.mode = "intro"; state.introStart = performance.now(); lastBase = -1; dirty = true; };
  lastBase = -1; want(INTRO, 0, 1, false);          // start decoding the first intro frames right away
  if (introReady()) return begin();
  // intro still downloading: wait for it (briefly), otherwise fall back to the loop with a fade
  const t0 = performance.now();
  const poll = () => {
    if (introReady()) return begin();
    if (performance.now() - t0 > 2500) {
      state.mode = "loop"; state.idle = -state.scroll; dirty = true;
      gsap.fromTo(host, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power2.out" });
      return;
    }
    introWait = setTimeout(poll, 80);
  };
  gsap.set(host, { opacity: 0 });
  poll();
}
function exitCards() {
  clearTimeout(introWait);
  gsap.killTweensOf(host);
  gsap.to(host, {
    opacity: 0, y: 16, duration: 0.45, ease: "power2.out",       // exits are quicker
    onComplete: () => { state.mode = "hidden"; },                 // coming back replays the intro
  });
}
ScrollTrigger.create({
  trigger: section, start: "top 55%",
  onEnter: () => { startLoading(); startLoop(); enterCards(); },
  onLeaveBack: exitCards,
});

function playTitle() {
  const tl = gsap.timeline();
  const words = title.querySelectorAll(".wi:not([data-split])");
  const chars = title.querySelectorAll(".ch");
  if (reduce) {
    tl.to([...title.querySelectorAll(".wi"), lead], { opacity: 1, duration: 0.6, ease: "power1.out" });
    return;
  }
  gsap.set(splitEl, { opacity: 1 });
  tl.fromTo(words,
    { yPercent: 105, opacity: 0, rotate: 3 },
    { yPercent: 0, opacity: 1, rotate: 0, duration: 1.2, ease: "power4.out", stagger: 0.09 }, 0)
    // "Crédito" arrives letter by letter, out of a soft blur
    .fromTo(chars,
      { yPercent: 110, opacity: 0, filter: "blur(10px)" },
      { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: 1.1, ease: "power4.out", stagger: 0.04 }, 0.22)
    .fromTo(lead, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: "power3.out" }, 0.9);
}
ScrollTrigger.create({ trigger: section, start: "top 70%", once: true, onEnter: playTitle });

/* ---------------- Resize / fonts ---------------- */
new ResizeObserver(layout).observe(host);
document.fonts && document.fonts.ready.then(() => { layout(); ScrollTrigger.refresh(); });
ScrollTrigger.addEventListener("refresh", layout);
layout();
})();
