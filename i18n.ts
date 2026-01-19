export type Language = 'en' | 'zh';

type UiKey =
  | 'refineBannerRefinedSort'
  | 'systemInternals'
  | 'resetDemo'
  | 'liveUserProfileModel'
  | 'expandDescription'
  | 'collapseDescription'
  | 'traits'
  | 'redFlagsDownrankOnly'
  | 'interestVectorsLikes'
  | 'negativeFiltersDislikes'
  | 'noInterests'
  | 'noNegativeFiltersYet'
  | 'waitingForInteraction'
  | 'defaultPersonaDescription';

const DICT: Record<Language, Record<UiKey, string>> = {
  en: {
    refineBannerRefinedSort: 'Refined sorting for you',
    systemInternals: 'System Internals',
    resetDemo: 'Reset Demo',
    liveUserProfileModel: 'Live User Profile Model',
    expandDescription: 'Expand description',
    collapseDescription: 'Collapse description',
    traits: 'Traits',
    redFlagsDownrankOnly: 'Red flags (Downrank-only)',
    interestVectorsLikes: 'Interest Vectors (Likes)',
    negativeFiltersDislikes: 'Negative Filters (Dislikes)',
    noInterests: 'No interests...',
    noNegativeFiltersYet: 'No negative filters yet...',
    waitingForInteraction: 'Waiting for interaction...',
    defaultPersonaDescription: 'New user — waiting for more feedback to build a persona...'
  },
  zh: {
    refineBannerRefinedSort: '已为你细化排序',
    systemInternals: '系统内部状态',
    resetDemo: '重置演示',
    liveUserProfileModel: '实时用户画像模型',
    expandDescription: '展开画像',
    collapseDescription: '收起画像',
    traits: '特征',
    redFlagsDownrankOnly: '雷点（仅降权）',
    interestVectorsLikes: '兴趣向量（喜欢）',
    negativeFiltersDislikes: '负向过滤（不喜欢）',
    noInterests: '暂无兴趣…',
    noNegativeFiltersYet: '暂无负向过滤…',
    waitingForInteraction: '等待交互…',
    defaultPersonaDescription: '新用户，等待更多反馈来描绘画像...'
  }
};

export function t(lang: Language, key: UiKey): string {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}

