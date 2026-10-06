// ==UserScript==
// @name         B站自动取消连播
// @namespace    https://github.com/cruz0407/bilibili-auto-cancel-play-next
// @version      1.1.0
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
  const videos = new Map();
  const pending = new Set();
  const retryAfter = new Map();
  let scheduled = false;

  function currentRoute() {
    const match = location.pathname.match(/^\/video\/(BV[\da-zA-Z]+)(?:\/|$)/);
    if (!match) return null;
    const page = Number(new URL(location.href).searchParams.get('p') || 1);
    return { bvid: match[1], page: Number.isInteger(page) && page > 0 ? page : 1 };
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
    videos.set(bvid, info);
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
      retryAfter.set(bvid, Date.now() + 10000);
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

  function applyPlaybackMode(policy) {
    if (!policy || policy.mode === null) return;
    for (const group of document.querySelectorAll(HANDOFF_SELECTOR)) {
      const input = group.querySelector(`input[type="radio"][value="${policy.mode}"]`);
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
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse') return false;
    }
    return true;
  }

  function cancelRecommendations(policy) {
    for (const button of document.querySelectorAll(CANCEL_SELECTOR)) {
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
    const route = currentRoute();
    const policy = playbackPolicy(route, route && resolveVideo(route));
    applyPlaybackMode(policy);
    cancelRecommendations(policy);
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    // Coalesce danmaku/countdown animation mutations into one scan per batch.
    window.setTimeout(() => {
      scheduled = false;
      scan();
    }, 30);
  }

  function start() {
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-i18n', 'aria-hidden', 'hidden'],
    });
    document.addEventListener('change', scheduleScan, true);
    window.addEventListener('popstate', scheduleScan);
    // Also detect history.pushState and input property changes without patching
    // the site's history or player APIs.
    window.setInterval(scan, 500);
    scan();
  }

  function waitForBody() {
    if (document.body) start();
    else window.setTimeout(waitForBody, 50);
  }

  waitForBody();
})();
