
// ==UserScript==
// @name         Instagram Focus – No Reels, No Endless Scroll
// @namespace    instagram-focus
// @version      1.2
// @description  Hides Reels and the Explore grid (keeps Search), stops the feed after a set number of posts, and removes "open in app" banners.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
 
(function () {
  "use strict";
 
  // ---- Settings -----------------------------------------------------------
  const MAX_FEED_POSTS = 20;   // how many feed posts you can see before it stops
  const SHOW_BADGE = false;     // small green "Focus on" badge at the top
  // -------------------------------------------------------------------------
 
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
 
    #ig-focus-stop {
      margin: 32px 16px; padding: 24px; border-radius: 16px;
      text-align: center; font: 600 17px -apple-system, system-ui, sans-serif;
      background: #f2f2f7; color: #111;
    }
    #ig-focus-stop small { display:block; margin-top:8px; font-weight:400; color:#666; }
    @media (prefers-color-scheme: dark) {
      #ig-focus-stop { background:#1c1c1e; color:#eee; }
    }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
 
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
 
  // 6) Stop the home feed after MAX_FEED_POSTS posts
  const seen = new Set();
 
  function postId(article) {
    const a = article.querySelector('a[href*="/p/"]');
    return a ? a.getAttribute("href").split("/p/")[1].split("/")[0] : null;
  }
 
  function limitFeed() {
    if (location.pathname !== "/") return;
    const articles = document.querySelectorAll("article");
    if (!articles.length) return;
 
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
      box.innerHTML = `That's enough bro ✨<small>Was it worth it? Did u gain something? Go fuck off and touch some grass</small>`;
      lastAllowed.after(box);
    }
  }
 
  // 7) Small badge so you can see the script is running
  function addBadge() {
    if (!SHOW_BADGE || document.getElementById("ig-focus-badge")) return;
    const b = document.createElement("div");
    b.id = "ig-focus-badge";
    b.textContent = "Focus on";
    b.style.cssText =
      "position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "background:#34c759;color:#fff;font:600 11px -apple-system,sans-serif;" +
      "padding:3px 8px;border-radius:10px;opacity:.85;pointer-events:none;";
    document.body.appendChild(b);
  }
 
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