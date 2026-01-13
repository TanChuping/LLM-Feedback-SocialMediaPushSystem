/**
 * React Hook for registering glass regions
 * 
 * 使用方式：
 * const { register, unregister, update } = useLiquidGlass('unique-id');
 * 
 * useEffect(() => {
 *   const rect = elementRef.current?.getBoundingClientRect();
 *   if (rect) {
 *     register({
 *       x: rect.left,
 *       y: rect.top,
 *       width: rect.width,
 *       height: rect.height,
 *       // ... 其他参数
 *     });
 *   }
 *   return () => unregister();
 * }, []);
 */

import { useEffect, useRef, useCallback } from 'react';
import { registerGlassRegion, unregisterGlassRegion } from '../components/LiquidGlassBackground';
import { GlassRegion } from '../services/liquidGlassRenderer';

interface UseLiquidGlassOptions {
  id: string;
  enabled?: boolean;
  updateInterval?: number; // 自动更新位置的时间间隔（ms），0 表示不自动更新
}

export function useLiquidGlass({
  id,
  enabled = true,
  updateInterval = 0,
}: UseLiquidGlassOptions) {
  const elementRef = useRef<HTMLElement | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  const currentRegionRef = useRef<GlassRegion | null>(null);

  const register = useCallback((region: Omit<GlassRegion, 'id'>) => {
    if (!enabled) return;
    
    const fullRegion: GlassRegion = {
      id,
      ...region,
    };
    currentRegionRef.current = fullRegion;
    registerGlassRegion(fullRegion);
  }, [id, enabled]);

  const unregister = useCallback(() => {
    unregisterGlassRegion(id);
    currentRegionRef.current = null;
  }, [id]);

  const update = useCallback(() => {
    if (!enabled || !elementRef.current) {
      console.log(`[useLiquidGlass ${id}] Update skipped:`, { enabled, hasElement: !!elementRef.current });
      return;
    }
    
    const rect = elementRef.current.getBoundingClientRect();
    
    // 使用 visualViewport API 来处理移动设备缩放（双指捏合）
    // 在 viewport zoom 时，getBoundingClientRect 返回的坐标是相对于 layout viewport 的 CSS 像素
    // 但 canvas 是 fixed 定位，需要转换为相对于 visual viewport 的坐标
    const viewport = window.visualViewport;
    
    let x = rect.left;
    let y = rect.top;
    let width = rect.width;
    let height = rect.height;
    
    // 如果存在 visualViewport（移动设备缩放时），需要调整坐标
    if (viewport && viewport.scale !== 1) {
      // 对于 fixed 定位的元素，getBoundingClientRect 在 viewport zoom 时
      // 返回的坐标是相对于 layout viewport 的，但我们需要相对于 visual viewport
      // visualViewport.offsetLeft/Top 是 visual viewport 相对于 layout viewport 的偏移
      x = (rect.left - viewport.offsetLeft) / viewport.scale;
      y = (rect.top - viewport.offsetTop) / viewport.scale;
      width = rect.width / viewport.scale;
      height = rect.height / viewport.scale;
    }
    
    const region = currentRegionRef.current ? {
      ...currentRegionRef.current,
      x,
      y,
      width,
      height,
    } : {
      id,
      x,
      y,
      width,
      height,
      cornerRadius: 32,      // 从 demo 调优的参数
      ior: 1.1,              // IOR (Refraction)
      thickness: 30.2,       // Thickness/Strength
      normalStrength: 4,     // Normal Strength
      blurRadius: 3,         // Blur Radius (Frosted)
      highlightWidth: 1,     // Highlight Width
    };
    
    console.log(`[useLiquidGlass ${id}] Registering region:`, region);
    register(region);
    currentRegionRef.current = region;
  }, [enabled, register, id]);

  // 自动更新位置
  useEffect(() => {
    if (!enabled || updateInterval <= 0) return;

    const startAutoUpdate = () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
      updateTimerRef.current = window.setInterval(update, updateInterval);
    };

    startAutoUpdate();

    // 监听滚动和窗口大小变化
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    
    // 监听 visualViewport 事件以处理移动设备缩放（双指捏合）
    // visualViewport 在移动设备缩放时会触发，但触控板缩放不会
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update);
      window.visualViewport.addEventListener('scroll', update);
    }

    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', update);
        window.visualViewport.removeEventListener('scroll', update);
      }
    };
  }, [enabled, updateInterval, update]);

  // 清理函数
  useEffect(() => {
    return () => {
      unregister();
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
    };
  }, [unregister]);

  return {
    elementRef,
    register,
    unregister,
    update,
  };
}
