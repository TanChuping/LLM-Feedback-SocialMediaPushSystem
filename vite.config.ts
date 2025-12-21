import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    // 安全地加载环境变量，如果文件不存在也不会报错
    let env = {};
    try {
      env = loadEnv(mode, '.', '');
    } catch (e) {
      // 在构建环境中，如果没有 .env 文件，使用空对象
      console.warn('No .env file found, using defaults');
    }
    
    return {
      // 关键修改：添加 base 配置，对应你的 GitHub 仓库名
      // 如果你的仓库名改了，请把 /LLM-Feedback-SocialMediaPushSystem/ 换成新的名字，前后斜杠不能少
      base: '/LLM-Feedback-SocialMediaPushSystem/',
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // 保持原有的环境变量配置，如果不存在则使用空字符串
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
