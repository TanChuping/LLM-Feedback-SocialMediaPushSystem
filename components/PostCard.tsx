import React from 'react';
import { Post } from '../types';
import { MoreHorizontal, Heart, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PostCardProps {
  post: Post;
  language: 'en' | 'zh';
  onNotInterested: (post: Post) => void;
  isOnboarding?: boolean;
}

export const PostCard: React.FC<PostCardProps> = ({ post, language, onNotInterested, isOnboarding }) => {
  // Only show first 5 tags to prevent clutter, but the recommendation engine uses all of them.
  const visibleTags = post.tags.slice(0, 5);
  const remainingTags = post.tags.length - 5;

  return (
    <div className={`bg-white rounded-xl p-4 mb-4 shadow-sm border border-gray-100 transition-all hover:shadow-md ${isOnboarding ? '' : ''}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-400 to-blue-400 flex items-center justify-center text-white text-xs font-bold">
            {post.author[0]}
          </div>
          <span className="text-sm font-medium text-gray-700">{post.author}</span>
        </div>
        
        {/* Animated More Button with Lively Tooltip */}
        <motion.button 
          whileHover="hover"
          whileTap="tap"
          onClick={() => onNotInterested(post)}
          // Changed: Replaced large ring-4 with a cleaner border-2, and kept text blue during onboarding
          className={`text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 group outline-none ${isOnboarding ? 'z-50 relative bg-white border-2 border-blue-500 text-blue-600' : 'relative'}`}
          // Changed: Reduced animation spread (boxShadow) to be much tighter (max 6px instead of 12px)
          animate={isOnboarding ? { 
            boxShadow: ["0 0 0 0px rgba(59, 130, 246, 0)", "0 0 0 3px rgba(59, 130, 246, 0.3)", "0 0 0 6px rgba(59, 130, 246, 0)"],
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

          {/* Lively Feedback Tooltip */}
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
            className="absolute right-8 top-0.5 whitespace-nowrap bg-black text-white text-xs font-medium py-1.5 px-3 rounded-lg pointer-events-none shadow-lg z-10"
          >
            Feedback
            <div className="absolute top-1/2 -right-1 w-2 h-2 bg-black transform -translate-y-1/2 rotate-45"></div>
          </motion.div>
        </motion.button>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight">{post.title[language]}</h3>
          <p className="text-gray-600 text-sm line-clamp-2 mb-3 leading-relaxed">
            {post.content[language]}
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {visibleTags.map(tag => (
              <span key={tag} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                #{tag}
              </span>
            ))}
            {remainingTags > 0 && (
              <span className="text-xs px-2 py-1 bg-gray-50 text-gray-400 rounded-full border border-gray-100">
                +{remainingTags} more
              </span>
            )}
          </div>
        </div>
        {post.imageUrl && (
          <img 
            src={post.imageUrl} 
            alt="Post cover" 
            className="w-24 h-24 object-cover rounded-lg bg-gray-200 shrink-0"
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-50 pt-3 mt-1">
        <div className="flex gap-6">
          {/* Animated Like Button */}
          <motion.button 
            whileHover="hover" 
            whileTap="tap"
            className="flex items-center gap-1.5 text-gray-500 hover:text-red-500 transition-colors text-sm group"
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

          {/* Animated Reply Button */}
          <motion.button 
             whileHover="hover" 
             whileTap="tap"
             className="flex items-center gap-1.5 text-gray-500 hover:text-blue-500 transition-colors text-sm group"
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
        {/* Debug score display for demo purposes */}
        <div className="text-xs font-mono text-gray-300" title={post.debugReason}>
           Score: {post.score}
        </div>
      </div>
    </div>
  );
};