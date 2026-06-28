/**
 * src/memory/temporal-resolve.ts — B-1：bi-temporal 矛盾消解（北极星 §4.1）
 *
 * 由 eval:contradiction 实测驱动：记忆 store 新旧并存无失效（住杭州+住上海、美式+拿铁全在），
 * 规模化/隐式变更会退化（mem0 都退回 ADD-only 放弃了自动消解）。
 *
 * 本模块标记被「更新事实」取代的旧事实（invalidatedAt，bi-temporal：不删除留审计），
 * structured-memory.ts 的 activeEntities 据此把失效项排除出 prompt-facing 检索。
 *
 * 引擎 resolveContradictions 是纯函数（矛盾判定 contradicts 注入）：
 *   - 单测注入确定性 fake（可复现）；
 *   - 生产注入 makeLLMContradicts（真 provider，语义判定，像 Zep 的 per-edge 矛盾检查）。
 *
 * 接线（待续）：structured-memory.ts 的 LLM 提取路径 assembleMemory 后调用本 resolver。
 */

import type { MemoryEntity } from './structured-memory.js';
import type { AIProvider } from '../types.js';

/** 旧事实是否被新事实取代（同主题、值冲突）。可同步(测试)或异步(LLM)。 */
export type Contradicts = (older: MemoryEntity, newer: MemoryEntity) => boolean | Promise<boolean>;

/**
 * 标记被取代的旧事实。只在同 type、newer.firstSeen > older.firstSeen 的候选对上问 contradicts，
 * 命中则给 older 打 invalidatedAt + supersededBy。bi-temporal：保留实体，仅标失效。
 */
export async function resolveContradictions(
  entities: MemoryEntity[],
  contradicts: Contradicts,
  now: string,
): Promise<{ entities: MemoryEntity[]; supersededCount: number }> {
  const out = entities.map((e) => ({ ...e }));
  let supersededCount = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i].invalidatedAt) continue;
    for (let j = 0; j < out.length; j++) {
      if (i === j || out[j].invalidatedAt) continue;
      if (out[j].type !== out[i].type) continue;                       // 矛盾只在同类事实间
      if ((out[j].firstSeen ?? '') <= (out[i].firstSeen ?? '')) continue; // j 必须更新
      if (await contradicts(out[i], out[j])) {
        out[i].invalidatedAt = now;
        out[i].supersededBy = out[j].content;
        supersededCount++;
        break;
      }
    }
  }
  return { entities: out, supersededCount };
}

const CONTRADICT_SYSTEM = `你判断"新事实"是否取代(更新)"旧事实"——同一属性的值变了、旧的不再成立。果断判断。

判 true（取代）的例子：
- 旧:用户在北京工作 / 新:用户现在在深圳工作 → true（工作地变了）
- 旧:用户在北京工作 / 新:用户上个月从北京调到了深圳 → true（已搬走，旧址不再成立）
- 旧:用户爱吃辣 / 新:用户现在忌口不吃辣了 → true（偏好反转）

判 false（不取代）的例子：
- 旧:用户在北京工作 / 新:用户曾经在北京工作 → false（在确认过去，没换成新值）
- 旧:用户叫小明 / 新:用户在准备考试 → false（不同属性，可同时成立）
- 旧:用户爱跑步 / 新:用户最近在赶项目 → false（互不相关）

规则：同一属性、值确实发生了变化 = true；不同属性、互不相关、或只是在补充/确认 = false。
只输出 JSON：{"supersedes": true} 或 {"supersedes": false}`;

/**
 * 生产用：基于真 provider 的语义矛盾判定（像 Zep 的 per-edge 矛盾检查）。
 * 接线时注入给 resolveContradictions。失败默认 false（宁可漏标，不可误杀记忆）。
 */
export function makeLLMContradicts(provider: AIProvider, model?: string): Contradicts {
  return async (older, newer) => {
    try {
      const res = await provider.chat(
        [{ role: 'user', content: `旧事实：${older.content}\n新事实：${newer.content}` }],
        CONTRADICT_SYSTEM,
        [],
        { temperature: 0, model },
      );
      const m = res.text.match(/\{[\s\S]*\}/);
      if (!m) return false;
      return JSON.parse(m[0]).supersedes === true;
    } catch {
      return false; // 判定失败时不标失效，保守
    }
  };
}
