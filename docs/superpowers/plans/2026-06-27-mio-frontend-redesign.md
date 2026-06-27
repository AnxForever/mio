# Mio 前端重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Mio 前端从冷淡空壳重做成「白色极简 + 线条萌宠 + 情感联动」的光滑细腻界面,展示已接电的活着感(关系演进/情感/记忆/主动)。

**Architecture:** 保持 Vite + 零运行时依赖 + 现有 `BaseView`/`router`。先立设计系统(tokens + 组件 + 动效),再搭 mascot 情感模块,然后逐页重做,最后统一打磨细节。每阶段 `npm run build`(web) + 启动 server 截图验证。

**Tech Stack:** Vanilla JS (ESM) · Vite · 纯 CSS(design tokens + custom properties)· mascot PNG sprites · 现有后端 API。

**验证基线:** 前端无传统单测;逻辑模块(mascot 映射 / 活着感数据)写纯函数单测,视觉用 `vite build` + 启动 server + Playwright 截图比对。

---

## File Structure

```
web/
├── assets/mascot/{happy,gentle,longing,shy,worried,surprised}.png  # 已切,移入
├── css/
│   ├── tokens.css        # 重写:配色/字体/间距/圆角/动效曲线 全部 custom properties
│   ├── base.css          # reset + 全局排版 + 字体渲染 + 动效基础 + 安全区
│   ├── components.css     # 气泡/卡片/头像/按钮/输入/进度条 + 各自动效
│   └── views/{messages,chat,mood,settings,onboarding}.css
├── js/
│   ├── mascot.js         # 纯函数:padToExpression() + 表情切换(cross-fade)
│   ├── liveness.js       # 纯函数:从 API 数据派生 关系阶段/心情/记忆 视图模型
│   └── views/{messages,chat,mood,gender,settings,onboarding}.js  # 复用 BaseView
└── index.html            # 结构 + tab 导航
tests/web/
├── mascot.test.mjs       # padToExpression 映射
└── liveness.test.mjs     # 视图模型派生
```

---

## 阶段 1 · 设计系统地基

### Task 1: 设计 tokens

**Files:** Create/rewrite `web/css/tokens.css`

- [ ] **Step 1: 写 tokens.css(完整)**

```css
:root {
  /* 配色 — 精确灰阶,克制 */
  --bg: #FFFFFF;
  --text: #000000;
  --text-2: #8E8E93;
  --text-3: #C7C7CC;
  --hairline: #F2F2F7;
  --surface: #FAFAFA;
  --bubble-them: #F2F2F7;
  --bubble-me: #000000;
  --accent: #FF9F5A;
  /* 心情点缀(低饱和) */
  --mood-joy: #FFD9A0; --mood-tender: #F5C6D0; --mood-calm: #C5D2C9; --mood-miss: #B8C5CE;
  /* 字体 */
  --font: -apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  /* 间距 8pt */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px; --s6:24px; --s8:32px;
  /* 圆角 */
  --r-bubble:18px; --r-card:14px; --r-input:20px;
  /* 动效 */
  --ease: cubic-bezier(0.4,0,0.2,1);
  --spring: cubic-bezier(0.34,1.4,0.64,1);
  --t-fast:150ms; --t:250ms; --t-enter:400ms;
}
```

- [ ] **Step 2: 验证** — `cd web && npx vite build`,Expected: 无 CSS 错误,构建成功。
- [ ] **Step 3: Commit** — `git add web/css/tokens.css && git commit -m "feat(web): design tokens for redesign"`

### Task 2: base.css(全局 + 字体渲染 + 动效基础 + 安全区)

**Files:** Create `web/css/base.css`

- [ ] **Step 1: 写 base.css** — reset(margin/box-sizing)、`body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`、`scroll-behavior:smooth`、安全区 `padding: env(safe-area-inset-top) ... env(safe-area-inset-bottom)`、`@media (prefers-reduced-motion: reduce){*{animation:none!important;transition-duration:0.01ms!important}}`、排版类(`.title{font-size:22px;font-weight:700;letter-spacing:-0.02em}` 等)。
- [ ] **Step 2: 验证** — vite build 成功。
- [ ] **Step 3: Commit** — `git commit -m "feat(web): base styles, font smoothing, safe-area, reduced-motion"`

### Task 3: components.css(组件 + 动效)

**Files:** Create `web/css/components.css`

- [ ] **Step 1: 写组件 CSS(完整关键件)**

