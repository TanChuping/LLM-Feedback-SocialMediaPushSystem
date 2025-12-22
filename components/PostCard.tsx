import React, { useEffect } from 'react';
import { Post } from '../types';
import { MoreHorizontal, Heart, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLiquidGlass } from '../hooks/useLiquidGlass';

interface PostCardProps {
  post: Post;
  language: 'en' | 'zh';
  onNotInterested: (post: Post) => void;
  isOnboarding?: boolean;
  enableLiquidGlass?: boolean; // 新增：是否启用液态玻璃效果
}

export const PostCard: React.FC<PostCardProps> = ({ 
  post, 
  language, 
  onNotInterested, 
  isOnboarding,
  enableLiquidGlass = false 
}) => {
  const visibleTags = post.tags.slice(0, 5);
  const remainingTags = post.tags.length - 5;

  // 使用液态玻璃 Hook
  const { elementRef, update } = useLiquidGlass({
    id: `post-card-${post.id}`,
    enabled: enableLiquidGlass,
    updateInterval: 100, // 每 100ms 更新一次位置（用于滚动时）
  });

  // 初始注册和位置更新
  useEffect(() => {
    if (enableLiquidGlass) {
      console.log(`[PostCard ${post.id}] Enabling liquid glass, updating region...`);
      // 延迟一帧确保 DOM 已渲染
      const timer = setTimeout(() => {
        update();
      }, 100); // 增加延迟确保 DOM 完全渲染
      return () => clearTimeout(timer);
    } else {
      console.log(`[PostCard ${post.id}] Disabling liquid glass`);
    }
  }, [enableLiquidGlass, update, post.id]);

  return (
    <div 
      ref={elementRef as React.RefObject<HTMLDivElement>}
      className={`
        mb-6 p-5 transition-all duration-300 hover:scale-[1.01]
        relative overflow-hidden
        rounded-[32px]
        
        /* 液态玻璃模式：完全透明，由 WebGL 层渲染 */
        ${enableLiquidGlass 
          ? 'bg-transparent border-none shadow-none' 
          : `bg-white/60 backdrop-blur-xl backdrop-saturate-150 border border-white/40 shadow-[0_8px_32px_0_rgba(31,38,135,0.07),inset_0_0_0_1px_rgba(255,255,255,0.4)]`
        }
        ${enableLiquidGlass ? 'backdrop-blur-none' : ''} /* 禁用 CSS backdrop-blur，使用 WebGL 渲染 */
        
        group
      `}
    >
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {post.author[0]}
            </div>
            <span className="text-sm font-semibold text-gray-800 tracking-wide">{post.author}</span>
          </div>
          
          <motion.button 
            whileHover="hover"
            whileTap="tap"
            onClick={() => onNotInterested(post)}
            className={`text-gray-500 hover:text-gray-800 p-1.5 rounded-full hover:bg-white/50 group outline-none ${isOnboarding ? 'z-[60] relative bg-white/80 border-2 border-blue-500 text-blue-600 shadow-xl' : 'relative'}`}
            animate={isOnboarding ? { 
              boxShadow: ["0 0 0 0px rgba(59, 130, 246, 0)", "0 0 0 4px rgba(59, 130, 246, 0.4)", "0 0 0 8px rgba(59, 130, 246, 0)"],
              transition: { repeat: Infinity, duration: 1.5 }
            } : {}}
          >
            <motion.div
              variants={{
                hover: { rotate: 90 },
                tap: { scale: 0.9 }
              }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
               <MoreHorizontal size={20} className={isOnboarding ? "text-blue-600" : ""} />
            </motion.div>

            <motion.div 
              variants={{
                hover: { 
                  opacity: 1, 
                  x: -5,
                  y: 0,
                  scale: 1,
                  display: 'block',
                  transition: { type: 'spring', stiffness: 400, damping: 20 }
                },
                tap: { scale: 0.95 }
              }}
              initial={{ opacity: 0, x: 10, y: 0, scale: 0.8, display: 'none' }}
              className="absolute right-9 top-0.5 whitespace-nowrap bg-black/80 backdrop-blur-md text-white text-xs font-medium py-1.5 px-3 rounded-lg pointer-events-none shadow-lg z-10"
            >
              Feedback
              <div className="absolute top-1/2 -right-1 w-2 h-2 bg-black/80 transform -translate-y-1/2 rotate-45"></div>
            </motion.div>
          </motion.button>
        </div>

        <div className="flex gap-5">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 mb-1.5 leading-tight">{post.title[language]}</h3>
            <p className="text-gray-700 text-sm line-clamp-2 mb-3 leading-relaxed font-normal opacity-90">
              {post.content[language]}
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {visibleTags.map(tag => (
                <span key={tag} className="text-xs px-2.5 py-1 bg-white/50 border border-white/60 text-gray-600 font-medium rounded-full shadow-sm backdrop-blur-sm">
                  #{tag}
                </span>
              ))}
              {remainingTags > 0 && (
                <span className="text-xs px-2.5 py-1 bg-white/30 text-gray-500 rounded-full border border-white/40 font-medium">
                  +{remainingTags} more
                </span>
              )}
            </div>
          </div>
          {post.imageUrl && (
            <img 
              src={post.imageUrl} 
              alt="Post cover" 
              className="w-24 h-24 object-cover rounded-2xl bg-gray-200/50 shrink-0 border border-white/50 shadow-sm"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200/40 pt-3 mt-1">
          <div className="flex gap-6">
            <motion.button 
              whileHover="hover" 
              whileTap="tap"
              className="flex items-center gap-1.5 text-gray-600 hover:text-red-500 transition-colors text-sm group font-medium"
            >
              <motion.div
                variants={{
                  hover: { scale: 1.2, y: -2 },
                  tap: { scale: 0.8 }
                }}
                transition={{ type: "spring", stiffness: 400, damping: 10 }}
              >
                <Heart size={18} />
              </motion.div>
              <span>{post.likes}</span>
            </motion.button>

            <motion.button 
               whileHover="hover" 
               whileTap="tap"
               className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors text-sm group font-medium"
            >
               <motion.div
                 variants={{
                   hover: { scale: 1.1, rotate: -5, x: 2 },
                   tap: { scale: 0.9 }
                 }}
               >
                 <MessageSquare size={18} />
               </motion.div>
              <span>Reply</span>
            </motion.button>
          </div>
          <div className="text-[10px] font-mono text-gray-400 opacity-60" title={post.debugReason}>
             Score: {post.score}
          </div>
        </div>
      </div>
    </div>
  );
};