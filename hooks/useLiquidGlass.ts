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
    
    // 对于 fixed 定位的 canvas，使用 getBoundingClientRect 返回的视口坐标
    // 不需要加上 scrollX/scrollY，因为 canvas 是 fixed 定位
    const x = rect.left;
    const y = rect.top;
    
    const region = currentRegionRef.current ? {
      ...currentRegionRef.current,
      x,
      y,
      width: rect.width,
      height: rect.height,
    } : {
      id,
      x,
      y,
      width: rect.width,
      height: rect.height,
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

    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
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
