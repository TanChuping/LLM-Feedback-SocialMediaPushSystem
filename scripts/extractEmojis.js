/**
 * 从 emoji-kitchen metadata.json 中提取所有唯一的 emoji
 * 运行: node scripts/extractEmojis.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const METADATA_URL = 'https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json';
const OUTPUT_FILE = path.join(__dirname, '../data/availableEmojis.ts');

async function fetchMetadata(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const req = https.get(METADATA_URL, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          },
          timeout: 30000
        }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(error);
            }
          });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`⚠️  重试 ${i + 1}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

function extractUniqueEmojis(metadata) {
  const emojiSet = new Set();
  
  // 检查是否有 knownSupportedEmoji 字段（新格式）
  if (metadata.knownSupportedEmoji && Array.isArray(metadata.knownSupportedEmoji)) {
    console.log('📋 检测到新格式: knownSupportedEmoji 数组');
    // 这些是 codepoint，需要转换为 emoji
    for (const codepoint of metadata.knownSupportedEmoji) {
      try {
        const emoji = String.fromCodePoint(parseInt(codepoint, 16));
        emojiSet.add(emoji);
      } catch (e) {
        // 忽略无效的 codepoint
      }
    }
  }
  
  // 遍历所有顶层 key（可能是 leftEmojiCodepoint）
  for (const key in metadata) {
    if (key === 'knownSupportedEmoji') continue; // 已处理
    
    const value = metadata[key];
    
    if (Array.isArray(value)) {
      // 遍历每个组合
      for (const combo of value) {
        if (typeof combo === 'object' && combo !== null) {
          // 提取 leftEmoji 和 rightEmoji
          if (combo.leftEmoji) {
            emojiSet.add(combo.leftEmoji);
          }
          if (combo.rightEmoji) {
            emojiSet.add(combo.rightEmoji);
          }
        }
      }
    }
  }
  
  return Array.from(emojiSet).sort();
}

function generateTypeScriptFile(emojis) {
  const emojiList = emojis.map(emoji => `  '${emoji}'`).join(',\n');
  
  return `/**
 * Google Emoji Kitchen 支持的 emoji 列表
 * 从 https://github.com/xsalazar/emoji-kitchen-backend 的 metadata.json 自动生成
 * 生成时间: ${new Date().toISOString()}
 * 
 * 注意：此列表包含所有可以在 Emoji Kitchen 中使用的 emoji
 * 每个 emoji 都可以和自己或其他 emoji 组合
 */

export const AVAILABLE_EMOJIS: string[] = [
${emojiList}
];

/**
 * 检查 emoji 是否在支持列表中
 */
export function isEmojiSupported(emoji: string): boolean {
  return AVAILABLE_EMOJIS.includes(emoji);
}

/**
 * 获取随机支持的 emoji
 */
export function getRandomEmoji(): string {
  return AVAILABLE_EMOJIS[Math.floor(Math.random() * AVAILABLE_EMOJIS.length)];
}
`;
}

async function main() {
  try {
    console.log('📥 正在下载 metadata.json...');
    const metadata = await fetchMetadata();
    
    console.log('🔍 正在提取唯一的 emoji...');
    const emojis = extractUniqueEmojis(metadata);
    
    console.log(`✅ 找到 ${emojis.length} 个唯一的 emoji`);
    
    console.log('📝 正在生成 TypeScript 文件...');
    const tsContent = generateTypeScriptFile(emojis);
    
    // 确保目录存在
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(OUTPUT_FILE, tsContent, 'utf-8');
    
    console.log(`✨ 完成！文件已保存到: ${OUTPUT_FILE}`);
    console.log(`📊 统计: ${emojis.length} 个唯一的 emoji`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

main();

