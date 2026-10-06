// ==UserScript==
// @name         B站自动取消连播
// @namespace    https://github.com/cruz0407/bilibili-auto-cancel-play-next
// @version      1.0.0
// @description  B站视频结束出现“取消连播”时自动点击，避免自动播放下一个视频
// @updateURL     https://raw.githubusercontent.com/cruz0407/bilibili-auto-cancel-play-next/main/bilibili-auto-cancel-play-next.user.js
// @downloadURL   https://raw.githubusercontent.com/cruz0407/bilibili-auto-cancel-play-next/main/bilibili-auto-cancel-play-next.user.js
// @author       local
// @match        https://www.bilibili.com/*
// @match        https://bilibili.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SELECTOR =
    '.bpx-player-ending-related-item-cancel[data-i18n="cancelAutoPlayNext"]';
  const clicked = new WeakSet();
  let observer;
  let fallbackTimer;

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function cancelAutoPlayNext(root = document) {
    const buttons = root.querySelectorAll(SELECTOR);

    for (const button of buttons) {
      if (clicked.has(button)) continue;
      if (!isVisible(button)) continue;
      if (button.textContent.trim() !== '取消连播') continue;

      clicked.add(button);
      button.click();
      console.debug('[B站自动取消连播] 已点击“取消连播”');
    }
  }

  function start() {
    cancelAutoPlayNext();

    observer = new MutationObserver(() => cancelAutoPlayNext());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-i18n', 'aria-hidden'],
    });

    window.setInterval(cancelAutoPlayNext, 500);
  }

  function waitForBody() {
    if (document.body) {
      start();
      return;
    }
    window.setTimeout(waitForBody, 50);
  }

  waitForBody();
})();
