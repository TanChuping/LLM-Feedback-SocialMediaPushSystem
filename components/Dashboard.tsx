import React, { useEffect, useRef, useState } from 'react';
import { UserProfile, SystemLog, WeightedTag } from '../types';
import { Activity, User, Terminal, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';

interface DashboardProps {
  userProfile: UserProfile;
  logs: SystemLog[];
  onReset: () => void;
  className?: string; // Allow overriding the default sticky positioning
}

// --- Inner Component: Tag Chip with Animation ---
const TagChip: React.FC<{ tagData: WeightedTag; colorClass: string }> = ({ tagData, colorClass }) => {
  // Use a ref to track the previous weight so we don't lose it across renders
  const prevWeightRef = useRef(tagData.weight);
  const [animData, setAnimData] = useState<{ val: string; key: number } | null>(null);

  useEffect(() => {
    // Calculate difference
    const diff = tagData.weight - prevWeightRef.current;
    
    // Only animate if there is a significant difference (> 0.1)
    if (Math.abs(diff) > 0.1) {
      const sign = diff > 0 ? '+' : '';
      setAnimData({ 
        val: `${sign}${diff.toFixed(1)}`, 
        key: Date.now() // Unique key to force restart animation
      });
    }

    // Update the ref to current for next time
    prevWeightRef.current = tagData.weight;
  }, [tagData.weight]);

  return (
    <div className={`relative px-2.5 py-1.5 ${colorClass} text-xs rounded-lg border flex items-center gap-2 transition-all duration-300 animate-in fade-in zoom-in`}>
      <span className="font-medium">{tagData.tag}</span>
      
      {/* Score Pill */}
      <span className="bg-white/60 px-1.5 rounded-md text-[10px] font-mono font-bold min-w-[28px] text-center shadow-sm">
        {tagData.weight.toFixed(1)}
      </span>

      {/* Floating Animation Label */}
      {animData && (
        <span 
          key={animData.key} // Forces unmount/remount of this span to restart animation
          onAnimationEnd={() => setAnimData(null)} // Cleanup after animation
          className={`
            absolute -top-6 right-0 z-50
            text-sm font-black px-2 py-0.5 rounded-full shadow-sm border
            animate-[floatUpFade_1.5s_ease-out_forwards]
            ${animData.val.startsWith('-') 
              ? 'bg-red-100 text-red-600 border-red-200' 
              : 'bg-green-100 text-green-600 border-green-200'}
          `}
        >
          {animData.val}
        </span>
      )}
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, logs, onReset, className }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={className || "sticky top-6 space-y-6"}>
      {/* Improved Animation Keyframes */}
      <style>{`
        @keyframes floatUpFade {
          0% { 
            opacity: 0; 
            transform: translateY(5px) scale(0.8); 
          }
          15% {
            opacity: 1;
            transform: translateY(-8px) scale(1.1);
          }
          100% { 
            opacity: 0; 
            transform: translateY(-25px) scale(1); 
          }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Activity className="text-blue-600" />
          System Internals
        </h2>
        <motion.button 
          whileHover={{ scale: 1.05, color: '#dc2626' }}
          whileTap={{ scale: 0.95 }}
          onClick={onReset}
          className="text-xs flex items-center gap-1 text-gray-500 transition-colors p-1"
        >
          <motion.div
            whileHover={{ rotate: 180 }}
            transition={{ duration: 0.3 }}
          >
            <RefreshCcw size={14} />
          </motion.div>
          Reset Demo
        </motion.button>
      </div>

      {/* User Persona Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 border-b border-blue-100 flex items-center gap-3">
          <div className="bg-blue-100 p-2 rounded-full text-blue-600">
             <User size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">{userProfile.name}</h3>
            <p className="text-xs text-blue-600 font-medium">Live User Profile Model</p>
          </div>
        </div>
        
        <div className="p-4 space-y-5">
          {/* Interests Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-600 uppercase tracking-wider">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></span>
                Interest Vectors (Likes)
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {userProfile.interests.map(t => (
                <TagChip 
                  key={t.tag} 
                  tagData={t} 
                  colorClass="bg-green-50 text-green-800 border-green-200" 
                />
              ))}
              {userProfile.interests.length === 0 && <span className="text-xs text-gray-400">No interests...</span>}
            </div>
          </div>

          {/* Dislikes Section */}
          <div className="relative border-t border-dashed border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-600 uppercase tracking-wider">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm animate-pulse"></span>
                Negative Filters (Dislikes)
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5 min-h-[2rem]">
              {userProfile.dislikes.length === 0 ? (
                <span className="text-xs text-gray-400 italic">No negative filters yet...</span>
              ) : (
                userProfile.dislikes.map(t => (
                  <TagChip 
                    key={t.tag} 
                    tagData={t} 
                    colorClass="bg-red-50 text-red-800 border-red-200" 
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Logs Console */}
      <div className="bg-gray-900 rounded-2xl shadow-lg overflow-hidden flex flex-col h-[400px]">
        <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center gap-2 text-gray-300 text-sm font-mono">
            <Terminal size={16} />
            <span>algorithm_events.log</span>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
          </div>
        </div>
        
        <div 
          ref={scrollRef}
          className="flex-1 p-4 overflow-y-auto custom-scrollbar font-mono text-xs space-y-4"
        >
          {logs.length === 0 && (
            <div className="text-gray-500 text-center mt-10">Waiting for interaction...</div>
          )}
          
          {logs.map((log) => (
            <div key={log.id} className="border-l-2 border-gray-700 pl-3 py-1 animate-in slide-in-from-left-2 duration-300">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500">[{log.timestamp}]</span>
                <span className={`font-bold ${
                  log.type === 'FEEDBACK' ? 'text-yellow-400' :
                  log.type === 'LLM_ANALYSIS' ? 'text-purple-400' :
                  log.type === 'PROFILE_UPDATE' ? 'text-blue-400' :
                  'text-green-400'
                }`}>
                  {log.type}
                </span>
              </div>
              <div className="text-gray-300 mb-1 font-semibold">{log.title}</div>
              
              {log.details && (
                <div className="bg-black/30 p-2 rounded text-gray-400 whitespace-pre-wrap break-words">
                  {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};