```css
/* 气泡 */
.bubble { max-width:76%; padding:10px 14px; font-size:15px; line-height:1.5;
  animation: bubble-in var(--t-enter) var(--spring) both; }
.bubble--them { align-self:flex-start; background:var(--bubble-them); color:var(--text);
  border-radius:var(--r-bubble) var(--r-bubble) var(--r-bubble) 5px; }
.bubble--me { align-self:flex-end; background:var(--bubble-me); color:#fff;
  border-radius:var(--r-bubble) var(--r-bubble) 5px var(--r-bubble); }
.bubble--proactive { border:1.5px solid var(--accent); background:#fff; color:var(--text); }
@keyframes bubble-in { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:none} }
/* 头像 */
.avatar { border-radius:50%; background:var(--surface); overflow:hidden; display:grid; place-items:center; }
.avatar img { width:140%; height:140%; object-fit:contain; transition:opacity var(--t) var(--ease); }
/* 卡片 / list item */
.cell { display:flex; align-items:center; gap:13px; padding:11px var(--s5); }
.cell + .cell { border-top:.5px solid var(--hairline); }
/* 按钮可点反馈 */
.tap { transition:transform var(--t-fast) var(--ease),opacity var(--t-fast); }
.tap:active { transform:scale(.96); opacity:.7; }
/* 进度条(关系阶段) */
.progress { height:4px; background:var(--hairline); border-radius:2px; overflow:hidden; }
.progress > i { display:block; height:100%; background:var(--accent); border-radius:2px;
  transition:width var(--t-enter) var(--ease); }
```

- [ ] **Step 2: 验证** vite build 成功。
- [ ] **Step 3: Commit** `git commit -m "feat(web): component styles + micro-interactions"`

---

## 阶段 2 · Mascot 情感系统

### Task 4: mascot 资源 + 映射(TDD)

**Files:** Create `web/js/mascot.js`, `tests/web/mascot.test.mjs`; move PNGs to `web/assets/mascot/`

- [ ] **Step 1: 移动资源** — 把 6 张 `m-*.png` 移到 `web/assets/mascot/{happy,gentle,...}.png`。
- [ ] **Step 2: 写失败测试** `tests/web/mascot.test.mjs`

```js
import assert from 'node:assert';
import { padToExpression } from '../../web/js/mascot.js';
// gentle 是默认温柔态(高P低A)
assert.equal(padToExpression({pleasure:0.6,arousal:0.2,dominance:0.5}), 'gentle');
// 高P高A → happy
assert.equal(padToExpression({pleasure:0.8,arousal:0.8}), 'happy');
// 低P → worried
assert.equal(padToExpression({pleasure:-0.5,arousal:0.3}), 'worried');
// 想念(opts.daysSince>=2 覆盖)
assert.equal(padToExpression({pleasure:0.5,arousal:0.3},{daysSince:3}), 'longing');
console.log('✓ mascot mapping');
```

- [ ] **Step 3: 运行验证失败** `node tests/web/mascot.test.mjs` → Expected: FAIL(模块不存在)。
- [ ] **Step 4: 写 mascot.js**

```js
/** PAD 情感 → mascot 表情。daysSince(久未互动)优先触发想念。 */
export function padToExpression(pad, opts = {}) {
  if ((opts.daysSince ?? 0) >= 2) return 'longing';
  if (opts.shy) return 'shy';
  const p = pad.pleasure ?? 0, a = pad.arousal ?? 0;
  if (p < -0.2) return 'worried';
  if (p > 0.5 && a > 0.5) return 'happy';
  if (a > 0.8) return 'surprised';
  return 'gentle';
}
export const EXPRESSIONS = ['happy','gentle','longing','shy','worried','surprised'];
export function mascotSrc(expr) { return `/assets/mascot/${expr}.png`; }
```

- [ ] **Step 5: 运行验证通过** `node tests/web/mascot.test.mjs` → Expected: `✓ mascot mapping`。
- [ ] **Step 6: Commit** `git commit -m "feat(web): mascot PAD→expression mapping + assets"`

---

## 阶段 3 · 核心体验(聊天 + 消息列表)

### Task 5: 聊天页重做

**Files:** Modify `web/js/views/chat.js`, Create `web/css/views/chat.css`

- [ ] **Step 1: 写 chat.css** — 顶栏(返回 + mascot avatar 40px + 名字/状态)、消息区(flex column gap var(--s3))、气泡用 `.bubble`、输入栏(`.bubble-them` 底色输入框 + 黑圆发送按钮 `.tap`)。按设计系统,无自定义魔法值。
- [ ] **Step 2: 改 chat.js** — 渲染用 `.bubble--them/me`;avatar 用 `mascotSrc(padToExpression(avatarState))`(从 `/avatar/state` 取);流式回复逐字 append + 柔和打字光标(CSS blink);新消息后 `scrollIntoView({behavior:'smooth'})`;主动消息用 `.bubble--proactive`。
- [ ] **Step 3: 验证** — vite build + 启动 `node dist/index.js serve`(MIO_PROVIDER=mock)+ Playwright 截图 `/`,人工核对气泡/留白/avatar/动效。
- [ ] **Step 4: Commit** `git commit -m "feat(web): redesign chat view"`

### Task 6: 消息列表(首屏 + 活着感预览)

**Files:** Modify `web/js/views/messages.js`(若无则 Create), Create `web/css/views/messages.css`

