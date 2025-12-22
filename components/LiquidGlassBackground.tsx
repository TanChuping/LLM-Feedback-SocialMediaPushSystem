/**
 * 液态玻璃全屏背景层组件
 * 
 * 架构：
 * - 全屏固定定位，z-index: -1
 * - 单一 WebGL Context
 * - 接收来自其他组件的玻璃区域注册
 */

import React, { useEffect, useRef } from 'react';
import { LiquidGlassRenderer, GlassRegion } from '../services/liquidGlassRenderer';

// 全局渲染器实例（单例模式）
let globalRenderer: LiquidGlassRenderer | null = null;
const regionUpdateCallbacks: Map<string, () => void> = new Map();

// 全局注册函数，供其他组件调用
export function registerGlassRegion(region: GlassRegion): void {
  if (globalRenderer) {
    console.log('[registerGlassRegion] Registering:', region);
    globalRenderer.registerRegion(region);
  } else {
    console.warn('[registerGlassRegion] Global renderer not initialized yet');
  }
}

export function unregisterGlassRegion(id: string): void {
  if (globalRenderer) {
    globalRenderer.unregisterRegion(id);
  }
}

// 注册更新回调（用于响应式更新）
export function onRegionUpdate(id: string, callback: () => void): () => void {
  regionUpdateCallbacks.set(id, callback);
  return () => {
    regionUpdateCallbacks.delete(id);
  };
}

interface LiquidGlassBackgroundProps {
  backgroundImageUrl?: string;
  enabled?: boolean;
}

export const LiquidGlassBackground: React.FC<LiquidGlassBackgroundProps> = ({
  backgroundImageUrl,
  enabled = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LiquidGlassRenderer | null>(null);

  useEffect(() => {
    console.log('[LiquidGlassBackground] useEffect triggered', { enabled, hasCanvas: !!canvasRef.current, backgroundImageUrl });
    
    if (!enabled || !canvasRef.current) {
      console.log('LiquidGlassBackground: disabled or canvas not ready', { enabled, hasCanvas: !!canvasRef.current });
      return;
    }

    const canvas = canvasRef.current;
    
    // 确保 canvas 有正确的尺寸
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    
    console.log('LiquidGlassBackground: Initializing renderer...', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      windowSize: { w: window.innerWidth, h: window.innerHeight },
      hasWebGL: !!canvas.getContext('webgl') || !!canvas.getContext('experimental-webgl')
    });
    
    // 检查 WebGL 支持
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('LiquidGlassBackground: WebGL not supported, falling back to disabled state');
      return;
    }
    
    // 初始化渲染器
    try {
      const renderer = new LiquidGlassRenderer(canvas);
      rendererRef.current = renderer;
      globalRenderer = renderer;

      // 初始化并加载背景（添加更详细的错误处理）
      renderer
        .initialize(backgroundImageUrl)
        .then(() => {
          console.log('LiquidGlassBackground: Renderer initialized successfully');
        })
        .catch((error) => {
          console.error('Failed to initialize liquid glass renderer:', error);
          // 即使背景加载失败，也继续使用默认纹理
          console.warn('LiquidGlassBackground: Continuing with default texture');
        });
    } catch (error) {
      console.error('Failed to create renderer:', error);
      // 清理状态
      rendererRef.current = null;
      globalRenderer = null;
    }

    // 监听窗口大小变化
    const handleResize = () => {
      // Canvas 尺寸会在 render 循环中自动更新
    };
    window.addEventListener('resize', handleResize);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      if (globalRenderer === rendererRef.current) {
        globalRenderer = null;
      }
    };
  }, [enabled, backgroundImageUrl]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: enabled ? -1 : -999, // 禁用时隐藏更深
        pointerEvents: 'none', // 不拦截鼠标事件
        display: enabled ? 'block' : 'none', // 禁用时完全不渲染
        opacity: enabled ? 1 : 0, // 额外的可见性控制
      }}
      onError={(e) => {
        console.error('Canvas error:', e);
      }}
    />
  );
};
