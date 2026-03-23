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
  updateInterval?: number; // Kept for API compat but ignored (scroll is per-frame now)
}

export function useLiquidGlass({
  id,
  enabled = true,
}: UseLiquidGlassOptions) {
  const elementRef = useRef<HTMLElement | null>(null);
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
    
    const anchorScrollY = window.scrollY;

    const region = currentRegionRef.current ? {
      ...currentRegionRef.current,
      x,
      y,
      width,
      height,
      anchorScrollY,
    } : {
      id,
      x,
      y,
      width,
      height,
      anchorScrollY,
      cornerRadius: 32,
      ior: 1.1,
      thickness: 30.2,
      normalStrength: 4,
      blurRadius: 3,
      highlightWidth: 1,
    };
    
    register(region);
    currentRegionRef.current = region;
  }, [enabled, register, id]);

  // Re-measure positions on resize only (scroll is handled per-frame in the renderer via anchorScrollY)
  useEffect(() => {
    if (!enabled) return;

    const handleResize = () => {
      requestAnimationFrame(update);
    };

    window.addEventListener('resize', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
    };
  }, [enabled, update]);

  useEffect(() => {
    return () => {
      unregister();
    };
  }, [unregister]);

  return {
    elementRef,
    register,
    unregister,
    update,
  };
}
