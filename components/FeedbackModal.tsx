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

  // Note: Parent component handles AnimatePresence conditional rendering.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div 
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl relative z-10 overflow-hidden"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0">
          <h3 className="font-semibold text-gray-900">Why are you not interested?</h3>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <X size={20} />
          </motion.button>
        </div>

        <div className="p-5">
          <div className="bg-gray-50 p-3 rounded-lg mb-4 text-sm text-gray-600 border border-gray-100">
            You're giving feedback on: <span className="font-semibold text-gray-800">"{post.title[language]}"</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-2 mb-4">
               {predefinedReasons.map((r, i) => (
                 <motion.button 
                  key={r} 
                  type="button"
                  whileHover={{ scale: 1.05, y: -2, borderColor: '#60a5fa', color: '#2563eb' }}
                  whileTap={{ scale: 0.95 }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setReason(r)}
                  className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full transition-colors"
                 >
                   {r}
                 </motion.button>
               ))}
            </div>

            <div className="relative group">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Type your reason here... (e.g. 'I scored 110 on TOEFL, don't show me basic English tips')"
                className="w-full p-4 bg-gray-50 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all text-sm min-h-[100px] resize-none"
                autoFocus
              />
              <div className="absolute bottom-3 right-3 text-xs text-gray-400 pointer-events-none group-focus-within:text-blue-500 transition-colors">
                <span className="flex items-center gap-1">
                  <Sparkles size={12} className={reason ? "text-purple-500 animate-pulse" : ""} />
                  AI Powered
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <motion.button 
                type="submit" 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={!reason.trim() || isAnalyzing}
                className={`
                  flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all shadow-lg
                  ${!reason.trim() || isAnalyzing 
                    ? 'bg-gray-300 cursor-not-allowed shadow-none' 
                    : 'bg-black hover:bg-gray-800 hover:shadow-xl'}
                `}
              >
                {isAnalyzing ? (
                  <>
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" 
                    />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <span>Submit Feedback</span>
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