/**
 * 下载 emoji-kitchen metadata.json 并保存到本地
 * 运行: node scripts/downloadMetadata.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const METADATA_URL = 'https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json';
const OUTPUT_FILE_DATA = path.join(__dirname, '../data/metadata.json');
const OUTPUT_FILE_PUBLIC = path.join(__dirname, '../public/metadata.json');

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

async function main() {
  try {
    console.log('📥 正在下载 metadata.json...');
    const metadata = await fetchMetadata();
    
    // 保存到两个位置：data 和 public
    const dirs = [path.dirname(OUTPUT_FILE_DATA), path.dirname(OUTPUT_FILE_PUBLIC)];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // 保存到 data 目录（用于 TypeScript 导入，如果支持）
    fs.writeFileSync(OUTPUT_FILE_DATA, JSON.stringify(metadata, null, 2), 'utf-8');
    
    // 保存到 public 目录（用于运行时 fetch）
    fs.writeFileSync(OUTPUT_FILE_PUBLIC, JSON.stringify(metadata, null, 2), 'utf-8');
    
    console.log(`✨ 完成！metadata.json 已保存到:`);
    console.log(`   - ${OUTPUT_FILE_DATA}`);
    console.log(`   - ${OUTPUT_FILE_PUBLIC}`);
    console.log(`📊 统计: ${Object.keys(metadata).length} 个顶层 key`);
    
    if (metadata.knownSupportedEmoji) {
      console.log(`📊 支持的 emoji 数量: ${metadata.knownSupportedEmoji.length}`);
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

main();

