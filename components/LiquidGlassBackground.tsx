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
    globalRenderer.registerRegion(region);
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
    if (!enabled || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const vp = window.visualViewport;
    const cssWidth = vp ? vp.width : window.innerWidth;
    const cssHeight = vp ? vp.height : window.innerHeight;

    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    try {
      const renderer = new LiquidGlassRenderer(canvas);
      rendererRef.current = renderer;
      globalRenderer = renderer;

      // 初始化并加载背景（添加更详细的错误处理）
      renderer.initialize(backgroundImageUrl).catch(() => {});
    } catch {
      rendererRef.current = null;
      globalRenderer = null;
    }

    // 监听窗口大小变化和 visualViewport 变化（处理移动设备缩放）
    // Renderer now updates canvas size per-frame using visualViewport,
    // but we still listen for resize to trigger region re-measurement in the hook.
    const handleResize = () => {};
    
    window.addEventListener('resize', handleResize);
    // 监听 visualViewport 变化以处理移动设备缩放
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      if (rendererRef.current) {
        if (globalRenderer === rendererRef.current) {
          globalRenderer = null;
        }
        rendererRef.current.destroy();
        rendererRef.current = null;
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
        zIndex: enabled ? -1 : -999,
        pointerEvents: 'none',
        display: enabled ? 'block' : 'none',
      }}
    />
  );
};
