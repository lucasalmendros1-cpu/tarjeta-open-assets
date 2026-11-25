(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  
  document.documentElement.classList.remove("no-js");

  /* ------------------------------------------------------------
   * Hero: entrance, video, sound, play/pause, scroll depth
   * ---------------------------------------------------------- */
  const hero = document.querySelector("[data-hero]");
  const video = document.querySelector("[data-hero-video]");
  const toggle = document.querySelector("[data-video-toggle]");
  const soundBtn = document.querySelector("[data-sound-toggle]");
  const soundLabel = document.querySelector("[data-sound-label]");

  // Paint the hidden state once, then play the entrance (timeout covers throttled rAF in background tabs).
  const markLoaded = () => document.body.classList.add("is-loaded");
  requestAnimationFrame(() => requestAnimationFrame(markLoaded));
  setTimeout(markLoaded, 120);

  if (hero && video && toggle && soundBtn) {
    const VOLUME = 0.8;
    let userPaused = false;
    let fadeRaf = 0;

    /* Preview + loading bar: the still (Figma) is on screen immediately; the bar follows
       what has been downloaded. When the browser can play the video through without
       stalling, the bar completes and the still cross-fades to the (muted) video. */
    const progressEl = document.querySelector("[data-video-progress]");
    let videoReady = false;
    const setProgress = (p) => {
      progressEl.style.setProperty("--p", p.toFixed(3));
      progressEl.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    };
    const updateProgress = () => {
      if (videoReady || !video.duration || !isFinite(video.duration)) return;
      let end = 0;
      for (let i = 0; i < video.buffered.length; i++) end = Math.max(end, video.buffered.end(i));
      setProgress(Math.min(0.97, end / video.duration));   // the last bit lands on "ready"
    };
    const markReady = () => {
      if (videoReady) return;
      videoReady = true;
      setProgress(1);
      // let the bar visibly reach the end, then cross-fade still → video
      setTimeout(() => {
        video.classList.add("is-ready");
        hero.classList.add("is-video-ready");
        progressEl.setAttribute("aria-hidden", "true");
      }, 280);
    };
    ["progress", "loadedmetadata", "durationchange"].forEach((ev) => video.addEventListener(ev, updateProgress));
    if (video.readyState >= 4) markReady();
    else video.addEventListener("canplaythrough", markReady, { once: true });
    video.addEventListener("error", () => { progressEl.style.opacity = "0"; });   // keep the still

    const setPaused = (paused) => {
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.setAttribute("aria-label", paused ? "Reproducir video" : "Pausar video");
    };

    const controls = soundBtn.closest(".hero__controls");
    const volume = document.querySelector("[data-volume]");
    let level = VOLUME;                      // the volume the user chose (kept while muted)

    const paintVolume = (v) => {
      volume.value = String(v);
      volume.style.setProperty("--v", `${Math.round(v * 100)}%`);
      volume.setAttribute("aria-valuetext", `${Math.round(v * 100)}%`);
    };
    const setSound = (on) => {
      soundBtn.setAttribute("aria-pressed", String(on));
      soundBtn.setAttribute("aria-label", on ? "Silenciar video" : "Activar sonido");
      soundLabel.textContent = on ? "Silenciar" : "Activar sonido";
      controls.classList.toggle("has-sound", on);   // the volume slider slides out next to the button
      volume.tabIndex = on ? 0 : -1;
    };
    paintVolume(level);
    volume.tabIndex = -1;

    // Ramp volume instead of snapping — avoids the audio "click" and feels gentler.
    const fadeVolume = (to, ms, done) => {
      cancelAnimationFrame(fadeRaf);
      const from = video.volume, t0 = performance.now();
      const step = (now) => {
        const p = clamp((now - t0) / ms);
        video.volume = from + (to - from) * p;
        if (p < 1) fadeRaf = requestAnimationFrame(step); else done && done();
      };
      fadeRaf = requestAnimationFrame(step);
    };

    if (reduceMotion.matches) {
      video.removeAttribute("autoplay");
      video.pause();
      userPaused = true;
      setPaused(true);
    }

    // Browsers only allow autoplay when muted; sound is one tap away.
    soundBtn.addEventListener("click", () => {
      if (video.muted) {
        if (level < 0.02) { level = VOLUME; paintVolume(level); }
        video.volume = 0;
        video.muted = false;
        if (video.paused) { userPaused = false; setPaused(false); video.play().catch(() => {}); }
        fadeVolume(level, 450);
        setSound(true);
      } else {
        fadeVolume(0, 180, () => { video.muted = true; });
        setSound(false);
      }
    });

    // Volume slider: follows the hand 1:1 (no easing while dragging).
    // Dragging to 0 mutes; dragging up from 0 un-mutes.
    volume.addEventListener("input", () => {
      cancelAnimationFrame(fadeRaf);
      level = parseFloat(volume.value);
      paintVolume(level);
      if (level < 0.02) {
        video.volume = 0;
        video.muted = true;
        setSound(false);
        return;
      }
      if (video.muted) { video.muted = false; setSound(true); }
      video.volume = level;
    });

    toggle.addEventListener("click", () => {
      userPaused = !video.paused;
      if (userPaused) video.pause(); else video.play().catch(() => {});
      setPaused(userPaused);
    });

    // Don't decode (or keep talking) when nobody can see the video.
    new IntersectionObserver(([entry]) => {
      if (userPaused) return;
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.15 }).observe(hero);
  }

  /* ------------------------------------------------------------
   * Site navbar (built in Webflow): give it the attribute data-nav.
   * The hero fills the viewport minus the navbar height, so the whole video fits on any
   * screen. If the navbar is fixed (overlays the page), the hero is also pushed below it.
   * ---------------------------------------------------------- */
  const nav = document.querySelector("[data-nav]");
  const root = document.documentElement.style;
  const setNavH = () => {
    if (!nav) return;
    const h = nav.offsetHeight;
    const pos = getComputedStyle(nav).position;
    root.setProperty("--nav-h", h + "px");
    root.setProperty("--nav-offset", pos === "fixed" || pos === "absolute" ? h + "px" : "0px");
  };
  setNavH();
  if (nav) new ResizeObserver(setNavH).observe(nav);

  /* ------------------------------------------------------------
   * Scroll + resize (single passive listener, rAF-throttled)
   * ---------------------------------------------------------- */
  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const y = window.scrollY;
      if (hero && !reduceMotion.matches) {
        const s = 1 - clamp(y / window.innerHeight) * 0.04;
        hero.style.setProperty("--hero-scale", s.toFixed(4));
      }
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

})();
