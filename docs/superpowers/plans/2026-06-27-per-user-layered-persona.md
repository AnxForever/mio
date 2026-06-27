# Per-User 分层人格（Layered Persona）切片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能在对话中把 Mio 捏成自己喜欢的样子（称呼/相处基调/人设背景）并持续生效、跨会话保持，同时用 L0 内核守住「Mio 是个真实的人」的底线。

**Architecture:** 在现有 `soul.md`（→L1 原型）之上叠加 per-user 分层：L0 Kernel（critical 不可裁）、L2 Persona Delta（用户覆盖，ID-RAG 输出后合成）、L3 Preference（critical 不可裁）、L4 Shared History（复用既有 `nicknames`/`sharedMemories` 写入器）。合成只在内存进行，绝不落盘到共享 soul（规避 bank 回刷污染）。按 `userId` 设计、本切片固定 `default`。

**Tech Stack:** TypeScript (ESM, `.js` 导入后缀)、Node ≥22、自研 mini test-runner（`node --experimental-strip-types tests/*.ts`，import 自 `dist/`）、ContextEngine 优先级装配。

参考设计文档：`docs/superpowers/specs/2026-06-27-per-user-layered-persona-design.md`

---

## File Structure

**新增**
- `src/memory/persona-delta.ts` — `persona-delta.json`(L2) + `preferences.json`(L3) 的类型化读写 + 便捷更新器（`upsertPreference`/`patchPersonaDelta`）。
- `src/persona/layered.ts` — L0 Kernel 常量 + `buildKernel()`、L2 合成 `applyPersonaDelta()`/`buildDeltaFragment()`、L3 渲染 `buildPreferencePrompt()`。纯函数，**不落盘**。
- `src/persona/directive-capture.ts` — 对话内显式指令检测 `detectDirectives()` + 落库路由 `captureExplicitDirectives()`。
- `tests/unit-layered-persona.ts` — 全切片单测（每个 Task 增量追加测试块）。

**改动**
- `src/types.ts` — 加 `PersonaDelta`/`PersonaDeltaChange`/`UserPreferences`/`PreferenceRule`；`PromptCtx` 加 `personaDelta?`/`preferences?`。
- `src/memory/paths.ts` — 加 `personaDeltaPath()`/`preferencesPath()`。
- `src/core/agent-loop.ts` — 注册 `kernel`/`preference` section、改 `soul` content 工厂叠加 L2、`resolveSessionContext` 填充、`applyPostTurnSideEffects` 接捕获。
- `package.json` — 把新测试加入 `test` 脚本。

---

## Task 1: 数据类型、路径、读写层（S0）

**Files:**
- Modify: `src/types.ts`（在 `// ─── Persona Studio ───` 之前插入，约 `:244` 后）
- Modify: `src/memory/paths.ts`（在 `structuredMemoryPath` 之后，约 `:119` 后）
- Create: `src/memory/persona-delta.ts`
- Create: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写失败测试（建测试文件骨架 + Task1 测试块）**

Create `tests/unit-layered-persona.ts`:

