import React, { useState, useEffect, useMemo } from 'react';
import { Post, UserProfile, SystemLog, WeightedTag } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS, ALL_TAGS } from './constants';
import { ADDITIONAL_POSTS, EXTRA_TAGS } from './constants2'; 
import { ADDITIONAL_POSTS_3, PET_AND_ENT_TAGS } from './constants3'; 
import { rankPosts } from './services/recommendationEngine';
import { analyzeFeedback } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowUp, Key, Check, RefreshCcw, ArrowLeft, ArrowRight, Menu, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ITEMS_PER_PAGE = 30;

// Merge data sources
const COMBINED_POSTS = [...MOCK_POSTS, ...ADDITIONAL_POSTS, ...ADDITIONAL_POSTS_3];

// --- DYNAMIC TAG GENERATION ---
// 1. Start with the explicitly defined tags from our constants files (Schema)
const EXPLICIT_TAGS = [...ALL_TAGS, ...EXTRA_TAGS, ...PET_AND_ENT_TAGS];

// 2. Iterate through ALL posts to find any "ad-hoc" tags used in the data but missing from the lists
const POST_DERIVED_TAGS = COMBINED_POSTS.flatMap(post => post.tags);

// 3. Merge and Deduplicate to create the Master Vocabulary for the LLM
const MASTER_TAG_POOL = Array.from(new Set([...EXPLICIT_TAGS, ...POST_DERIVED_TAGS]));

