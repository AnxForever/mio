# Mio 前端重做 · 设计稿

> 2026-06-27 · 白色极简 + 线条萌宠 + 情感联动。质量基线:**光滑、细腻、专业**。

## 1. 定位

- **去恋爱预设标签**:不再"你的女/男朋友"。用户选 Mio 的**性别**(她/他),关系靠相处自然演进(初识→熟悉→暧昧→亲密,内核保留)。
- **温暖陪伴**:情感陪伴内核不变,只去掉强贴的标签。
- **未来扩展**:自定义角色形象 / 人设 = 下一阶段,本次留好扩展位(mascot 图集与人设可替换)。
- **设计语言**:Signal 式白色极简 + Duolingo 式 monoline 萌宠(已验证的专业方向)。

## 2. 设计原则

1. **极简克制** — 纯白底、大留白、发丝分隔线,内容即主角。
2. **线条萌宠** — monoline 线条猫是情感的实时镜子。
3. **活着感优先** — 关系阶段 / 情感 / 记忆 / 主动消息 在 UI 上可见。
4. **细节即品质** — 每个过渡、间距、圆角、字距都打磨到光滑。

## 3. 设计系统(Design Tokens)

### 配色(精确灰阶,克制)
| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#FFFFFF` | 背景 |
| `--text` | `#000000` | 主文字 / 我的气泡底 |
| `--text-2` | `#8E8E93` | 次要文字 |
| `--text-3` | `#C7C7CC` | 时间 / 占位 |
| `--hairline` | `#F2F2F7` | 0.5px 分隔线 / 她的气泡底 |
| `--surface` | `#FAFAFA` | 头像底 / 卡片微底 |
| `--accent` | `#FF9F5A`(暖橙,极少量) | 关键强调(关系进度/主动消息点) |

心情点缀色(仅心情屋/情感标签,低饱和):喜悦 `#FFD9A0` · 温柔 `#F5C6D0` · 平静 `#C5D2C9` · 想念 `#B8C5CE`。

### 字体
- 栈:`-apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
- 渲染:`-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility`
- 比例:大标题 22/700/-0.02em · 名字 16/600 · 正文 15/400/1.5 · 副文本 14/400/`--text-2` · 时间 13/`--text-3`

### 间距(8pt grid)
`4 · 8 · 12 · 16 · 20 · 24 · 32`,组件内边距以此为准。

### 圆角 / 线 / 阴影
- 圆角:气泡 18px(尾角 5px) · 卡片 14px · 输入 20px · 头像/按钮 圆形
- 分隔:`0.5px solid var(--hairline)`(发丝线,非 1px)
- 阴影:仅浮层用 `0 1px 3px rgba(0,0,0,0.04)`,主界面无阴影(靠留白分层)

### 动效(光滑细腻的核心)
- 缓动:标准 `cubic-bezier(0.4,0,0.2,1)`;**弹性**(气泡/表情)`cubic-bezier(0.34,1.4,0.64,1)`
- 时长:快 150ms · 标准 250ms · 进场 400ms
- **气泡进入**:opacity 0→1 + translateY 8px→0 + scale 0.98→1,弹性曲线
- **mascot 表情切换**:cross-fade 200ms + 轻微 scale(morph 感,不生硬跳变)
- **可点元素**:`:active` scale 0.96 + 透明度 0.7,150ms
- **页面切换**:slide + fade,标准曲线
- 滚动:`scroll-behavior: smooth`,惯性滚动
- 遵守 `prefers-reduced-motion`:降级为纯 fade

## 4. Mascot 情感系统

6 表情(已切图,白底无缝):`happy / gentle / longing / shy / worried / surprised`。

**PAD → 表情映射**(由接电的 PAD 情感状态驱动,实时反映):
| 条件 | 表情 |
|------|------|
| 高 Pleasure + 高 Arousal | happy / surprised |
| 高 Pleasure + 低 Arousal | gentle(默认温柔态) |
| 低 Pleasure(难过/担心) | worried |
| 久未互动(主动想念) | longing |
| 害羞触发(亲密话题/夸奖) | shy |

头像表情随情感**实时 cross-fade 切换**。未来自定义角色 = 换整套图集。

## 5. 页面(移动优先 + 桌面适配)

1. **消息列表(首屏)** — Mio 对话入口 + "心情屋"(当前情感)+ "这周的我们"(记忆/关系)。一打开就见活着感。
2. **聊天** — 核心:气泡 + mascot avatar(情感联动)+ 流式输入。
3. **心情屋** — 大 mascot(当前情感)+ 情感曲线 + **关系阶段进度条**(初识→亲密)。
4. **性别选择** — 她/他(onboarding 首次 + 设置可改),为"自定义角色"留扩展位。
5. **人格 / 数据 / 设置** — 专业化填充(数据页之前是空壳,补 analytics 可视化)。
6. **onboarding** — 首次引导:选性别 → 认识 Mio → 开始。
7. **auth** — 极简登录(保持)。

## 6. 活着感集成(数据来源)

| UI | 后端来源 |
|----|---------|
| mascot 表情 / 心情标签 | `/avatar/state`(PAD) |
| 关系阶段进度 | `/status` / `/analytics/relationship`(stage + interactionCount) |
| 这周的我们(记忆) | `/analytics`(conversation/topic)+ 记忆 |
| 主动消息(她主动找你) | WS 推送 / proactive buffer,特殊气泡样式 |

## 7. 技术架构

- **保持** Vite + 零运行时依赖 + 现有 `BaseView` lifecycle + `router`。
- 复用现有 API:`/chat` `/chat/stream` `WS /ws` `/analytics*` `/avatar/state` `/status`。
- mascot:6 PNG(白底,已切于本次)→ 放 `web/assets/mascot/`;未来可换 SVG / 自定义图集。
- 重写 CSS:统一 `tokens.css`(上述 token)+ 各页 CSS 按新系统重做;移动端修复(顶栏错乱)+ 安全区(`env(safe-area-inset-*)`)。
- 复用现有 OffscreenCanvas worker / 虚拟滚动 / PWA(前端优化已做的)。

## 8. 细节打磨清单(光滑细腻 · 实现时逐项验收)

- 统一缓动曲线(标准 + 弹性两条),无生硬跳变
- 气泡进入:fade + slide-up + 微 scale,连续消息 stagger
- mascot 表情 cross-fade morph(200ms),非硬切
- 流式回复:逐字 + 柔和打字光标
- 可点元素 `:active` 微反馈(scale + 透明度)
- 发丝分隔线 0.5px(非 1px)
- 字体抗锯齿 + 精确字距
- 骨架屏 / 加载态(非白屏)
- 平滑滚动 + 惯性 + 新消息自动吸底
- 移动端安全区(刘海/底部 home indicator)
- `prefers-reduced-motion` 降级
- 暗色模式 = 标注为未来,本次不做(YAGNI)

## 9. 范围与非目标

- **范围**:7 个页面视觉重做 + 设计系统 + mascot 情感联动 + 活着感集成 + 细节打磨。
- **非目标(本次不做)**:自定义角色/人设(未来)、暗色模式(未来)、多租户、后端 persona 措辞中性化(配套,可后续单独处理)。
