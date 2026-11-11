// ==UserScript==
// @name         Instagram Focus – No Reels, No Endless Scroll
// @namespace    instagram-focus
// @version      1.5
// @description  Hides Reels and the Explore grid (keeps Search), shows 10 feed posts per load, caps feed time at 10 min with a 20 min cooldown, and removes "open in app" banners.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
 
(function () {
  "use strict";
 
  // ---- Settings -----------------------------------------------------------
  const MAX_FEED_POSTS = 10;   // posts per page load (refresh for 10 more)
  const FEED_MINUTES = 10;     // total time allowed on the feed...
  const COOLDOWN_MINUTES = 20; // ...then the feed is locked for this long
  const SHOW_BADGE = true;     // small "Focus on" badge at the top (no timer shown)
  // -------------------------------------------------------------------------
 
  // Feed timer, saved in Safari so reloading doesn't reset it
  const KEY_USED = "igf_used_ms";
  const KEY_LOCK = "igf_lock_until";
  function load(key) {
    try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (e) {}
  }
  const seen = new Set(); // posts shown since this page load
  let usedMs = load(KEY_USED);
  let lockUntil = load(KEY_LOCK);
 
  function isLocked() {
    if (lockUntil && Date.now() >= lockUntil) {
      // Cooldown finished: start a fresh 10 minutes
      lockUntil = 0; usedMs = 0;
      save(KEY_LOCK, 0); save(KEY_USED, 0);
      seen.clear();
      const old = document.getElementById("ig-focus-lock");
      if (old) old.remove();
    }
    return lockUntil > Date.now();
  }
 
  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
 
  // Count time only while the home feed is open and on screen
  setInterval(() => {
    if (isLocked()) { updateBadge(); return; }
    if (location.pathname === "/" && document.visibilityState === "visible") {
      usedMs = load(KEY_USED) + 1000; // re-read in case another tab added time
      save(KEY_USED, usedMs);
      if (usedMs >= FEED_MINUTES * 60000) {
        lockUntil = Date.now() + COOLDOWN_MINUTES * 60000;
        save(KEY_LOCK, lockUntil);
      }
    }
    if (location.pathname === "/") limitFeed(); // apply lock / unlock right away
    updateBadge();
  }, 1000);
 
  const SEARCH_PATH = "/explore/search/";
 
  // 1) Redirects: Reels -> home, Explore grid -> Search page
  function checkPath() {
    const p = location.pathname;
    if (/^\/reels?\//.test(p)) {
      location.replace("https://www.instagram.com/");
    } else if (/^\/explore\/?$/.test(p)) {
      location.replace("https://www.instagram.com" + SEARCH_PATH);
    }
    // /explore/search/, /explore/tags/..., /explore/locations/... stay allowed
  }
 
  // Instagram is a single-page app, so watch in-app navigation too
  ["pushState", "replaceState"].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      checkPath();
      return r;
    };
  });
  window.addEventListener("popstate", checkPath);
  checkPath();
 
  // 2) CSS
  const css = `
    a[href="/reels/"], a[href^="/reels/"],
    article:has(a[href*="/reel/"]) { display: none !important; }
 
    /* Search page: hide any Reels/Explore grid shown under the search box */
    body.igf-search main a[href^="/reel/"],
    body.igf-search main a[href^="/p/"] { display: none !important; }
 
    #ig-focus-stop, #ig-focus-lock {
      margin: 32px 16px; padding: 24px; border-radius: 16px;
      text-align: center; font: 600 17px -apple-system, system-ui, sans-serif;
      background: #f2f2f7; color: #111;
    }
    #ig-focus-stop small, #ig-focus-lock small { display:block; margin-top:8px; font-weight:400; color:#666; }
    #ig-focus-lock .igf-time { display:block; margin-top:12px; font-size:32px; font-variant-numeric: tabular-nums; }
    @media (prefers-color-scheme: dark) {
      #ig-focus-stop, #ig-focus-lock { background:#1c1c1e; color:#eee; }
      #ig-focus-stop small, #ig-focus-lock small { color:#999; }
    }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  (function addStyle() {
    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
    else setTimeout(addStyle, 10);
  })();
 
  // 3) Remove Safari's own "Open in the Instagram app" banner tag as early as possible
  function removeSmartBanner() {
    document.querySelectorAll('meta[name="apple-itunes-app"]').forEach((m) => m.remove());
  }
  removeSmartBanner();
 
  // 4) Make the Search / Explore button go straight to Search
  function fixSearchButton() {
    document.querySelectorAll('a[href="/explore/"]').forEach((a) => {
      a.setAttribute("href", SEARCH_PATH);
    });
    document.querySelectorAll("svg[aria-label]").forEach((svg) => {
      const label = svg.getAttribute("aria-label");
      if (label === "Reels" || label === "Reel") {
        const el = svg.closest("a, [role='link'], [role='button']");
        if (el) el.style.display = "none";
      }
    });
  }
  // Catch taps on any remaining Explore link and send them to Search
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest && e.target.closest('a[href="/explore/"]');
      if (a) {
        e.preventDefault();
        e.stopPropagation();
        location.href = SEARCH_PATH;
      }
    },
    true
  );
 
  // 5) Hide "Open app" / "Use the app" banners and pop-ups
  const APP_TEXT = /^(open( in)?( the)? app|open instagram|use the app|get the app|switch to the app)$/i;
  const APP_HREF = /apps\.apple\.com|itunes\.apple\.com|^instagram:\/\/|applink|\/download\//i;
 
  function bannerContainer(el) {
    // Walk up to the fixed/sticky bar that holds the button, if there is one
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      const pos = getComputedStyle(node).position;
      if (pos === "fixed" || pos === "sticky") return node;
      node = node.parentElement;
    }
    return el;
  }
 
  function hideAppBanners() {
    // Buttons and links that push the app
    document.querySelectorAll("a, button, [role='button']").forEach((el) => {
      if (el.dataset.igfChecked) return;
      el.dataset.igfChecked = "1";
      const text = (el.textContent || "").trim();
      const href = el.getAttribute("href") || "";
      if (APP_HREF.test(href) || (text.length < 30 && APP_TEXT.test(text))) {
        bannerContainer(el).style.display = "none";
      }
    });
 
    // Pop-ups like "See more in the app": tap "Not now" for you
    document.querySelectorAll("[role='dialog']").forEach((dlg) => {
      const t = (dlg.textContent || "").toLowerCase();
      if (/\bapp\b/.test(t) && !t.includes("notification")) {
        const notNow = [...dlg.querySelectorAll("button, [role='button'], a")].find((b) =>
          /^(not now|continue on web|cancel|close)$/i.test((b.textContent || "").trim())
        );
        if (notNow) notNow.click();
        else dlg.style.display = "none";
      }
    });
  }
 
  // 6) Stop the home feed after MAX_FEED_POSTS posts, or lock it during cooldown
  function postId(article) {
    const a = article.querySelector('a[href*="/p/"]');
    return a ? a.getAttribute("href").split("/p/")[1].split("/")[0] : null;
  }
 
  function limitFeed() {
    if (location.pathname !== "/") return;
    const articles = document.querySelectorAll("article");
    if (!articles.length) return;
 
    // Cooldown: hide every post (Stories at the top stay visible)
    if (isLocked()) {
      articles.forEach((art) => (art.style.display = "none"));
      const stop = document.getElementById("ig-focus-stop");
      if (stop) stop.remove();
      if (!document.getElementById("ig-focus-lock")) {
        const box = document.createElement("div");
        box.id = "ig-focus-lock";
        box.innerHTML =
          `The feed is resting for a bit, Go touch some grass and look at the sky bro🌿<small>If u need to talk to your bitches u still can just no scrolling for you <3 The feed will be back later.</small>`;
        articles[0].before(box);
      }
      return;
    }
 
    let lastAllowed = null;
    articles.forEach((art) => {
      if (art.querySelector('a[href*="/reel/"]')) {
        art.style.display = "none";
        return;
      }
      const id = postId(art);
      if (id && !seen.has(id) && seen.size < MAX_FEED_POSTS) seen.add(id);
 
      if (id && seen.has(id)) {
        art.style.display = "";
        lastAllowed = art;
      } else {
        art.style.display = "none";
      }
    });
 
    if (seen.size >= MAX_FEED_POSTS && lastAllowed && !document.getElementById("ig-focus-stop")) {
      const box = document.createElement("div");
      box.id = "ig-focus-stop";
      box.innerHTML = `That's ${MAX_FEED_POSTS} posts ✨<small>. Did you learn anything new? Was it REALLY worth your time?</small>`;
      lastAllowed.after(box);
    }
  }
 
  // 7) Badge at the top: time left, or cooldown countdown
  function addBadge() {
    if (!SHOW_BADGE || document.getElementById("ig-focus-badge")) return;
    const b = document.createElement("div");
    b.id = "ig-focus-badge";
    b.style.cssText =
      "position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "color:#fff;font:600 11px -apple-system,sans-serif;font-variant-numeric:tabular-nums;" +
      "padding:3px 8px;border-radius:10px;opacity:.9;pointer-events:none;";
    document.body.appendChild(b);
    updateBadge();
  }
 
  // No countdowns shown anywhere: the badge just says the script is on
  function updateBadge() {
    const b = document.getElementById("ig-focus-badge");
    if (b) { b.textContent = "Focus on"; b.style.background = "#34c759"; }
  }
 
  // 8) Don't let the page scroll past the "That's 10 posts" / "resting" message
  //    (Instagram keeps empty space where the hidden posts would be)
  const BOTTOM_ROOM = 140; // px left below the message so it clears the bottom bar
 
  function endBox() {
    if (location.pathname !== "/") return null;
    return document.getElementById("ig-focus-lock") || document.getElementById("ig-focus-stop");
  }
 
  function clampScroll(e) {
    const box = endBox();
    if (!box) return;
    const target = e && e.target;
    const scroller =
      !target || target === document || target === document.documentElement || target === document.body
        ? null
        : target;
 
    if (scroller && scroller.contains && scroller.contains(box)) {
      // Feed scrolls inside a container
      const boxBottom = box.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const maxTop = Math.max(0, boxBottom + BOTTOM_ROOM - scroller.clientHeight);
      if (scroller.scrollTop > maxTop) scroller.scrollTop = maxTop;
    } else if (!scroller) {
      // Whole page scrolls
      const boxBottom = box.getBoundingClientRect().bottom + window.scrollY;
      const maxY = Math.max(0, boxBottom + BOTTOM_ROOM - window.innerHeight);
      if (window.scrollY > maxY) window.scrollTo(0, maxY);
    }
  }
  document.addEventListener("scroll", clampScroll, { capture: true, passive: true });
 
  function runAll() {
    checkPath();
    document.body.classList.toggle("igf-search", location.pathname.startsWith(SEARCH_PATH));
    removeSmartBanner();
    fixSearchButton();
    hideAppBanners();
    limitFeed();
    addBadge();
  }
 
  // Re-run whenever Instagram loads more content (at most once per frame)
  let scheduled = false;
  const obs = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      runAll();
    });
  });
  function start() {
    obs.observe(document.body, { childList: true, subtree: true });
    runAll();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
 