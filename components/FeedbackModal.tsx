import React, { useState } from 'react';
import { X, Send, Sparkles } from 'lucide-react';
import { Post } from '../types';

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

  if (!isOpen || !post) return null;

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-semibold text-gray-900">Why are you not interested?</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          <div className="bg-gray-50 p-3 rounded-lg mb-4 text-sm text-gray-600 border border-gray-100">
            You're giving feedback on: <span className="font-semibold text-gray-800">"{post.title[language]}"</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-2 mb-4">
               {predefinedReasons.map(r => (
                 <button 
                  key={r} 
                  type="button"
                  onClick={() => setReason(r)}
                  className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-blue-400 hover:text-blue-600 transition-colors"
                 >
                   {r}
                 </button>
               ))}
            </div>

            <div className="relative">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Type your reason here... (e.g. 'I scored 110 on TOEFL, don't show me basic English tips')"
                className="w-full p-4 bg-gray-50 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all text-sm min-h-[100px] resize-none"
                autoFocus
              />
              <div className="absolute bottom-3 right-3 text-xs text-gray-400 pointer-events-none">
                <span className="flex items-center gap-1">
                  <Sparkles size={12} className="text-purple-500" />
                  AI Powered
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button 
                type="submit" 
                disabled={!reason.trim() || isAnalyzing}
                className={`
                  flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all
                  ${!reason.trim() || isAnalyzing 
                    ? 'bg-gray-300 cursor-not-allowed' 
                    : 'bg-black hover:bg-gray-800 shadow-lg hover:shadow-xl active:scale-95'}
                `}
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <span>Submit Feedback</span>
                    <Send size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};