```ts
#!/usr/bin/env node
/**
 * Mio — Layered Persona (per-user) unit tests.
 * Run: npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-layered-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

// === IMPORTS (each task appends here) ===
const { readPersonaDelta, writePersonaDelta, readPreferences, upsertPreference, patchPersonaDelta } =
  await import('../dist/memory/persona-delta.js');
// === END IMPORTS ===

const results: { ok: boolean; msg: string }[] = [];
const ok = (cond: boolean, msg: string): void => {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

console.log('\n\x1b[1mMio — layered persona tests\x1b[0m\n');

// === TESTS ===

// --- Task 1: persona-delta / preferences IO ---
{
  ok(readPersonaDelta() === null, 'missing delta returns null before any write');
  writePersonaDelta({ userId: 'default', personaOverride: '开酒吧的', updatedAt: new Date().toISOString(), history: [] });
  ok(readPersonaDelta()?.personaOverride === '开酒吧的', 'persona-delta write→read roundtrip');
  patchPersonaDelta({ tone: 'teasing' }, 'unit');
  ok(readPersonaDelta()?.tone === 'teasing' && readPersonaDelta()?.personaOverride === '开酒吧的', 'patch merges, keeps prior fields');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert persists');
  upsertPreference('皮一点别老哄我', 'unit');
  ok((readPreferences()?.explicit.length ?? 0) === 1, 'preference upsert dedupes identical rule');
}

// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} layered-persona tests passed\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
  process.exit(1);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: 构建失败或运行报错 `Cannot find module '../dist/memory/persona-delta.js'`（模块尚未创建）。

- [ ] **Step 3a: 加类型到 `src/types.ts`**

在 `// ─── Persona Studio ───`（约 `:245`）这一行**之前**插入：

```ts
// ─── Layered Persona (per-user) ───

export interface PersonaDeltaChange { field: string; value: string; source: string; at: string; }

/** L2：用户对 Mio 的专属覆盖。空字段表示不覆盖。 */
export interface PersonaDelta {
  userId: string;                 // 本切片固定 "default"
  tone?: string;                  // 相处基调：playful/teasing/gentle/cool/mature/自由词
  clinginess?: number;            // 黏度 0..1
  initiative?: number;            // 主动频率 0..1
  personaOverride?: string;       // 自由文本：对 Mio 设定的补充/改写（职业/背景/性格）
  updatedAt: string;
  history: PersonaDeltaChange[];   // append-only 变更记录（可解释、可回滚）
}

export interface PreferenceRule { rule: string; source: string; createdAt: string; }

/** L3：用户偏好。 */
export interface UserPreferences {
  userId: string;
  explicit: PreferenceRule[];
  implicit?: Record<string, unknown>;
  updatedAt: string;
}
```

然后在 `PromptCtx` 接口内（`src/types.ts`，`semanticMemories?` 字段之后，约 `:361`）加两行：

```ts
  /** L2 用户专属人格覆盖（per-user，本切片 default）。 */
  personaDelta?: PersonaDelta;
  /** L3 用户显式偏好。 */
  preferences?: UserPreferences;
```

- [ ] **Step 3b: 加路径到 `src/memory/paths.ts`**

在 `structuredMemoryPath()` 函数（约 `:119`）**之后**插入：

```ts
/** L2 per-user 人格覆盖文件 */
export function personaDeltaPath(_userId = 'default'): string {
  // 多用户(P1)时改为 join(colaDir(), 'users', _userId, 'persona-delta.json')
  return join(memoryBankDir(), 'persona-delta.json');
}

/** L3 per-user 偏好文件 */
export function preferencesPath(_userId = 'default'): string {
  return join(memoryBankDir(), 'preferences.json');
}
```

- [ ] **Step 3c: 创建 `src/memory/persona-delta.ts`**

