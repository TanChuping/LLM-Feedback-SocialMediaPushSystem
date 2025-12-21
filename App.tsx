import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Post, UserProfile, SystemLog, WeightedTag } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS, ALL_TAGS } from './constants';
import { ADDITIONAL_POSTS, EXTRA_TAGS } from './constants2'; 
import { ADDITIONAL_POSTS_3, PET_AND_ENT_TAGS } from './constants3'; 
import { ADDITIONAL_POSTS_4 } from './constants4';
import { rankPosts, normalizeTag, generateRandomProfile, getHybridFeed } from './services/recommendationEngine';
import { analyzeFeedback, rerankFeed, pruneUserProfile } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowUp, Key, Check, RefreshCcw, ArrowLeft, ArrowRight, Menu, X, Sparkles, BrainCircuit, Zap, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ITEMS_PER_PAGE = 30;
const MAX_TAG_WEIGHT = 40;
// Increased to 25 to leverage deeper content pool, since Stage 2 is now non-blocking
const LLM_RERANK_COUNT = 25;

// Merge data sources
const COMBINED_POSTS = [...MOCK_POSTS, ...ADDITIONAL_POSTS, ...ADDITIONAL_POSTS_3, ...ADDITIONAL_POSTS_4];

const EXPLICIT_TAGS = [...ALL_TAGS, ...EXTRA_TAGS, ...PET_AND_ENT_TAGS];
const POST_DERIVED_TAGS = COMBINED_POSTS.flatMap(post => post.tags);
const MASTER_TAG_POOL = Array.from(new Set([...EXPLICIT_TAGS, ...POST_DERIVED_TAGS]));

