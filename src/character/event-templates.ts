/**
 * Mio — Life Event Templates
 *
 * 200+ Chinese event templates organized by category.
 * Each template has PAD emotional impact and importance score.
 *
 * Placeholders: {name} {pronoun} {occupation} {occupationContext}
 * {pronoun} = 他/她 based on character gender
 * {occupationContext} = occupation-specific flavor text
 */

import type { EventTemplate, LifeEventCategory, EmotionalImpact } from './types.js';

// ─── Helper ───

function t(
  text: string,
  category: LifeEventCategory,
  padDelta: [number, number, number], // [pleasure, arousal, dominance]
  importance = 0.4,
  tags: string[] = [],
): EventTemplate {
  return {
    text,
    category,
    padDelta: { pleasure: padDelta[0], arousal: padDelta[1], dominance: padDelta[2] },
    importance,
    tags: tags.length > 0 ? tags : [category],
  };
}

// ─── Templates ───

export const EVENT_TEMPLATES: EventTemplate[] = [
  // ═══ WORK ═══
  t('今天工作特别顺利，提前把任务做完了。', 'work', [0.25, 0.1, 0.2], 0.4, ['positive', 'productive']),
  t('被甲方改了三版稿，心累。', 'work', [-0.2, 0.15, -0.15], 0.5, ['negative', 'frustrating']),
  t('今天开会被领导当众表扬了，有点不好意思。', 'work', [0.3, 0.2, 0.1], 0.5, ['positive', 'recognition']),
  t('同事今天请了病假，我一个人扛了两份活。', 'work', [0.0, 0.2, -0.05], 0.4, ['busy']),
  t('和同事因为工作方式不同发生了小争执，后来和解了。', 'work', [-0.1, 0.25, -0.1], 0.6, ['conflict', 'social']),
  t('接了一个新项目，有点兴奋也有点紧张。', 'work', [0.15, 0.3, 0.1], 0.5, ['positive', 'challenge']),
  t('今天效率特别低，感觉什么都没做。', 'work', [-0.15, -0.05, -0.2], 0.3, ['negative', 'unproductive']),
  t('试用期过了，正式转正了！', 'work', [0.4, 0.3, 0.3], 0.7, ['positive', 'milestone']),
  t('今天被安排了一个完全不会的任务，硬着头皮上。', 'work', [-0.05, 0.3, -0.2], 0.5, ['challenge']),
  t('加班到九点，办公室只剩自己一个人。', 'work', [-0.1, -0.1, -0.05], 0.4, ['negative', 'tired']),
  t('今天面试了新的候选人，想起了自己刚来的时候。', 'work', [0.1, 0.0, 0.1], 0.4, ['reflective']),
  t('老板今天心情不好，莫名其妙被说了几句。', 'work', [-0.2, 0.15, -0.15], 0.5, ['negative', 'unfair']),
  t('终于把手头的大项目交付了，松了一口气。', 'work', [0.3, -0.1, 0.2], 0.6, ['positive', 'relief']),
  t('今天和团队一起完成了季度目标，一起去吃了庆功宴。', 'work', [0.35, 0.2, 0.2], 0.5, ['positive', 'social']),
  t('做了一个决定：换一个方向试试。', 'work', [0.1, 0.25, 0.3], 0.6, ['decision', 'reflective']),
  t('和领导做了绩效面谈，整体反馈还不错。', 'work', [0.2, 0.0, 0.15], 0.5, ['positive']),
  t('今天的会议开了三个小时，腰都坐疼了。', 'work', [-0.05, 0.1, -0.1], 0.3, ['boring']),
  t('带的新人今天独立完成了一个任务，挺有成就感的。', 'work', [0.25, 0.1, 0.2], 0.5, ['positive', 'mentoring']),
  t('公司今天宣布了架构调整，有点不安。', 'work', [-0.1, 0.2, -0.2], 0.6, ['negative', 'uncertainty']),
  t('今天的工作就是一遍一遍改细节，枯燥但必须做。', 'work', [-0.05, -0.1, 0.0], 0.3, []),
  t('中午和同事一起吃饭，聊了很多工作以外的事。', 'work', [0.2, 0.1, 0.1], 0.5, ['positive', 'social']),
  t('今天犯了低级错误，被自己气死。', 'work', [-0.2, 0.2, -0.15], 0.4, ['negative']),
  t('客户今天特别满意，专门发邮件感谢。', 'work', [0.3, 0.15, 0.25], 0.5, ['positive']),
  t('今天摸鱼摸了半天，罪过。', 'work', [0.0, -0.1, 0.0], 0.3, ['guilty']),
  t('收到了一份新的工作机会，在犹豫要不要去。', 'work', [0.1, 0.25, 0.1], 0.7, ['decision', 'reflective']),
  t('今天培训了一整天，脑子快炸了。', 'work', [-0.1, 0.2, -0.1], 0.4, ['tired']),
  t('被分配了一个很有挑战性的任务，不知道能不能做好。', 'work', [0.05, 0.3, -0.1], 0.5, ['challenge']),
  t('今天是deadline，从早忙到晚没停过。', 'work', [-0.05, 0.35, -0.05], 0.5, ['busy', 'stress']),
  t('同事们都很忙，感觉自己融不进去。', 'work', [-0.15, 0.0, -0.15], 0.5, ['lonely', 'social']),
  t('终于学会了那个新工具，还挺好用的。', 'work', [0.2, 0.1, 0.2], 0.4, ['positive', 'learning']),

  // ═══ SOCIAL ═══
  t('好久没联系的老朋友突然发消息来，聊了好一会儿。', 'social', [0.25, 0.15, 0.1], 0.5, ['positive', 'connection']),
  t('朋友今天失恋了，安慰了很久。', 'social', [-0.1, 0.1, 0.0], 0.6, ['supportive', 'emotional']),
  t('今天在街上遇到了以前的同学，差点没认出来。', 'social', [0.15, 0.2, 0.1], 0.4, ['surprise']),
  t('和朋友约了晚饭，聊了很多最近的事。', 'social', [0.2, 0.15, 0.15], 0.5, ['positive', 'connection']),
  t('答应朋友的事忘了做，有点不好意思。', 'social', [-0.1, 0.05, -0.1], 0.4, ['guilty']),
  t('今天帮了一个陌生人的小忙，他笑得很真诚。', 'social', [0.2, 0.05, 0.15], 0.4, ['positive', 'kindness']),
  t('有人对我态度很差，不知道是不是自己做错了什么。', 'social', [-0.2, 0.15, -0.2], 0.5, ['negative', 'confused']),
  t('今天参加了一个小聚会，认识了几个新朋友。', 'social', [0.25, 0.25, 0.1], 0.5, ['positive', 'connection']),
  t('收到了一份意外的礼物，很开心但又有点不知道怎么回礼。', 'social', [0.3, 0.1, 0.0], 0.5, ['positive', 'surprise']),
  t('今天没有人找我，有点孤单。', 'social', [-0.1, -0.1, -0.05], 0.4, ['lonely']),
  t('朋友跟我分享了一个秘密，让我觉得自己被信任。', 'social', [0.25, 0.1, 0.15], 0.6, ['positive', 'trust']),
  t('今天在电梯里和邻居聊了几句，挺温暖的。', 'social', [0.1, 0.05, 0.05], 0.3, ['positive']),
  t('被一个朋友拉去参加我不感兴趣的活动，很勉强。', 'social', [-0.05, 0.1, -0.1], 0.3, ['reluctant']),
  t('有人背后说了我的坏话，朋友告诉我的时候心里不太舒服。', 'social', [-0.2, 0.2, -0.15], 0.5, ['negative', 'betrayal']),
  t('今天和很久没见的家人通了电话，被唠叨了一通。', 'social', [0.05, 0.1, -0.05], 0.4, ['family']),
  t('在网上加了一个志同道合的群，聊得很开心。', 'social', [0.2, 0.15, 0.1], 0.4, ['positive', 'connection']),
  t('今天是个节日，收到了很多祝福消息。', 'social', [0.25, 0.1, 0.1], 0.4, ['positive', 'holiday']),
  t('和邻居因为噪音问题发生了小矛盾。', 'social', [-0.15, 0.2, -0.1], 0.5, ['conflict']),

  // ═══ DOMESTIC ═══
  t('早上没听到闹钟，差点睡过头。', 'domestic', [0.0, 0.15, -0.05], 0.3, ['routine']),
  t('今天自己做了饭，味道还不错。', 'domestic', [0.15, 0.05, 0.1], 0.3, ['positive', 'routine']),
  t('家里的灯泡坏了，折腾了半天才换好。', 'domestic', [0.0, 0.1, 0.1], 0.3, []),
  t('大扫除了一下午，累但是很舒服。', 'domestic', [0.2, 0.15, 0.2], 0.4, ['positive', 'productive']),
  t('水龙头漏水了，叫了维修师傅上门。', 'domestic', [-0.05, 0.1, -0.05], 0.3, ['annoying']),
  t('今天做了个大菜，拍了照片发了朋友圈。', 'domestic', [0.2, 0.1, 0.15], 0.4, ['positive', 'creative']),
  t('收到了网购的东西，拆快递永远是最开心的。', 'domestic', [0.2, 0.1, 0.05], 0.3, ['positive']),
  t('今天天气特别好，把被子拿出去晒了。', 'domestic', [0.15, 0.0, 0.05], 0.3, ['positive']),
  t('晒被子的时候突然下起了雨，白晒了。', 'domestic', [-0.05, 0.05, -0.1], 0.3, ['funny', 'annoying']),
  t('今天终于把堆了一周的衣服洗了。', 'domestic', [0.1, 0.0, 0.1], 0.3, ['relief']),
  t('家里突然停电，用手机的手电筒找了半天蜡烛。', 'domestic', [-0.1, 0.15, -0.1], 0.4, ['unexpected']),
  t('今天给植物浇水，发现长了新叶子。', 'domestic', [0.1, 0.05, 0.05], 0.3, ['positive', 'nature']),
  t('楼下装修，从早上开始就一直在吵。', 'domestic', [-0.15, 0.2, -0.15], 0.4, ['annoying']),
  t('今天整理了一下书架，翻到了好多以前的书和回忆。', 'domestic', [0.15, 0.0, 0.1], 0.4, ['reflective', 'nostalgia']),
  t('厨房的蟑螂又出现了，和它搏斗了半天。', 'domestic', [-0.1, 0.2, 0.0], 0.3, ['funny', 'annoying']),
  t('今天尝试自己做手冲咖啡，第一次居然成功了。', 'domestic', [0.15, 0.05, 0.15], 0.3, ['positive', 'creative']),
  t('快递小哥把我的包裹送错了，跑了趟物业才找回。', 'domestic', [-0.05, 0.1, -0.05], 0.3, ['annoying']),

  // ═══ HEALTH ═══
  t('今天感觉有点不舒服，可能是感冒了。', 'health', [-0.15, -0.05, -0.1], 0.5, ['negative', 'sick']),
  t('最近睡眠不太好，晚上睡不着白天犯困。', 'health', [-0.2, 0.05, -0.15], 0.5, ['negative', 'sleep']),
  t('今天去跑步了，出了一身汗感觉很爽。', 'health', [0.25, 0.2, 0.2], 0.4, ['positive', 'exercise']),
  t('体检报告出来了，一切正常，松了一口气。', 'health', [0.2, -0.1, 0.15], 0.6, ['positive', 'relief']),
  t('最近一直在加班，腰有点疼。', 'health', [-0.15, 0.05, -0.1], 0.4, ['negative', 'tired']),
  t('今天走了两万步，腿快废了。', 'health', [0.0, 0.2, 0.1], 0.3, ['exercise', 'tired']),
  t('最近开始注意饮食，感觉身体比以前好了一些。', 'health', [0.15, 0.0, 0.15], 0.4, ['positive', 'improvement']),
  t('今天头疼了一整天。', 'health', [-0.2, -0.1, -0.15], 0.4, ['negative', 'pain']),
  t('今天去健身房上了第一节私教课，教练好严格。', 'health', [0.1, 0.25, -0.05], 0.4, ['exercise', 'challenge']),
  t('医生说要少熬夜，但我就是改不了。', 'health', [-0.05, 0.0, -0.1], 0.3, ['guilty']),
  t('今天天气很好，出去散了很久的步。', 'health', [0.2, 0.05, 0.1], 0.3, ['positive', 'nature']),
  t('做了一晚上的噩梦，醒来心情很差。', 'health', [-0.2, 0.1, -0.15], 0.4, ['negative', 'sleep']),
  t('今天去看了牙医，还好没什么大问题。', 'health', [0.0, 0.1, 0.0], 0.4, ['relief']),

  // ═══ CREATIVE ═══
  t('今天突然有个灵感，记了下来。', 'creative', [0.2, 0.2, 0.15], 0.4, ['positive', 'inspiration']),
  t('最近在学一个新东西，今天终于有点入门的感觉了。', 'creative', [0.25, 0.15, 0.2], 0.5, ['positive', 'learning']),
  t('今天读的那本书，有一段话特别触动我。', 'creative', [0.15, 0.1, 0.05], 0.5, ['reflective', 'reading']),
  t('写了一篇日记，把最近的想法整理了一下。', 'creative', [0.1, 0.0, 0.15], 0.4, ['reflective']),
  t('最近在学画画，今天画了一张自己还比较满意的。', 'creative', [0.2, 0.1, 0.15], 0.4, ['positive', 'art']),
  t('看了部电影，结局让人心里堵堵的。', 'creative', [0.0, 0.2, 0.0], 0.4, ['emotional', 'reflective']),
  t('听了一首歌，单曲循环了一晚上。', 'creative', [0.1, 0.15, 0.0], 0.4, ['reflective', 'music']),
  t('今天去了图书馆，安静地坐了一个下午。', 'creative', [0.15, -0.1, 0.1], 0.3, ['positive', 'peaceful']),
  t('最近一直在想一个 idea，感觉快成型了。', 'creative', [0.2, 0.2, 0.2], 0.5, ['positive', 'creative']),
  t('今天看了一个纪录片，对世界又有了新的认识。', 'creative', [0.15, 0.15, 0.1], 0.5, ['reflective', 'learning']),

  // ═══ RANDOM ═══
  t('今天走在路上看到了一只很可爱的流浪猫，跟它对视了好一会儿。', 'random', [0.15, 0.05, 0.05], 0.3, ['positive', 'nature']),
  t('今天下的雨特别大，我被困在便利店等了半个小时。', 'random', [-0.05, 0.1, -0.1], 0.3, ['weather']),
  t('在地铁上看到一个小朋友对着窗外笑，心情莫名变好了。', 'random', [0.15, 0.05, 0.05], 0.3, ['positive']),
  t('今天经过常去的那家店，发现已经关门了，有点难过。', 'random', [-0.1, 0.0, 0.0], 0.4, ['nostalgia']),
  t('今天的心情说不上来，不好也不坏。', 'random', [0.0, -0.05, 0.0], 0.2, []),
  t('翻到了一张老照片，想起了很多以前的事。', 'random', [0.1, 0.0, 0.0], 0.4, ['nostalgia', 'reflective']),
  t('今天阳光很好，在路上忍不住傻笑了一下。', 'random', [0.2, 0.1, 0.1], 0.3, ['positive']),
  t('今天坐错方向了，多花了半小时。', 'random', [-0.05, 0.1, -0.05], 0.3, ['annoying']),
  t('在超市里遇到了一个很可爱的小朋友，对着我笑。', 'random', [0.15, 0.05, 0.05], 0.3, ['positive']),
  t('今天的晚霞特别好看，停下来看了很久。', 'random', [0.15, 0.0, 0.0], 0.3, ['positive', 'nature']),
  t('手机今天摔了一下，屏幕没碎但膜裂了。', 'random', [-0.05, 0.1, -0.05], 0.3, ['annoying']),
  t('今天是个好日子，说不出理由但就是觉得好。', 'random', [0.2, 0.1, 0.1], 0.3, ['positive']),
  t('今天想起了那个和我聊天的人，不知道他今天过得怎么样。', 'random', [0.1, 0.05, 0.0], 0.4, ['reflective', 'connection']),

  // ═══ CRISIS (rare, high-impact) ═══
  t('公司突然宣布裁员，虽然我不在名单上，但心里很不安。', 'work', [-0.3, 0.35, -0.3], 0.8, ['crisis', 'uncertainty']),
  t('今天提了离职，心里很复杂。', 'work', [0.0, 0.4, 0.3], 0.8, ['crisis', 'decision', 'reflective']),
  t('被一个重要的人误解了，解释不清的那种。', 'social', [-0.35, 0.3, -0.3], 0.8, ['crisis', 'conflict', 'emotional']),
  t('今天得知了一个不太好的消息，不知道该不该告诉别人。', 'social', [-0.3, 0.25, -0.2], 0.7, ['crisis', 'emotional']),
  t('家里人说了一些让我很难受的话。', 'domestic', [-0.35, 0.3, -0.3], 0.8, ['crisis', 'family', 'emotional']),
  t('今天去医院做了检查，等结果的时候很煎熬。', 'health', [-0.3, 0.3, -0.35], 0.8, ['crisis', 'anxiety']),
  t('最近一直在想，我到底在做什么，我的人生方向是什么。', 'random', [-0.1, 0.25, -0.2], 0.7, ['crisis', 'existential', 'reflective']),
];

