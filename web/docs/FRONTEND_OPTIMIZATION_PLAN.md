# 功能规划：前端架构优化与性能提升 (Web UI)

**规划时间**：2026/06/26
**预估工作量**：18 任务点

---

## 1. 功能概述

### 1.1 目标
针对 Mio 当前的 Vanilla JS 前端项目进行系统性升级。旨在消除原生 ES Modules 的网络请求瀑布流、降低高频聊天和复杂动画带来的主线程负担，提升应用的可维护性（组件化与状态解耦）、运行性能（渲染分离、虚拟列表）及用户体验（流式动画平顺度、离线可用性）。

### 1.2 范围
**包含**：
- **架构层**：引入构建工具（Vite），轻量级组件/视图类抽象，局部状态隔离。
- **性能层**：基于 `OffscreenCanvas` 的情绪球 Web Worker 渲染，聊天长列表虚拟滚动，PWA Service Worker 资源缓存。
- **体验层**：流式生成期间的平滑滚动与滚动锚定，无障碍访问 (A11y) 完善，全设备（移动端/平板/桌面端）响应式体验提升。

**不包含**：
- 替换现有技术栈为 React/Vue（保持无框架依赖的初衷，仅做原生优化）。
- 任何后端/服务端核心逻辑的修改。

### 1.3 技术约束
- 保持“Zero-framework”设计理念，不引入重量级前端框架。
- 所有动画和渲染（Canvas、CSS 过渡）必须保证在移动端设备达到 60FPS。
- 保证构建产物对主流现代浏览器（支持 ES2022+）的兼容性。

---

## 2. WBS 任务分解

### 2.1 任务清单

#### 模块 A：架构与工程化（5 任务点）

**文件**: `web/package.json`, `vite.config.js`, `web/js/**/*.js`

- [ ] **任务 A.1**：接入 Vite 构建体系（2 点）
  - **输入**：现有 `web/` 静态目录和原生 ES Module。
  - **输出**：完成 Vite 配置，支持热更新 (HMR) 与生产环境 Rollup 压缩打包。
  - **关键步骤**：
    1. 在 `web` 目录初始化 `package.json` 并安装 `vite`。
    2. 配置 `vite.config.js`，将后端 `/api` 和 `/ws` 接口代理到本机的 `3000` 端口。
    3. 修复硬编码的相对路径引入，确保打包产物指纹化 (Hash)。

- [ ] **任务 A.2**：重构视图状态隔离与生命���期机制（3 点）
  - **输入**：`app.js`, `views/chat.js` 等存在全局变量堆积的文件。
  - **输出**：轻量级 View/Component 抽象类。
  - **关键步骤**：
    1. 消除 `chat.js` 中 `let emotionBall = null`, `let chatMessages = null` 等文件级全局状态。
    2. 创建 `BaseView` 类，规范 `mount`, `render`, `unmount` 的执行流与事件监听解绑逻辑。
    3. 将原有的手动 Store 订阅改造为在 `unmount` 时自动销毁，防止内存泄漏。

#### 模块 B：性能优化（8 任务点）

**文件**: `web/js/components/bubble.js`, `web/js/components/emotion-ball.js`, `web/sw.js`

- [ ] **任务 B.1**：聊天长列表虚拟渲染（Virtual Scrolling）（4 点）
  - **输入**：`chat.js` 和 `bubble.js`。
  - **输出**：支持数千条历史消息不卡顿的滚动容器。
  - **关键步骤**：
    1. 实现基于 `IntersectionObserver` 或滚动测算的轻量虚拟列表。
    2. 将视口外（超过安全距离）的消息气泡 DOM 节点用占位符 (placeholder) 替换。
    3. 优化 DOM 追加逻辑：在收到大量历史记录时使用 `DocumentFragment` 批量插入。

- [ ] **任务 B.2**：情绪球 Worker 离屏渲染改造（2 点）
  - **输入**：`emotion-ball.js`。
  - **输出**：主线程与渲染线程分离的情绪球模块。
  - **关键步骤**：
    1. 检测 `canvas.transferControlToOffscreen()` 支持情况（不支持则优雅降级为原版主线程渲染）。
    2. 将 `_tick()`, `_draw()` 移入 `emotion-worker.js`。
    3. 通过 `postMessage` 实时同步主线程的好感度、情绪状态变化，降低高频流式打印文字时的掉帧风险。

- [ ] **任务 B.3**：PWA Service Worker 与离线策略（2 点）
  - **输入**：`manifest.json`, `index.html`。
  - **输出**：实现静态资源的缓存及离线骨架屏。
  - **关键步骤**：
    1. 引入 Workbox 或手写 `sw.js`。
    2. 配置 Cache First 策略缓存 HTML/CSS/JS 与字体资产。
    3. 确保网络不稳定时可以快速加载 App Shell，提示"等待网络连接..."。

#### 模块 C：体验与UI/UX（5 任务点）

**文件**: `web/js/views/chat.js`, `web/css/chat.css`

- [ ] **任务 C.1**：流式输出滚动平滑度与锚定控制（3 点）
  - **输入**：`chat.js` 中的 `onToken` 回调。
  - **输出**：智能滚动的聊天流。
  - **关键步骤**：
    1. 实现用户滚动意图检测：如果用户主动往上翻阅历史记录，则**停止自动滚动到底部**，出现"新消息"悬浮提示。
    2. 配合 CSS `overflow-anchor: auto;` 防止气泡高度突变引发屏幕跳动。
    3. 流式生成时，采用 RequestAnimationFrame 节流控制 `scrollTop` 修改频率。

- [ ] **任务 C.2**：无障碍交互 (A11y) 与细节打磨（2 点）
  - **输入**：`chat.js`, `dom.js`。
  - **输出**：满足屏幕阅读器可用的键盘导向结构。
  - **关键步骤**：
    1. 为发送、语音、切换模式按钮补充 `aria-label`。
    2. 将消息区的流式变化使用 `aria-live="polite"` 更新。
    3. 在移动端呼出键盘时，进一步优化 iOS Safari 下 `visualViewport` 的防遮挡行为，确保输入框精准贴边。
