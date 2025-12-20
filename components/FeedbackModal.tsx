import React, { useState } from 'react';
import { X, Send, Sparkles } from 'lucide-react';
import { Post } from '../types';
import { motion } from 'framer-motion';

interface FeedbackModalProps {
  isOpen: boolean;
  post: Post | null;
  language: 'en' | 'zh';
  onClose: () => void;
  onSubmit: (text: string, post: Post) => void;
  isAnalyzing: boolean;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ 
  isOpen, 
  post, 
  language,
  onClose, 
  onSubmit, 
  isAnalyzing 
}) => {
  const [reason, setReason] = useState('');

  if (!post) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim()) {
      onSubmit(reason, post);
      setReason('');
    }
  };

  const predefinedReasons = [
    "Already know this content",
    "It's misleading clickbait",
    "Not relevant to my major",
    "Too basic/low quality"
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop with Blur */}
      <motion.div 
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Glass Modal */}
      <motion.div 
        className="
          relative z-10 w-full max-w-md overflow-hidden
          rounded-[32px] 
          bg-white/70 backdrop-blur-2xl backdrop-saturate-150
          border border-white/50
          shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15),inset_0_0_0_1px_rgba(255,255,255,0.5)]
        "
        initial={{ scale: 0.9, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 30 }}
        transition={{ type: "spring", duration: 0.6, bounce: 0.2 }}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/30 flex justify-between items-center bg-white/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-100/50 rounded-lg text-blue-600">
               <Sparkles size={16} />
            </div>
            <h3 className="font-bold text-gray-800 text-lg">AI Feedback</h3>
          </div>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 90, backgroundColor: 'rgba(0,0,0,0.05)' }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose} 
            className="text-gray-500 p-2 rounded-full transition-colors"
          >
            <X size={20} />
          </motion.button>
        </div>

        <div className="p-6 space-y-5">
          {/* Post Context Info */}
          <div className="bg-white/40 p-3 rounded-xl text-sm text-gray-600 border border-white/40 shadow-sm">
            Feedback regarding: <span className="font-bold text-gray-900 block mt-1 truncate">"{post.title[language]}"</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Quick Chips */}
            <div className="flex flex-wrap gap-2">
               {predefinedReasons.map((r, i) => (
                 <motion.button 
                  key={r} 
                  type="button"
                  whileHover={{ scale: 1.05, y: -2, backgroundColor: "rgba(255,255,255,0.9)" }}
                  whileTap={{ scale: 0.95 }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setReason(r)}
                  className="text-xs font-medium bg-white/50 border border-white/50 text-gray-600 px-3 py-1.5 rounded-full shadow-sm hover:shadow-md hover:text-blue-600 hover:border-blue-200 transition-all"
                 >
                   {r}
                 </motion.button>
               ))}
            </div>

            {/* Input Area */}
            <div className="relative group">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Share your thoughts (e.g. 'I like this topic', 'Too noisy', 'Show more like this')..."
                className="w-full p-4 bg-white/40 rounded-2xl border border-white/50 focus:border-blue-400 focus:bg-white/60 focus:ring-4 focus:ring-blue-100/50 outline-none transition-all text-sm min-h-[120px] resize-none placeholder-gray-500 shadow-inner text-gray-800 font-medium"
                autoFocus
              />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <motion.button 
                type="submit" 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={!reason.trim() || isAnalyzing}
                className={`
                  flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold shadow-lg transition-all
                  ${!reason.trim() || isAnalyzing 
                    ? 'bg-gray-300/50 text-gray-500 cursor-not-allowed shadow-none border border-white/20' 
                    : 'bg-black/90 text-white hover:bg-black hover:shadow-xl hover:shadow-blue-900/20 border border-black/10'}
                `}
              >
                {isAnalyzing ? (
                  <>
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" 
                    />
                    <span>Analyzing Intent...</span>
                  </>
                ) : (
                  <>
                    <span>Submit to Algorithm</span>
                    <Send size={16} />
                  </>
                )}
              </motion.button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
};