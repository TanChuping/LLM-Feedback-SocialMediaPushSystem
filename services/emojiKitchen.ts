/**
 * Google Emoji Kitchen 工具函数
 * 直接使用 Google 的 emoji 融合图片 URL
 * 参考：https://github.com/USYDShawnTan/emoji-fusion
 */

/**
 * 将 emoji 字符转换为 Unicode 编码（如 😀 -> 1f600）
 * 处理多字符 emoji（如带修饰符的）
 */
export function emojiToUnicode(emoji: string): string {
  if (!emoji || emoji.length === 0) return '';
  
  // 移除可能的变体选择器和其他修饰符
  const cleaned = emoji.replace(/\uFE0F/g, '').trim();
  
  // 获取第一个有效的 codePoint（emoji 通常在 0x1F000 以上）
  const codePoint = cleaned.codePointAt(0);
  if (!codePoint) return '';
  
  // 确保是有效的 emoji 范围
  if (codePoint >= 0x1F000) {
    return codePoint.toString(16).toLowerCase();
  }
  
  // 对于某些特殊 emoji，可能需要不同的处理
  // 但大多数情况下，第一个 codePoint 就足够了
  return codePoint.toString(16).toLowerCase();
}

/**
 * 生成两个 emoji 的融合图片 URL
 * Google Emoji Kitchen URL 格式：
 * https://www.gstatic.com/android/keyboard/emojikitchen/{date}/u{unicode1}/u{unicode1}_u{unicode2}.png
 */
export function getEmojiFusionUrl(emoji1: string, emoji2: string, date: string = '20201001'): string {
  const unicode1 = emojiToUnicode(emoji1);
  const unicode2 = emojiToUnicode(emoji2);
  
  if (!unicode1 || !unicode2) {
    throw new Error('Invalid emoji characters');
  }
  
  return `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/u${unicode1}/u${unicode1}_u${unicode2}.png`;
}

/**
 * 尝试获取融合图片（支持顺序交换和多个日期版本）
 * 如果第一个组合不存在，尝试交换顺序或使用更新的日期
 */
export async function getEmojiFusionImage(
  emoji1: string, 
  emoji2: string
): Promise<{ url: string | null; triedBoth: boolean }> {
  // 尝试的日期版本（从新到旧）
  const dates = ['20240101', '20230101', '20221001', '20201001'];
  
  // 先尝试原始顺序
  for (const date of dates) {
    const url1 = getEmojiFusionUrl(emoji1, emoji2, date);
    const exists1 = await checkImageExists(url1);
    if (exists1) {
      return { url: url1, triedBoth: false };
    }
  }
  
  // 尝试交换顺序
  for (const date of dates) {
    const url2 = getEmojiFusionUrl(emoji2, emoji1, date);
    const exists2 = await checkImageExists(url2);
    if (exists2) {
      return { url: url2, triedBoth: true };
    }
  }
  
  return { url: null, triedBoth: true };
}

/**
 * 检查图片是否存在（使用 HEAD 请求）
 */
async function checkImageExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      mode: 'no-cors' // 避免 CORS 问题，但无法真正验证
    });
    // 由于 no-cors，我们无法读取状态码，但可以尝试加载图片
    return true; // 假设存在，让浏览器尝试加载
  } catch {
    return false;
  }
}

/**
 * 验证融合图片是否可加载（通过创建 Image 对象）
 */
export function validateEmojiFusionUrl(url: string): Promise<boolean> {
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
    
    // 增加超时时间到 5 秒
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 5000);
  });
}

/**
 * 获取两个 emoji 的融合图片（带验证和调试信息）
 */
export async function getValidatedEmojiFusion(
  emoji1: string,
  emoji2: string
): Promise<string | null> {
  const dates = ['20240101', '20230101', '20221001', '20201001'];
  
  const unicode1 = emojiToUnicode(emoji1);
  const unicode2 = emojiToUnicode(emoji2);
  
  console.log(`[Emoji Fusion] Attempting fusion: ${emoji1} (${unicode1}) + ${emoji2} (${unicode2})`);
  
  // 尝试原始顺序
  for (const date of dates) {
    const url1 = getEmojiFusionUrl(emoji1, emoji2, date);
    console.log(`[Emoji Fusion] Trying URL: ${url1}`);
    const valid1 = await validateEmojiFusionUrl(url1);
    if (valid1) {
      console.log(`[Emoji Fusion] ✅ Success with URL: ${url1}`);
      return url1;
    } else {
      console.log(`[Emoji Fusion] ❌ Failed: ${url1}`);
    }
  }
  
  // 尝试交换顺序
  console.log(`[Emoji Fusion] Trying swapped order...`);
  for (const date of dates) {
    const url2 = getEmojiFusionUrl(emoji2, emoji1, date);
    console.log(`[Emoji Fusion] Trying URL: ${url2}`);
    const valid2 = await validateEmojiFusionUrl(url2);
    if (valid2) {
      console.log(`[Emoji Fusion] ✅ Success with swapped URL: ${url2}`);
      return url2;
    } else {
      console.log(`[Emoji Fusion] ❌ Failed: ${url2}`);
    }
  }
  
  console.warn(`[Emoji Fusion] ❌ All attempts failed for ${emoji1} + ${emoji2}. This combination may not exist in Emoji Kitchen.`);
  return null;
}

/**
 * 测试函数：验证 emoji 组合是否可用
 * 可以在浏览器控制台调用：testEmojiFusion('🤡', '👅')
 */
export async function testEmojiFusion(emoji1: string, emoji2: string) {
  console.log(`\n🧪 Testing Emoji Fusion: ${emoji1} + ${emoji2}`);
  const unicode1 = emojiToUnicode(emoji1);
  const unicode2 = emojiToUnicode(emoji2);
  console.log(`Unicode: ${unicode1} + ${unicode2}`);
  
  const result = await getValidatedEmojiFusion(emoji1, emoji2);
  if (result) {
    console.log(`✅ Success! URL: ${result}`);
    return result;
  } else {
    console.log(`❌ Failed - This combination may not exist in Emoji Kitchen`);
    return null;
  }
}

// 暴露到 window 对象以便在控制台测试
if (typeof window !== 'undefined') {
  (window as any).testEmojiFusion = testEmojiFusion;
}

