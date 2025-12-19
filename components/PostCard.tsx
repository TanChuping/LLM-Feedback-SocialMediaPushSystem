import React from 'react';
import { Post } from '../types';
import { MoreHorizontal, Heart, MessageSquare, ThumbsDown } from 'lucide-react';

interface PostCardProps {
  post: Post;
  onNotInterested: (post: Post) => void;
}

export const PostCard: React.FC<PostCardProps> = ({ post, onNotInterested }) => {
  return (
    <div className="bg-white rounded-xl p-4 mb-4 shadow-sm border border-gray-100 transition-all hover:shadow-md">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-400 to-blue-400 flex items-center justify-center text-white text-xs font-bold">
            {post.author[0]}
          </div>
          <span className="text-sm font-medium text-gray-700">{post.author}</span>
        </div>
        <button 
          onClick={() => onNotInterested(post)}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 transition-colors group relative"
          title="Not Interested / Feedback"
        >
          <MoreHorizontal size={20} />
          {/* Tooltip hint */}
          <span className="absolute right-0 top-6 w-24 bg-black text-white text-xs p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-center z-10">
            Feedback
          </span>
        </button>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight">{post.title}</h3>
          <p className="text-gray-600 text-sm line-clamp-2 mb-3 leading-relaxed">
            {post.content}
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {post.tags.map(tag => (
              <span key={tag} className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                #{tag}
              </span>
            ))}
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
          <button className="flex items-center gap-1.5 text-gray-500 hover:text-red-500 transition-colors text-sm">
            <Heart size={18} />
            <span>{post.likes}</span>
          </button>
          <button className="flex items-center gap-1.5 text-gray-500 hover:text-blue-500 transition-colors text-sm">
            <MessageSquare size={18} />
            <span>Reply</span>
          </button>
        </div>
        {/* Debug score display for demo purposes */}
        <div className="text-xs font-mono text-gray-300" title={post.debugReason}>
           Score: {post.score}
        </div>
      </div>
    </div>
  );
};
