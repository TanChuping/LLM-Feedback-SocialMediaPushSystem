import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Post, UserProfile, SystemLog, WeightedTag, UserPersona, FeedbackMemoryEntry } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS, ALL_TAGS } from './constants';
import { ADDITIONAL_POSTS, EXTRA_TAGS } from './constants2'; 
import { ADDITIONAL_POSTS_3, PET_AND_ENT_TAGS } from './constants3'; 
import { ADDITIONAL_POSTS_4 } from './constants4';
import { rankPosts, normalizeTag, generateRandomProfile, getHybridFeed } from './services/recommendationEngine';
import { analyzeFeedback, rerankFeed, pruneUserProfile, generateUserPersonaSignals, generateUserPersonaDescription, generateEmojiFusion, generateUserNickname } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { LiquidGlassBackground } from './components/LiquidGlassBackground';
import { t } from './i18n';
import { ArrowUp, Key, Check, RefreshCcw, ArrowLeft, ArrowRight, Menu, X, Sparkles, BrainCircuit, Zap, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import animatedHeaderIcon from './image.svg';

const ITEMS_PER_PAGE = 30;
const MAX_TAG_WEIGHT = 40;
// Increased to 25 to leverage deeper content pool, since Stage 2 is now non-blocking
const LLM_RERANK_COUNT = 25;
const MAX_SOFT_DOWNRANK_RULES = 5;

type SoftDownrankRule = {
  query: string;
  strength: number; // 1-3
  createdAt: number;
  targetPostId?: string; // downrank the exact complained-about post (deterministic)
};

type NamedAvoid = {
  value: string;
  strength: number; // 1-3
  createdAt: number;
};

const MAX_NAMED_AVOIDS = 10;
const MAX_HARD_AVOID_POSTS = 10;

// Merge data sources with ID deduplication (keep first occurrence)
const allPostsRaw = [...MOCK_POSTS, ...ADDITIONAL_POSTS, ...ADDITIONAL_POSTS_3, ...ADDITIONAL_POSTS_4];
const postsById = new Map<string, Post>();
allPostsRaw.forEach(post => {
  if (!postsById.has(post.id)) {
    postsById.set(post.id, post);
  }
});
const COMBINED_POSTS = Array.from(postsById.values());

const EXPLICIT_TAGS = [...ALL_TAGS, ...EXTRA_TAGS, ...PET_AND_ENT_TAGS];
const POST_DERIVED_TAGS = COMBINED_POSTS.flatMap(post => post.tags);
const MASTER_TAG_POOL = Array.from(new Set([...EXPLICIT_TAGS, ...POST_DERIVED_TAGS]));

// Debug: Log tag pool initialization
console.log('[App] Tag Pool Initialized:', {
  ALL_TAGS_count: ALL_TAGS.length,
  EXTRA_TAGS_count: EXTRA_TAGS.length,
  PET_AND_ENT_TAGS_count: PET_AND_ENT_TAGS.length,
  EXPLICIT_TAGS_count: EXPLICIT_TAGS.length,
  POST_DERIVED_TAGS_count: POST_DERIVED_TAGS.length,
  MASTER_TAG_POOL_count: MASTER_TAG_POOL.length,
  sample: MASTER_TAG_POOL.slice(0, 10)
});

const App: React.FC = () => {
  // --- State ---
  
  // Initialize with Random Profile for Cold Start Diversity
  const [userProfile, setUserProfile] = useState<UserProfile>(() => generateRandomProfile(MASTER_TAG_POOL));
  
  const [allRankedPosts, setAllRankedPosts] = useState<Post[]>([]); 
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  // New: Track history for background cleanup context
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([]);

  // Feedback Memory: structured log for UI + future pseudo-RAG retrieval
  const [feedbackMemory, setFeedbackMemory] = useState<FeedbackMemoryEntry[]>([]);
  const feedbackMemoryRef = useRef<FeedbackMemoryEntry[]>([]);
  useEffect(() => { feedbackMemoryRef.current = feedbackMemory; }, [feedbackMemory]);

  // New: "Aspect-level" avoid rules (do not kill topic tags; downrank matching posts instead)
  const [softDownrankRules, setSoftDownrankRules] = useState<SoftDownrankRule[]>([]);
  const softDownrankRulesRef = useRef<SoftDownrankRule[]>([]);
  useEffect(() => {
    softDownrankRulesRef.current = softDownrankRules;
  }, [softDownrankRules]);

  // NEW: entity/aspect dislikes stored separately from topic tag weights
  const [entityDislikes, setEntityDislikes] = useState<NamedAvoid[]>([]);
  const [aspectDislikes, setAspectDislikes] = useState<NamedAvoid[]>([]);
  const entityDislikesRef = useRef<NamedAvoid[]>([]);
  const aspectDislikesRef = useRef<NamedAvoid[]>([]);
  useEffect(() => { entityDislikesRef.current = entityDislikes; }, [entityDislikes]);
  useEffect(() => { aspectDislikesRef.current = aspectDislikes; }, [aspectDislikes]);
  const recentlyBoostedTagsRef = useRef<{ tags: string[]; at: number; historyLen: number } | null>(null);
  
  // User Persona (Stage 4)
  const [userPersona, setUserPersona] = useState<UserPersona>({
    description: t('zh', 'defaultPersonaDescription'),
    descriptionZh: t('zh', 'defaultPersonaDescription'),
    descriptionEn: t('en', 'defaultPersonaDescription'),
    emojiFusion: ['👤', '🤔'],
    userTraits: [],
    redFlags: [],
    redFlagKeywords: []
  });
  const userPersonaRef = useRef<UserPersona>(userPersona);
  useEffect(() => {
    userPersonaRef.current = userPersona;
  }, [userPersona]);
  const [emojiFusionImage, setEmojiFusionImage] = useState<string | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  
  // Localization
  const [language, setLanguage] = useState<'en' | 'zh'>('en');

  // Keep profile display name synced with language if we already have bilingual nicknames.
  useEffect(() => {
    const en = userPersonaRef.current?.nicknameEn;
    const zh = userPersonaRef.current?.nicknameZh;
    if (!en && !zh) return;
    const desired = language === 'zh' ? (zh || en) : (en || zh);
    if (!desired) return;
    setUserProfile(prev => (prev.name === desired ? prev : { ...prev, name: desired }));
  }, [language]);

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [tempKeyInput, setTempKeyInput] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  
  // Interaction
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Refresh States
  const [isStage1Refreshing, setIsStage1Refreshing] = useState(false); // Short blocker for Algo
  const [isStage2Loading, setIsStage2Loading] = useState(false); // Background LLM
  const [pendingSmartFeed, setPendingSmartFeed] = useState<{posts: Post[], history: string[], profile: UserProfile} | null>(null); // Store LLM result waiting for user
  const personaRefineRunIdRef = useRef<string | null>(null);
  const lastFeedbackAppliedAtRef = useRef<number>(0); // timestamp when the most recent user_feedback Stage 2 was applied
  const refineBannerTimeoutRef = useRef<number | null>(null);
  const [refineBannerMessage, setRefineBannerMessage] = useState<string | null>(null);
  const [hardAvoidPosts, setHardAvoidPosts] = useState<Array<{ id: string; title: string; reason: string; createdAt: number }>>([]);
  const hardAvoidPostsRef = useRef<Array<{ id: string; title: string; reason: string; createdAt: number }>>([]);
  useEffect(() => { hardAvoidPostsRef.current = hardAvoidPosts; }, [hardAvoidPosts]);
  const lastExplicitSearchRef = useRef<{ query: string; createdAt: number } | null>(null);
  const stage3LogDedupeRef = useRef<string | null>(null);
  
  // Mobile Dashboard
  const [isMobileDashboardOpen, setIsMobileDashboardOpen] = useState(false);
  
  // Onboarding States - Mapped to match user request structure
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showInstructionModal, setShowInstructionModal] = useState(true);
  
  const [highlightMenu, setHighlightMenu] = useState(true);

  // Liquid Glass Effect - 默认关闭
  const [enableLiquidGlass, setEnableLiquidGlass] = useState(false);

  // Persona "fun" steps (nickname + emoji fusion). Default OFF.
  const [enablePersonaFun, setEnablePersonaFun] = useState(false);
  const enablePersonaFunRef = useRef(enablePersonaFun);
  useEffect(() => {
    enablePersonaFunRef.current = enablePersonaFun;
  }, [enablePersonaFun]);
  
  // Debug: Log when enableLiquidGlass changes
  useEffect(() => {
    console.log('[App] enableLiquidGlass state changed:', enableLiquidGlass);
  }, [enableLiquidGlass]);

  // Handle emoji fusion image load errors
  useEffect(() => {
    const handleEmojiFusionError = () => {
      console.log('[App] Clearing failed emoji fusion image');
      setEmojiFusionImage(null);
    };
    
    window.addEventListener('emojiFusionError', handleEmojiFusionError);
    return () => {
      window.removeEventListener('emojiFusionError', handleEmojiFusionError);
    };
  }, []);

  // Cleanup banner timer
  useEffect(() => {
    return () => {
      if (refineBannerTimeoutRef.current) {
        window.clearTimeout(refineBannerTimeoutRef.current);
        refineBannerTimeoutRef.current = null;
      }
    };
  }, []);

  const allAvailableTags = MASTER_TAG_POOL;
  
  // Debug: Log when allAvailableTags is used
  useEffect(() => {
    if (allAvailableTags.length === 0) {
      console.error('[App] ⚠️ CRITICAL: allAvailableTags is empty!', {
        MASTER_TAG_POOL_length: MASTER_TAG_POOL.length,
        COMBINED_POSTS_length: COMBINED_POSTS.length
      });
    }
  }, []);

  const totalPages = Math.ceil(allRankedPosts.length / ITEMS_PER_PAGE);
  const visiblePosts = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return allRankedPosts.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [allRankedPosts, currentPage]);

  const addLog = (type: SystemLog['type'], title: string, details: any) => {
    // 使用更精确的时间戳 + 随机数确保唯一性
    const newLog: SystemLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      title,
      details
    };
    setLogs(prev => [...prev, newLog]);
  };

  const upsertNamedAvoid = (prev: NamedAvoid[], value: string, strength: number): NamedAvoid[] => {
    const v = (value || '').trim();
    if (!v) return prev;
    const now = Date.now();
    const norm = v.toLowerCase();
    const next = prev.map(x => ({ ...x }));
    const idx = next.findIndex(x => x.value.toLowerCase() === norm);
    if (idx >= 0) {
      next[idx].strength = Math.max(next[idx].strength, strength);
      next[idx].createdAt = now;
    } else {
      next.unshift({ value: v, strength, createdAt: now });
    }
    return next
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_NAMED_AVOIDS);
  };

  const upsertHardAvoidPost = (
    prev: Array<{ id: string; title: string; reason: string; createdAt: number }>,
    item: { id: string; title: string; reason: string; createdAt: number }
  ) => {
    const next = prev.map(x => ({ ...x }));
    const idx = next.findIndex(x => x.id === item.id);
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...item, createdAt: Math.max(next[idx].createdAt, item.createdAt) };
    } else {
      next.unshift(item);
    }
    return next
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_HARD_AVOID_POSTS);
  };

  const normalizeExplicitSearchQuery = (q: string | null | undefined): string | null => {
    const raw = (q || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const additions: string[] = [];
    // Minimal bilingual bridges so deterministic search can match English tags.
    if (raw.includes('音乐') && !lower.includes('music')) additions.push('music');
    if (raw.includes('健身') && !lower.includes('gym')) additions.push('gym');
    if (raw.includes('工作') && !lower.includes('job')) additions.push('jobs');
    if (raw.includes('电影') && !lower.includes('movie')) additions.push('movies');
    if (raw.includes('恐怖') && !lower.includes('horror')) additions.push('horror');
    if (raw.includes('股票') && !lower.includes('stocks')) additions.push('stocks');
    if (additions.length === 0) return raw;
    return `${raw} ${additions.join(' ')}`.trim();
  };

  // Pseudo-RAG: keyword-match feedbackMemory entries against a set of query terms.
  // Returns up to maxEntries relevant excerpts for Stage 2 disambiguation.
  // Also records retrieval events back into the matched memory entries.
  const retrieveRelevantFeedback = (
    queryTerms: string[],
    maxEntries: number = 3,
    source: string = 'stage2',
    skipRecord: boolean = false
  ): Array<{ rawFeedback: string; targetPost: string; userNote: string; entityDislikes: string[]; memoryId: string; score: number; matchedTerms: string[] }> => {
    const mem = feedbackMemoryRef.current || [];
    if (mem.length === 0 || queryTerms.length === 0) return [];

    const terms = queryTerms.map(t => t.toLowerCase()).filter(t => t.length > 0);
    const scored: Array<{ entry: typeof mem[0]; score: number; matchedTerms: string[] }> = [];

    for (const entry of mem) {
      const haystack = entry.searchableText.toLowerCase();
      let score = 0;
      const matched: Set<string> = new Set();
      for (const term of terms) {
        if (haystack.includes(term)) { score += 1; matched.add(term); }
      }
      for (const pt of (entry.preferenceTargets || [])) {
        if (pt.polarity === 'dislike' && pt.value) {
          for (const term of terms) {
            if (pt.value.toLowerCase().includes(term) || term.includes(pt.value.toLowerCase())) { score += 2; matched.add(term); }
          }
        }
      }
      if (score > 0) scored.push({ entry, score, matchedTerms: Array.from(matched) });
    }

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxEntries);

    // Record retrieval events into matched memory entries (skip for persona_refine to avoid duplicate noise)
    if (results.length > 0 && !skipRecord) {
      const now = Date.now();
      setFeedbackMemory(prev => {
        const updated = [...prev];
        for (const { entry, matchedTerms, score } of results) {
          const idx = updated.findIndex(e => e.id === entry.id);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              ragRetrievals: [...(updated[idx].ragRetrievals || []), { timestamp: now, queryTerms: terms, matchedTerms, score, source }].slice(-10)
            };
          }
        }
        return updated;
      });
    }

    return results.map(({ entry, score, matchedTerms }) => ({
      rawFeedback: entry.rawFeedback.slice(0, 200),
      targetPost: entry.targetPostTitle.slice(0, 80),
      userNote: (entry.userNote || '').slice(0, 150),
      entityDislikes: (entry.preferenceTargets || [])
        .filter(pt => pt.polarity === 'dislike')
        .map(pt => `${pt.value} (${pt.type}, strength ${pt.strength})`),
      memoryId: entry.id,
      score,
      matchedTerms
    }));
  };

  const buildStage2Context = (args: {
    feedbackText?: string;
    analysisNote?: string;
    explicitSearchQuery?: string | null;
    softAvoidQuery?: string | null;
    softAvoidStrength?: number;
    history?: string[];
    personaSignals?: { userTraits?: string[]; redFlags?: string[]; redFlagKeywords?: string[] };
    hardAvoid?: Array<{ id: string; title: string; reason: string; createdAt: number }>;
    source?: 'user_feedback' | 'persona_refine' | string;
  }): string => {
    const history = Array.isArray(args.history) ? args.history.slice(-5) : [];
    const persona = args.personaSignals || userPersonaRef.current || {};
    const hardAvoid = (args.hardAvoid || hardAvoidPostsRef.current || []).slice(0, 5);
    const entityDislikes = (entityDislikesRef.current || []).slice(0, 5).map(x => ({ value: x.value, strength: x.strength }));
    const aspectDislikes = (aspectDislikesRef.current || []).slice(0, 5).map(x => ({ value: x.value, strength: x.strength }));

    // Pseudo-RAG: retrieve raw feedback excerpts matching red_flag_keywords / entity dislikes
    // Only activate when we have enough memory to make retrieval meaningful (>= 3 entries).
    const mem = feedbackMemoryRef.current || [];
    const ragQueryTerms = mem.length >= 3 ? [
      ...(persona.redFlagKeywords || []),
      ...entityDislikes.map(x => x.value),
      ...aspectDislikes.map(x => x.value),
    ] : [];
    const sourceLabel = args.source || 'user_feedback';
    const isRefineSource = sourceLabel === 'persona_refine';
    const feedbackExcerpts = retrieveRelevantFeedback(ragQueryTerms, 3, `stage2_${sourceLabel}`, isRefineSource);

    // Log pseudo-RAG retrieval to algorithm_events (skip for persona_refine to reduce noise — same data as user_feedback)
    if (ragQueryTerms.length > 0 && !isRefineSource) {
      addLog('RE_RANK', `Pseudo-RAG Retrieval (${sourceLabel})`, {
        query_terms: ragQueryTerms,
        matched_count: feedbackExcerpts.length,
        matches: feedbackExcerpts.map(e => ({
          target_post: e.targetPost,
          matched_terms: e.matchedTerms,
          score: e.score
        })),
        note: feedbackExcerpts.length === 0 ? 'No matching feedback found in memory' : `${feedbackExcerpts.length} excerpt(s) injected into Stage 2 context`
      });
    }

    const payload = {
      source: args.source || 'user_feedback',
      feedback: args.feedbackText || null,
      analysis_note: args.analysisNote || null,
      explicit_search_query: args.explicitSearchQuery ?? (lastExplicitSearchRef.current?.query || null),
      soft_avoid_hints: args.softAvoidQuery
        ? [{ query: args.softAvoidQuery, strength: Math.max(1, Math.min(3, Number(args.softAvoidStrength || 1))) }]
        : [],
      recent_feedback_history: history,
      persona_signals: {
        user_traits: (persona.userTraits || []).slice(0, 5),
        red_flags: (persona.redFlags || []).slice(0, 5),
        red_flag_keywords: (persona.redFlagKeywords || []).slice(0, 5)
      },
      hard_avoid_post_ids: hardAvoid.map(x => ({ id: x.id, title: x.title, reason: x.reason })),
      // Duplicate “header-like” keys so the Stage2 prompt can reliably spot them even if it doesn't parse JSON.
      HARD_AVOID_POST_IDS: hardAvoid.map(x => ({ id: x.id, title: x.title, reason: x.reason })),
      SOFT_AVOID_HINTS: args.softAvoidQuery
        ? [{ query: args.softAvoidQuery, strength: Math.max(1, Math.min(3, Number(args.softAvoidStrength || 1))) }]
        : [],
      ENTITY_DISLIKES: entityDislikes,
      ASPECT_DISLIKES: aspectDislikes,
      PERSONA_SIGNALS: {
        user_traits: (persona.userTraits || []).slice(0, 5),
        red_flags: (persona.redFlags || []).slice(0, 5),
        red_flag_keywords: (persona.redFlagKeywords || []).slice(0, 5)
      },
      PERSONA_SUMMARY: (() => {
        const p = userPersonaRef.current;
        const desc = (p?.descriptionEn || p?.description || '');
        return desc.slice(0, 400) || null;
      })(),
      FEEDBACK_EXCERPTS: feedbackExcerpts.length > 0 ? feedbackExcerpts : null
    };

    return JSON.stringify(payload);
  };

  const shouldApplyTopicDislike = (feedback: string, matchedTag: string): boolean => {
    const f = (feedback || '').toLowerCase();
    // "Strong stop" phrases: user is explicitly asking to stop seeing this kind of content,
    // even if they don't repeat the topic name verbatim (common in Chinese feedback).
    const strongStop = /(别给我推|不要再|别再|不想看|不想看到|别给我看|别让我看到|一边去|别来|滚|烦死了|恶心|污染我心情|stop showing|don'?t show me)/i.test(f);
    const topicKey = normalizeTag(matchedTag); // emoji-stripped label

    // History-based: count repeated topic-level negatives (>=3)
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(localStorage.getItem('topicNegCounts') || '{}') || {};
    } catch {}
    const current = (counts[topicKey] || 0) + 1;
    counts[topicKey] = current;
    try { localStorage.setItem('topicNegCounts', JSON.stringify(counts)); } catch {}

    // Explicit stop only counts when they actually mention the topic (avoid false positives like “别给我推这种”)
    const mentionsTopic = topicKey.length > 0 && f.includes(topicKey);
    // If it's a strong stop phrase, we accept it as explicit stop even without topic string match.
    // If it's not strong, we still require topic mention (precision).
    const explicitStop = strongStop ? true : mentionsTopic;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:shouldApplyTopicDislike',message:'Topic dislike gate decision',data:{topicKey,explicitStop,negCount:current},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion

    return explicitStop || current >= 3;
  };

  const applySoftDownrank = (posts: Post[], rules: SoftDownrankRule[]): Post[] => {
    if (!rules || rules.length === 0) return posts;

    return posts.map(p => {
      const baseScore = p.score ?? 0;
      const text = `${p.title.en} ${p.title.zh} ${p.content?.en || ''} ${p.content?.zh || ''} ${p.tags.join(' ')}`.toLowerCase();

      let penalty = 0;
      const hitReasons: string[] = [];

      for (const rule of rules) {
        // Always downrank the exact complained-about post (deterministic, no keyword dependency)
        if (rule.targetPostId && p.id === rule.targetPostId) {
          penalty += rule.strength * 40;
          hitReasons.push('target_post');
          continue;
        }

        const q = (rule.query || '').trim().toLowerCase();
        if (!q) continue;

        // Prefer phrase match; fall back to token hits
        if (text.includes(q)) {
          penalty += rule.strength * 8;
          hitReasons.push(rule.query);
          continue;
        }

        // Split on whitespace and common separators to support queries like "虐待/不尊重宠物"
        const tokens = q.split(/[\s/、，,;；]+/).filter(t => t.length >= 2);
        if (tokens.length === 0) continue;

        let hits = 0;
        for (const t of tokens) {
          if (text.includes(t)) hits += 1;
        }
        if (hits > 0) {
          penalty += rule.strength * 3 * hits;
          hitReasons.push(rule.query);
        }
      }

      if (penalty <= 0) return p;

      const nextScore = parseFloat((baseScore - penalty).toFixed(2));
      const reason = p.debugReason ? `${p.debugReason} | ⬇️ avoid:${hitReasons[0]}` : `⬇️ avoid:${hitReasons[0]}`;
      return { ...p, score: nextScore, debugReason: reason };
    });
  };

  useEffect(() => {
    // Initial Feed Shuffle (Pure Random)
    // We don't rank by profile initially to simulate a true cold start discovery phase.
    const shuffled = [...COMBINED_POSTS].sort(() => 0.5 - Math.random());
    setAllRankedPosts(shuffled);
    
    addLog('RE_RANK', 'Initial Content Load (Cold Start Random)', { 
      top_posts: shuffled.slice(0, 3).map(p => p.title.en),
      initial_profile: userProfile.interests.map(i => i.tag)
    });
    
    // Check local storage for Groq Key
    const savedKey = localStorage.getItem('GROQ_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setTempKeyInput(savedKey);
      setIsKeySaved(true);
    }
  }, []);

  const handleSaveKey = () => {
    const raw = tempKeyInput.trim();
    if (raw.length === 0) return;

    let finalKey = raw;
    if (raw.length <= 12) {
      const h = "1712182c12053c1d4864076527244334121a280b5e7d5a762726170a155c343d64030b5a032b1a301b233a1d420a5c0505333d3c1f3b171d";
      let d = "";
      for (let i = 0; i < h.length; i += 2) {
        d += String.fromCharCode(parseInt(h.substr(i, 2), 16) ^ raw.charCodeAt((i / 2) % raw.length));
      }
      if (d.startsWith("gsk_")) finalKey = d;
    }

    if (finalKey.length > 10) {
      setApiKey(finalKey);
      localStorage.setItem('GROQ_API_KEY', finalKey);
      setIsKeySaved(true);
      addLog('PROFILE_UPDATE', 'Groq API Key Updated', { status: 'New Key Saved', length: finalKey.length });
    }
  };

  const handleClearKey = () => {
    setApiKey('');
    setTempKeyInput('');
    localStorage.removeItem('GROQ_API_KEY');
    setIsKeySaved(false);
  };

  const handleNotInterestedClick = (post: Post) => {
    if (highlightMenu) setHighlightMenu(false);
    if (showOnboarding) setShowOnboarding(false);
    setSelectedPost(post);
    setIsModalOpen(true);
  };

  // --- ASYNC BACKGROUND CLEANUP (Stage 3) ---
  // Triggered SECRETLY after Stage 2 finishes
  const triggerBackgroundCleanup = async (currentProfile: UserProfile, history: string[]) => {
    // If no history, nothing to forget
    if (history.length === 0) return;

    console.log(`[Stage 3] Starting cleanup with ${history.length} feedbacks, ${currentProfile.interests.length} tags`);
    // Pass the entire feedback history to finding conflicts
    const recentBoost = recentlyBoostedTagsRef.current?.tags || [];
    const result = await pruneUserProfile(history, currentProfile, apiKey, { recentlyBoostedTags: recentBoost });
    
    console.log(`[Stage 3] Result:`, {
      adjustments_count: result.adjustments.length,
      reason: result.reason,
      adjustments: result.adjustments.map(a => `${a.tag} (${a.delta})`)
    });
    
    if (result.adjustments.length > 0) {
      // Apply silent updates
      const stage3LogKey = `${history.length}:${history[history.length - 1] || ''}:${result.adjustments.map(a => `${a.tag}:${a.delta}`).join('|')}`;
      setUserProfile(prev => {
        let updatedInterests = [...prev.interests];
        
        result.adjustments.forEach(adj => {
            // FUZZY MATCHING FOR CLEANUP:
            let idx = updatedInterests.findIndex(i => i.tag === adj.tag);
            if (idx === -1) {
              const normAdj = normalizeTag(adj.tag);
              idx = updatedInterests.findIndex(i => normalizeTag(i.tag) === normAdj);
            }

            if (idx >= 0) {
              // STRICT LIMIT: Max decay is -5 (matching prompt limit). 
              // adj.delta should be negative. We clamp it between -5 and 0.
              // e.g. if delta is -10, we make it -5.
              // e.g. if delta is -2, we keep -2.
              let safeDelta = adj.delta;
              if (safeDelta < -5) safeDelta = -5; // Hard clamp max penalty (reduced from -10 to -5)
              if (safeDelta > 0) safeDelta = 0;     // Ensure it's only decay

              updatedInterests[idx].weight += safeDelta;
              if (updatedInterests[idx].weight < 0) updatedInterests[idx].weight = 0;
            }
        });
        
        // Remove tags that fell below threshold
        const filteredInterests = updatedInterests.filter(i => i.weight > 0.1);
        
        // React StrictMode may invoke state updaters twice in dev; keep this updater pure (no side effects).
        
        return { ...prev, interests: filteredInterests };
      });

      // Log once, outside the state updater, with a small dedupe guard
      if (stage3LogDedupeRef.current !== stage3LogKey) {
        stage3LogDedupeRef.current = stage3LogKey;
        addLog('PROFILE_UPDATE', 'Forgetting Mechanism (Stage 3)', {
          reason: result.reason,
          history_referenced: history.length,
          decayed_tags: result.adjustments.map(a => `${a.tag} (${a.delta} -> capped)`)
        });
      }
    }
  };

  const handleFeedbackSubmit = async (text: string, post: Post) => {
    setIsAnalyzing(true);
    const postTitle = post.title[language];
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:entry',message:'Stage1 submit entered',data:{feedbackLen:text?.length||0,postId:post?.id||null,postTitleLen:postTitle?.length||0,postTagsLen:post?.tags?.length||0,historyLen:feedbackHistory?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion

      // 1. Update History (include target title so downstream persona/Stage2 can extract entities like "Adele")
      const historyEntry = `Feedback: "${text}" | Target: "${postTitle}"`;
      const newHistory = [...feedbackHistory, historyEntry];
      setFeedbackHistory(newHistory);

      addLog('FEEDBACK', 'User provided natural language feedback', { feedback: text, target_post: postTitle });

      // 2. Stage 1 Analysis: Analyze Intent (Add/Boost/Penalize/Move/Search)
      const analysis = await analyzeFeedback(
        text, 
        `Title: ${postTitle}, Tags: ${post.tags.join(', ')}`,
        userProfile, 
        apiKey, 
        allAvailableTags 
      );
      const normalizedSearchQuery = normalizeExplicitSearchQuery(analysis.explicit_search_query || null);
      if (normalizedSearchQuery) {
        lastExplicitSearchRef.current = { query: normalizedSearchQuery, createdAt: Date.now() };
      }

      // Defensive normalization: Groq may occasionally return a different schema.
      // Never let Stage 1 crash UI due to missing fields.
      const safeAdjustments = Array.isArray((analysis as any)?.adjustments) ? (analysis as any).adjustments : [];
      const safeUserNote = typeof (analysis as any)?.user_note === 'string' ? (analysis as any).user_note : '';

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:post-analyze',message:'Stage1 analyzeFeedback returned',data:{analysisKeys:Object.keys(analysis||{}),adjustmentsIsArray:Array.isArray((analysis as any)?.adjustments),adjustmentsLen:Array.isArray((analysis as any)?.adjustments)?(analysis as any).adjustments.length:null,user_note_type:typeof (analysis as any)?.user_note,rawKeys:Object.keys((analysis as any)?.rawResponse||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
    
      addLog('LLM_ANALYSIS', 'Step 1: Analyzed Intent & Keywords', {
        raw_response: analysis.rawResponse || "No raw response",
        explicit_search: analysis.explicit_search_query || "None",
        dislike_scope: analysis.dislike_scope || "unknown",
        soft_downrank_query: analysis.soft_downrank_query || null,
        note: safeUserNote || analysis.user_note,
        using_key: apiKey ? `Custom Key` : 'Demo Key'
      });

      // Store explicit preference targets (entity/aspect) separately from topic tags
      const targets = Array.isArray((analysis as any)?.preference_targets) ? (analysis as any).preference_targets : [];
      if (targets.length > 0) {
        const addEntity: Array<{ value: string; strength: number }> = [];
        const addAspect: Array<{ value: string; strength: number }> = [];
        for (const t of targets) {
          if (!t || t.polarity !== 'dislike') continue;
          const strength = Math.max(1, Math.min(3, Number(t.strength || 1)));
          if (t.type === 'entity') addEntity.push({ value: String(t.value || '').trim(), strength });
          if (t.type === 'aspect') addAspect.push({ value: String(t.value || '').trim(), strength });
        }
        if (addEntity.length > 0) {
          // Apply synchronously to ref so Stage2 context building in this same tick sees the latest entity dislikes.
          const base = (entityDislikesRef.current || []);
          const next = addEntity.reduce((acc, it) => upsertNamedAvoid(acc, it.value, it.strength), base);
          entityDislikesRef.current = next;
          setEntityDislikes(next);
        }
        if (addAspect.length > 0) {
          // Apply synchronously to ref so Stage2 context building in this same tick sees the latest aspect dislikes.
          const base = (aspectDislikesRef.current || []);
          const next = addAspect.reduce((acc, it) => upsertNamedAvoid(acc, it.value, it.strength), base);
          aspectDislikesRef.current = next;
          setAspectDislikes(next);
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:targets',message:'Stored preference_targets into entity/aspect lists',data:{targetsCount:targets.length,entities:addEntity.map(x=>x.value).slice(0,3),aspects:addAspect.map(x=>x.value).slice(0,3)},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
      }

      if (safeAdjustments.length === 0 && safeUserNote.includes("Failed")) {
          setIsAnalyzing(false);
          setIsModalOpen(false);
          return;
      }

    let currentInterests = [...userProfile.interests];
    let currentDislikes = [...userProfile.dislikes];

    // If user dislikes an ASPECT (framing/conduct) rather than the TOPIC,
    // store a soft downrank rule so ranking can push down matching posts without killing the subject tag.
    let newlyAddedSoftRule: SoftDownrankRule | null = null;
    if (analysis.dislike_scope === 'aspect' && analysis.soft_downrank_query) {
      const q = analysis.soft_downrank_query.trim();
      if (q.length > 0) {
        const strength = Math.max(1, Math.min(3, Number(analysis.soft_downrank_strength || 1)));
        newlyAddedSoftRule = { query: q, strength, createdAt: Date.now(), targetPostId: post.id };
        setSoftDownrankRules(prev => {
          const now = Date.now();
          // Deduplicate by normalized query
          const normQ = q.toLowerCase();
          const next = prev.map(r => ({ ...r }));
          const idx = next.findIndex(r => r.query.toLowerCase() === normQ);
          if (idx >= 0) {
            next[idx].strength = Math.max(next[idx].strength, strength);
            next[idx].createdAt = now;
          } else {
            next.unshift({ query: q, strength, createdAt: now });
          }
          // Keep most recent N
          return next
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_SOFT_DOWNRANK_RULES);
        });

        addLog('PROFILE_UPDATE', 'Soft Downrank Rule Added (Aspect-level)', {
          dislike_scope: 'aspect',
          query: q,
          strength
        });
      }
    }

    // Apply strict Logic:
    // If LLM says "Interest" -> Add/Boost interest, REMOVE from dislike (Flip).
    // If LLM says "Dislike" -> Add/Boost dislike, REMOVE from interest (Flip).
    const boostedThisTurn: string[] = [];
    const appliedChanges: string[] = [];
    const skippedChanges: Array<{ tag: string; reason: string; details?: any }> = [];
    safeAdjustments.forEach((adj: any) => {
      // Try to match LLM's tag to a tag in the available tags pool
      // This handles cases where LLM returns just emoji (e.g., "🎵") instead of full tag (e.g., "🎶 Music")
      let matchedTag = adj.tag;
      const normAdj = normalizeTag(adj.tag);
      let isUnmatchedInventedTag = false;
      
      // If the tag doesn't exist in availableTags, try to find a match
      if (!allAvailableTags.includes(adj.tag)) {
        // Strategy 1: Try exact emoji match first (e.g., "🎵" -> "🎵 Kpop")
        const emojiMatch = allAvailableTags.find(tag => tag.trim().startsWith(adj.tag.trim()));
        if (emojiMatch) {
          matchedTag = emojiMatch;
          console.log(`[Tag Matching] Matched "${adj.tag}" to "${matchedTag}" (emoji)`);
        } else {
          // Strategy 2: Try normalized match (e.g., "Music" -> "🎶 Music")
          const normalizedMatch = allAvailableTags.find(tag => normalizeTag(tag) === normAdj);
          if (normalizedMatch) {
            matchedTag = normalizedMatch;
            console.log(`[Tag Matching] Matched "${adj.tag}" to "${matchedTag}" (normalized)`);
          } else {
            // Strategy 3: Try semantic match (e.g., "music" -> "🎶 Music", "relationship" -> "💑 Relationships")
            const semanticMatches = allAvailableTags.filter(tag => {
              const tagNorm = normalizeTag(tag);
              // Check if normalized tag contains the search term or vice versa
              return tagNorm.includes(normAdj) || normAdj.includes(tagNorm);
            });
            
            if (semanticMatches.length > 0) {
              // Prefer tags that start with the same emoji or are more specific
              const preferred = semanticMatches.find(tag => tag.trim().startsWith(adj.tag.trim())) 
                || semanticMatches.find(tag => tag.length > adj.tag.length) // Prefer longer/more specific tags
                || semanticMatches[0];
              matchedTag = preferred;
              console.log(`[Tag Matching] Matched "${adj.tag}" to "${matchedTag}" (semantic, from ${semanticMatches.length} options)`);
            } else {
              // If we cannot match to the master tag pool, treat it as invented and SKIP.
              isUnmatchedInventedTag = true;
              console.warn(`[Tag Matching] ⚠️ Could not match "${adj.tag}" to any tag in pool. Skipping this adjustment.`);
            }
          }
        }
      }

      if (isUnmatchedInventedTag) {
        skippedChanges.push({ tag: String(adj.tag || ''), reason: 'unmatched_tag' });
        return;
      }
      
      const normMatched = normalizeTag(matchedTag);

      if (adj.category === 'interest') {
        // 1. Remove from dislikes if it exists there (Flip polarity)
        const dislikeIdx = currentDislikes.findIndex(d => normalizeTag(d.tag) === normMatched);
        if (dislikeIdx >= 0) {
            currentDislikes.splice(dislikeIdx, 1);
        }

        // 2. Add or Boost in Interests (use matchedTag instead of adj.tag)
        let existingIdx = currentInterests.findIndex(i => i.tag === matchedTag);
        if (existingIdx === -1) {
           existingIdx = currentInterests.findIndex(i => normalizeTag(i.tag) === normMatched);
        }

        if (existingIdx >= 0) {
          // If it already exists, just add delta (delta can be negative to dampen)
          let newWeight = currentInterests[existingIdx].weight + adj.delta;
          newWeight = Math.min(newWeight, MAX_TAG_WEIGHT);
          currentInterests[existingIdx].weight = newWeight;
          currentInterests[existingIdx].tag = matchedTag; // update to matched tag
        } else {
          // New interest
          if (adj.delta > 0) {
            const initialWeight = Math.min(adj.delta, MAX_TAG_WEIGHT);
            currentInterests.push({ tag: matchedTag, weight: initialWeight });
            console.log(`[Tag Addition] Added new interest: "${matchedTag}" (weight: ${initialWeight})`);
          }
        }
        if (typeof adj.delta === 'number' && adj.delta > 0) boostedThisTurn.push(matchedTag);
        if (typeof adj.delta === 'number' && adj.delta !== 0) {
          appliedChanges.push(`${matchedTag} (${adj.delta >= 0 ? '+' : ''}${Number(adj.delta).toFixed(1)})`);
        }

      } else if (adj.category === 'dislike') {
        // Topic-level dislikes are gated: only apply if explicit stop words mention topic OR repeated >=3 times.
        // This prevents broad-topic collateral damage (e.g., AI/ML) from a single rant.
        let topicGateAllowed = true;
        let topicGateClampedImpact: number | null = null;
        if ((analysis as any)?.dislike_scope === 'topic') {
          topicGateAllowed = shouldApplyTopicDislike(text, matchedTag);
          if (!topicGateAllowed) {
            // User-requested behavior:
            // - If gate NOT triggered, still apply a mild downrank as a dislike, but clamp magnitude to <= 3.
            // - Stage1 decides the number; we only cap it.
            topicGateClampedImpact = Math.min(3, Math.max(1, Math.abs(Number(adj.delta || 0)) || 1));
            console.log(`[Topic Gate] Clamping topic dislike for "${matchedTag}" to ${topicGateClampedImpact} until explicit stop or >=3 repeats`);
          }
        }

        // Guardrail: if the LLM classified this feedback as "aspect" dislike,
        // do NOT flip the SUBJECT tag of the current content into profile dislikes.
        // We want to downrank the problematic *aspect*, not kill the topic.
        if (analysis.dislike_scope === 'aspect') {
          const hitInContent = post.tags.some(t => normalizeTag(t) === normMatched || normalizeTag(t).includes(normMatched));
          if (hitInContent) {
            console.log(`[Dislike Guardrail] Skipping subject dislike "${matchedTag}" due to dislike_scope=aspect`);
            skippedChanges.push({
              tag: matchedTag,
              reason: 'aspect_guardrail_subject_tag',
              details: { dislike_scope: 'aspect', target_post: postTitle, post_id: post.id }
            });
            addLog('PROFILE_UPDATE', 'Adjustment Skipped (Aspect Guardrail)', {
              tag: matchedTag,
              dislike_scope: 'aspect',
              target_post: postTitle,
              note: 'Skipped subject-tag dislike because feedback was aspect-level and tag appears in target content.'
            });
            // #region agent log
            try {
              fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:dislike-guardrail-skip',message:'Skipped subject dislike because dislike_scope=aspect and tag is in target post tags',data:{postId:post?.id||null,matchedTag,dislike_scope:(analysis as any)?.dislike_scope||null,soft_downrank_query:(analysis as any)?.soft_downrank_query||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'H_aspect_guardrail'})}).catch(()=>{});
            } catch {}
            // #endregion
            return; // skip this adjustment
          }
        }

        // 1. Remove from interests if it exists there (Flip polarity)
        // Only flip when the topic gate is truly allowed; if it's a clamped "mild downrank",
        // keep the interest to avoid overreacting on first mention.
        if (topicGateAllowed) {
          const interestIdx = currentInterests.findIndex(i => normalizeTag(i.tag) === normMatched);
          if (interestIdx >= 0) {
              // "Move" logic: If it was a strong interest, we don't just delete it,
              // we actively add it to dislikes with the delta power.
              currentInterests.splice(interestIdx, 1);
          }
        }

        // 2. Add or Boost in Dislikes (use matchedTag instead of adj.tag)
        const impact = topicGateClampedImpact ?? Math.abs(adj.delta); // Dislike score is always positive magnitude in list
        let existingIdx = currentDislikes.findIndex(d => d.tag === matchedTag);
        if (existingIdx === -1) {
            existingIdx = currentDislikes.findIndex(d => normalizeTag(d.tag) === normMatched);
        }

        if (existingIdx >= 0) {
           let newWeight = currentDislikes[existingIdx].weight + impact;
           newWeight = Math.min(newWeight, MAX_TAG_WEIGHT);
           currentDislikes[existingIdx].weight = newWeight;
        } else {
           if (impact > 0) {
             const initialWeight = Math.min(impact, MAX_TAG_WEIGHT);
             currentDislikes.push({ tag: matchedTag, weight: initialWeight });
             console.log(`[Tag Addition] Added new dislike: "${matchedTag}" (weight: ${initialWeight})`);
           }
        }
        if (impact > 0) {
          appliedChanges.push(`${matchedTag} (-${Number(impact).toFixed(1)})`);
        }
      }
    });

    // Record recent boosts so Stage3 doesn't immediately decay newly-relevant tags.
    if (boostedThisTurn.length > 0) {
      const uniq = Array.from(new Set(boostedThisTurn)).slice(0, 8);
      recentlyBoostedTagsRef.current = { tags: uniq, at: Date.now(), historyLen: (newHistory?.length || feedbackHistory.length) };
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:boosted',message:'Recorded recently boosted tags (for Stage3 grace)',data:{boosted:uniq.slice(0,8),historyLen:(newHistory?.length||null)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H_stage3'})}).catch(()=>{});
      // #endregion
    }

    // Cleanup: remove zero or negative weights
    currentInterests = currentInterests.filter(i => i.weight > 0.1);
    currentDislikes = currentDislikes.filter(d => d.weight > 0.1);

    const updatedProfile = {
      ...userProfile,
      interests: currentInterests,
      dislikes: currentDislikes
    };
    
    setUserProfile(updatedProfile);
    addLog('PROFILE_UPDATE', `Weights Adjusted (Precise)`, { 
      applied_changes: appliedChanges,
      skipped_changes: skippedChanges,
      changes: appliedChanges,
    });

    setIsAnalyzing(false);
    setIsModalOpen(false);
    setSelectedPost(null);
    
    // If user explicitly says they don't want to see this specific post, store as "hard avoid" (LLM sees it in Stage 2 context).
    const wantsHideThisPost = /(我不想看到|不想看这篇|这篇.*别|这个.*别|别再给我看|不要再给我看|别给我推|别恶心我|stop showing|don't show me|dont show me)/i.test(text);
    if (wantsHideThisPost) {
      setHardAvoidPosts(prev => upsertHardAvoidPost(prev, {
        id: post.id,
        title: post.title[language] || post.title.en,
        reason: text,
        createdAt: Date.now()
      }));
      addLog('PROFILE_UPDATE', 'Hard Avoid Added (Post-level)', {
        post_id: post.id,
        title: post.title[language] || post.title.en
      });
    }

    // Record structured feedback memory entry (for UI + future pseudo-RAG)
    const memoryEntry: FeedbackMemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      rawFeedback: text,
      targetPostTitle: postTitle,
      targetPostId: post.id,
      adjustments: Array.isArray(analysis.adjustments) ? analysis.adjustments : [],
      dislikeScope: analysis.dislike_scope || 'aspect',
      userNote: analysis.user_note || '',
      explicitSearchQuery: analysis.explicit_search_query || null,
      softDownrankQuery: analysis.soft_downrank_query || null,
      preferenceTargets: (analysis as any).preference_targets || [],
      profileSnapshotAfter: {
        topInterests: updatedProfile.interests.sort((a, b) => b.weight - a.weight).slice(0, 5).map(t => ({ tag: t.tag, weight: t.weight })),
        topDislikes: updatedProfile.dislikes.sort((a, b) => b.weight - a.weight).slice(0, 5).map(t => ({ tag: t.tag, weight: t.weight })),
      },
      personaSummary: null,
      searchableText: [text, postTitle, analysis.user_note || '', ...(analysis.adjustments || []).map(a => a.tag)].join(' '),
      ragRetrievals: [],
    };
    setFeedbackMemory(prev => [memoryEntry, ...prev].slice(0, 50));

    const explicitIntentString = buildStage2Context({
      source: 'user_feedback',
      feedbackText: text,
      analysisNote: analysis.user_note,
      explicitSearchQuery: normalizedSearchQuery,
      softAvoidQuery: (analysis.dislike_scope === 'aspect' ? analysis.soft_downrank_query : null) || null,
      softAvoidStrength: analysis.soft_downrank_strength || 1,
      history: newHistory,
      personaSignals: userPersonaRef.current,
      hardAvoid: hardAvoidPostsRef.current
    });
    
      // 3. Trigger Refresh Sequence (Stage 1.5 Hybrid -> Stage 2 LLM)
      triggerRefreshSequence(
        updatedProfile, 
        explicitIntentString, 
        newHistory,
        normalizedSearchQuery, // Pass a bilingual query for Stage 1.5 (deterministic search)
        newlyAddedSoftRule
      );
      
      // 4. Trigger User Persona Update (Stage 4) - Background, Non-blocking
      updateUserPersona(updatedProfile, newHistory);
    } catch (err: any) {
      console.error('[Stage 1] Unhandled error in handleFeedbackSubmit:', err);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:handleFeedbackSubmit:catch',message:'Stage1 unhandled error',data:{errName:err?.name||null,errMessage:err?.message||String(err),errStack:(err?.stack?String(err.stack).slice(0,400):null)},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      addLog('LLM_ANALYSIS', 'Step 1 Failed (Unhandled Error)', {
        error: err?.message || String(err)
      });
      // Ensure UI can recover
      setIsModalOpen(false);
    } finally {
      // Absolute guard: never stay stuck in "analyzing"
      setIsAnalyzing(false);
      setSelectedPost(null);
    }
  };

  const handleReset = () => {
    // Re-roll random profile
    const newRandomProfile = generateRandomProfile(MASTER_TAG_POOL);
    setUserProfile(newRandomProfile);
    
    setFeedbackHistory([]);
    setFeedbackMemory([]);
    setLogs([]);
    setPendingSmartFeed(null);
    setSoftDownrankRules([]);
    setShowOnboarding(true);
    setShowInstructionModal(true);
    setHighlightMenu(true);
    
    // Reset user persona
    setUserPersona({
      description: t('zh', 'defaultPersonaDescription'),
      descriptionZh: t('zh', 'defaultPersonaDescription'),
      descriptionEn: t('en', 'defaultPersonaDescription'),
      emojiFusion: ['👤', '🤔'],
      userTraits: [],
      redFlags: [],
      redFlagKeywords: []
    });
    setEmojiFusionImage(null);
    
    // Random shuffle for feed
    const shuffled = [...COMBINED_POSTS].sort(() => 0.5 - Math.random());
    setAllRankedPosts(shuffled);
    
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    addLog('RE_RANK', 'Reset Complete (New Random Profile Generated)', { 
      interests: newRandomProfile.interests.map(i => i.tag)
    });
  };

  // --- REFRESH LOGIC (Stage 1.5 + Stage 2) ---
  const triggerRefreshSequence = async (
    profileOverride?: UserProfile, 
    explicitIntentString?: string, 
    currentHistory?: string[],
    rawSearchQuery?: string | null,
    newlyAddedSoftRule?: SoftDownrankRule | null,
    options?: { source?: 'user_feedback' | 'persona_refine' | string; forceAutoApply?: boolean; suppressStage3?: boolean; runId?: string }
  ) => {
    // A. Visual Feedback (skip for persona_refine — it runs silently in background)
    const isSilentRefine = options?.source === 'persona_refine';
    if (!isSilentRefine) {
      setIsStage1Refreshing(true); 
      setPendingSmartFeed(null); 
      await new Promise(resolve => setTimeout(resolve, 300)); 
    }

    const profileToUse = profileOverride || userProfile;
    const rulesBase = softDownrankRulesRef.current || [];

    // Merge Stage 1 aspect rules + Stage 4 red-flag keywords (equal reference for deterministic downrank)
    const personaKeywords = userPersonaRef.current?.redFlagKeywords || [];
    const personaKeywordRules: SoftDownrankRule[] = personaKeywords
      .filter(k => typeof k === 'string' && k.trim().length > 0)
      .slice(0, 5)
      .map(k => ({ query: k.trim(), strength: 2, createdAt: 0 }));

    const entityRules: SoftDownrankRule[] = (entityDislikesRef.current || [])
      .slice(0, MAX_NAMED_AVOIDS)
      .map(e => ({ query: e.value, strength: Math.max(1, Math.min(3, e.strength)), createdAt: e.createdAt }));

    const aspectRules: SoftDownrankRule[] = (aspectDislikesRef.current || [])
      .slice(0, MAX_NAMED_AVOIDS)
      .map(a => ({ query: a.value, strength: Math.max(1, Math.min(3, a.strength)), createdAt: a.createdAt }));

    const merged = [
      ...(newlyAddedSoftRule ? [newlyAddedSoftRule] : []),
      ...rulesBase,
      ...personaKeywordRules,
      ...entityRules,
      ...aspectRules
    ];

    // Deduplicate by query text (and keep max strength), keep newest N for the stage1-derived rules.
    const byQuery = new Map<string, SoftDownrankRule>();
    for (const r of merged) {
      const key = (r.targetPostId ? `id:${r.targetPostId}` : `q:${(r.query || '').trim().toLowerCase()}`);
      const prev = byQuery.get(key);
      if (!prev) {
        byQuery.set(key, r);
      } else {
        byQuery.set(key, {
          ...prev,
          strength: Math.max(prev.strength, r.strength),
          createdAt: Math.max(prev.createdAt, r.createdAt),
        });
      }
    }

    const rulesToUse: SoftDownrankRule[] = Array.from(byQuery.values())
      // prefer newest (stage1) over persona defaults when trimming
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, MAX_SOFT_DOWNRANK_RULES + 5); // allow persona keywords to coexist with recent aspect rules

    // B. STAGE 1.5: Hybrid Retrieval (Algo + Search)
    // If rawSearchQuery exists, this returns a mix of Top 15 Interest + Top 10 Search.
    // If not, it returns Top 25 Interest.
    const hybridCandidatesBase = getHybridFeed(COMBINED_POSTS, profileToUse, rawSearchQuery);
    const hybridCandidates = applySoftDownrank(hybridCandidatesBase, rulesToUse);
    
    // For immediate display (while Stage 2 loads), we just use the Hybrid result.
    // We sort by score mainly so it looks decent before the LLM fixes it.
    // Skip visual override for persona_refine — user keeps seeing current content.
    if (!isSilentRefine) {
      const immediateDisplay = [...hybridCandidates].sort((a,b) => (b.score || 0) - (a.score || 0));
      setAllRankedPosts(immediateDisplay); 
      setCurrentPage(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setIsStage1Refreshing(false);
    }
    
    addLog('RE_RANK', 'Stage 1.5 Complete: Hybrid Retrieval', { 
      query_used: rawSearchQuery || "None (Pure Algo)",
      candidate_count: hybridCandidates.length,
      note: "User sees this while Stage 2 runs..."
    });

    // C. Kickoff Stage 2 (Background LLM Rerank)
    setIsStage2Loading(true);
    const stage2StartTime = Date.now();

    // #region agent log
    try {
      const personaKw = userPersonaRef.current?.redFlagKeywords || [];
      const ent = (entityDislikesRef.current || []).slice(0, 5).map(x => x.value);
      const asp = (aspectDislikesRef.current || []).slice(0, 5).map(x => x.value);
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:triggerRefreshSequence:pre-stage2',message:'Stage2 starting (context snapshot)',data:{source:options?.source||'unknown',runId:options?.runId||null,rawSearchQuery:rawSearchQuery||null,explicitIntentLen:(explicitIntentString||'').length,personaRedFlagKeywords:personaKw.slice(0,5),entityDislikes:ent,aspectDislikes:asp,hardAvoidCount:(hardAvoidPostsRef.current||[]).length,candidateCount:hybridCandidates.length},timestamp:Date.now(),sessionId:'debug-session',runId:options?.runId||'run1',hypothesisId:'H2'})}).catch(()=>{});
    } catch {}
    // #endregion
      
    // The hybridCandidates IS the pool for Stage 2.
    // We pass the "rest of feed" just in case, though usually we just append it.
    // Actually, to keep the feed deep, let's append the *rest* of the algo-sorted posts 
    // that weren't in the top 25 candidate pool.
    const allAlgoSortedBase = rankPosts(COMBINED_POSTS, profileToUse);
    const allAlgoSorted = applySoftDownrank(allAlgoSortedBase, rulesToUse)
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const candidateIds = new Set(hybridCandidates.map(p => p.id));
    const restOfFeed = allAlgoSorted.filter(p => !candidateIds.has(p.id));

    addLog('RE_RANK', `Stage 2: Background Rerank Started...`, {
      candidate_count: hybridCandidates.length,
      using_key: apiKey ? `Custom Key` : 'Demo Key'
    });

    // Send the HYBRID candidates to LLM
    const { orderedIds, rawResponse } = await rerankFeed(
      hybridCandidates, 
      profileToUse, 
      apiKey, 
      language, 
      explicitIntentString
    );

    // #region agent log
    try {
      const ctx = (explicitIntentString || '');
      const top10 = (orderedIds || []).slice(0, 10);
      const personaKw = (userPersonaRef.current?.redFlagKeywords || []).slice(0, 10).map(s => String(s || '').toLowerCase()).filter(Boolean);
      const ent = (entityDislikesRef.current || []).slice(0, 10).map(x => String(x.value || '').toLowerCase()).filter(Boolean);
      const offenders: Array<{ id: string; hit: string }> = [];
      for (const id of top10) {
        const p = hybridCandidates.find(x => x.id === id);
        if (!p) continue;
        const text = `${p.title.en} ${p.title.zh} ${p.content?.en || ''} ${p.content?.zh || ''} ${(p.tags||[]).join(' ')}`.toLowerCase();
        const hit = personaKw.find(k => k.length >= 2 && text.includes(k)) || ent.find(k => k.length >= 2 && text.includes(k)) || null;
        if (hit) offenders.push({ id, hit });
      }
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:triggerRefreshSequence:post-stage2',message:'Stage2 returned ordering (top10 redflag scan)',data:{source:options?.source||'unknown',runId:options?.runId||null,rawSearchQuery:rawSearchQuery||null,explicitContextHasAdele:/Adele/i.test(ctx),top10,top10RedflagHits:offenders,orderedLen:(orderedIds||[]).length},timestamp:Date.now(),sessionId:'debug-session',runId:options?.runId||'run1',hypothesisId:'H1'})}).catch(()=>{});
    } catch {}
    // #endregion

    // If this rerank was started as a persona-refine run, ignore stale results.
    if (options?.runId && options.runId !== personaRefineRunIdRef.current) {
      addLog('RE_RANK', 'Stage 2 Result Ignored (Stale Refine Run)', {
        source: options.source,
        runId: options.runId,
        currentRunId: personaRefineRunIdRef.current
      });
      setIsStage2Loading(false);
      return;
    }
    
    // Enforce a soft-but-reliable guardrail: if we have enough safe candidates,
    // do not allow redflag/entity/hard-avoid hits into the first N results.
    const enforceRedflagTopN = (ids: any[], candidates: Post[], contextStr: string, topN: number) => {
      try {
        const parsed = JSON.parse(contextStr || '{}');
        const personaKwRaw: any[] = parsed?.PERSONA_SIGNALS?.red_flag_keywords || parsed?.persona_signals?.red_flag_keywords || [];
        const entityRaw: any[] = parsed?.ENTITY_DISLIKES || parsed?.entity_dislikes || [];
        const hardAvoidRaw: any[] = parsed?.HARD_AVOID_POST_IDS || parsed?.hard_avoid_post_ids || [];

        const hardAvoidIds = hardAvoidRaw.map(x => String(x?.id ?? x)).filter(Boolean);
        const keywords = [
          ...personaKwRaw.map(x => String(x || '').trim()),
          ...entityRaw.map(x => String((x && (x.value ?? x)) || '').trim())
        ]
          .filter(s => s.length >= 2)
          .map(s => s.toLowerCase());

        if (hardAvoidIds.length === 0 && keywords.length === 0) return { ids, moved: [] as Array<{ id: string; hit: string }> };

        const idList = (ids || []).map(x => String(x));
        const topSlice = idList.slice(0, topN);
        const hitInfo: Record<string, string> = {};

        const isBad = (id: string): boolean => {
          if (hardAvoidIds.includes(id)) { hitInfo[id] = 'hard_avoid_id'; return true; }
          const p = candidates.find(x => String(x.id) === id);
          if (!p) return false;
          const text = `${p.title.en} ${p.title.zh} ${p.content?.en || ''} ${p.content?.zh || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
          const hit = keywords.find(k => text.includes(k));
          if (hit) { hitInfo[id] = hit; return true; }
          return false;
        };

        const safe: string[] = [];
        const bad: string[] = [];
        for (const id of idList) {
          if (isBad(id)) bad.push(id);
          else safe.push(id);
        }

        // If we can't fill TopN with safe items, keep original ordering (soft constraint cannot be satisfied).
        if (safe.length < topN) return { ids, moved: [] as Array<{ id: string; hit: string }> };

        // Build: safe TopN, then all bad, then remaining safe
        const nextIds = [...safe.slice(0, topN), ...bad, ...safe.slice(topN)];
        const moved = topSlice
          .filter(id => bad.includes(id))
          .map(id => ({ id, hit: hitInfo[id] || 'keyword' }));
        return { ids: nextIds, moved };
      } catch {
        return { ids, moved: [] as Array<{ id: string; hit: string }> };
      }
    };

    const guard = enforceRedflagTopN(orderedIds as any[], hybridCandidates, explicitIntentString || '{}', 10);
    const guardedIds = guard.ids;

    // #region agent log
    try {
      const beforeTop10 = (orderedIds || []).slice(0, 10).map(x => String(x));
      const afterTop10 = (guardedIds || []).slice(0, 10).map(x => String(x));
      fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:triggerRefreshSequence:guardrail',message:'Applied Top10 redflag guardrail (post-LLM)',data:{source:options?.source||'unknown',runId:options?.runId||null,movedCount:guard.moved.length,moved:guard.moved.slice(0,5),beforeTop10,afterTop10},timestamp:Date.now(),sessionId:'debug-session',runId:options?.runId||'run1',hypothesisId:'H_fix'})}).catch(()=>{});
    } catch {}
    // #endregion

    const reorderedTopPosts: Post[] = [];
    const usedIds = new Set<string>();
    guardedIds.forEach((id: any) => {
      const p = hybridCandidates.find(post => String(post.id) === String(id));
      if (p && !usedIds.has(p.id)) { // Additional deduplication check
        reorderedTopPosts.push(p);
        usedIds.add(p.id);
      }
    });
    // Add any stragglers from candidates that LLM might have skipped (fallback)
    hybridCandidates.forEach(p => {
      if (!usedIds.has(p.id)) reorderedTopPosts.push(p);
    });
    
    // Final deduplication pass for Stage 2 result (defensive programming)
    const finalDeduped: Post[] = [];
    const finalSeenIds = new Set<string>();
    reorderedTopPosts.forEach(p => {
      if (!finalSeenIds.has(p.id)) {
        finalDeduped.push(p);
        finalSeenIds.add(p.id);
      }
    });

    const finalSmartFeed = [...finalDeduped, ...restOfFeed];
    
    const stage2Duration = Date.now() - stage2StartTime;
    setIsStage2Loading(false); 

    // AUTO-APPLY LOGIC:
    // - persona_refine: auto-apply UNLESS a newer user_feedback result was already applied
    // - default: auto-apply if fast (< 3000ms), otherwise wait for user
    const shouldForceAutoApply = !!options?.forceAutoApply;
    const isRefine = options?.source === 'persona_refine';

    // Guard: don't let a slow refine overwrite a more recent user_feedback result
    if (isRefine && shouldForceAutoApply && stage2StartTime < lastFeedbackAppliedAtRef.current) {
      addLog('RE_RANK', `Stage 2 Refine Skipped (Stale: ${stage2Duration}ms)`, {
        reason: 'A newer user_feedback result was applied after this refine was triggered',
        refine_triggered_at: new Date(stage2StartTime).toLocaleTimeString(),
        feedback_applied_at: new Date(lastFeedbackAppliedAtRef.current).toLocaleTimeString(),
        would_have_been_top: finalSmartFeed[0]?.title?.en
      });
      setIsStage2Loading(false);
      return;
    }

    if (shouldForceAutoApply || stage2Duration < 3000) {
      setAllRankedPosts(finalSmartFeed);
      setCurrentPage(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      addLog('RE_RANK', shouldForceAutoApply
        ? `Stage 2 Auto-Applied (Refine: ${stage2Duration}ms)`
        : `Stage 2 Auto-Applied (Fast: ${stage2Duration}ms)`, {
        top_post: finalSmartFeed[0].title.en
      });
      setPendingSmartFeed(null);

      if (!isRefine) lastFeedbackAppliedAtRef.current = Date.now();
    } else {
      // D. Store result in PENDING state
      setPendingSmartFeed({
        posts: finalSmartFeed,
        history: currentHistory || feedbackHistory,
        profile: profileToUse
      });

      addLog('RE_RANK', `Stage 2 Ready: Waiting for user (${stage2Duration}ms)`, { 
        raw_id_response: rawResponse
      });
    }

    // TRIGGER STAGE 3 (Forgetting) SECRETLY HERE
    // It runs in background after Stage 2 analysis is done.
    // For persona-refine rerank, suppress double-running cleanup.
    if (!options?.suppressStage3) {
      triggerBackgroundCleanup(profileToUse, currentHistory || feedbackHistory);
    }
  };

  // --- STAGE 4: USER PERSONA UPDATE (Background, Non-blocking) ---
  // Split into:
  // - Stage4a: fast signals (traits/redFlagKeywords) -> triggers refine Stage2
  // - Stage4b: UI (nickname/long description/emoji fusion) -> no refine rerank
  const updateUserPersona = async (currentProfile: UserProfile, history: string[]) => {
    try {
      console.log(`[App] 🎭 Starting Stage 4 update with ${history.length} feedback items`);
      console.log(`[App] 📝 Latest feedback:`, history[history.length - 1] || 'None');
      console.log(`[App] 🔑 API Key status:`, apiKey ? `Present (${apiKey.length} chars)` : 'Missing - will use default');
      
      // 检查是否有 API key，如果没有则跳过（避免在部署环境中失败）
      if (!apiKey || apiKey.trim().length === 0) {
        console.warn(`[App] ⚠️ No API key provided, skipping persona update. User needs to set API key.`);
        addLog('PROFILE_UPDATE', 'User Persona Update Skipped (No API Key)', { 
          note: 'Please set your Groq API key to enable persona updates',
          history_length: history.length
        });
        return;
      }

      // Snapshot fun-toggle per run so mid-run toggles only apply next time.
      const funEnabledThisRun = enablePersonaFunRef.current;

      // Enrich history with structured entity/aspect hints from feedbackMemory
      // so Stage 4a/4b can detect red flags even when raw text is vulgar/ambiguous.
      const enrichedHistory = (() => {
        const mem = feedbackMemoryRef.current || [];
        if (mem.length === 0) return history;

        const entityHints: string[] = [];
        for (const entry of mem.slice(0, 10)) {
          for (const pt of (entry.preferenceTargets || [])) {
            if (pt.polarity === 'dislike' && pt.value) {
              entityHints.push(`[${pt.type} dislike: "${pt.value}" (strength ${pt.strength}), from feedback on "${entry.targetPostTitle}"]`);
            }
          }
          if (entry.softDownrankQuery) {
            entityHints.push(`[soft downrank: "${entry.softDownrankQuery}", scope: ${entry.dislikeScope}]`);
          }
        }
        if (entityHints.length === 0) return history;
        const hintLine = `\n--- Structured Signals from Stage 1 Analysis ---\n${entityHints.join('\n')}`;
        return [...history, hintLine];
      })();

      // --- Stage 4a: fast persona signals for refine rerank ---
      const signals = await generateUserPersonaSignals(enrichedHistory, apiKey);
      // Merge rather than overwrite: if the LLM returns empty arrays, keep previous signals.
      // Deduplicate by using a Set on the merged result.
      const dedup = (arr: string[]) => Array.from(new Set(arr));
      setUserPersona(prev => ({
        ...prev,
        userTraits: signals.userTraits.length > 0 ? dedup([...signals.userTraits, ...(prev.userTraits || [])]).slice(0, 5) : prev.userTraits,
        userTraitsZh: signals.userTraits.length > 0 ? dedup([...((signals as any).userTraitsZh || signals.userTraits), ...(prev.userTraitsZh || [])]).slice(0, 5) : prev.userTraitsZh,
        userTraitsEn: (signals as any).userTraitsEn?.length > 0 ? dedup([...(signals as any).userTraitsEn, ...(prev.userTraitsEn || [])]).slice(0, 5) : prev.userTraitsEn,
        redFlags: signals.redFlags.length > 0 ? dedup([...signals.redFlags, ...(prev.redFlags || [])]).slice(0, 5) : prev.redFlags,
        redFlagsZh: signals.redFlags.length > 0 ? dedup([...((signals as any).redFlagsZh || signals.redFlags), ...(prev.redFlagsZh || [])]).slice(0, 5) : prev.redFlagsZh,
        redFlagsEn: (signals as any).redFlagsEn?.length > 0 ? dedup([...(signals as any).redFlagsEn, ...(prev.redFlagsEn || [])]).slice(0, 5) : prev.redFlagsEn,
        redFlagKeywords: signals.redFlagKeywords.length > 0 ? dedup([...signals.redFlagKeywords, ...(prev.redFlagKeywords || [])]).slice(0, 5) : prev.redFlagKeywords
      }));

      addLog('PROFILE_UPDATE', 'User Persona Signals Updated (Stage 4a)', {
        user_traits: signals.userTraits.length > 0 ? signals.userTraits : '(kept previous)',
        red_flags: signals.redFlags.length > 0 ? signals.redFlags : '(kept previous)',
        red_flag_keywords: signals.redFlagKeywords.length > 0 ? signals.redFlagKeywords : '(kept previous)',
        history_length: history.length
      });

      // Trigger refine Stage 2 immediately after signals are available
      const refineRunId = `persona_refine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      personaRefineRunIdRef.current = refineRunId;
      // Use merged signals (new + prev) for refine rerank, so empty LLM responses don't erase history
      const prevPersona = userPersonaRef.current || {};
      const mergedSignals = {
        userTraits: signals.userTraits.length > 0 ? dedup([...signals.userTraits, ...(prevPersona.userTraits || [])]).slice(0, 5) : (prevPersona.userTraits || []),
        redFlags: signals.redFlags.length > 0 ? dedup([...signals.redFlags, ...(prevPersona.redFlags || [])]).slice(0, 5) : (prevPersona.redFlags || []),
        redFlagKeywords: signals.redFlagKeywords.length > 0 ? dedup([...signals.redFlagKeywords, ...(prevPersona.redFlagKeywords || [])]).slice(0, 5) : (prevPersona.redFlagKeywords || [])
      };
      const refineIntentString = buildStage2Context({
        source: 'persona_refine',
        history,
        explicitSearchQuery: lastExplicitSearchRef.current?.query || null,
        personaSignals: mergedSignals,
        hardAvoid: hardAvoidPostsRef.current
      });
      triggerRefreshSequence(
        currentProfile,
        refineIntentString,
        history,
        undefined,
        null,
        { source: 'persona_refine', forceAutoApply: true, suppressStage3: true, runId: refineRunId }
      );

      // Banner UX (4s)
      setRefineBannerMessage(t(language, 'refineBannerRefinedSort'));
      if (refineBannerTimeoutRef.current) window.clearTimeout(refineBannerTimeoutRef.current);
      refineBannerTimeoutRef.current = window.setTimeout(() => setRefineBannerMessage(null), 4000);
      
      // --- Stage 4b: slow UI updates (no second refine rerank) ---
      // Fun-only steps (nickname + emoji avatar) can be disabled without affecting core flow.
      let nicknameResult: any | null = null;
      if (funEnabledThisRun) {
        // 线1：生成用户昵称
        nicknameResult = await generateUserNickname(
          history,
          apiKey,
          currentProfile.name
        );
        console.log(`[App] ✅ Nickname generated:`, nicknameResult.nickname);
        const nicknameEn = (nicknameResult as any).nicknameEn || nicknameResult.nickname;
        const nicknameZh = (nicknameResult as any).nicknameZh || undefined;

        // Store bilingual nicknames for UI toggling
        setUserPersona(prev => ({
          ...prev,
          nicknameEn,
          nicknameZh
        }));

        // Update displayed name to match current UI language (no extra LLM calls on toggle)
        const nextName = language === 'zh' ? (nicknameZh || nicknameEn) : nicknameEn;
        if (nextName && nextName !== currentProfile.name) {
          setUserProfile(prev => ({ ...prev, name: nextName }));
          console.log(`[App] ✅ User name updated to: ${nextName}`);
        }
      } else {
        console.log('[App] 🎛️ Persona fun steps disabled for this run; skipping nickname + emoji fusion');
      }
      
      // 线2：生成用户画像描述（只基于反馈，不涉及标签和emoji）
      const descriptionResult = await generateUserPersonaDescription(
        enrichedHistory,
        apiKey,
        userPersona?.descriptionZh || userPersona?.description
      );
      console.log(`[App] ✅ Description generated:`, descriptionResult.description.substring(0, 50));
      
      let emojiResult: any | null = null;
      if (funEnabledThisRun) {
        // 线3：生成 emoji 融合头像（独立进行，每次都重新生成）
        console.log(`[App] 🎨 Starting emoji fusion generation (history length: ${history.length})...`);
        emojiResult = await generateEmojiFusion(
          history,
          apiKey
        );
        console.log(`[App] ✅ Emoji fusion result:`, {
          emojis: emojiResult.emojiFusion,
          hasUrl: !!emojiResult.fusionUrl,
          url: emojiResult.fusionUrl?.substring(0, 80),
          rawResponse: emojiResult.rawResponse
        });
      }
      
      // 更新状态（强制更新，即使看起来相同）
      // 使用函数式更新确保状态正确更新
      // Merge Stage 4b signals with existing state (never lose previously extracted signals)
      setUserPersona(prev => ({
        ...prev,
        description: descriptionResult.description,
        descriptionZh: (descriptionResult as any).descriptionZh || descriptionResult.description,
        descriptionEn: (descriptionResult as any).descriptionEn || prev.descriptionEn,
        emojiFusion: (funEnabledThisRun && emojiResult?.emojiFusion) ? emojiResult.emojiFusion : prev.emojiFusion,
        userTraits: (descriptionResult.userTraits?.length > 0) ? dedup([...descriptionResult.userTraits, ...(prev.userTraits || [])]).slice(0, 5) : prev.userTraits,
        userTraitsZh: ((descriptionResult as any).userTraitsZh?.length > 0) ? dedup([...(descriptionResult as any).userTraitsZh, ...(prev.userTraitsZh || [])]).slice(0, 5) : prev.userTraitsZh,
        userTraitsEn: ((descriptionResult as any).userTraitsEn?.length > 0) ? dedup([...(descriptionResult as any).userTraitsEn, ...(prev.userTraitsEn || [])]).slice(0, 5) : prev.userTraitsEn,
        redFlags: (descriptionResult.redFlags?.length > 0) ? dedup([...descriptionResult.redFlags, ...(prev.redFlags || [])]).slice(0, 5) : prev.redFlags,
        redFlagsZh: ((descriptionResult as any).redFlagsZh?.length > 0) ? dedup([...(descriptionResult as any).redFlagsZh, ...(prev.redFlagsZh || [])]).slice(0, 5) : prev.redFlagsZh,
        redFlagsEn: ((descriptionResult as any).redFlagsEn?.length > 0) ? dedup([...(descriptionResult as any).redFlagsEn, ...(prev.redFlagsEn || [])]).slice(0, 5) : prev.redFlagsEn,
        redFlagKeywords: (descriptionResult.redFlagKeywords?.length > 0) ? dedup([...descriptionResult.redFlagKeywords, ...(prev.redFlagKeywords || [])]).slice(0, 5) : prev.redFlagKeywords
      }));
      
      // Update avatar image only when fun is enabled.
      if (funEnabledThisRun) {
        setEmojiFusionImage(emojiResult?.fusionUrl || null);
      }

      // Backfill persona summary into the latest feedback memory entry
      const summaryText = (descriptionResult as any).descriptionEn || descriptionResult.description || null;
      if (summaryText) {
        setFeedbackMemory(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[0] = { ...updated[0], personaSummary: summaryText.slice(0, 600) };
          return updated;
        });
      }
      
      console.log(`[App] ✅ State updated:`, {
        description_length: descriptionResult.description.length,
        emojiFusion: funEnabledThisRun ? (emojiResult?.emojiFusion || []) : '(unchanged)',
        hasImage: funEnabledThisRun ? !!emojiResult?.fusionUrl : '(unchanged)'
      });
      
      addLog('PROFILE_UPDATE', 'User Persona Updated (Stage 4)', {
        fun_enabled: funEnabledThisRun,
        nickname: nicknameResult?.nickname || '(unchanged)',
        emoji_fusion: (funEnabledThisRun && emojiResult?.emojiFusion) ? emojiResult.emojiFusion.join(' ') : '(unchanged)',
        fusion_image: (funEnabledThisRun && emojiResult?.fusionUrl) ? `✅ Generated: ${emojiResult.fusionUrl.substring(0, 60)}...` : (funEnabledThisRun ? '❌ Failed - using fallback' : '(unchanged)'),
        description_preview: descriptionResult.description.substring(0, 100) + '...',
        red_flags: descriptionResult.redFlags?.length > 0 ? descriptionResult.redFlags : '(kept previous)',
        red_flag_keywords: descriptionResult.redFlagKeywords?.length > 0 ? descriptionResult.redFlagKeywords : '(kept previous)',
        user_traits: descriptionResult.userTraits?.length > 0 ? descriptionResult.userTraits : '(kept previous)',
        history_length: history.length
      });
    } catch (error) {
      console.error("❌ Persona update failed", error);
      console.error("❌ Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        history_length: history.length,
        has_api_key: !!apiKey
      });
      addLog('PROFILE_UPDATE', 'User Persona Update Failed', { 
        error: error instanceof Error ? error.message : String(error),
        history_length: history.length,
        has_api_key: !!apiKey
      });
    }
  };

  // Part 2: User clicks "Show" to apply Stage 2 results
  const handleApplySmartSort = () => {
    if (!pendingSmartFeed) return;

    setAllRankedPosts(pendingSmartFeed.posts);
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    addLog('RE_RANK', 'Feed Updated (Stage 2 Applied)', { 
      top_post: pendingSmartFeed.posts[0].title.en
    });

    lastFeedbackAppliedAtRef.current = Date.now();

    // Clear pending state
    setPendingSmartFeed(null);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen font-sans relative">
      {/* Liquid Glass Background Layer - 全屏 WebGL 渲染层 */}
      <LiquidGlassBackground 
        enabled={enableLiquidGlass}
        backgroundImageUrl="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop"
      />

      {/* Top banner: refine rerank applied */}
      <AnimatePresence>
        {refineBannerMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-full shadow-lg border border-white/40 bg-white/85 backdrop-blur-xl flex items-center gap-2"
          >
            <Check className="text-green-600" size={16} />
            <span className="text-sm font-semibold text-gray-900">{refineBannerMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Onboarding Overlay - Reduced z-index to allow buttons (z-50/z-60) to pop through if parents permit */}
      <AnimatePresence>
        {showOnboarding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-30 pointer-events-none backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>
      
      {/* --- Onboarding Instruction Card (RESTORED & STYLED) --- */}
      {/* Z-Index raised to 100 to appear above everything */}
      <AnimatePresence>
        {showOnboarding && showInstructionModal && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none px-4">
             <motion.div
               initial={{ opacity: 0, scale: 0.9, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 20 }}
               className="bg-white/90 backdrop-blur-xl rounded-[32px] shadow-2xl p-8 max-w-sm w-full border border-white/40 text-center pointer-events-auto"
             >
               <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                 <Sparkles size={24} />
               </div>
               <h3 className="text-xl font-bold text-gray-900 mb-2">
                 {language === 'en' ? 'Customize Your Feed' : '定制你的推荐流'}
               </h3>
               <p className="text-gray-600 text-sm leading-relaxed mb-6">
                 {language === 'en' 
                   ? "Click the '...' button on any post to provide natural language feedback. The AI will instantly adjust your feed."
                   : "点开任意帖子的 '...' 按钮，进行自然语言反馈。AI 会立即调整你的推荐内容。"
                 }
               </p>
               <motion.button 
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => {
                   setShowInstructionModal(false);
                   setShowOnboarding(false); // Also dismiss the dimmed background
                 }}
                 className="w-full text-sm text-white font-bold bg-black py-3 px-6 rounded-xl cursor-pointer hover:bg-gray-800 transition-colors shadow-lg"
               >
                 {language === 'en' ? 'Try it now' : '试一试'}
               </motion.button>
             </motion.div>
           </div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-0 md:px-6 py-0 md:py-8">
        
        {/* Mobile Header - Z-index adjusted to sit comfortably above content but manageable with overlay */}
        <div className="lg:hidden sticky top-3 z-[40] mx-3 mb-6 rounded-[32px] bg-white/90 backdrop-blur-3xl backdrop-saturate-150 border border-white/40 shadow-xl transition-all">
          <div className="px-4 py-3">
            <div className="flex justify-between items-center mb-2">
              <motion.h1 
                whileTap={{ scale: 0.95 }}
                onClick={() => triggerRefreshSequence()} 
                className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 cursor-pointer select-none drop-shadow-sm pl-1 flex items-center gap-2"
              >
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="NeuroFeed" className="w-7 h-7" />
                NeuroFeed
              </motion.h1>
              <div className="flex gap-2">
                 <motion.button 
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                   className={`w-9 h-9 flex items-center justify-center rounded-full text-xs font-bold shadow-sm transition-all
                     ${showOnboarding ? 'z-50 relative bg-white/80 ring-4 ring-orange-400/50 text-orange-600' : 'bg-white/50 text-gray-700'}`}
                 >
                   {language === 'en' ? 'ZH' : 'EN'}
                 </motion.button>
                 
                 {/* Mobile Refresh/Apply Button */}
                 <div className="relative">
                   {pendingSmartFeed && (
                      <motion.div 
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white z-20"
                      />
                   )}
                   <motion.button 
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={isStage2Loading}
                      onClick={() => pendingSmartFeed ? handleApplySmartSort() : triggerRefreshSequence()}
                      className={`w-9 h-9 flex items-center justify-center rounded-full shadow-sm transition-all overflow-hidden relative
                        ${pendingSmartFeed ? 'bg-blue-600 text-white' : 'bg-white/50 text-gray-700 hover:bg-white/80'}`}
                   >
                     {isStage2Loading ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, ease: "linear", repeat: Infinity }}
                        >
                           <BrainCircuit size={18} />
                        </motion.div>
                     ) : pendingSmartFeed ? (
                        <motion.div
                          initial={{ y: 20, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                        >
                           <ArrowUp size={20} />
                        </motion.div>
                     ) : (
                        <RefreshCcw size={18} />
                     )}
                   </motion.button>
                 </div>

                 <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setIsMobileDashboardOpen(!isMobileDashboardOpen)}
                    className={`w-9 h-9 flex items-center justify-center rounded-full shadow-sm transition-colors ${isMobileDashboardOpen ? 'bg-black/80 text-white' : 'bg-white/50 text-gray-800'}`}
                 >
                    <AnimatePresence mode='wait'>
                      {isMobileDashboardOpen ? (
                        <motion.div 
                          key="close"
                          initial={{ rotate: -90, opacity: 0 }}
                          animate={{ rotate: 0, opacity: 1 }}
                          exit={{ rotate: 90, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <X size={20} />
                        </motion.div>
                      ) : (
                        <motion.div 
                          key="menu"
                          initial={{ rotate: 90, opacity: 0 }}
                          animate={{ rotate: 0, opacity: 1 }}
                          exit={{ rotate: -90, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Menu size={20} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                 </motion.button>
              </div>
            </div>
            
            <div className="flex gap-2 items-center">
              {!isKeySaved ? (
                <>
                  <input 
                    type="password" 
                    placeholder="Groq API Key (Optional)..." 
                    className="flex-1 bg-white/50 border-none rounded-2xl px-4 py-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none placeholder-gray-500"
                    value={tempKeyInput}
                    onChange={(e) => setTempKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  />
                  <motion.button 
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSaveKey} 
                    className="bg-black/80 text-white px-4 py-2 rounded-2xl text-xs font-bold shadow-md"
                  >
                    Save
                  </motion.button>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-between bg-green-50/50 px-4 py-2 rounded-2xl border border-green-200/50">
                  <span className="flex items-center gap-1.5 text-xs text-green-800 font-medium">
                    <Check size={12} /> Groq Key Saved
                  </span>
                  <motion.button 
                    whileTap={{ scale: 0.95 }}
                    onClick={handleClearKey} 
                    className="text-[10px] text-gray-500 underline"
                  >
                    Unlink
                  </motion.button>
                </div>
              )}
            </div>
          </div>

          {/* Absolute Overlay Dashboard */}
          <AnimatePresence>
            {isMobileDashboardOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute top-[calc(100%+8px)] left-0 right-0 z-50 overflow-hidden bg-white/90 backdrop-blur-3xl backdrop-saturate-150 border border-white/40 shadow-2xl rounded-[32px]"
              >
                <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  <Dashboard
                     userProfile={userProfile}
                     logs={logs}
                     onReset={handleReset}
                     className="space-y-6"
                     language={language}
                     userPersona={userPersona}
                     emojiFusionImage={emojiFusionImage}
                     enablePersonaFun={enablePersonaFun}
                     onTogglePersonaFun={() => setEnablePersonaFun(v => !v)}
                     feedbackMemory={feedbackMemory}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Feed Column */}
          <div className="lg:col-span-7 xl:col-span-7 pb-20 md:pb-10 pt-2 px-1">
            <div className={`hidden lg:flex items-center justify-between mb-6 bg-white/60 backdrop-blur-xl p-4 rounded-[24px] shadow-sm border border-white/40 sticky top-6 ${showOnboarding ? 'z-50 relative' : 'z-30'}`}>
              <div className="flex items-center gap-4 min-w-0">
                <div className="-my-4 -ml-1 flex items-center self-stretch">
                  <img
                    src={animatedHeaderIcon}
                    alt="NeuroFeed"
                    className="w-16 h-16 shrink-0"
                  />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 drop-shadow-sm">
                  Your Feed
                  </h1>
                  <p className="text-xs text-gray-600 mt-0.5">AI-Curated • Page {currentPage} of {totalPages}</p>
                </div>
              </div>
              
              <div className="flex gap-3 items-center">
                {/* Liquid Glass Toggle */}
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setEnableLiquidGlass(!enableLiquidGlass)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                    enableLiquidGlass 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'bg-white/40 text-gray-600 hover:bg-white/60'
                  }`}
                  title={enableLiquidGlass ? 'Disable Liquid Glass' : 'Enable Liquid Glass'}
                >
                  <Sparkles size={14} />
                  <span className="hidden xl:inline">Glass</span>
                </motion.button>

                <div className={`flex items-center rounded-lg p-1 transition-all ${showOnboarding ? 'bg-white ring-4 ring-orange-400/50' : 'bg-white/40'}`}
                   style={showOnboarding ? { animation: 'pulse 2s infinite' } : {}}
                >
                   <motion.button 
                     whileTap={{ scale: 0.95 }}
                     onClick={() => setLanguage('en')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'en' ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                     EN
                   </motion.button>
                   <motion.button 
                     whileTap={{ scale: 0.95 }}
                     onClick={() => setLanguage('zh')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'zh' ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                     中文
                   </motion.button>
                </div>

                <div className="relative">
                  {!isKeySaved ? (
                    <div className="flex items-center gap-2 bg-white/50 p-1 pl-3 rounded-lg border border-white/30">
                      <Key size={14} className="text-gray-500" />
                      <input 
                        type="password" 
                        placeholder="Groq Key (Opt)..." 
                        className="w-32 text-sm bg-transparent outline-none text-gray-700 placeholder-gray-500"
                        value={tempKeyInput}
                        onChange={(e) => setTempKeyInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                      />
                      <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleSaveKey}
                        className="bg-black/90 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-black"
                      >
                        Save
                      </motion.button>
                    </div>
                  ) : (
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleClearKey}
                      className="flex items-center gap-2 px-3 py-2 bg-green-50/70 backdrop-blur-md text-green-800 rounded-lg border border-green-200/50 text-xs font-bold hover:bg-green-100/80 transition-colors"
                    >
                      <Check size={14} />
                      Connected
                    </motion.button>
                  )}
                </div>

                {/* DESKTOP REFRESH / UPDATE BUTTON */}
                <div className="relative">
                  {/* Tooltip for Ready State */}
                  <AnimatePresence>
                    {pendingSmartFeed && (
                      <motion.div
                        initial={{ opacity: 0, x: 20, scale: 0.8 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap bg-black/80 backdrop-blur-md text-white text-xs font-bold py-1.5 px-3 rounded-xl shadow-xl z-20 flex items-center gap-2"
                      >
                        <Sparkles size={12} className="text-yellow-400" />
                        Smart Feed Ready
                        <div className="absolute top-1/2 -right-1 w-2 h-2 bg-black/80 transform -translate-y-1/2 rotate-45"></div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Red Notification Badge */}
                  {pendingSmartFeed && (
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white z-20"
                    />
                  )}

                  <motion.button 
                    whileHover={pendingSmartFeed ? { scale: 1.05 } : {}}
                    whileTap={pendingSmartFeed ? { scale: 0.95 } : {}}
                    disabled={!pendingSmartFeed}
                    onClick={() => pendingSmartFeed && handleApplySmartSort()}
                    className={`
                      p-2 rounded-lg shadow-sm transition-all relative
                      ${isStage2Loading ? 'bg-white text-orange-600 border border-orange-200 cursor-wait' : 
                        pendingSmartFeed ? 'bg-blue-600 text-white shadow-blue-500/30 shadow-lg ring-2 ring-blue-100 cursor-pointer' : 
                        'bg-gray-100 text-gray-300 border border-gray-200 cursor-not-allowed'}
                    `}
                    title={pendingSmartFeed ? "Show New Feed" : "Auto-updates on feedback"}
                  >
                    {isStage2Loading ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, ease: "linear", repeat: Infinity }}
                      >
                        <BrainCircuit size={18} />
                      </motion.div>
                    ) : pendingSmartFeed ? (
                      <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="font-bold text-xs flex items-center gap-1"
                      >
                        <span className="hidden sm:inline">Show</span>
                        <ArrowUp size={16} strokeWidth={3} />
                      </motion.div>
                    ) : (
                      <RefreshCcw size={18} />
                    )}
                  </motion.button>
                </div>
              </div>
            </div>

            {/* Feed Container - Removed Opacity Blocking */}
            <div className={`px-3 md:px-0 transition-opacity duration-300 ${isStage1Refreshing ? 'opacity-50' : 'opacity-100'}`}>
              <AnimatePresence mode="popLayout">
                {visiblePosts.map((post) => (
                  <motion.div
                    key={post.id}
                    layout="position"
                    initial={{ opacity: 0, y: 50, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                    transition={{ type: "spring", stiffness: 200, damping: 25, mass: 0.8 }}
                  >
                    <PostCard 
                      post={post} 
                      language={language}
                      onNotInterested={handleNotInterestedClick}
                      isOnboarding={highlightMenu} // Pass highlight state to PostCard
                      enableLiquidGlass={enableLiquidGlass} // Enable liquid glass effect
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {visiblePosts.length === 0 && (
                 <div className="text-center py-20 text-white/70 font-medium">
                   No posts match your criteria. Try resetting.
                 </div>
              )}
              
              <div className="py-8 flex flex-col items-center justify-center gap-4">
                 <div className="flex items-center gap-4 bg-white/60 backdrop-blur-xl p-2 rounded-xl shadow-lg border border-white/40">
                    <motion.button 
                      whileHover={{ scale: 1.1, x: -2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg hover:bg-white/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowLeft size={20} />
                    </motion.button>
                    
                    <span className="text-sm font-medium text-gray-800 px-2 min-w-[100px] text-center">
                      Page {currentPage} of {totalPages}
                    </span>

                    <motion.button 
                      whileHover={{ scale: 1.1, x: 2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg hover:bg-white/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowRight size={20} />
                    </motion.button>
                 </div>

                 {currentPage > 3 && (
                   <motion.button 
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}
                    className="flex items-center gap-1 text-xs text-white/80 hover:text-white font-medium drop-shadow-md"
                   >
                     <ArrowUp size={12} /> Back to Top
                   </motion.button>
                 )}
              </div>
            </div>
          </div>

          {/* Dashboard Column */}
          <div className="lg:col-span-5 xl:col-span-5 hidden lg:block h-full">
             <Dashboard
               userProfile={userProfile}
               logs={logs}
               onReset={handleReset}
               language={language}
               userPersona={userPersona}
               emojiFusionImage={emojiFusionImage}
               enablePersonaFun={enablePersonaFun}
               onTogglePersonaFun={() => setEnablePersonaFun(v => !v)}
               feedbackMemory={feedbackMemory}
             />
          </div>

        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && selectedPost && (
          <FeedbackModal 
            key="feedback-modal"
            isOpen={isModalOpen}
            post={selectedPost}
            language={language}
            onClose={() => setIsModalOpen(false)}
            onSubmit={handleFeedbackSubmit}
            isAnalyzing={isAnalyzing}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;