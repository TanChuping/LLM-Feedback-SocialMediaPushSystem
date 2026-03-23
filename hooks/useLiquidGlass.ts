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
    if (!enabled || !elementRef.current) return;

    // Always store raw layout-viewport coordinates.
    // The renderer handles visualViewport transform per-frame.
    const rect = elementRef.current.getBoundingClientRect();
    const anchorScrollX = window.scrollX;
    const anchorScrollY = window.scrollY;

    const region = currentRegionRef.current ? {
      ...currentRegionRef.current,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      anchorScrollX,
      anchorScrollY,
    } : {
      id,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      anchorScrollX,
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
