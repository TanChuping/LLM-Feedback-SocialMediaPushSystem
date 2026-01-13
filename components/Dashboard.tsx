import React, { useEffect, useRef, useState } from 'react';
import { UserProfile, SystemLog, WeightedTag } from '../types';
import { Activity, User, Terminal, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiquidGlass } from '../hooks/useLiquidGlass';

interface DashboardProps {
  userProfile: UserProfile;
  logs: SystemLog[];
  onReset: () => void;
  className?: string;
  enableLiquidGlass?: boolean; // 新增：是否启用液态玻璃效果
  userPersona?: { description: string; emojiFusion: string[] };
  emojiFusionImage?: string | null;
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

export const Dashboard: React.FC<DashboardProps> = ({ 
  userProfile, 
  logs, 
  onReset, 
  className,
  userPersona,
  emojiFusionImage
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

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
        <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 p-4 border-b border-white/30">
          <div className="flex items-center gap-3">
            {/* Emoji Fusion 大头像 */}
            <div className="relative">
              {emojiFusionImage ? (
                // 显示融合后的图片
                <div className="relative">
                  <motion.img
                    key={emojiFusionImage} // 使用 key 强制重新渲染
                    src={emojiFusionImage}
                    alt="Emoji Fusion"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 200 }}
                    className="w-16 h-16 rounded-full object-cover shadow-lg border-2 border-white/50 bg-white/20"
                    onError={(e) => {
                      // 如果融合图片加载失败，隐藏并回退到显示原始 emoji
                      console.error('[Dashboard] Emoji fusion image failed to load:', emojiFusionImage);
                      e.currentTarget.style.display = 'none';
                      // 触发父组件更新，清除失败的图片URL
                      const event = new CustomEvent('emojiFusionError');
                      window.dispatchEvent(event);
                    }}
                    onLoad={() => {
                      console.log('[Dashboard] ✅ Emoji fusion image loaded successfully');
                    }}
                  />
                  {/* 加载指示器（可选） */}
                  <div className="absolute inset-0 flex items-center justify-center bg-white/10 rounded-full">
                    <div className="w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin opacity-0" />
                  </div>
                </div>
              ) : (
                // 回退：显示原始 emoji（如果融合失败或未生成）
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center text-3xl shadow-lg border-2 border-white/50">
                  <div className="flex items-center justify-center gap-0.5">
                    {(userPersona?.emojiFusion?.slice(0, 2) || ['👤', '🤔']).map((emoji, idx) => (
                      <motion.span
                        key={idx}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: idx * 0.1, type: "spring" }}
                        className="text-2xl"
                      >
                        {emoji}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
              {/* 旋转装饰 */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-1 border-2 border-dashed border-purple-200/50 rounded-full pointer-events-none"
              />
            </div>
            
            <div className="flex-1">
              <h3 className="font-bold text-gray-900">{userProfile.name}</h3>
              <p className="text-xs text-blue-600 font-medium">Live User Profile Model</p>
            </div>
            
            {/* 展开/折叠按钮 */}
            {userPersona?.description && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                title={isDescriptionExpanded ? "Collapse description" : "Expand description"}
              >
                <motion.svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  animate={{ rotate: isDescriptionExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <path
                    d="M5 7.5L10 12.5L15 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              </motion.button>
            )}
          </div>
          
          {/* 用户画像文字描述（默认折叠） */}
          {userPersona?.description && (
            <AnimatePresence>
              {isDescriptionExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 p-3 bg-white/40 rounded-xl border border-white/40 overflow-hidden"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg">📝</span>
                    <p className="text-xs text-gray-700 leading-relaxed font-medium">
                      {userPersona.description}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
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