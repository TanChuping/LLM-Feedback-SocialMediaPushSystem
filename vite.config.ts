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
    
    // 开发模式使用根路径，生产模式使用 GitHub Pages 路径
    // 注意：GitHub Actions 构建时 mode 是 'production'
    const isDev = mode === 'development';
    const base = isDev ? '/' : '/LLM-Feedback-SocialMediaPushSystem/';
    
    console.log(`[Vite Config] Mode: ${mode}, Base: ${base}`);
    
    return {
      // 关键修改：添加 base 配置，对应你的 GitHub 仓库名
      // 开发模式使用 '/'，生产模式使用 '/LLM-Feedback-SocialMediaPushSystem/'
      base: base,
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        outDir: 'dist',
        assetsDir: 'assets',
        // 确保资源路径正确
        rollupOptions: {
          output: {
            // 确保资源文件名包含 hash，便于缓存
            assetFileNames: 'assets/[name].[hash].[ext]',
            chunkFileNames: 'assets/[name].[hash].js',
            entryFileNames: 'assets/[name].[hash].js',
          }
        }
      },
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
