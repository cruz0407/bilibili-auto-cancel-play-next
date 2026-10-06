// ==UserScript==
// @name         B站自动取消连播
// @namespace    https://github.com/cruz0407/bilibili-auto-cancel-play-next
// @version      1.1.1
// @description  合集播完暂停；分P视频自动播至最后一P；取消普通推荐连播
// @updateURL    https://raw.githubusercontent.com/cruz0407/bilibili-auto-cancel-play-next/main/bilibili-auto-cancel-play-next.user.js
// @downloadURL  https://raw.githubusercontent.com/cruz0407/bilibili-auto-cancel-play-next/main/bilibili-auto-cancel-play-next.user.js
// @author       cruz0407
// @match        https://www.bilibili.com/*
// @match        https://bilibili.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CANCEL_SELECTOR =
    '.bpx-player-ending-related-item-cancel[data-i18n="cancelAutoPlayNext"]';
  const HANDOFF_SELECTOR = '.bpx-player-ctrl-setting-handoff-content';
  const clicked = new WeakSet();
  const MAX_CACHE_ENTRIES = 32;
  const videos = new Map();
  const pending = new Set();
  const retryAfter = new Map();
  const PLAYER_SELECTOR = '.bpx-player-container';
  const NOISE_SELECTOR =
    '.bpx-player-render-dm-wrap, .bpx-player-ending-related-item-countdown';
  let scheduled = false;
  let targetsDirty = true;
  let playerRoots = [];
  let handoffGroups = [];
  let cancelButtons = [];
  let cachedHref = '';
  let cachedRoute = null;

  function currentRoute() {
    if (location.href === cachedHref) return cachedRoute;
    cachedHref = location.href;
    const match = location.pathname.match(/^\/video\/(BV[\da-zA-Z]+)(?:\/|$)/);
    if (!match) return (cachedRoute = null);
    const page = Number(new URL(cachedHref).searchParams.get('p') || 1);
    cachedRoute = { bvid: match[1], page: Number.isInteger(page) && page > 0 ? page : 1 };
    return cachedRoute;
  }

  function cacheEntry(cache, key, value) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  function rememberVideo(data, bvid) {
    if (!data || data.bvid !== bvid || !Array.isArray(data.pages) || !data.pages.length) {
      return null;
    }
    const info = {
      bvid,
      total: data.pages.length,
      collection: Boolean(data.ugc_season && data.ugc_season.id),
    };
    cacheEntry(videos, bvid, info);
    return info;
  }

  function resolveVideo(route) {
    if (videos.has(route.bvid)) return videos.get(route.bvid);
    // Initial state can remain stale during SPA navigation: always match the BV.
    const initial = rememberVideo(window.__INITIAL_STATE__?.videoData, route.bvid);
    if (initial) return initial;
    if (!pending.has(route.bvid) && Date.now() >= (retryAfter.get(route.bvid) || 0)) {
      void fetchVideo(route.bvid);
    }
    return null;
  }

  async function fetchVideo(bvid) {
    pending.add(bvid);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      // Public metadata only; no login cookies or external service are needed.
      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { credentials: 'omit', signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.code !== 0 || !rememberVideo(result.data, bvid)) {
        throw new Error('Video metadata unavailable');
      }
      retryAfter.delete(bvid);
    } catch (error) {
      cacheEntry(retryAfter, bvid, Date.now() + 10000);
      console.debug('[B站自动取消连播] 暂未取得视频信息，保留播放设置', error);
    } finally {
      window.clearTimeout(timeout);
      pending.delete(bvid);
      // Re-read the current route instead of applying an old request's policy.
      scheduleScan();
    }
  }

  function playbackPolicy(route, info) {
    if (!route || !info || route.page > info.total) return null;
    // A multipart BV may itself be inside a collection: continue its own Ps,
    // but stop on its last P so it cannot cross into the next BV.
    if (info.total > 1) {
      return { mode: route.page < info.total ? '0' : '2',
        allowNextPart: route.page < info.total };
    }
    return { mode: info.collection ? '2' : null, allowNextPart: false };
  }

  function refreshTargets() {
    if (!targetsDirty && playerRoots.every(root => root.isConnected)) return;
    targetsDirty = false;
    playerRoots = Array.from(document.querySelectorAll(PLAYER_SELECTOR));
    handoffGroups = [];
    cancelButtons = [];
    // Full-page lookup happens only during discovery/replacement. Routine checks
    // reuse controls cached within the player instead of searching comments.
    for (const root of playerRoots) {
      for (const group of root.querySelectorAll(HANDOFF_SELECTOR)) {
        handoffGroups.push({
          element: group,
          auto: group.querySelector('input[type="radio"][value="0"]'),
          stop: group.querySelector('input[type="radio"][value="2"]'),
        });
      }
      cancelButtons.push(...root.querySelectorAll(CANCEL_SELECTOR));
    }
  }

  function onMutations(records) {
    if (location.href !== cachedHref) scheduleScan();
    if (playerRoots.some(root => !root.isConnected)) {
      targetsDirty = true;
      scheduleScan();
    }
    for (const record of records) {
      const node = record.target;
      if (!(node instanceof Element) || node.closest(NOISE_SELECTOR)) continue;
      if (record.type === 'childList') {
        // Rendering danmaku and countdown SVG paths cannot add player controls.
        if (playerRoots.some(root => root.contains(node))) {
          targetsDirty = true;
          scheduleScan();
          return;
        }
        for (const added of record.addedNodes) {
          if (added instanceof Element &&
              (added.matches(PLAYER_SELECTOR) || added.querySelector(PLAYER_SELECTOR))) {
            targetsDirty = true;
            scheduleScan();
            return;
          }
        }
      } else if (node.matches(PLAYER_SELECTOR) ||
                 node.matches(CANCEL_SELECTOR) || node.matches(HANDOFF_SELECTOR) ||
                 cancelButtons.some(button => node.contains(button)) ||
                 handoffGroups.some(group => node.contains(group.element) ||
                   group.element.contains(node))) {
        // Ancestor visibility still matters; styles on comments do not.
        if (record.attributeName === 'class' || record.attributeName === 'data-i18n') {
          targetsDirty = true;
        }
        scheduleScan();
        return;
      }
    }
  }

  function applyPlaybackMode(policy) {
    if (!policy || policy.mode === null) return;
    for (const group of handoffGroups) {
      const input = policy.mode === '0' ? group.auto : group.stop;
      // The menu is normally hidden. A real click triggers the player's handler;
      // assigning input.checked alone would only change the appearance.
      if (input && !input.disabled && !input.checked) {
        input.click();
        console.debug('[B站自动取消连播] 播放方式：',
          policy.mode === '2' ? '播完暂停' : '自动切集（仅当前视频的分P）');
      }
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    // The common idle state needs no computed-style/layout traversal.
    if (element.hidden || element.style.display === 'none' ||
        element.style.visibility === 'hidden' ||
        element.style.visibility === 'collapse') return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse') return false;
    }
    return true;
  }

  function cancelRecommendations(policy) {
    for (const button of cancelButtons) {
      if (!isVisible(button)) {
        clicked.delete(button);
        continue;
      }
      if (!policy || policy.allowNextPart || clicked.has(button)) continue;
      if (button.textContent.trim() !== '取消连播') continue;
      clicked.add(button);
      button.click();
      if (!isVisible(button)) clicked.delete(button);
      console.debug('[B站自动取消连播] 已取消推荐连播');
    }
  }

  function scan() {
    refreshTargets();
    const route = currentRoute();
    const policy = playbackPolicy(route, route && resolveVideo(route));
    applyPlaybackMode(policy);
    cancelRecommendations(policy);
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    // Coalesce only relevant player/route changes; ignore animation noise.
    window.setTimeout(() => {
      scheduled = false;
      scan();
    }, 30);
  }

  function start() {
    const observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-i18n', 'aria-hidden', 'hidden'],
    });
    document.addEventListener('change', event => {
      if (event.target instanceof Element && event.target.closest(HANDOFF_SELECTOR)) {
        scheduleScan();
      }
    }, true);
    window.addEventListener('popstate', scheduleScan);
    // Keep a lightweight fallback for silent history.pushState / checked changes.
    // It uses cached references; it does not rescan the document.
    window.setInterval(scan, 500);
    scan();
  }

  function waitForBody() {
    if (document.body) start();
    else window.setTimeout(waitForBody, 50);
  }

  waitForBody();
})();