const App: React.FC = () => {
  // --- State ---
  
  // Initialize with Random Profile for Cold Start Diversity
  const [userProfile, setUserProfile] = useState<UserProfile>(() => generateRandomProfile(MASTER_TAG_POOL));
  
  const [allRankedPosts, setAllRankedPosts] = useState<Post[]>([]); 
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  // New: Track history for background cleanup context
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([]);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  
  // Localization
  const [language, setLanguage] = useState<'en' | 'zh'>('en');

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
  
  // Mobile Dashboard
  const [isMobileDashboardOpen, setIsMobileDashboardOpen] = useState(false);
  
  // Onboarding States - Mapped to match user request structure
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showInstructionModal, setShowInstructionModal] = useState(true);
  
  const [highlightMenu, setHighlightMenu] = useState(true);

  const allAvailableTags = MASTER_TAG_POOL;

  const totalPages = Math.ceil(allRankedPosts.length / ITEMS_PER_PAGE);
  const visiblePosts = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return allRankedPosts.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [allRankedPosts, currentPage]);

  const addLog = (type: SystemLog['type'], title: string, details: any) => {
    const newLog: SystemLog = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      type,
      title,
      details
    };
    setLogs(prev => [...prev, newLog]);
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
    if (tempKeyInput.trim().length > 10) {
      const cleanedKey = tempKeyInput.trim();
      setApiKey(cleanedKey);
      localStorage.setItem('GROQ_API_KEY', cleanedKey);
      setIsKeySaved(true);
      // Feedback to user that key is updated
      addLog('PROFILE_UPDATE', 'Groq API Key Updated', { status: 'New Key Saved', length: cleanedKey.length });
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

    // console.log("Starting Background Cleanup...");
    // Pass the entire feedback history to finding conflicts
    const result = await pruneUserProfile(history, currentProfile, apiKey);
    
    if (result.adjustments.length > 0) {
      // Apply silent updates
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
              // STRICT LIMIT: Max decay is -10. 
              // adj.delta should be negative. We clamp it between -10 and 0.
              // e.g. if delta is -30, we make it -10.
              // e.g. if delta is -5, we keep -5.
              let safeDelta = adj.delta;
              if (safeDelta < -10) safeDelta = -10; // Hard clamp max penalty
              if (safeDelta > 0) safeDelta = 0;     // Ensure it's only decay

              updatedInterests[idx].weight += safeDelta;
              if (updatedInterests[idx].weight < 0) updatedInterests[idx].weight = 0;
            }
        });
        
        // Remove tags that fell below threshold
        const filteredInterests = updatedInterests.filter(i => i.weight > 0.1);
        
        if (filteredInterests.length !== prev.interests.length || filteredInterests.some((i, idx) => i.weight !== prev.interests[idx]?.weight)) {
            addLog('PROFILE_UPDATE', 'Forgetting Mechanism (Stage 3)', {
              reason: result.reason,
              history_referenced: history.length,
              decayed_tags: result.adjustments.map(a => `${a.tag} (${a.delta} -> capped)`)
            });
        }
        
        return { ...prev, interests: filteredInterests };
      });
    }
  };

  const handleFeedbackSubmit = async (text: string, post: Post) => {
    setIsAnalyzing(true);
    const postTitle = post.title[language];
    
    // 1. Update History
    const newHistory = [...feedbackHistory, text];
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
    
    addLog('LLM_ANALYSIS', 'Step 1: Analyzed Intent & Keywords', {
      raw_response: analysis.rawResponse || "No raw response",
      explicit_search: analysis.explicit_search_query || "None",
      note: analysis.user_note,
      using_key: apiKey ? `Custom Key` : 'Demo Key'
    });

    if (analysis.adjustments.length === 0 && analysis.user_note.includes("Failed")) {
        setIsAnalyzing(false);
        setIsModalOpen(false);
        return;
    }

    let currentInterests = [...userProfile.interests];
    let currentDislikes = [...userProfile.dislikes];

    // Apply strict Logic:
    // If LLM says "Interest" -> Add/Boost interest, REMOVE from dislike (Flip).
    // If LLM says "Dislike" -> Add/Boost dislike, REMOVE from interest (Flip).
    analysis.adjustments.forEach(adj => {
      const normAdj = normalizeTag(adj.tag);

      if (adj.category === 'interest') {
        // 1. Remove from dislikes if it exists there (Flip polarity)
        const dislikeIdx = currentDislikes.findIndex(d => normalizeTag(d.tag) === normAdj);
        if (dislikeIdx >= 0) {
            currentDislikes.splice(dislikeIdx, 1);
        }

        // 2. Add or Boost in Interests
        let existingIdx = currentInterests.findIndex(i => i.tag === adj.tag);
        if (existingIdx === -1) {
           existingIdx = currentInterests.findIndex(i => normalizeTag(i.tag) === normAdj);
        }

        if (existingIdx >= 0) {
          // If it already exists, just add delta (delta can be negative to dampen)
          let newWeight = currentInterests[existingIdx].weight + adj.delta;
          newWeight = Math.min(newWeight, MAX_TAG_WEIGHT);
          currentInterests[existingIdx].weight = newWeight;
          currentInterests[existingIdx].tag = adj.tag; // update casing
        } else {
          // New interest
          if (adj.delta > 0) {
            const initialWeight = Math.min(adj.delta, MAX_TAG_WEIGHT);
            currentInterests.push({ tag: adj.tag, weight: initialWeight });
          }
        }

      } else if (adj.category === 'dislike') {
        // 1. Remove from interests if it exists there (Flip polarity)
        const interestIdx = currentInterests.findIndex(i => normalizeTag(i.tag) === normAdj);
        if (interestIdx >= 0) {
            // "Move" logic: If it was a strong interest, we don't just delete it,
            // we actively add it to dislikes with the delta power.
            currentInterests.splice(interestIdx, 1);
        }

        // 2. Add or Boost in Dislikes
        const impact = Math.abs(adj.delta); // Dislike score is always positive magnitude in list
        let existingIdx = currentDislikes.findIndex(d => d.tag === adj.tag);
        if (existingIdx === -1) {
            existingIdx = currentDislikes.findIndex(d => normalizeTag(d.tag) === normAdj);
        }

        if (existingIdx >= 0) {
           let newWeight = currentDislikes[existingIdx].weight + impact;
           newWeight = Math.min(newWeight, MAX_TAG_WEIGHT);
           currentDislikes[existingIdx].weight = newWeight;
        } else {
           if (impact > 0) {
             const initialWeight = Math.min(impact, MAX_TAG_WEIGHT);
             currentDislikes.push({ tag: adj.tag, weight: initialWeight });
           }
        }
      }
    });

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
      changes: analysis.adjustments.map(a => `${a.tag} (${a.category === 'dislike' ? '-' : '+'}${Math.abs(a.delta)})`),
    });

    setIsAnalyzing(false);
    setIsModalOpen(false);
    setSelectedPost(null);
    
    // Construct intent string for LLM Context in Stage 2
    let explicitIntentString = `User Feedback: "${text}" | Analysis: ${analysis.user_note}`;
    if (analysis.explicit_search_query) {
      explicitIntentString += ` | EXPLICIT SEARCH REQUEST: "${analysis.explicit_search_query}"`;
    }
    
    // 3. Trigger Refresh Sequence (Stage 1.5 Hybrid -> Stage 2 LLM)
    triggerRefreshSequence(
      updatedProfile, 
      explicitIntentString, 
      newHistory,
      analysis.explicit_search_query // Pass the raw search query for Stage 1.5
    );
  };

  const handleReset = () => {
    // Re-roll random profile
    const newRandomProfile = generateRandomProfile(MASTER_TAG_POOL);
    setUserProfile(newRandomProfile);
    
    setFeedbackHistory([]);
    setLogs([]);
    setPendingSmartFeed(null);
    setShowOnboarding(true);
    setShowInstructionModal(true);
    setHighlightMenu(true);
    
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
    rawSearchQuery?: string | null
  ) => {
    // A. Visual Feedback
    setIsStage1Refreshing(true); 
    setPendingSmartFeed(null); 

    await new Promise(resolve => setTimeout(resolve, 300)); 

    const profileToUse = profileOverride || userProfile;
    
    // B. STAGE 1.5: Hybrid Retrieval (Algo + Search)
    // If rawSearchQuery exists, this returns a mix of Top 15 Interest + Top 10 Search.
    // If not, it returns Top 25 Interest.
    const hybridCandidates = getHybridFeed(COMBINED_POSTS, profileToUse, rawSearchQuery);
    
    // For immediate display (while Stage 2 loads), we just use the Hybrid result.
    // We sort by score mainly so it looks decent before the LLM fixes it.
    const immediateDisplay = [...hybridCandidates].sort((a,b) => (b.score || 0) - (a.score || 0));
    setAllRankedPosts(immediateDisplay); 
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    setIsStage1Refreshing(false);
    
    addLog('RE_RANK', 'Stage 1.5 Complete: Hybrid Retrieval', { 
      query_used: rawSearchQuery || "None (Pure Algo)",
      candidate_count: hybridCandidates.length,
      note: "User sees this while Stage 2 runs..."
    });

    // C. Kickoff Stage 2 (Background LLM Rerank)
    setIsStage2Loading(true);
    const stage2StartTime = Date.now();
      
    // The hybridCandidates IS the pool for Stage 2.
    // We pass the "rest of feed" just in case, though usually we just append it.
    // Actually, to keep the feed deep, let's append the *rest* of the algo-sorted posts 
    // that weren't in the top 25 candidate pool.
    const allAlgoSorted = rankPosts(COMBINED_POSTS, profileToUse);
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
    
    const reorderedTopPosts: Post[] = [];
    const usedIds = new Set<string>();
    orderedIds.forEach(id => {
      const p = hybridCandidates.find(post => post.id === id);
      if (p) {
        reorderedTopPosts.push(p);
        usedIds.add(id);
      }
    });
    // Add any stragglers from candidates that LLM might have skipped (fallback)
    hybridCandidates.forEach(p => {
      if (!usedIds.has(p.id)) reorderedTopPosts.push(p);
    });

    const finalSmartFeed = [...reorderedTopPosts, ...restOfFeed];
    
    const stage2Duration = Date.now() - stage2StartTime;
    setIsStage2Loading(false); 

    // AUTO-APPLY LOGIC: If fast (< 3000ms), apply immediately. Otherwise wait for user.
    if (stage2Duration < 3000) {
      setAllRankedPosts(finalSmartFeed);
      setCurrentPage(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      addLog('RE_RANK', `Stage 2 Auto-Applied (Fast: ${stage2Duration}ms)`, { 
        top_post: finalSmartFeed[0].title.en
      });
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
    // It runs in background after Stage 2 analysis is done
    triggerBackgroundCleanup(profileToUse, currentHistory || feedbackHistory);
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
                className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 cursor-pointer select-none drop-shadow-sm pl-1"
              >
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
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 drop-shadow-sm flex items-center gap-2">
                  Your Feed
                </h1>
                <p className="text-xs text-gray-600 mt-0.5">AI-Curated • Page {currentPage} of {totalPages}</p>
              </div>
              
              <div className="flex gap-3 items-center">
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