import React, { useEffect, useRef, useState } from 'react';
import { UserProfile, SystemLog, WeightedTag } from '../types';
import { Activity, User, Terminal, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLiquidGlass } from '../hooks/useLiquidGlass';

interface DashboardProps {
  userProfile: UserProfile;
  logs: SystemLog[];
  onReset: () => void;
  className?: string;
  enableLiquidGlass?: boolean; // 新增：是否启用液态玻璃效果
}

const TagChip: React.FC<{ tagData: WeightedTag; colorClass: string }> = ({ tagData, colorClass }) => {
  const prevWeightRef = useRef(tagData.weight);
  const [animData, setAnimData] = useState<{ val: string; key: number } | null>(null);

  useEffect(() => {
    const diff = tagData.weight - prevWeightRef.current;
    if (Math.abs(diff) > 0.1) {
      const sign = diff > 0 ? '+' : '';
      setAnimData({ 
        val: `${sign}${diff.toFixed(1)}`, 
        key: Date.now() 
      });
    }
    prevWeightRef.current = tagData.weight;
  }, [tagData.weight]);

  return (
    <div className={`relative px-2.5 py-1.5 ${colorClass} text-xs rounded-lg border flex items-center gap-2 transition-all duration-300 animate-in fade-in zoom-in shadow-sm`}>
      <span className="font-medium">{tagData.tag}</span>
      <span className="bg-white/60 px-1.5 rounded-md text-[10px] font-mono font-bold min-w-[28px] text-center shadow-sm">
        {tagData.weight.toFixed(1)}
      </span>
      {animData && (
        <span 
          key={animData.key} 
          onAnimationEnd={() => setAnimData(null)} 
          className={`
            absolute -top-6 right-0 z-50
            text-sm font-black px-2 py-0.5 rounded-full shadow-sm border
            animate-[floatUpFade_1.5s_ease-out_forwards]
            ${animData.val.startsWith('-') 
              ? 'bg-red-100/90 text-red-600 border-red-200' 
              : 'bg-green-100/90 text-green-600 border-green-200'}
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={className || "sticky top-6 space-y-6"}>
      <style>{`
        @keyframes floatUpFade {
          0% { opacity: 0; transform: translateY(5px) scale(0.8); }
          15% { opacity: 1; transform: translateY(-8px) scale(1.1); }
          100% { opacity: 0; transform: translateY(-25px) scale(1); }
        }
      `}</style>

      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-bold text-gray-900 drop-shadow-sm flex items-center gap-2">
          <Activity className="text-blue-600" />
          System Internals
        </h2>
        <motion.button 
          whileHover={{ scale: 1.05, color: '#dc2626' }}
          whileTap={{ scale: 0.95 }}
          onClick={onReset}
          className="text-xs flex items-center gap-1 text-gray-700 bg-white/40 px-2 py-1 rounded-full hover:bg-white/60 transition-all font-medium border border-white/40"
        >
          <motion.div whileHover={{ rotate: 180 }} transition={{ duration: 0.3 }}>
            <RefreshCcw size={14} />
          </motion.div>
          Reset Demo
        </motion.button>
      </div>

      {/* User Persona Card - Glass Effect */}
      <div className="bg-white/60 backdrop-blur-xl rounded-[24px] shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] border border-white/40 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 p-4 border-b border-white/30 flex items-center gap-3">
          <div className="bg-blue-100/80 p-2 rounded-full text-blue-600 shadow-sm">
             <User size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">{userProfile.name}</h3>
            <p className="text-xs text-blue-600 font-medium">Live User Profile Model</p>
          </div>
        </div>
        
        <div className="p-4 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></span>
                Interest Vectors (Likes)
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {userProfile.interests.map(t => (
                <TagChip 
                  key={t.tag} 
                  tagData={t} 
                  colorClass="bg-green-50/80 backdrop-blur-sm text-green-800 border-green-200/50" 
                />
              ))}
              {userProfile.interests.length === 0 && <span className="text-xs text-gray-500">No interests...</span>}
            </div>
          </div>

          <div className="relative border-t border-dashed border-gray-300/50 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm animate-pulse"></span>
                Negative Filters (Dislikes)
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5 min-h-[2rem]">
              {userProfile.dislikes.length === 0 ? (
                <span className="text-xs text-gray-500 italic">No negative filters yet...</span>
              ) : (
                userProfile.dislikes.map(t => (
                  <TagChip 
                    key={t.tag} 
                    tagData={t} 
                    colorClass="bg-red-50/80 backdrop-blur-sm text-red-800 border-red-200/50" 
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Logs Console - Glass Effect Dark Mode */}
      <div className="bg-gray-900/80 backdrop-blur-xl rounded-[24px] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-[400px]">
        <div className="bg-gray-800/50 px-4 py-3 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-2 text-gray-300 text-sm font-mono">
            <Terminal size={16} />
            <span>algorithm_events.log</span>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-sm"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></div>
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
                <div className="bg-black/40 p-2 rounded text-gray-400 whitespace-pre-wrap break-words border border-white/5">
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