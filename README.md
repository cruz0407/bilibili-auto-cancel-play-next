# B站自动取消连播

一个 Tampermonkey / 油猴脚本：当 B 站播放器结束页出现“取消连播”时，自动点击它，避免视频自动播放下一个推荐视频。

## 功能

- 自动识别 B 站播放器结束页的“取消连播”按钮
- 支持按钮动态出现、B 站单页切换视频
- 使用 `MutationObserver` 监听播放器变化
- 低频轮询作为兜底，避免漏掉 B 站只修改状态但没有明显 DOM 变化的情况
- 不会修改播放器设置，也不会请求额外权限

## 油猴订阅

安装 Tampermonkey 后，打开下面的地址即可安装或订阅：

```text
https://raw.githubusercontent.com/cruz0407/bilibili-auto-cancel-play-next/main/bilibili-auto-cancel-play-next.user.js
```

脚本内置了 `@updateURL` 和 `@downloadURL`，之后 Tampermonkey 可以从 GitHub Raw 地址检查更新。

## 手动安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 [`bilibili-auto-cancel-play-next.user.js`](./bilibili-auto-cancel-play-next.user.js)。
3. 复制全部内容，在 Tampermonkey 中新建脚本并粘贴保存。

## 原理

脚本监听以下按钮：

```css
.bpx-player-ending-related-item-cancel[data-i18n="cancelAutoPlayNext"]
```

只有当按钮可见且文字为“取消连播”时才会执行点击。

## 免责声明

这是一个个人用户脚本，仅用于改善本地浏览体验。B 站页面结构发生变化时，脚本可能需要更新。