const App: React.FC = () => {
  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [allRankedPosts, setAllRankedPosts] = useState<Post[]>([]); 
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Mobile Dashboard
  const [isMobileDashboardOpen, setIsMobileDashboardOpen] = useState(false);
  
  // Onboarding & Tutorials
  const [showWelcome, setShowWelcome] = useState(true); // Controls Overlay + Welcome Modal + Language Flash
  const [highlightMenu, setHighlightMenu] = useState(true); // Controls "..." Button Flash independently

  // Derived State
  // Pass the dynamically generated Master List to the analysis engine
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

  // Initialization
  useEffect(() => {
    const sorted = rankPosts(COMBINED_POSTS, INITIAL_USER_PROFILE);
    setAllRankedPosts(sorted);
    addLog('RE_RANK', 'Initial Content Load', { top_posts: sorted.slice(0, 3).map(p => p.title.en) });
    
    // Debug log to confirm tags are loaded
    console.log(`Loaded ${COMBINED_POSTS.length} posts and ${MASTER_TAG_POOL.length} unique tags.`);
    
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setTempKeyInput(savedKey);
      setIsKeySaved(true);
    }
  }, []);

  const handleSaveKey = () => {
    if (tempKeyInput.trim().length > 10) {
      setApiKey(tempKeyInput.trim());
      localStorage.setItem('GEMINI_API_KEY', tempKeyInput.trim());
      setIsKeySaved(true);
    }
  };

  const handleClearKey = () => {
    setApiKey('');
    setTempKeyInput('');
    localStorage.removeItem('GEMINI_API_KEY');
    setIsKeySaved(false);
  };

  const handleNotInterestedClick = (post: Post) => {
    // If user clicks the menu, we turn off the highlight tutorial
    if (highlightMenu) {
      setHighlightMenu(false);
    }
    // Also close welcome screen if they bypassed it (e.g. via overlay clicks if enabled)
    if (showWelcome) {
      setShowWelcome(false);
    }

    setSelectedPost(post);
    setIsModalOpen(true);
  };

  const handleFeedbackSubmit = async (text: string, post: Post) => {
    setIsAnalyzing(true);
    const postTitle = post.title[language];
    addLog('FEEDBACK', 'User provided natural language feedback', { feedback: text, target_post: postTitle });

    const analysis = await analyzeFeedback(
      text, 
      `Title: ${postTitle}, Tags: ${post.tags.join(', ')}`,
      apiKey,
      allAvailableTags 
    );
    
    addLog('LLM_ANALYSIS', 'Gemini parsed intent using available tags', analysis);

    // Deep copy to avoid mutation issues during iteration
    let currentInterests = [...userProfile.interests];
    let currentDislikes = [...userProfile.dislikes];

    // --- LOGIC UPDATE: Cross-Category Cleansing ---
    // If we add to Interest, we MUST remove from Dislike, and vice versa.
    // This prevents "Score Cancellation" where +20 Interest and -20 Dislike result in 0 change.
    
    analysis.adjustments.forEach(adj => {
      if (adj.category === 'interest') {
        // 1. Update Interest List
        const existingIdx = currentInterests.findIndex(i => i.tag === adj.tag);
        if (existingIdx >= 0) {
          currentInterests[existingIdx].weight += adj.delta;
          if (currentInterests[existingIdx].weight < 0) currentInterests[existingIdx].weight = 0;
        } else {
          if (adj.delta > 0) {
            currentInterests.push({ tag: adj.tag, weight: adj.delta });
          }
        }
        
        // 2. CLEANSE Dislike List (Crucial Step!)
        // If user now LIKES this, they certainly don't DISLIKE it anymore.
        currentDislikes = currentDislikes.filter(d => d.tag !== adj.tag);

      } else if (adj.category === 'dislike') {
        // 1. Update Dislike List
        const existingIdx = currentDislikes.findIndex(d => d.tag === adj.tag);
        if (existingIdx >= 0) {
           currentDislikes[existingIdx].weight += adj.delta;
        } else {
           if (adj.delta > 0) {
             currentDislikes.push({ tag: adj.tag, weight: adj.delta });
           }
        }

        // 2. CLEANSE Interest List (Crucial Step!)
        // If user now DISLIKES this, remove it from interests.
        currentInterests = currentInterests.filter(i => i.tag !== adj.tag);
      }
    });

    // Clean up zero weights just in case
    currentInterests = currentInterests.filter(i => i.weight > 0.1);
    currentDislikes = currentDislikes.filter(d => d.weight > 0.1);

    const updatedProfile = {
      ...userProfile,
      interests: currentInterests,
      dislikes: currentDislikes
    };
    
    setUserProfile(updatedProfile);
    addLog('PROFILE_UPDATE', 'Weights Updated (Cross-Cleansed)', { 
      changes: analysis.adjustments.map(a => `${a.tag} (${a.delta > 0 ? '+' : ''}${a.delta})`),
      note: analysis.user_note 
    });

    setIsAnalyzing(false);
    setIsModalOpen(false);
    setSelectedPost(null);
    handleManualRefresh(updatedProfile);
  };

  const handleReset = () => {
    setUserProfile(INITIAL_USER_PROFILE);
    setLogs([]);
    setShowWelcome(true);
    setHighlightMenu(true);
    const sorted = rankPosts(COMBINED_POSTS, INITIAL_USER_PROFILE);
    setAllRankedPosts(sorted);
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleManualRefresh = (profileOverride?: UserProfile) => {
    setIsRefreshing(true);
    setTimeout(() => {
       const profileToUse = profileOverride || userProfile;
       const sorted = rankPosts(COMBINED_POSTS, profileToUse);
       setAllRankedPosts([...sorted]); 
       setCurrentPage(1);
       setIsRefreshing(false);
       addLog('RE_RANK', 'Feed Refreshed', { 
        top_recommendation: sorted[0].title[language]
      });
       window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 800);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen font-sans relative">
      
      {/* Onboarding Overlay (Only for Welcome phase) */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 pointer-events-none backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>
      
      {/* Onboarding Instruction Modal */}
      <AnimatePresence>
        {showWelcome && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none px-4">
             <motion.div
               initial={{ opacity: 0, scale: 0.9, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 20 }}
               className="bg-white/90 backdrop-blur-xl rounded-[32px] shadow-2xl p-6 max-w-sm w-full border border-white/40 text-center pointer-events-auto"
             >
               <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                 <Sparkles size={24} />
               </div>
               <h3 className="text-lg font-bold text-gray-900 mb-2">
                 {language === 'en' ? 'Customize Your Feed' : '定制你的推荐流'}
               </h3>
               <p className="text-gray-600 text-sm leading-relaxed mb-4">
                 {language === 'en' 
                   ? "Click the '...' button on any post to provide natural language feedback. The AI will instantly adjust your feed."
                   : "点开任意帖子的 '...' 按钮，进行自然语言反馈。AI 会立即调整你的推荐内容。"
                 }
               </p>
               <motion.button 
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => {
                   setShowWelcome(false);
                   // Note: We DO NOT set highlightMenu(false) here. 
                   // The menu dots will continue to flash until clicked.
                 }}
                 className="text-xs text-blue-500 font-medium bg-blue-50 py-2 px-4 rounded-full inline-block cursor-pointer hover:bg-blue-100 transition-colors"
               >
                 Try it now / 试一试
               </motion.button>
             </motion.div>
           </div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-0 md:px-6 py-0 md:py-8">
        
        {/* Mobile Header */}
        <div className="lg:hidden sticky top-3 z-50 mx-3 mb-6 rounded-[32px] bg-white/90 backdrop-blur-3xl backdrop-saturate-150 border border-white/40 shadow-xl transition-all">
          <div className="px-4 py-3">
            <div className="flex justify-between items-center mb-2">
              <motion.h1 
                whileTap={{ scale: 0.95 }}
                onClick={() => handleManualRefresh()} 
                className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-purple-700 cursor-pointer select-none drop-shadow-sm pl-1"
              >
                NeuroFeed
              </motion.h1>
              <div className="flex gap-2">
                 <motion.button 
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                   className={`w-9 h-9 flex items-center justify-center rounded-full text-xs font-bold shadow-sm transition-all
                     ${showWelcome ? 'z-50 relative bg-white/80 ring-4 ring-blue-400/50 text-blue-600' : 'bg-white/50 text-gray-700'}`}
                 >
                   {language === 'en' ? 'ZH' : 'EN'}
                 </motion.button>
                 <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleManualRefresh()}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-white/50 text-gray-700 hover:bg-white/80 shadow-sm"
                 >
                   <motion.div
                     animate={{ rotate: isRefreshing ? 360 : 0 }}
                     transition={{ duration: 1, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                   >
                      <RefreshCcw size={18} />
                   </motion.div>
                 </motion.button>

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
                    placeholder="API Key..." 
                    className="flex-1 bg-white/50 border-none rounded-2xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none placeholder-gray-500"
                    value={tempKeyInput}
                    onChange={(e) => setTempKeyInput(e.target.value)}
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
                    <Check size={12} /> API Connected
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
            <div className={`hidden lg:flex items-center justify-between mb-6 bg-white/60 backdrop-blur-xl p-4 rounded-[24px] shadow-sm border border-white/40 sticky top-6 ${showWelcome ? 'z-50 relative' : 'z-30'}`}>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 drop-shadow-sm">Your Feed</h1>
                <p className="text-xs text-gray-600 mt-0.5">AI-Curated • Page {currentPage} of {totalPages}</p>
              </div>
              
              <div className="flex gap-3 items-center">
                <div className={`flex items-center rounded-lg p-1 transition-all ${showWelcome ? 'bg-white ring-4 ring-blue-400/50' : 'bg-white/40'}`}
                   style={showWelcome ? { animation: 'pulse 2s infinite' } : {}}
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
                        placeholder="Paste Gemini Key..." 
                        className="w-40 text-sm bg-transparent outline-none text-gray-700 placeholder-gray-500"
                        value={tempKeyInput}
                        onChange={(e) => setTempKeyInput(e.target.value)}
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

                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleManualRefresh()}
                  className="p-2 bg-black/90 text-white rounded-lg shadow-sm hover:bg-gray-800 transition-all"
                  title="Refresh Feed"
                >
                  <motion.div
                    animate={{ rotate: isRefreshing ? 360 : 0 }}
                    transition={{ duration: 1, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                  >
                    <RefreshCcw size={18} />
                  </motion.div>
                </motion.button>
              </div>
            </div>

            <div className={`px-3 md:px-0 transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`}>
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