import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Post, UserProfile, SystemLog } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS, ALL_TAGS } from './constants';
import { ADDITIONAL_POSTS, EXTRA_TAGS } from './constants2'; // Import new data
import { ADDITIONAL_POSTS_3 } from './constants3'; // Import filled gap data
import { rankPosts } from './services/recommendationEngine';
import { analyzeFeedback } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowUp, Key, Check, RefreshCcw, ArrowLeft, ArrowRight, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ITEMS_PER_PAGE = 30;

// Merge data sources at initialization
const COMBINED_POSTS = [...MOCK_POSTS, ...ADDITIONAL_POSTS, ...ADDITIONAL_POSTS_3];
const COMBINED_TAGS = [...ALL_TAGS, ...EXTRA_TAGS];

const App: React.FC = () => {
  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [allRankedPosts, setAllRankedPosts] = useState<Post[]>([]); // All posts ranked
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  
  // Localization State
  const [language, setLanguage] = useState<'en' | 'zh'>('en');

  // API Key Management (Manual Input)
  const [apiKey, setApiKey] = useState('');
  const [tempKeyInput, setTempKeyInput] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  
  // Interaction State
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Mobile Dashboard State
  const [isMobileDashboardOpen, setIsMobileDashboardOpen] = useState(false);

  // --- Derived State: Tag Pool ---
  // Use the merged tag list so the LLM knows about new vocabulary
  const allAvailableTags = COMBINED_TAGS;

  // --- Derived State: Pagination ---
  const totalPages = Math.ceil(allRankedPosts.length / ITEMS_PER_PAGE);
  const visiblePosts = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return allRankedPosts.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [allRankedPosts, currentPage]);

  // --- Helper: Add Log ---
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

  // --- Initialization ---
  useEffect(() => {
    // Initial ranking with COMBINED_POSTS
    const sorted = rankPosts(COMBINED_POSTS, INITIAL_USER_PROFILE);
    setAllRankedPosts(sorted);
    addLog('RE_RANK', 'Initial Content Load', { top_posts: sorted.slice(0, 3).map(p => p.title.en) });
    
    // Check local storage for key convenience
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setTempKeyInput(savedKey);
      setIsKeySaved(true);
    }
  }, []);

  // --- Handlers ---
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
    setSelectedPost(post);
    setIsModalOpen(true);
  };

  const handleFeedbackSubmit = async (text: string, post: Post) => {
    setIsAnalyzing(true);
    const postTitle = post.title[language];
    addLog('FEEDBACK', 'User provided natural language feedback', { feedback: text, target_post: postTitle });

    // 1. Call LLM
    const analysis = await analyzeFeedback(
      text, 
      `Title: ${postTitle}, Tags: ${post.tags.join(', ')}`,
      apiKey,
      allAvailableTags 
    );
    
    addLog('LLM_ANALYSIS', 'Gemini parsed intent using available tags', analysis);

    // 2. Update Profile Weights
    const currentInterests = [...userProfile.interests];
    const currentDislikes = [...userProfile.dislikes];

    analysis.adjustments.forEach(adj => {
      if (adj.category === 'interest') {
        const existingIdx = currentInterests.findIndex(i => i.tag === adj.tag);
        if (existingIdx >= 0) {
          currentInterests[existingIdx].weight += adj.delta;
          if (currentInterests[existingIdx].weight < 0) currentInterests[existingIdx].weight = 0;
        } else {
          if (adj.delta > 0) {
            currentInterests.push({ tag: adj.tag, weight: adj.delta });
          }
        }
      } else if (adj.category === 'dislike') {
        const existingIdx = currentDislikes.findIndex(d => d.tag === adj.tag);
        if (existingIdx >= 0) {
           currentDislikes[existingIdx].weight += adj.delta;
        } else {
           if (adj.delta > 0) {
             currentDislikes.push({ tag: adj.tag, weight: adj.delta });
           }
        }
      }
    });

    const updatedProfile = {
      ...userProfile,
      interests: currentInterests,
      dislikes: currentDislikes
    };
    
    setUserProfile(updatedProfile);
    addLog('PROFILE_UPDATE', 'Weights Updated', { 
      changes: analysis.adjustments.map(a => `${a.tag} (${a.delta > 0 ? '+' : ''}${a.delta})`),
      note: analysis.user_note 
    });

    // 3. Close Modal & Stop Loading
    setIsAnalyzing(false);
    setIsModalOpen(false);
    setSelectedPost(null);

    // 4. Trigger Re-rank & Reset View
    handleManualRefresh(updatedProfile);
  };

  const handleReset = () => {
    setUserProfile(INITIAL_USER_PROFILE);
    setLogs([]);
    // Reset to COMBINED_POSTS
    const sorted = rankPosts(COMBINED_POSTS, INITIAL_USER_PROFILE);
    setAllRankedPosts(sorted);
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleManualRefresh = (profileOverride?: UserProfile) => {
    setIsRefreshing(true);
    // Simulate network delay and calculation
    setTimeout(() => {
       const profileToUse = profileOverride || userProfile;
       // Rank COMBINED_POSTS
       const sorted = rankPosts(COMBINED_POSTS, profileToUse);
       setAllRankedPosts([...sorted]); 
       setCurrentPage(1); // Reset to first page on refresh
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
    <div className="min-h-screen bg-[#f3f4f6] text-gray-900 font-sans">
      <div className="max-w-7xl mx-auto px-0 md:px-6 py-0 md:py-8">
        
        {/* --- Mobile/Tablet Header (Sticky) --- */}
        {/* Shows on screens smaller than lg (1024px) */}
        <div className="lg:hidden sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b shadow-sm transition-all">
          <div className="px-4 py-3">
            <div className="flex justify-between items-center mb-2">
              <motion.h1 
                whileTap={{ scale: 0.95 }}
                onClick={() => handleManualRefresh()} 
                className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 cursor-pointer select-none"
              >
                NeuroFeed
              </motion.h1>
              <div className="flex gap-2">
                 {/* Lang Toggle */}
                 <motion.button 
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                   className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xs font-bold shadow-sm"
                 >
                   {language === 'en' ? 'ZH' : 'EN'}
                 </motion.button>
                 {/* Refresh */}
                 <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleManualRefresh()}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 shadow-sm"
                 >
                   <motion.div
                     animate={{ rotate: isRefreshing ? 360 : 0 }}
                     transition={{ duration: 1, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                   >
                      <RefreshCcw size={16} />
                   </motion.div>
                 </motion.button>

                 {/* Mobile Dashboard Toggle */}
                 <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setIsMobileDashboardOpen(!isMobileDashboardOpen)}
                    className={`w-8 h-8 flex items-center justify-center rounded-full shadow-sm transition-colors ${isMobileDashboardOpen ? 'bg-black text-white' : 'bg-gray-100 text-gray-800'}`}
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
                          <X size={18} />
                        </motion.div>
                      ) : (
                        <motion.div 
                          key="menu"
                          initial={{ rotate: 90, opacity: 0 }}
                          animate={{ rotate: 0, opacity: 1 }}
                          exit={{ rotate: -90, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Menu size={18} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                 </motion.button>
              </div>
            </div>
            
            {/* Mobile Key Input */}
            <div className="flex gap-2 items-center">
              {!isKeySaved ? (
                <>
                  <input 
                    type="password" 
                    placeholder="API Key..." 
                    className="flex-1 bg-gray-100 border-none rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={tempKeyInput}
                    onChange={(e) => setTempKeyInput(e.target.value)}
                  />
                  <motion.button 
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSaveKey} 
                    className="bg-black text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                  >
                    Save
                  </motion.button>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-between bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                  <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                    <Check size={12} /> API Connected
                  </span>
                  <motion.button 
                    whileTap={{ scale: 0.95 }}
                    onClick={handleClearKey} 
                    className="text-[10px] text-gray-400 underline"
                  >
                    Unlink
                  </motion.button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Dashboard Dropdown (Drawer) */}
          <AnimatePresence>
            {isMobileDashboardOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="overflow-hidden bg-gray-50 border-t border-gray-200 shadow-inner"
              >
                <div className="p-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  <Dashboard 
                     userProfile={userProfile} 
                     logs={logs} 
                     onReset={handleReset}
                     className="space-y-6" // Override sticky behavior for mobile
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT: Feed Column (Span 7 on desktop, full width on mobile) */}
          <div className="lg:col-span-7 xl:col-span-7 pb-20 md:pb-10">
            {/* Desktop Header (Only visible on lg+) */}
            <div className="hidden lg:flex items-center justify-between mb-6 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 sticky top-6 z-30">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Your Feed</h1>
                <p className="text-xs text-gray-500 mt-0.5">AI-Curated • Page {currentPage} of {totalPages}</p>
              </div>
              
              <div className="flex gap-3 items-center">
                {/* Language Toggle */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                   <motion.button 
                     whileTap={{ scale: 0.95 }}
                     onClick={() => setLanguage('en')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'en' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                   >
                     EN
                   </motion.button>
                   <motion.button 
                     whileTap={{ scale: 0.95 }}
                     onClick={() => setLanguage('zh')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'zh' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                   >
                     中文
                   </motion.button>
                </div>

                {/* Desktop API Key */}
                <div className="relative">
                  {!isKeySaved ? (
                    <div className="flex items-center gap-2 bg-gray-50 p-1 pl-3 rounded-lg border border-gray-200">
                      <Key size={14} className="text-gray-400" />
                      <input 
                        type="password" 
                        placeholder="Paste Gemini Key..." 
                        className="w-40 text-sm bg-transparent outline-none text-gray-600 placeholder-gray-400"
                        value={tempKeyInput}
                        onChange={(e) => setTempKeyInput(e.target.value)}
                      />
                      <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleSaveKey}
                        className="bg-black text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-gray-800"
                      >
                        Save
                      </motion.button>
                    </div>
                  ) : (
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleClearKey}
                      className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg border border-green-200 text-xs font-bold hover:bg-green-100 transition-colors"
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
                  className="p-2 bg-black text-white rounded-lg shadow-sm hover:bg-gray-800 transition-all"
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

            {/* Content Feed with Animation */}
            <div className={`px-3 md:px-0 transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`}>
              <AnimatePresence mode="popLayout">
                {visiblePosts.map((post) => (
                  <motion.div
                    key={post.id}
                    layout="position"
                    initial={{ opacity: 0, y: 30, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  >
                    <PostCard 
                      post={post} 
                      language={language}
                      onNotInterested={handleNotInterestedClick} 
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {visiblePosts.length === 0 && (
                 <div className="text-center py-20 text-gray-400">
                   No posts match your criteria. Try resetting.
                 </div>
              )}
              
              {/* Pagination Controls */}
              <div className="py-8 flex flex-col items-center justify-center gap-4">
                 <div className="flex items-center gap-4 bg-white p-2 rounded-xl shadow-sm border border-gray-100">
                    <motion.button 
                      whileHover={{ scale: 1.1, x: -2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Previous Page"
                    >
                      <ArrowLeft size={20} />
                    </motion.button>
                    
                    <span className="text-sm font-medium text-gray-600 px-2 min-w-[100px] text-center">
                      Page {currentPage} of {totalPages}
                    </span>

                    <motion.button 
                      whileHover={{ scale: 1.1, x: 2 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Next Page"
                    >
                      <ArrowRight size={20} />
                    </motion.button>
                 </div>

                 {currentPage > 3 && (
                   <motion.button 
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                   >
                     <ArrowUp size={12} /> Back to Top
                   </motion.button>
                 )}
              </div>
            </div>
          </div>

          {/* RIGHT: Dashboard Column (Hidden on mobile/tablet portrait, Visible on Desktop lg+) */}
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