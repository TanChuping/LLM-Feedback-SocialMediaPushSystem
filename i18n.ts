export type Language = 'en' | 'zh';

type UiKey =
  | 'refineBannerRefinedSort'
  | 'systemInternals'
  | 'resetDemo'
  | 'liveUserProfileModel'
  | 'personaFunOn'
  | 'personaFunOff'
  | 'personaFunToggleTitle'
  | 'personaFunInfo'
  | 'personaFunInfoAria'
  | 'expandDescription'
  | 'collapseDescription'
  | 'traits'
  | 'redFlagsDownrankOnly'
  | 'interestVectorsLikes'
  | 'negativeFiltersDislikes'
  | 'noInterests'
  | 'noNegativeFiltersYet'
  | 'mixedLabel'
  | 'interestLabel'
  | 'negativeLabel'
  | 'waitingForInteraction'
  | 'defaultPersonaDescription'
  | 'feedbackMemory'
  | 'feedbackMemoryEmpty'
  | 'awaitingPersona'
  | 'viewAlgoLog'
  | 'viewMemory';

const DICT: Record<Language, Record<UiKey, string>> = {
  en: {
    refineBannerRefinedSort: 'Refined sorting for you',
    systemInternals: 'System Internals',
    resetDemo: 'Reset Demo',
    liveUserProfileModel: 'Live User Profile Model',
    personaFunOn: 'Fun',
    personaFunOff: 'Fun off',
    personaFunToggleTitle: 'Toggle nickname + emoji avatar (fun only)',
    personaFunInfo: "Fun feature: generates nickname + emoji fusion avatar from feedback (doesn't affect recommendations). Changes apply on next persona update.",
    personaFunInfoAria: 'About the fun feature toggle',
    expandDescription: 'Expand description',
    collapseDescription: 'Collapse description',
    traits: 'Traits',
    redFlagsDownrankOnly: 'Red flags (Downrank-only)',
    interestVectorsLikes: 'Interest Vectors (Likes)',
    negativeFiltersDislikes: 'Negative Filters (Dislikes)',
    noInterests: 'No interests...',
    noNegativeFiltersYet: 'No negative filters yet...',
    mixedLabel: 'Mixed',
    interestLabel: 'Interest',
    negativeLabel: 'Negative',
    waitingForInteraction: 'Waiting for interaction...',
    defaultPersonaDescription: 'New user — waiting for more feedback to build a persona...',
    feedbackMemory: 'Feedback Memory',
    feedbackMemoryEmpty: 'No feedback recorded yet...',
    awaitingPersona: '(awaiting persona...)',
    viewAlgoLog: 'Events',
    viewMemory: 'Memory'
  },
  zh: {
    refineBannerRefinedSort: '已为你细化排序',
    systemInternals: '系统内部状态',
    resetDemo: '重置演示',
    liveUserProfileModel: '实时用户画像模型',
    personaFunOn: '娱乐',
    personaFunOff: '娱乐关',
    personaFunToggleTitle: '切换昵称/表情头像（仅娱乐）',
    personaFunInfo: '娱乐功能：基于反馈生成昵称和表情融合头像（不影响推荐主流程）。开关会在下一轮画像更新时生效。',
    personaFunInfoAria: '关于娱乐功能开关',
    expandDescription: '展开画像',
    collapseDescription: '收起画像',
    traits: '特征',
    redFlagsDownrankOnly: '雷点（仅降权）',
    interestVectorsLikes: '兴趣向量（喜欢）',
    negativeFiltersDislikes: '负向过滤（不喜欢）',
    noInterests: '暂无兴趣…',
    noNegativeFiltersYet: '暂无负向过滤…',
    mixedLabel: '混合',
    interestLabel: '兴趣',
    negativeLabel: '负向',
    waitingForInteraction: '等待交互…',
    defaultPersonaDescription: '新用户，等待更多反馈来描绘画像...',
    feedbackMemory: '反馈记忆',
    feedbackMemoryEmpty: '暂无反馈记录…',
    awaitingPersona: '（画像生成中…）',
    viewAlgoLog: '事件',
    viewMemory: '记忆'
  }
};

export function t(lang: Language, key: UiKey): string {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}

