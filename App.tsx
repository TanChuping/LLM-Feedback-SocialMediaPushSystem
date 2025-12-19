import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Post, UserProfile, SystemLog } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS } from './constants';
import { rankPosts } from './services/recommendationEngine';
import { analyzeFeedback } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowUp, Key, Check, Globe, RefreshCcw, Loader2 } from 'lucide-react';

const INITIAL_LOAD_COUNT = 10;
const LOAD_MORE_INCREMENT = 10;

const App: React.FC = () => {
  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [allRankedPosts, setAllRankedPosts] = useState<Post[]>([]); // All posts ranked
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD_COUNT); // How many are currently shown
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
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

  // --- Infinite Scroll Ref ---
  const observerTarget = useRef<HTMLDivElement>(null);

  // --- Derived State: Tag Pool ---
  const allAvailableTags = useMemo(() => {
    const tags = new Set<string>();
    MOCK_POSTS.forEach(p => p.tags.forEach(t => tags.add(t)));
    return Array.from(tags);
  }, []);

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
    // Initial ranking
    const sorted = rankPosts(MOCK_POSTS, INITIAL_USER_PROFILE);
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

  // --- Infinite Scroll Logic ---
  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + LOAD_MORE_INCREMENT, allRankedPosts.length));
  }, [allRankedPosts.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !isRefreshing) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [handleLoadMore, isRefreshing]);

  const visiblePosts = allRankedPosts.slice(0, visibleCount);

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
    const sorted = rankPosts(MOCK_POSTS, INITIAL_USER_PROFILE);
    setAllRankedPosts(sorted);
    setVisibleCount(INITIAL_LOAD_COUNT);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleManualRefresh = (profileOverride?: UserProfile) => {
    setIsRefreshing(true);
    // Simulate network delay and calculation
    setTimeout(() => {
       const profileToUse = profileOverride || userProfile;
       const sorted = rankPosts(MOCK_POSTS, profileToUse);
       setAllRankedPosts([...sorted]); 
       setVisibleCount(INITIAL_LOAD_COUNT); // Reset to top
       setIsRefreshing(false);
       addLog('RE_RANK', 'Feed Refreshed', { 
        top_recommendation: sorted[0].title[language]
      });
       window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-gray-900 font-sans">
      <div className="max-w-7xl mx-auto px-0 md:px-6 py-0 md:py-8">
        
        {/* --- Mobile Header (Sticky) --- */}
        <div className="lg:hidden sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b px-4 py-3 shadow-sm transition-all">
          <div className="flex justify-between items-center mb-2">
            <h1 onClick={() => handleManualRefresh()} className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 cursor-pointer select-none">
              NeuroFeed
            </h1>
            <div className="flex gap-2">
               {/* Lang Toggle */}
               <button 
                 onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                 className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xs font-bold"
               >
                 {language === 'en' ? 'ZH' : 'EN'}
               </button>
               {/* Refresh */}
               <button 
                  onClick={() => handleManualRefresh()}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
               >
                 <RefreshCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
               </button>
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
                <button onClick={handleSaveKey} className="bg-black text-white px-3 py-1.5 rounded-lg text-xs font-bold">Save</button>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-between bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                  <Check size={12} /> API Connected
                </span>
                <button onClick={handleClearKey} className="text-[10px] text-gray-400 underline">Unlink</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT: Infinite Feed Column */}
          <div className="lg:col-span-7 xl:col-span-7 pb-20 md:pb-10">
            {/* Desktop Header */}
            <div className="hidden lg:flex items-center justify-between mb-6 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 sticky top-6 z-30">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Your Feed</h1>
                <p className="text-xs text-gray-500 mt-0.5">AI-Curated • {allRankedPosts.length} items</p>
              </div>
              
              <div className="flex gap-3 items-center">
                {/* Language Toggle */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                   <button 
                     onClick={() => setLanguage('en')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'en' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                   >
                     EN
                   </button>
                   <button 
                     onClick={() => setLanguage('zh')}
                     className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${language === 'zh' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                   >
                     中文
                   </button>
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
                      <button 
                        onClick={handleSaveKey}
                        className="bg-black text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-gray-800"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={handleClearKey}
                      className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg border border-green-200 text-xs font-bold hover:bg-green-100 transition-colors"
                    >
                      <Check size={14} />
                      Connected
                    </button>
                  )}
                </div>

                <button 
                  onClick={() => handleManualRefresh()}
                  className="p-2 bg-black text-white rounded-lg shadow-sm hover:bg-gray-800 active:scale-95 transition-all"
                  title="Refresh Feed"
                >
                  <RefreshCcw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Content Feed */}
            <div className={`space-y-4 px-3 md:px-0 transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`}>
              {visiblePosts.map((post) => (
                <PostCard 
                  key={post.id} 
                  post={post} 
                  language={language}
                  onNotInterested={handleNotInterestedClick} 
                />
              ))}
              
              {/* Infinite Scroll Sentinel / Loading State */}
              <div ref={observerTarget} className="py-8 flex justify-center items-center">
                 {visibleCount < allRankedPosts.length ? (
                   <div className="flex items-center gap-2 text-gray-400 text-sm">
                     <Loader2 size={20} className="animate-spin" />
                     <span>Loading more recommendations...</span>
                   </div>
                 ) : (
                   <div className="text-center text-gray-400 text-xs">
                     <div className="mb-2">You've reached the end!</div>
                     <button 
                      onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}
                      className="flex items-center gap-1 mx-auto text-blue-500 hover:text-blue-600"
                     >
                       <ArrowUp size={14} /> Back to Top
                     </button>
                   </div>
                 )}
              </div>
            </div>
          </div>

          {/* RIGHT: Dashboard Column */}
          <div className="lg:col-span-5 xl:col-span-5 hidden lg:block h-full">
             <Dashboard 
               userProfile={userProfile} 
               logs={logs} 
               onReset={handleReset}
             />
          </div>

        </div>
      </div>

      <FeedbackModal 
        isOpen={isModalOpen}
        post={selectedPost}
        language={language}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleFeedbackSubmit}
        isAnalyzing={isAnalyzing}
      />
    </div>
  );
};

export default App;