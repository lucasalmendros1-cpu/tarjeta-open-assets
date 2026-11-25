/*
 * Smooth scrolling for the whole page (Lenis), driven by GSAP's ticker so
 * ScrollTrigger (pins, the card sequence, the title) reads the same smoothed
 * position on the same frame — no jitter between the page and the animations.
 *
 * - Wheel / trackpad: eased with inertia. Touch keeps the native feel (phones
 *   already scroll smoothly, and hijacking touch feels wrong).
 * - In-page links (#tarjeta) glide to their target.
 * - prefers-reduced-motion: native scrolling, untouched.
 */
(() => {
  "use strict";
  const { gsap, ScrollTrigger, Lenis } = window;
  if (!Lenis || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({
    lerp: 0.085,            // how much of the remaining distance is covered per frame: soft, not floaty
    wheelMultiplier: 0.9,
    smoothWheel: true,
    syncTouch: false,
  });
  window.lenis = lenis;

  // start at the very top on every load/reload
  ScrollTrigger.clearScrollMemory("manual");
  window.scrollTo(0, 0);
  lenis.scrollTo(0, { immediate: true, force: true });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);   // keep the scroll and the ticker in lockstep

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();   // in Webflow, keep webflow.js from also animating the same jump
    lenis.scrollTo(target, { duration: 1.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
  }, true);
})();
