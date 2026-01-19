/**
 * Emoji Kitchen combos (fast path):
 * - Build-time generates per-emoji index files under public/emoji-index/
 * - Runtime only loads the requested emoji file and caches it (no full-library JSON.parse / merge / scan)
 * - Selection flow is strict: only real combos + only metadata gStaticUrl (no guessing)
 */

type EmojiIndexCombo = {
  leftEmoji: string;
  rightEmoji: string;
  gStaticUrl: string;
  date: string | null;
  isLatest: boolean;
};

type EmojiIndexFile = {
  codepoint: string;
  asLeft: EmojiIndexCombo[];
  asRight: EmojiIndexCombo[];
};

type EmojiIndexManifest = {
  version: string;
  count: number;
};

const memManifest: { value: EmojiIndexManifest | null } = { value: null };
const memIndex = new Map<string, EmojiIndexFile>();

const getBaseUrl = () => import.meta.env.BASE_URL || '/';

const manifestPathCandidates = () => {
  const base = getBaseUrl();
  return [`${base}emoji-index/manifest.json`, `/emoji-index/manifest.json`];
};

const indexPathCandidates = (cp: string) => {
  const base = getBaseUrl();
  return [`${base}emoji-index/u${cp}.json`, `/emoji-index/u${cp}.json`];
};

const safeOpenCache = async (name: string): Promise<Cache | null> => {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(name);
  } catch {
    return null;
  }
};

async function fetchJsonWithCache(url: string, cache: Cache | null, cacheKeyOverride?: string, fetchInit?: RequestInit) {
  const key = cacheKeyOverride || url;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.json();
    } catch {}
  }
  const res = await fetch(url, fetchInit);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  if (cache) {
    try { await cache.put(key, res.clone()); } catch {}
  }
  return await res.json();
}

async function loadEmojiIndexManifest(): Promise<EmojiIndexManifest | null> {
  if (memManifest.value) return memManifest.value;
  for (const p of manifestPathCandidates()) {
    try {
      // Always revalidate manifest (tiny), so cache version changes propagate.
      const res = await fetch(p, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = (await res.json()) as EmojiIndexManifest;
      if (json?.version && typeof json.version === 'string') {
        memManifest.value = json;
        return json;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function loadEmojiIndexFile(codepoint: string): Promise<EmojiIndexFile | null> {
  const cached = memIndex.get(codepoint);
  if (cached) return cached;

  const manifest = await loadEmojiIndexManifest();
  const cacheName = manifest?.version ? `emoji-index:${manifest.version}` : 'emoji-index';
  const cache = await safeOpenCache(cacheName);

  for (const p of indexPathCandidates(codepoint)) {
    try {
      const json = (await fetchJsonWithCache(p, cache)) as EmojiIndexFile;
      if (json?.codepoint === codepoint && Array.isArray(json?.asLeft) && Array.isArray(json?.asRight)) {
        memIndex.set(codepoint, json);
        return json;
      }
    } catch {
      continue;
    }
  }
  return null;
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
  const codepoint = emojiToCodepoint(emoji);
  if (!codepoint) return [];

  const idx = await loadEmojiIndexFile(codepoint);
  if (!idx) return [];

  const all = [...(idx.asLeft || []), ...(idx.asRight || [])];
  const unique = new Map<string, EmojiCombination>();
  for (const c of all) {
    if (!c?.leftEmoji || !c?.rightEmoji || !c?.gStaticUrl) continue;
    const key = `${c.leftEmoji}+${c.rightEmoji}`;
    if (!unique.has(key)) {
      unique.set(key, {
        leftEmoji: c.leftEmoji,
        rightEmoji: c.rightEmoji,
        gStaticUrl: c.gStaticUrl,
        date: (c.date || '') as string,
        isLatest: true
      });
    }
  }
  return Array.from(unique.values());
}

/**
 * 获取指定 emoji 的所有可能组合（包括作为左侧和右侧）
 */
export async function getAllCombinationsForEmoji(emoji: string): Promise<EmojiCombination[]> {
  const codepoint = emojiToCodepoint(emoji);
  if (!codepoint) return [];
  return await getCombinationsForEmoji(emoji);
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
  const cp1 = emojiToCodepoint(emoji1);
  const cp2 = emojiToCodepoint(emoji2);
  if (!cp1 || !cp2) return null;

  // Strict mode: only return gStaticUrl from indexed metadata (no guessing).
  const idx1 = await loadEmojiIndexFile(cp1);
  const idx2 = await loadEmojiIndexFile(cp2);
  const pool = [
    ...(idx1?.asLeft || []),
    ...(idx1?.asRight || []),
    ...(idx2?.asLeft || []),
    ...(idx2?.asRight || [])
  ];

  const find = (a: string, b: string) => pool.find(c => c?.leftEmoji === a && c?.rightEmoji === b && c?.gStaticUrl) || null;
  return find(emoji1, emoji2)?.gStaticUrl || find(emoji2, emoji1)?.gStaticUrl || null;
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

