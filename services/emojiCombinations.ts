/**
 * Emoji Kitchen 组合查找工具
 * 从 metadata.json 中查找特定 emoji 的所有可能组合
 */

// 动态加载 metadata（优先分片，其次单文件）
let metadata: any = null;

async function loadMetadataFromParts(): Promise<any | null> {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const manifestPaths = [
    `${baseUrl}metadata-parts/manifest.json`,
    '/metadata-parts/manifest.json'
  ];

  for (const mPath of manifestPaths) {
    try {
      const mRes = await fetch(mPath);
      if (!mRes.ok) continue;
      const manifest = await mRes.json();
      const parts = manifest?.parts;
      if (!parts || parts <= 0) continue;

      const merged: any = { knownSupportedEmoji: [], data: {} };
      for (let i = 0; i < parts; i++) {
        const pRes = await fetch(`${baseUrl}metadata-parts/part-${i}.json`);
        if (!pRes.ok) throw new Error('part fetch failed');
        const pJson = await pRes.json();
        if (pJson?.data) {
          Object.assign(merged.data, pJson.data);
        }
        if (merged.knownSupportedEmoji.length === 0 && Array.isArray(pJson?.knownSupportedEmoji)) {
          merged.knownSupportedEmoji = pJson.knownSupportedEmoji;
        }
      }
      return merged;
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function loadMetadata() {
  if (metadata) return metadata;
  
  // 优先分片
  const parts = await loadMetadataFromParts();
  if (parts) {
    metadata = parts;
    return metadata;
  }
  
  // 回退单文件
  const baseUrl = import.meta.env.BASE_URL || '/';
  const paths = [
    `${baseUrl}metadata.json`,
    '/metadata.json',
    `${baseUrl}data/metadata.json`,
    '/data/metadata.json'
  ];
  
  for (const path of paths) {
    try {
      const response = await fetch(path);
      if (response.ok) {
        metadata = await response.json();
        return metadata;
      }
    } catch (error) {
      continue;
    }
  }
  
  metadata = {};
  return metadata;
}

interface EmojiCombination {
  leftEmoji: string;
  rightEmoji: string;
  gStaticUrl: string;
  date: string;
  isLatest: boolean;
}

/**
 * 将 emoji 转换为 Unicode codepoint（如 😀 -> 1f600）
 */
function emojiToCodepoint(emoji: string): string {
  if (!emoji || emoji.length === 0) return '';
  const codePoint = emoji.codePointAt(0);
  if (!codePoint) return '';
  return codePoint.toString(16).toLowerCase();
}

/**
 * 获取指定 emoji 作为左侧的所有可能组合
 */
export async function getCombinationsForEmoji(emoji: string): Promise<EmojiCombination[]> {
  const md = await loadMetadata();
  const codepoint = emojiToCodepoint(emoji);
  if (!codepoint || !md) return [];
  
  const data = md?.data;
  if (!data || !data[codepoint] || !data[codepoint].combinations) return [];
  
  const combinations: EmojiCombination[] = [];
  
  // 遍历所有可能的右侧 emoji
  for (const rightCodepoint in data[codepoint].combinations) {
    const combos = data[codepoint].combinations[rightCodepoint];
    if (Array.isArray(combos)) {
      combos
        .filter((combo: any) => combo.isLatest && combo.leftEmoji && combo.rightEmoji)
        .forEach((combo: any) => {
          combinations.push({
            leftEmoji: combo.leftEmoji,
            rightEmoji: combo.rightEmoji,
            gStaticUrl: combo.gStaticUrl,
            date: combo.date,
            isLatest: combo.isLatest
          });
        });
    }
  }
  
  return combinations;
}

/**
 * 获取指定 emoji 的所有可能组合（包括作为左侧和右侧）
 */
export async function getAllCombinationsForEmoji(emoji: string): Promise<EmojiCombination[]> {
  const md = await loadMetadata();
  const codepoint = emojiToCodepoint(emoji);
  if (!codepoint || !md) return [];
  
  const data = md?.data;
  if (!data) return [];
  
  const combinations: EmojiCombination[] = [];
  
  // 作为左侧的组合
  if (data[codepoint] && data[codepoint].combinations) {
    for (const rightCodepoint in data[codepoint].combinations) {
      const combos = data[codepoint].combinations[rightCodepoint];
      if (Array.isArray(combos)) {
        combos
          .filter((combo: any) => combo.isLatest && combo.leftEmoji && combo.rightEmoji)
          .forEach((combo: any) => {
            combinations.push({
              leftEmoji: combo.leftEmoji,
              rightEmoji: combo.rightEmoji,
              gStaticUrl: combo.gStaticUrl,
              date: combo.date,
              isLatest: combo.isLatest
            });
          });
      }
    }
  }
  
  // 作为右侧的组合（需要遍历所有 key）
  for (const leftCodepoint in data) {
    if (leftCodepoint === codepoint) continue; // 已处理
    
    const emojiData = data[leftCodepoint];
    if (emojiData && emojiData.combinations && emojiData.combinations[codepoint]) {
      const combos = emojiData.combinations[codepoint];
      if (Array.isArray(combos)) {
        combos
          .filter((combo: any) => combo.isLatest && combo.leftEmoji && combo.rightEmoji)
          .forEach((combo: any) => {
            combinations.push({
              leftEmoji: combo.leftEmoji,
              rightEmoji: combo.rightEmoji,
              gStaticUrl: combo.gStaticUrl,
              date: combo.date,
              isLatest: combo.isLatest
            });
          });
      }
    }
  }
  
  // 去重（基于 leftEmoji + rightEmoji）
  const unique = new Map<string, EmojiCombination>();
  combinations.forEach(combo => {
    const key = `${combo.leftEmoji}+${combo.rightEmoji}`;
    if (!unique.has(key)) {
      unique.set(key, combo);
    }
  });
  
  return Array.from(unique.values());
}

/**
 * 获取主 emoji 的组合列表（用于 LLM 选择）
 * 返回格式化的字符串，包含 emoji 和描述
 */
export async function getCombinationsListForPrompt(emoji: string, limit: number = 50): Promise<string> {
  const combinations = await getAllCombinationsForEmoji(emoji);
  
  if (combinations.length === 0) {
    return `没有找到 ${emoji} 的组合`;
  }
  
  // 限制数量，避免 prompt 过长
  const limited = combinations.slice(0, limit);
  
  return limited
    .map((combo, idx) => `${idx + 1}. ${combo.leftEmoji} + ${combo.rightEmoji}`)
    .join('\n');
}

/**
 * 根据主 emoji 和选择的组合索引，获取融合图片 URL
 */
export async function getFusionUrlByIndex(emoji: string, index: number): Promise<string | null> {
  const combinations = await getAllCombinationsForEmoji(emoji);
  if (index < 0 || index >= combinations.length) {
    return null;
  }
  return combinations[index].gStaticUrl;
}

/**
 * 根据两个 emoji 直接查找组合 URL
 * 如果 metadata.json 不存在，回退到使用 URL 构造方式
 */
export async function getFusionUrl(emoji1: string, emoji2: string): Promise<string | null> {
  const md = await loadMetadata();
  const codepoint1 = emojiToCodepoint(emoji1);
  const codepoint2 = emojiToCodepoint(emoji2);
  
  if (!codepoint1 || !codepoint2) return null;
  
  // 如果 metadata 加载成功，使用 metadata 查找
  // metadata 结构：{ knownSupportedEmoji: [...], data: { "1f600": { combinations: { "1f601": [...] } } } }
  const data = md?.data;
  
  if (data && data[codepoint1] && data[codepoint1].combinations) {
    // 先尝试 emoji1 作为左侧，emoji2 作为右侧
    const combos1 = data[codepoint1].combinations[codepoint2];
    if (Array.isArray(combos1) && combos1.length > 0) {
      const match = combos1.find((combo: any) => combo.isLatest) || combos1[0];
      if (match && match.gStaticUrl) {
        console.log(`[EmojiCombinations] ✅ Found in metadata: ${emoji1} (${codepoint1}) + ${emoji2} (${codepoint2}) = ${match.gStaticUrl}`);
        return match.gStaticUrl;
      }
    }
  }
  
  // 再尝试 emoji2 作为左侧，emoji1 作为右侧
  if (data && data[codepoint2] && data[codepoint2].combinations) {
    const combos2 = data[codepoint2].combinations[codepoint1];
    if (Array.isArray(combos2) && combos2.length > 0) {
      const match = combos2.find((combo: any) => combo.isLatest) || combos2[0];
      if (match && match.gStaticUrl) {
        console.log(`[EmojiCombinations] ✅ Found in metadata (swapped): ${emoji2} (${codepoint2}) + ${emoji1} (${codepoint1}) = ${match.gStaticUrl}`);
        return match.gStaticUrl;
      }
    }
  }
  
  console.log(`[EmojiCombinations] ⚠️ Not found in metadata for ${emoji1} (${codepoint1}) + ${emoji2} (${codepoint2}), using fallback`);
  
  // 回退：使用 URL 构造方式（从 emojiKitchen.ts 导入）
  console.log(`[EmojiCombinations] Metadata not available, using URL construction fallback for ${emoji1} + ${emoji2}`);
  const { getEmojiFusionUrl } = await import('./emojiKitchen');
  const dates = ['20240101', '20231001', '20230301', '20221001', '20201001'];
  
  // 尝试所有日期版本
  for (const date of dates) {
    const url1 = getEmojiFusionUrl(emoji1, emoji2, date);
    const url2 = getEmojiFusionUrl(emoji2, emoji1, date);
    
    // 快速验证（使用 Image 对象）
    const valid1 = await validateUrl(url1);
    if (valid1) return url1;
    
    const valid2 = await validateUrl(url2);
    if (valid2) return url2;
  }
  
  return null;
}

/**
 * 快速验证 URL 是否有效
 */
function validateUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
      }
    };
    
    img.onload = () => {
      cleanup();
      resolve(true);
    };
    
    img.onerror = () => {
      cleanup();
      resolve(false);
    };
    
    img.src = url;
    
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 2000); // 2秒超时
  });
}