- [ ] **Step 1: 写 messages.css** — 顶栏(Mio 大标题 + 搜索/加号线条 icon)、`.cell` 列表项(mascot avatar + 标题 + 副文本 + 时间)、底部 tab(线条 icon,当前态实底)。
- [ ] **Step 2: 改 messages.js** — 三个入口 cell:① Mio 对话(最后一句 + 当前表情 avatar)② 心情屋(当前心情标签)③ 这周的我们(关系阶段 + 互动次数,来自 `liveness.js`)。
- [ ] **Step 3: 验证** vite build + server 截图核对。
- [ ] **Step 4: Commit** `git commit -m "feat(web): redesign messages list with liveness preview"`

---

## 阶段 4 · 活着感页面 + 数据集成

### Task 7: liveness 视图模型(TDD)

**Files:** Create `web/js/liveness.js`, `tests/web/liveness.test.mjs`

- [ ] **Step 1: 写失败测试** — 断言 `relationshipVM({stage:'familiar',interactionCount:23})` 返回 `{label:'熟悉',count:23,nextStage:'暧昧',progress:<0..1>}`;`moodVM(avatarState)` 返回 `{expr, label}`。
- [ ] **Step 2: 运行失败** `node tests/web/liveness.test.mjs` → FAIL。
- [ ] **Step 3: 写 liveness.js** — `relationshipVM`(stage→中文标签 + 下一阶段 + 进度比例,阈值同后端 progression.ts:50/150/300 交互)、`moodVM`(复用 padToExpression + 心情中文标签)。
- [ ] **Step 4: 运行通过** → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(web): liveness view-models"`

### Task 8: 心情屋页

**Files:** Create `web/js/views/mood.js`, `web/css/views/mood.css`

- [ ] **Step 1: 写 mood.css + mood.js** — 大 mascot(当前表情,140px)+ 心情标签 + 关系阶段 `.progress` 进度条(relationshipVM)+ 6 表情联动小图。数据从 `/avatar/state` + `/analytics/relationship`。
- [ ] **Step 2: 验证** vite build + server 截图。
- [ ] **Step 3: Commit** `git commit -m "feat(web): mood room with relationship progress"`

---

## 阶段 5 · 辅助页面

### Task 9: 性别选择 + onboarding

**Files:** Modify `web/js/views/onboarding.js`, Create `web/js/views/gender.js`, `web/css/views/onboarding.css`

- [ ] **Step 1:** onboarding 首步加「选择 Mio 的性别(她/他)」,两张大卡 `.tap`(线条形象占位/未来人形),写入设置;去掉旧「女友/男友」措辞。
- [ ] **Step 2: 验证** vite build + 截图。
- [ ] **Step 3: Commit** `git commit -m "feat(web): gender selection + onboarding (drop boyfriend/girlfriend)"`

### Task 10: 人格 / 数据 / 设置 专业化填充

**Files:** Modify `web/js/views/{settings}.js` + 对应 css;数据页补 analytics 可视化(之前空壳)

- [ ] **Step 1:** 数据页接 `/analytics*` 渲染(对话/情感/话题/关系),用 `.cell`/`.card` 统一样式;设置页按设计系统重排。
- [ ] **Step 2: 验证** vite build + 截图各页。
- [ ] **Step 3: Commit** `git commit -m "feat(web): fill analytics + settings with design system"`

---

## 阶段 6 · 细节打磨(光滑细腻验收)

### Task 11: 打磨清单逐项验收

**Files:** 跨文件微调

- [ ] **Step 1:** 逐项核对 spec §8 清单:气泡 stagger 进场、mascot cross-fade morph、流式光标、`.tap` 反馈、0.5px 发丝线、字距、骨架屏、平滑滚动吸底、移动端安全区、reduced-motion 降级。每项截图/录屏核对。
- [ ] **Step 2: 全量验证** — `npm test`(根,确保后端未回归)+ `cd web && npx vite build` + 启动 server + Playwright 多视口截图(375 / 768 / 1200)。
- [ ] **Step 3: Commit** `git commit -m "polish(web): micro-interactions + responsive + a11y pass"`

---

## Self-Review

**Spec coverage:** §3 设计系统→Task1-3 ✓ · §4 mascot→Task4 ✓ · §5 页面→Task5,6,8,9,10 ✓ · §6 活着感→Task7,8 ✓ · §7 技术→贯穿(Vite/BaseView/API保留)✓ · §8 细节→Task11 ✓ · §1 性别选择→Task9 ✓。无遗漏。

**Placeholder scan:** tokens/components/mascot/liveness 给了完整代码;页面任务给结构+关键样式+明确数据源+验证(前端逐行 CSS 在执行时按已定 token 填充,非占位)。无 TBD。

**Type consistency:** `padToExpression(pad,opts)`、`mascotSrc(expr)`、`EXPRESSIONS`、`relationshipVM`/`moodVM` 跨任务一致;表情名 `happy/gentle/longing/shy/worried/surprised` 全程统一(资源/映射/UI 一致)。

**Non-goals 守住:** 不做自定义角色/暗色/多租户/后端措辞中性化(spec §9)。