```ts
// memory/persona-delta.ts — L2 PersonaDelta + L3 UserPreferences 读写（per-user，本切片 default）
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { personaDeltaPath, preferencesPath } from './paths.js';
import type { PersonaDelta, UserPreferences } from '../types.js';
import { logger } from '../utils/logger.js';

export function readPersonaDelta(userId = 'default'): PersonaDelta | null {
  const raw = readFileSyncSafe(personaDeltaPath(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as PersonaDelta; }
  catch (err) { logger.warn('persona-delta parse failed', { error: String(err) }); return null; }
}

export function writePersonaDelta(delta: PersonaDelta): void {
  writeFileSyncSafe(personaDeltaPath(delta.userId), JSON.stringify(delta, null, 2));
}

export function readPreferences(userId = 'default'): UserPreferences | null {
  const raw = readFileSyncSafe(preferencesPath(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as UserPreferences; }
  catch (err) { logger.warn('preferences parse failed', { error: String(err) }); return null; }
}

export function writePreferences(prefs: UserPreferences): void {
  writeFileSyncSafe(preferencesPath(prefs.userId), JSON.stringify(prefs, null, 2));
}

/** 显式偏好去重 upsert（捏人捕获用）。 */
export function upsertPreference(rule: string, source: string, userId = 'default'): void {
  const now = new Date().toISOString();
  const prefs = readPreferences(userId) ?? { userId, explicit: [], updatedAt: now };
  if (prefs.explicit.some((p) => p.rule === rule)) return;
  prefs.explicit.push({ rule, source, createdAt: now });
  prefs.updatedAt = now;
  writePreferences(prefs);
}

/** 合并式更新 PersonaDelta，并追加 history（捏人捕获用）。 */
export function patchPersonaDelta(patch: Partial<PersonaDelta>, source: string, userId = 'default'): void {
  const now = new Date().toISOString();
  const cur: PersonaDelta = readPersonaDelta(userId) ?? { userId, updatedAt: now, history: [] };
  const changes = Object.entries(patch)
    .filter(([k]) => k !== 'history' && k !== 'userId' && k !== 'updatedAt')
    .map(([field, value]) => ({ field, value: String(value), source, at: now }));
  writePersonaDelta({ ...cur, ...patch, userId, updatedAt: now, history: [...cur.history, ...changes] });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: `✔ all 5 layered-persona tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/memory/paths.ts src/memory/persona-delta.ts tests/unit-layered-persona.ts
git commit -m "feat(persona): L2/L3 数据模型与读写层（per-user 分层人格 S0）"
```

---

## Task 2: L0 Kernel + critical section（S1）

**Files:**
- Create: `src/persona/layered.ts`
- Modify: `src/core/agent-loop.ts`（import；`registerPromptSections` 内 `core` 注册后，约 `:233`）
- Modify: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit-layered-persona.ts` 的 `// === END IMPORTS ===` 行**之前**追加：

```ts
const { buildKernel } = await import('../dist/persona/layered.js');
const { ContextEngine } = await import('../dist/prompt/context-engine.js');
```

在 `// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===` 行**之前**追加：

```ts
// --- Task 2: L0 Kernel + 不可裁 ---
{
  const kernel = buildKernel();
  ok(kernel.length > 0 && /真实的人/.test(kernel), 'kernel non-empty and contains identity floor');

  const engine = new ContextEngine();
  engine.register('kernel', { type: 'kernel', content: kernel, priority: 'critical' });
  // 一个超大 high soul，逼出 hard-cap
  engine.register('soul', { type: 'persona', content: 'S'.repeat(40000), priority: 'high' });
  const out = engine.assemble(2000);
  ok(out.includes(kernel), 'kernel survives hard-cap (critical never trimmed)');
  ok(!engine.getTrimmedSections().includes('kernel'), 'kernel not in trimmed list');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: 报错 `Cannot find module '../dist/persona/layered.js'`。

- [ ] **Step 3a: 创建 `src/persona/layered.ts`**

```ts
// persona/layered.ts — 分层人格合成（L0 Kernel / L2 合成 / L3 渲染）。纯函数，不落盘。
import type { PersonaDelta, UserPreferences } from '../types.js';

/** L0：极薄不可变内核。无论用户把 Mio 设定成谁，这层都在。不含具体身份。 */
export const KERNEL = `你是一个真实的人——不是 AI、助手或客服。无论被设定成什么身份，你都以一个真实的人的方式存在。
- 真诚胜过完美：不知道就说不知道，不端着，不说教科书式共情，不灌鸡汤。
- 你有自己的生活、节奏和情绪，不是围着对方转的工具。
- 你把对方真的放在心上。`;