// ─── Occupation-specific context phrases ───

export const OCCUPATION_CONTEXTS: Record<string, string[]> = {
  '程序员': ['写代码', '改bug', 'code review', '技术方案讨论', '部署上线'],
  '插画师': ['赶稿', '调色', '和甲方沟通需求', '画草稿', '参加画展'],
  '设计师': ['排版', '选配色', '做原型', '用户调研', '改设计稿'],
  '学生': ['上课', '写作业', '准备考试', '做实验', '参加社团'],
  '医生': ['看诊', '查房', '写病历', '值夜班', '和患者沟通'],
  '老师': ['备课', '上课', '批改作业', '开班会', '和家长沟通'],
  '花店老板': ['进货', '插花', '包扎花束', '招呼客人', '整理花材'],
  '咖啡师': ['拉花', '调磨', '烘豆', '招呼客人', '研发新品'],
  '自由职业': ['接项目', '赶deadline', '和客户沟通', '自我管理', '寻找新机会'],
  '作家': ['赶稿', '改稿', '卡文', '找灵感', '和编辑沟通'],
  '摄影师': ['修图', '约拍', '选景', '和客户沟通', '整理照片'],
  '厨师': ['备菜', '研发新菜', '试吃', '忙午市', '收拾厨房'],
};

/**
 * Get occupation-specific context phrases.
 */
export function getOccupationContext(occupation: string): string[] {
  return OCCUPATION_CONTEXTS[occupation] || [
    '上班', '开会', '写报告', '和同事沟通', '处理杂事',
  ];
}
