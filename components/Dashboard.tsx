import React, { useEffect, useRef, useState } from 'react';
import { UserProfile, SystemLog, WeightedTag, UserPersona, FeedbackMemoryEntry } from '../types';
import { Activity, User, Terminal, RefreshCcw, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiquidGlass } from '../hooks/useLiquidGlass';
import { Language, t } from '../i18n';
import { normalizeTag } from '../services/recommendationEngine';

interface DashboardProps {
  userProfile: UserProfile;
  logs: SystemLog[];
  onReset: () => void;
  className?: string;
  enableLiquidGlass?: boolean; // 新增：是否启用液态玻璃效果
  userPersona?: UserPersona;
  emojiFusionImage?: string | null;
  language: Language;
  enablePersonaFun: boolean;
  onTogglePersonaFun: () => void;
  feedbackMemory?: FeedbackMemoryEntry[];
}

const TagChip: React.FC<{ tagData: WeightedTag; colorClass: string; mixedBreakdown?: { interest: number; negative: number; language: Language } }> = ({ tagData, colorClass, mixedBreakdown }) => {
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

  const hasMixed = !!mixedBreakdown && mixedBreakdown.interest > 0 && mixedBreakdown.negative > 0;

  return (
    <div className={`relative group px-2.5 py-1.5 ${colorClass} text-xs rounded-lg border flex items-center gap-2 transition-all duration-300 animate-in fade-in zoom-in shadow-sm`}>
      <span className="font-medium">{tagData.tag}</span>
      <span className="bg-white/60 px-1.5 rounded-md text-[10px] font-mono font-bold min-w-[28px] text-center shadow-sm">
        {tagData.weight.toFixed(1)}
      </span>
      {hasMixed && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-[220px] rounded-xl bg-black/80 backdrop-blur-md text-white text-[11px] leading-relaxed font-semibold px-3 py-2 shadow-xl border border-white/10 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
          {t(mixedBreakdown.language, 'mixedLabel')}: {t(mixedBreakdown.language, 'interestLabel')} +{mixedBreakdown.interest.toFixed(1)}, {t(mixedBreakdown.language, 'negativeLabel')} +{mixedBreakdown.negative.toFixed(1)}
        </div>
      )}
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
  emojiFusionImage,
  language,
  enablePersonaFun,
  onTogglePersonaFun,
  feedbackMemory = []
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const memoryScrollRef = useRef<HTMLDivElement>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(true);
  const [showFunInfo, setShowFunInfo] = useState(false);
  const [logView, setLogView] = useState<'events' | 'memory'>('events');
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(new Set());

  // Merge duplicates across likes/dislikes for display only.
  type DisplayTag = {
    key: string;
    tag: string;
    interest: number;
    negative: number;
    net: number;
    mixed: boolean;
  };
  const buildDisplayTags = (): { likes: DisplayTag[]; dislikes: DisplayTag[] } => {
    const map = new Map<string, DisplayTag>();
    for (const it of userProfile.interests || []) {
      const k = normalizeTag(it.tag);
      const prev = map.get(k);
      const w = it.weight ?? 0;
      if (w >= 0) {
        const nextInterest = Math.max(prev?.interest ?? 0, w);
        map.set(k, {
          key: k,
          tag: prev?.tag || it.tag,
          interest: nextInterest,
          negative: prev?.negative ?? 0,
          net: 0,
          mixed: false
        });
      } else {
        const absW = Math.abs(w);
        const nextNegative = Math.max(prev?.negative ?? 0, absW);
        map.set(k, {
          key: k,
          tag: prev?.tag || it.tag,
          interest: prev?.interest ?? 0,
          negative: nextNegative,
          net: 0,
          mixed: false
        });
      }
    }
    for (const d of userProfile.dislikes || []) {
      const k = normalizeTag(d.tag);
      const prev = map.get(k);
      const nextNegative = Math.max(prev?.negative ?? 0, d.weight ?? 0);
      map.set(k, {
        key: k,
        tag: prev?.tag || d.tag,
        interest: prev?.interest ?? 0,
        negative: nextNegative,
        net: 0,
        mixed: false
      });
    }
    const all: DisplayTag[] = [];
    for (const v of map.values()) {
      const net = (v.interest || 0) - (v.negative || 0);
      all.push({ ...v, net, mixed: v.interest > 0 && v.negative > 0 });
    }
    const likes = all.filter(x => x.net >= 0).sort((a, b) => b.net - a.net);
    const dislikes = all.filter(x => x.net < 0).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    return { likes, dislikes };
  };
  const display = buildDisplayTags();

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
          {t(language, 'systemInternals')}
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
          {t(language, 'resetDemo')}
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
              <h3 className="font-bold text-gray-900">
                {language === 'zh'
                  ? (userPersona?.nicknameZh || userProfile.name)
                  : (userPersona?.nicknameEn || userProfile.name)}
              </h3>
              <p className="text-xs text-blue-600 font-medium">{t(language, 'liveUserProfileModel')}</p>
            </div>

            {/* Fun toggle + info (does not affect core recommendation flow) */}
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onTogglePersonaFun}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  enablePersonaFun
                    ? 'bg-black/85 text-white border-black/10'
                    : 'bg-white/55 text-gray-700 border-white/40 hover:bg-white/75'
                }`}
                title={t(language, 'personaFunToggleTitle')}
              >
                {enablePersonaFun ? t(language, 'personaFunOn') : t(language, 'personaFunOff')}
              </motion.button>

              <div
                className="relative"
                onMouseEnter={() => setShowFunInfo(true)}
                onMouseLeave={() => setShowFunInfo(false)}
              >
                <button
                  type="button"
                  className="w-6 h-6 rounded-full bg-white/50 border border-white/40 text-gray-600 hover:text-gray-900 hover:bg-white/70 text-xs font-black leading-none flex items-center justify-center transition-colors"
                  aria-label={t(language, 'personaFunInfoAria')}
                  aria-expanded={showFunInfo}
                  onFocus={() => setShowFunInfo(true)}
                  onBlur={() => setShowFunInfo(false)}
                  onClick={() => setShowFunInfo(v => !v)}
                >
                  ⓘ
                </button>
                <AnimatePresence>
                  {showFunInfo && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: 'easeOut' }}
                      className="absolute right-0 top-full mt-2 w-[260px] rounded-xl bg-black/80 backdrop-blur-md text-white text-[11px] leading-relaxed font-semibold px-3 py-2 shadow-xl border border-white/10 z-50"
                    >
                      {t(language, 'personaFunInfo')}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            
            {/* 展开/折叠按钮 */}
            {userPersona?.description && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                title={isDescriptionExpanded ? t(language, 'collapseDescription') : t(language, 'expandDescription')}
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
          {(userPersona?.description || userPersona?.descriptionZh || userPersona?.descriptionEn) && (
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
                      {language === 'zh'
                        ? (userPersona.descriptionZh || userPersona.description || t(language, 'defaultPersonaDescription'))
                        : (userPersona.descriptionEn || userPersona.description || t(language, 'defaultPersonaDescription'))}
                    </p>
                  </div>

                  {/* Traits + Red flags */}
                  {((userPersona.userTraits && userPersona.userTraits.length > 0) || (userPersona.redFlags && userPersona.redFlags.length > 0)) && (
                    <div className="mt-3 space-y-2">
                      {userPersona.userTraits && userPersona.userTraits.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-gray-800">{t(language, 'traits')}</div>
                          <ul className="mt-1 list-disc pl-5 text-[11px] text-gray-700 space-y-0.5">
                            {(language === 'zh'
                              ? (userPersona.userTraitsZh || userPersona.userTraits || [])
                              : (userPersona.userTraitsEn || userPersona.userTraits || [])
                            ).slice(0, 5).map((trait, idx) => (
                              <li key={`trait-${idx}`}>{trait}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {userPersona.redFlags && userPersona.redFlags.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold text-gray-800">{t(language, 'redFlagsDownrankOnly')}</div>
                          <ul className="mt-1 list-disc pl-5 text-[11px] text-gray-700 space-y-0.5">
                            {(language === 'zh'
                              ? (userPersona.redFlagsZh || userPersona.redFlags || [])
                              : (userPersona.redFlagsEn || userPersona.redFlags || [])
                            ).slice(0, 5).map((rf, idx) => (
                              <li key={`rf-${idx}`}>{rf}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
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
                {t(language, 'interestVectorsLikes')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {display.likes.map(x => (
                <TagChip
                  key={x.key}
                  tagData={{ tag: x.tag, weight: x.net }}
                  colorClass={
                    x.mixed
                      ? 'bg-yellow-50/80 backdrop-blur-sm text-yellow-900 border-yellow-200/60'
                      : 'bg-green-50/80 backdrop-blur-sm text-green-800 border-green-200/50'
                  }
                  mixedBreakdown={x.mixed ? { interest: x.interest, negative: x.negative, language } : undefined}
                />
              ))}
              {display.likes.length === 0 && <span className="text-xs text-gray-500">{t(language, 'noInterests')}</span>}
            </div>
          </div>

          <div className="relative border-t border-dashed border-gray-300/50 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm animate-pulse"></span>
                {t(language, 'negativeFiltersDislikes')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5 min-h-[2rem]">
              {display.dislikes.length === 0 ? (
                <span className="text-xs text-gray-500 italic">{t(language, 'noNegativeFiltersYet')}</span>
              ) : (
                display.dislikes.map(x => (
                  <TagChip
                    key={x.key}
                    tagData={{ tag: x.tag, weight: Math.abs(x.net) }}
                    colorClass={
                      x.mixed
                        ? 'bg-yellow-50/80 backdrop-blur-sm text-yellow-900 border-yellow-200/60'
                        : 'bg-red-50/80 backdrop-blur-sm text-red-800 border-red-200/50'
                    }
                    mixedBreakdown={x.mixed ? { interest: x.interest, negative: x.negative, language } : undefined}
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
            {logView === 'events' ? <Terminal size={16} /> : <BookOpen size={16} />}
            <span>{logView === 'events' ? 'algorithm_events.log' : t(language, 'feedbackMemory')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-700/50 rounded-lg p-0.5">
              <button
                onClick={() => setLogView('events')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                  logView === 'events' ? 'bg-gray-500/60 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t(language, 'viewAlgoLog')}
              </button>
              <button
                onClick={() => setLogView('memory')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                  logView === 'memory' ? 'bg-purple-500/60 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t(language, 'viewMemory')}{feedbackMemory.length > 0 ? ` (${feedbackMemory.length})` : ''}
              </button>
            </div>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-sm"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></div>
            </div>
          </div>
        </div>
        
        {logView === 'events' ? (
          <div 
            ref={scrollRef}
            className="flex-1 p-4 overflow-y-auto custom-scrollbar font-mono text-xs space-y-4"
          >
            {logs.length === 0 && (
              <div className="text-gray-500 text-center mt-10">{t(language, 'waitingForInteraction')}</div>
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
        ) : (
          <div 
            ref={memoryScrollRef}
            className="flex-1 p-3 overflow-y-auto custom-scrollbar text-xs space-y-2"
          >
            {feedbackMemory.length === 0 && (
              <div className="text-gray-500 text-center mt-10">{t(language, 'feedbackMemoryEmpty')}</div>
            )}
            
            {feedbackMemory.map((entry) => {
              const isExpanded = expandedMemoryIds.has(entry.id);
              const timeStr = new Date(entry.timestamp).toLocaleTimeString();
              return (
                <div key={entry.id} className="border border-white/5 rounded-lg bg-black/30 overflow-hidden animate-in fade-in duration-200">
                  <button
                    onClick={() => setExpandedMemoryIds(prev => {
                      const next = new Set(prev);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={12} className="text-gray-500 shrink-0" /> : <ChevronRight size={12} className="text-gray-500 shrink-0" />}
                    <span className="text-gray-500 font-mono text-[10px] shrink-0">[{timeStr}]</span>
                    <span className="text-gray-200 font-semibold truncate">{entry.targetPostTitle}</span>
                    <span className={`ml-auto shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      entry.dislikeScope === 'topic' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {entry.dislikeScope}
                    </span>
                  </button>
                  
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-white/5">
                      <div className="mt-2">
                        <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Feedback</div>
                        <div className="text-gray-200 bg-black/30 p-2 rounded border border-white/5">"{entry.rawFeedback}"</div>
                      </div>
                      
                      {entry.adjustments.length > 0 && (
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Adjustments</div>
                          <div className="flex flex-wrap gap-1">
                            {entry.adjustments.map((adj, i) => (
                              <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                adj.category === 'interest' 
                                  ? (adj.delta >= 0 ? 'bg-green-500/20 text-green-300' : 'bg-orange-500/20 text-orange-300')
                                  : 'bg-red-500/20 text-red-300'
                              }`}>
                                {adj.tag} {adj.delta >= 0 ? '+' : ''}{adj.delta}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {entry.userNote && (
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">AI Note</div>
                          <div className="text-gray-400 text-[11px] leading-relaxed">{entry.userNote}</div>
                        </div>
                      )}
                      
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Persona Summary</div>
                        <div className="text-gray-400 text-[11px] leading-relaxed">
                          {entry.personaSummary || <span className="italic text-gray-600">{t(language, 'awaitingPersona')}</span>}
                        </div>
                      </div>
                      
                      {entry.profileSnapshotAfter.topInterests.length > 0 && (
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Profile Snapshot</div>
                          <div className="flex flex-wrap gap-1">
                            {entry.profileSnapshotAfter.topInterests.map((t, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-500/15 text-green-300">
                                {t.tag} {t.weight.toFixed(1)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {entry.ragRetrievals && entry.ragRetrievals.length > 0 && (
                        <div>
                          <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">
                            Pseudo-RAG Retrievals ({entry.ragRetrievals.length})
                          </div>
                          <div className="space-y-1">
                            {entry.ragRetrievals.map((r, i) => (
                              <div key={i} className="bg-purple-500/10 border border-purple-500/20 rounded p-1.5 text-[10px]">
                                <div className="flex items-center gap-1 text-purple-300 font-mono">
                                  <span>[{new Date(r.timestamp).toLocaleTimeString()}]</span>
                                  <span className="text-purple-400 font-bold">{r.source}</span>
                                  <span className="ml-auto text-gray-500">score {r.score}</span>
                                </div>
                                <div className="mt-0.5 text-gray-400">
                                  matched: {r.matchedTerms.map((t, j) => (
                                    <span key={j} className="inline-block px-1 py-0 mx-0.5 rounded bg-purple-500/20 text-purple-200 font-mono">{t}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};