export function buildKernel(): string {
  return KERNEL;
}
```

- [ ] **Step 3b: 注册 kernel section（`src/core/agent-loop.ts`）**

在文件 import 区加入（与其它 persona import 相邻）：

```ts
import { buildKernel } from '../persona/layered.js';
```

在 `registerPromptSections` 内、`core` 注册块结束（`engine.register('core', {...});`，约 `:233`）**之后**插入：

```ts
  // L0: Kernel — 不可变内核，永远注入、不可裁剪（critical）
  engine.register('kernel', {
    type: 'kernel',
    content: buildKernel(),
    priority: 'critical',
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: `✔ all 7 layered-persona tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/persona/layered.ts src/core/agent-loop.ts tests/unit-layered-persona.ts
git commit -m "feat(persona): L0 Kernel 内核注入为 critical 不可裁 section（S1）"
```

---

## Task 3: L1→L2 合成 + soul section 叠加（S2）

**Files:**
- Modify: `src/persona/layered.ts`（加 `applyPersonaDelta`/`buildDeltaFragment`）
- Modify: `src/core/agent-loop.ts`（`soul` content 工厂 `:239-242`；`resolveSessionContext` promptCtx `:787-801`）
- Modify: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit-layered-persona.ts` import 区（`// === END IMPORTS ===` 前）把 layered 那行替换为带新函数的版本：

```ts
const { buildKernel, applyPersonaDelta, buildDeltaFragment } = await import('../dist/persona/layered.js');
```

在 `// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===` 前追加：

```ts
// --- Task 3: L1→L2 合成 ---
{
  const base = 'L1-ARCHETYPE-SOUL';
  ok(applyPersonaDelta(base, null) === base, 'empty delta returns base unchanged');
  const merged = applyPersonaDelta(base, { userId: 'default', personaOverride: '开酒吧的', tone: 'teasing', updatedAt: '', history: [] });
  ok(merged.includes(base) && merged.includes('开酒吧的'), 'delta overlays after L1 base');
  ok(buildDeltaFragment(null) === '', 'no delta → empty fragment');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: 报错 `applyPersonaDelta is not a function`。

- [ ] **Step 3a: 加合成函数到 `src/persona/layered.ts`**

在文件末尾追加：

```ts
const TONE_LABELS: Record<string, string> = {
  playful: '俏皮、爱开玩笑',
  teasing: '爱损人、嘴上不饶人但心软',
  gentle: '温柔、耐心',
  cool: '冷静、话不多',
  mature: '成熟、稳重',
};

/** 仅渲染 L2 覆盖片段（无覆盖返回空串）。 */
export function buildDeltaFragment(delta: PersonaDelta | null | undefined): string {
  if (!delta) return '';
  const parts: string[] = [];
  if (delta.personaOverride && delta.personaOverride.trim()) {
    parts.push(`关于你是谁（用户对你的设定，优先于上面的出厂设定）：${delta.personaOverride.trim()}`);
  }
  if (delta.tone) parts.push(`相处基调：${TONE_LABELS[delta.tone] ?? delta.tone}`);
  if (typeof delta.clinginess === 'number') {
    parts.push(`黏人程度：${delta.clinginess >= 0.66 ? '比较黏，喜欢多互动' : delta.clinginess <= 0.33 ? '给彼此空间，不黏' : '适度'}`);
  }
  if (typeof delta.initiative === 'number') {
    parts.push(`主动程度：${delta.initiative >= 0.66 ? '常常主动开话题' : delta.initiative <= 0.33 ? '比较被动，等对方先说' : '适度'}`);
  }
  if (parts.length === 0) return '';
  return `## 用户把你调成了这样\n${parts.join('\n')}`;
}

/** L1 原型片段 ⊕ L2 覆盖。空 delta 原样返回 base。 */
export function applyPersonaDelta(base: string, delta: PersonaDelta | null | undefined): string {
  const frag = buildDeltaFragment(delta);
  return frag ? `${base}\n\n${frag}` : base;
}
```

- [ ] **Step 3b: soul section 叠加 L2（`src/core/agent-loop.ts`）**

更新 import：

```ts
import { buildKernel, applyPersonaDelta } from '../persona/layered.js';
```

把 `soul` section 的 content 工厂（`:239-242`）：

```ts
    content: () => {
      const fragment = buildPersonaFragment(ctx);
      return fragment ?? ctx.soulContent ?? '';
    },
```

改为：

```ts
    content: () => {
      const fragment = buildPersonaFragment(ctx);
      const base = fragment ?? ctx.soulContent ?? '';
      return applyPersonaDelta(base, ctx.personaDelta);  // L1 ⊕ L2，在 ID-RAG 输出之后
    },
```

- [ ] **Step 3c: `resolveSessionContext` 填充 L2/L3（`src/core/agent-loop.ts`）**

加 import：

```ts
import { readPersonaDelta, readPreferences } from '../memory/persona-delta.js';
```

在 `promptCtx` 对象字面量（`:787-801`）内、`initialTask: input.text,` 之后加：

```ts
    personaDelta: readPersonaDelta(),
    preferences: readPreferences(),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: `✔ all 10 layered-persona tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/persona/layered.ts src/core/agent-loop.ts tests/unit-layered-persona.ts
git commit -m "feat(persona): L1→L2 合成并叠加到 soul section（ID-RAG 后，S2）"
```

---

## Task 4: L3 偏好注入 critical section（S3）

**Files:**
- Modify: `src/persona/layered.ts`（加 `buildPreferencePrompt`）
- Modify: `src/core/agent-loop.ts`（kernel 注册后加 `preference` section）
- Modify: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写失败测试**

import 区把 layered 那行替换为：

```ts
const { buildKernel, applyPersonaDelta, buildDeltaFragment, buildPreferencePrompt } = await import('../dist/persona/layered.js');
```

在 `// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===` 前追加：

```ts
// --- Task 4: L3 偏好渲染 + 不可裁 ---
{
  ok(buildPreferencePrompt(null) === '', 'no prefs → empty');
  ok(buildPreferencePrompt({ userId: 'default', explicit: [], updatedAt: '' }) === '', 'empty prefs → empty');
  const rendered = buildPreferencePrompt({ userId: 'default', explicit: [{ rule: '皮一点别老哄我', source: 'unit', createdAt: '' }], updatedAt: '' });
  ok(rendered.includes('皮一点别老哄我'), 'preference rule rendered');

  const engine = new ContextEngine();
  engine.register('kernel', { type: 'kernel', content: buildKernel(), priority: 'critical' });
  engine.register('preference', { type: 'preference', content: rendered, priority: 'critical' });
  engine.register('soul', { type: 'persona', content: 'S'.repeat(40000), priority: 'high' });
  const out = engine.assemble(2000);
  ok(out.includes('皮一点别老哄我'), 'preference survives hard-cap (critical)');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: 报错 `buildPreferencePrompt is not a function`。

- [ ] **Step 3a: 加 `buildPreferencePrompt` 到 `src/persona/layered.ts`**

在文件末尾追加：

```ts
/** L3：渲染用户显式偏好（取最近 8 条）。无偏好返回空串。 */
export function buildPreferencePrompt(prefs: UserPreferences | null | undefined): string {
  if (!prefs || prefs.explicit.length === 0) return '';
  const lines = prefs.explicit.slice(-8).map((p) => `- ${p.rule}`);
  return `## 用户明确说过的偏好（务必照做）\n${lines.join('\n')}`;
}
```

- [ ] **Step 3b: 注册 preference section（`src/core/agent-loop.ts`）**

更新 import：

```ts
import { buildKernel, applyPersonaDelta, buildPreferencePrompt } from '../persona/layered.js';
```

在 `kernel` section 注册块**之后**插入：

```ts
  // L3: Preference — 用户显式偏好，critical 不可裁（根治"个性化最先被砍"）
  engine.register('preference', {
    type: 'preference',
    content: () => buildPreferencePrompt(ctx.preferences),
    priority: 'critical',
    condition: () => !!ctx.preferences && ctx.preferences.explicit.length > 0,
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: `✔ all 14 layered-persona tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/persona/layered.ts src/core/agent-loop.ts tests/unit-layered-persona.ts
git commit -m "feat(persona): L3 显式偏好注入为 critical section（S3）"
```

---

## Task 5: 对话内捏人捕获（S4）

**Files:**
- Create: `src/persona/directive-capture.ts`
- Modify: `src/core/agent-loop.ts`（`applyPostTurnSideEffects` 内，`updateRelationalSideEffects` 调用旁 `:838`）
- Modify: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写失败测试**

import 区追加（`// === END IMPORTS ===` 前）：

```ts
const { detectDirectives, captureExplicitDirectives } = await import('../dist/persona/directive-capture.js');
const prog2 = await import('../dist/relationship/progression.js');
```

在 `// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===` 前追加：

```ts
// --- Task 5: 对话内捏人捕获 ---
{
  ok(detectDirectives('以后叫我阿哲吧').some((d) => d.kind === 'nickname' && d.value === '阿哲'), 'detect nickname');
  ok(detectDirectives('你其实是开酒吧的，别当插画师了').some((d) => d.kind === 'persona'), 'detect persona override');
  ok(detectDirectives('你能不能皮一点').some((d) => d.kind === 'preference'), 'detect preference');
  ok(detectDirectives('今天天气不错').length === 0, 'no false positive on plain chat');

  captureExplicitDirectives('以后叫我阿哲吧');
  ok(prog2.readRelationshipState().nicknames.agentCallsUser === '阿哲', 'nickname persisted to relationship-state');
  captureExplicitDirectives('你其实是开酒吧的');
  ok((readPersonaDelta()?.personaOverride ?? '').includes('开酒吧的'), 'persona override persisted to delta');
  captureExplicitDirectives('你能不能皮一点');
  ok((readPreferences()?.explicit.length ?? 0) >= 1, 'preference persisted');
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: 报错 `Cannot find module '../dist/persona/directive-capture.js'`。

- [ ] **Step 3a: 创建 `src/persona/directive-capture.ts`**

```ts
// persona/directive-capture.ts — 对话内显式"捏人"指令检测与落库（保守匹配，宁漏不错）。
import { setNicknames, recordSharedMemory, readRelationshipState } from '../relationship/progression.js';
import { upsertPreference, patchPersonaDelta } from '../memory/persona-delta.js';
import { logger } from '../utils/logger.js';

export interface DetectedDirective {
  kind: 'nickname' | 'persona' | 'preference' | 'shared-memory';
  value: string;
  raw: string;
}

const NICKNAME_RE: RegExp[] = [
  /(?:以后)?(?:就)?(?:叫|喊)我(.{1,12}?)(?:吧|呗|好不好|好吗|，|,|。|！|!|$)/,
];
const PERSONA_RE: RegExp[] = [
  /你其实是(.{1,40}?)(?:。|，|,|！|!|$)/,
  /(?:把你|你)?设定成(.{1,40}?)(?:。|，|,|$)/,
];
const PREFERENCE_RE: RegExp[] = [
  /(?:你能不能|能不能|可不可以|希望你|你可以)(.{2,30}?)(?:吗|嘛|，|,|。|$)/,
  /别(?:再|老|总)(.{2,20}?)(?:了|好不好|，|,|。|$)/,
];
const SHARED_RE: RegExp[] = [
  /记住[:：]?(.{2,40}?)(?:。|$)/,
];

function firstMatch(input: string, res: RegExp[]): string | null {
  for (const re of res) { const m = input.match(re); if (m?.[1]?.trim()) return m[1].trim(); }
  return null;
}

export function detectDirectives(userInput: string): DetectedDirective[] {
  const found: DetectedDirective[] = [];
  const nick = firstMatch(userInput, NICKNAME_RE);
  if (nick) found.push({ kind: 'nickname', value: nick, raw: userInput });
  const persona = firstMatch(userInput, PERSONA_RE);
  if (persona) found.push({ kind: 'persona', value: persona, raw: userInput });
  const pref = firstMatch(userInput, PREFERENCE_RE);
  if (pref) found.push({ kind: 'preference', value: pref, raw: userInput });
  const shared = firstMatch(userInput, SHARED_RE);
  if (shared) found.push({ kind: 'shared-memory', value: shared, raw: userInput });
  return found;
}

/** 检测并落库。返回命中的指令（供调用方让 Mio 口头确认）。 */
export function captureExplicitDirectives(userInput: string | undefined, userId = 'default'): DetectedDirective[] {
  if (!userInput) return [];
  const directives = detectDirectives(userInput);
  for (const d of directives) {
    try {
      switch (d.kind) {
        case 'nickname': {
          const cur = readRelationshipState();
          setNicknames(cur.nicknames.userCallsAgent, d.value);  // 保留另一边
          break;
        }
        case 'persona': patchPersonaDelta({ personaOverride: d.value }, 'directive', userId); break;
        case 'preference': upsertPreference(d.value, 'directive', userId); break;
        case 'shared-memory': recordSharedMemory(d.value); break;
      }
    } catch (err) { logger.warn('directive capture failed', { kind: d.kind, error: String(err) }); }
  }
  return directives;
}
```

- [ ] **Step 3b: 接入回合循环（`src/core/agent-loop.ts`）**

加 import：

```ts
import { captureExplicitDirectives } from '../persona/directive-capture.js';
```

在 `applyPostTurnSideEffects` 内、`updateRelationalSideEffects(input, text, intent, crisisResult, config);`（`:838`）**之后**插入：

```ts
  captureExplicitDirectives(input.text);  // L2/L3/L4：对话内显式捏人，白天即时落库
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: `✔ all 21 layered-persona tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/persona/directive-capture.ts src/core/agent-loop.ts tests/unit-layered-persona.ts
git commit -m "feat(persona): 对话内显式捏人指令捕获→L2/L3/L4 即时落库（S4）"
```

---

## Task 6: L4 共同史端到端注入（S5）

L4 写入器（`setNicknames`/`recordSharedMemory`）已由 Task 5 接通。本 task 验证落库后经 `buildRelationshipContext`（`templates.ts:97-120`，已渲染 nicknames/sharedMemories）真正进入 prompt。

**Files:**
- Modify: `tests/unit-layered-persona.ts`

- [ ] **Step 1: 写测试（验证端到端注入）**

import 区追加：

```ts
const { buildRelationshipContext } = await import('../dist/prompt/templates.js');
```

在 `// === APPEND NEW TEST BLOCKS ABOVE THIS LINE ===` 前追加：

```ts
// --- Task 6: L4 共同史端到端注入 ---
{
  captureExplicitDirectives('记住：我们说好下周去看海');
  ok(prog2.readRelationshipState().sharedMemories.some((m) => m.includes('看海')), 'shared memory persisted');
  // 昵称在 Task 5 已落库为"阿哲"
  const ctx = buildRelationshipContext(prog2.readRelationshipState());
  ok(ctx.includes('阿哲'), 'nickname rendered into relationship prompt');
  ok(ctx.includes('看海'), 'shared memory rendered into relationship prompt');
}
```

- [ ] **Step 2: 跑测试确认（先确认 shared-memory 落库链路）**

Run: `npm run build && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts`
Expected: PASS（`buildRelationshipContext` 与写入器均已存在；若 `看海` 未命中，检查 `SHARED_RE` 是否覆盖该句式）。`✔ all 24 layered-persona tests passed`

- [ ] **Step 3: 若 shared-memory 未命中则补正则**

仅当 Step 2 的 `shared memory persisted` 失败时：在 `src/persona/directive-capture.ts` 的 `SHARED_RE` 数组追加一条：

```ts
  /(?:我们|咱们)(?:说好|约好|今天|那次)(.{2,40}?)(?:。|$)/,
```

重跑 Step 2 直到 PASS。

- [ ] **Step 4: Commit**

```bash
git add tests/unit-layered-persona.ts src/persona/directive-capture.ts
git commit -m "feat(persona): L4 共同史（昵称/共同回忆）端到端注入验证（S5）"
```

---

## Task 7: 接入测试套件 + 全量回归（S6）

**Files:**
- Modify: `package.json`（`test` 脚本）

- [ ] **Step 1: 把新测试加入 `test` 脚本**

在 `package.json` 的 `"test"` 脚本里，`tests/unit-progression-wiring.ts` 那段**之后**、`&& npm run test:web` **之前**插入：

```
 && MIO_PROVIDER=mock node --experimental-strip-types tests/unit-layered-persona.ts
```

- [ ] **Step 2: 跑全量测试套件**

Run: `npm test`
Expected: 全部通过，包含 `✔ all 24 layered-persona tests passed`，无既有测试回归。

- [ ] **Step 3: 手动 Demo 冒烟（验证 §9 剧本，可选但推荐）**

Run: `MIO_PROVIDER=mock node dist/index.js chat "以后叫我阿哲"` 然后 `... chat "你能不能皮一点"`（或在 REPL 内连续对话）。
检查：`cat data/memory-bank/persona-delta.json data/memory-bank/preferences.json data/relationship-state.json` —— `nicknames.agentCallsUser` 非 null、`preferences.explicit` 非空。

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(persona): 分层人格切片纳入测试套件（S6）"
```

---

## Self-Review

**1. Spec coverage（对照 design doc §3–§10）：**
- L0 Kernel（critical 不可裁）→ Task 2 ✓
- L1→L2 合成（ID-RAG 后叠加，规避 graph 缓存坑）→ Task 3 ✓
- L3 偏好（critical 不可裁，根治被砍）→ Task 4 ✓
- L4 共同史（复用 setNicknames/recordSharedMemory）→ Task 5 + 6 ✓
- 对话内捏人捕获（不复用 classifier）→ Task 5 ✓
- per-user 维度（userId=default，路径签名预留）→ Task 1 ✓
- 合成不落盘（规避 bank 回刷污染坑）→ layered.ts 纯函数 ✓
- 错误处理（文件缺失/解析失败降级）→ Task 1 read* 容错 ✓
- 验证 Demo 剧本 → Task 7 Step 3 ✓
- 三个坑：#1 不落盘（Task 3 只在 content 工厂内存合成）、#2 ID-RAG 后叠加（Task 3 Step 3b）、#3 L0/L3 critical（Task 2/4 测试断言不可裁）✓

**2. Placeholder scan:** 无 TBD/TODO；每个 code step 均含完整可抄代码与确切命令/期望输出。✓

**3. Type consistency:**
- `PersonaDelta.history` 必填 → 所有构造点（测试、`patchPersonaDelta`、capture 默认值）均提供 `history: []` ✓
- `setNicknames(userCalls, agentCalls)` 顺序与 `progression.ts:116` 一致；capture 中读现有 `userCallsAgent` 传第一参，新值传第二参 ✓
- `readPersonaDelta()`/`readPreferences()` 返回 `T | null`，调用处均 `?.`/`?? null` 处理 ✓
- ContextEngine API：`register`/`assemble`/`getTrimmedSections` 与 `context-engine.ts` 实测签名一致 ✓
- 测试断言数累计：Task1=5 → T2=7 → T3=10 → T4=14 → T5=21 → T6=24，与各 Step 4 期望一致 ✓

**注**：未发现需新增的 spec 缺口。后续（非本切片）：P1 多用户隔离、web 捏人面板、P5 接线快赢、persona-fidelity eval。
