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

export function resolveContradictionsSync(
  entities: MemoryEntity[],
  contradicts: (older: MemoryEntity, newer: MemoryEntity) => boolean,
  now: string,
): { entities: MemoryEntity[]; supersededCount: number } {
  const out = entities.map((e) => ({ ...e }));
  let supersededCount = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i].invalidatedAt) continue;
    for (let j = 0; j < out.length; j++) {
      if (i === j || out[j].invalidatedAt) continue;
      if (out[j].type !== out[i].type) continue;
      if ((out[j].firstSeen ?? '') <= (out[i].firstSeen ?? '')) continue;
      if (contradicts(out[i], out[j])) {
        out[i].invalidatedAt = now;
        out[i].supersededBy = out[j].content;
        supersededCount++;
        break;
      }
    }
  }
  return { entities: out, supersededCount };
}

export function makeRuleBasedContradicts(): Contradicts {
  return (older, newer) => {
    const oldText = normalizeText(older.content);
    const newText = normalizeText(newer.content);

    const oldSlot = extractSingleValueSlot(oldText);
    const newSlot = extractSingleValueSlot(newText);
    if (oldSlot && newSlot && oldSlot.slot === newSlot.slot && oldSlot.value !== newSlot.value) {
      return true;
    }

    if (older.type === 'preference' && newer.type === 'preference') {
      return preferenceNegates(oldText, newText);
    }

    return false;
  };
}

export function combineContradicts(primary: Contradicts, fallback: Contradicts): Contradicts {
  return async (older, newer) => {
    if (await primary(older, newer)) return true;
    return fallback(older, newer);
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').replace(/[。！？!?，,、.]/g, '');
}

type SingleValueSlot =
  | 'lives_in'
  | 'works_at'
  | 'studies_at'
  | 'drink_preference'
  | 'support_style'
  | 'relationship_boundary'
  | 'project_context';

function extractSingleValueSlot(text: string): { slot: SingleValueSlot; value: string } | null {
  const projectChange = text.match(/(?:不做|暂停|先不管)(论文|简历|毕设|项目|报告|考试|面试)(?:了|啦)?(?:改做|在做|忙|准备)(论文|简历|毕设|项目|报告|考试|面试)/);
  if (projectChange) return { slot: 'project_context', value: projectChange[2] };
  const project = text.match(/(?:在做|忙|准备|主要弄|主要做)(论文|简历|毕设|项目|报告|考试|面试)/);
  if (project) return { slot: 'project_context', value: project[1] };

  const live = text.match(/用户(?:现在)?(?:住在|在)(\S{2,20}?)(?:住|居住)?(?:了|啦)?$/)
    ?? text.match(/用户(?:搬到|搬去|搬进)(\S{2,20}?)(?:了|啦)?(?:现在住\1)?$/)
    ?? text.match(/用户.*现在住(\S{2,20}?)(?:了|啦)?$/);
  if (live) return { slot: 'lives_in', value: cleanValue(live[1]) };

  const work = text.match(/用户(?:现在)?在(\S{2,30}?)(?:工作|上班)(?:了|啦)?$/)
    ?? text.match(/用户(?:入职|去了|换到)(\S{2,30}?)(?:工作|上班)?(?:了|啦)?$/);
  if (work) return { slot: 'works_at', value: cleanValue(work[1]) };

  const study = text.match(/用户(?:现在)?在(\S{2,30}?)(?:上学|读书|学习)(?:了|啦)?$/)
    ?? text.match(/用户(?:转到|考到|去了)(\S{2,30}?)(?:上学|读书|学习)?(?:了|啦)?$/);
  if (study) return { slot: 'studies_at', value: cleanValue(study[1]) };

  const drinkChange = text.match(/(?:不喝|不喜欢喝|别给我|不要给我|不用给我)(咖啡|奶茶|茶|可乐|酒)(?:了|啦)?(?:改喝|喝|想喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/);
  if (drinkChange) return { slot: 'drink_preference', value: drinkChange[2] };
  const drink = text.match(/(?:喜欢喝|想喝|改喝|只喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/);
  if (drink) return { slot: 'drink_preference', value: drink[1] };

  const support = supportStyleValue(text);
  if (support) return { slot: 'support_style', value: support };

  const boundary = relationshipBoundaryValue(text);
  if (boundary) return { slot: 'relationship_boundary', value: boundary };

  return null;
}

function preferenceNegates(oldText: string, newText: string): boolean {
  if (!/(别|不要|不想|不喜欢|讨厌|别再|以后别)/.test(newText)) return false;
  const oldCalled = oldText.match(/(?:叫|称呼)(?:我|用户)?(\S{1,12})/);
  if (oldCalled && newText.includes(oldCalled[1])) return true;

  const oldLike = oldText.match(/(?:喜欢|爱|偏好)(\S{2,20})/);
  if (oldLike && newText.includes(oldLike[1])) return true;

  return false;
}

function supportStyleValue(text: string): 'companionship' | 'advice' | null {
  if (/(?:别|不要|不用|先别)(?:给我)?(?:建议|讲道理|分析|解决方案)/.test(text)) return 'companionship';
  if (/(?:只想|就想|需要|想要).{0,8}(?:陪我|抱抱|听我说|安静陪着)/.test(text)) return 'companionship';
  if (/(?:可以|需要|想要|给我).{0,8}(?:建议|分析|解决方案|办法)/.test(text)) return 'advice';
  if (/(?:建议|分析|解决方案|办法)/.test(text) && !/(?:别|不要|不用|先别)/.test(text)) return 'advice';
  return null;
}

function relationshipBoundaryValue(text: string): 'slow' | 'intimate' | null {
  if (/(?:刚认识|慢慢来|先别太亲密|别太黏|不要太黏|别叫宝贝|不要叫宝贝|别说爱我|不要说爱我)/.test(text)) return 'slow';
  if (/(?:黏一点|亲密一点|叫我宝贝|叫宝贝|说爱我|宝贝|爱你)/.test(text) && !/(?:别|不要|刚认识|慢慢来)/.test(text)) return 'intimate';
  return null;
}

function cleanValue(value: string): string {
  return value.replace(/(?:现在|目前|已经|了|啦)$/g, '').slice(0, 30);
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
