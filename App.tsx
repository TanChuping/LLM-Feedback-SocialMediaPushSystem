import React, { useState, useEffect, useMemo } from 'react';
import { Post, UserProfile, SystemLog } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS } from './constants';
import { rankPosts } from './services/recommendationEngine';
import { analyzeFeedback } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowDown, Key, Check, ChevronLeft, ChevronRight, Globe } from 'lucide-react';

const POSTS_PER_PAGE = 15;

const App: React.FC = () => {
  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [posts, setPosts] = useState<Post[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  // Localization State
  const [language, setLanguage] = useState<'en' | 'zh'>('en');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  
  // API Key Management (Manual Input)
  const [apiKey, setApiKey] = useState('');
  const [tempKeyInput, setTempKeyInput] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  
  // Interaction State
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // --- Derived State: Tag Pool ---
  // Create a master list of all unique tags available in the system
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
    setPosts(sorted);
    addLog('RE_RANK', 'Initial Content Load', { top_posts: sorted.slice(0, 3).map(p => p.title.en) });
    
    // Check local storage for key convenience
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setTempKeyInput(savedKey);
      setIsKeySaved(true);
    }
  }, []);

  // --- Pagination Logic ---
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const visiblePosts = posts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  );

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

    // 1. Call LLM (Pass the Tag Pool!)
    // We pass the content context in the current language so the user intent matches what they read.
    const analysis = await analyzeFeedback(
      text, 
      `Title: ${postTitle}, Tags: ${post.tags.join(', ')}`,
      apiKey,
      allAvailableTags // Pass the pool
    );
    
    addLog('LLM_ANALYSIS', 'Gemini parsed intent using available tags', analysis);

    // 2. Update Profile Weights
    const currentInterests = [...userProfile.interests];
    const currentDislikes = [...userProfile.dislikes];

    analysis.adjustments.forEach(adj => {
      if (adj.category === 'interest') {
        // Try to find existing tag
        const existingIdx = currentInterests.findIndex(i => i.tag === adj.tag);
        if (existingIdx >= 0) {
          currentInterests[existingIdx].weight += adj.delta;
          // Clamp to 0
          if (currentInterests[existingIdx].weight < 0) currentInterests[existingIdx].weight = 0;
        } else {
          // Add new interest
          if (adj.delta > 0) {
            currentInterests.push({ tag: adj.tag, weight: adj.delta });
          }
        }
      } else if (adj.category === 'dislike') {
        // Try to find existing tag
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

    // 4. Trigger Re-rank
    setIsRefreshing(true);
    setTimeout(() => {
      const reRankedPosts = rankPosts(MOCK_POSTS, updatedProfile);
      setPosts(reRankedPosts);
      // Reset to page 1 to show the best results immediately
      setCurrentPage(1); 
      setIsRefreshing(false);
      addLog('RE_RANK', 'Feed Updated & Reset to Page 1', { 
        demoted_count: reRankedPosts.filter(p => p.score! < 0).length,
        top_recommendation: reRankedPosts[0].title[language]
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 800);
  };

  const handleReset = () => {
    setUserProfile(INITIAL_USER_PROFILE);
    setLogs([]);
    const sorted = rankPosts(MOCK_POSTS, INITIAL_USER_PROFILE);
    setPosts(sorted);
    setCurrentPage(1);
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
       const sorted = rankPosts(posts, userProfile);
       setPosts([...sorted]); 
       setIsRefreshing(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        
        {/* Top Header Mobile */}
        <div className="lg:hidden mb-6 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                NeuroFeed
              </h1>
              <p className="text-sm text-gray-500">Adaptive AI Recommendation</p>
            </div>
            {/* Language Toggle Mobile */}
            <div className="flex items-center bg-white rounded-lg border p-1">
               <button 
                 onClick={() => setLanguage('en')}
                 className={`px-3 py-1 text-xs rounded-md transition-all ${language === 'en' ? 'bg-black text-white' : 'text-gray-500'}`}
               >
                 EN
               </button>
               <button 
                 onClick={() => setLanguage('zh')}
                 className={`px-3 py-1 text-xs rounded-md transition-all ${language === 'zh' ? 'bg-black text-white' : 'text-gray-500'}`}
               >
                 中文
               </button>
            </div>
          </div>
          {/* Mobile Key Input */}
          <div className="flex gap-2">
            {!isKeySaved ? (
              <>
                <input 
                  type="text" 
                  placeholder="Paste API Key here..." 
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  value={tempKeyInput}
                  onChange={(e) => setTempKeyInput(e.target.value)}
                />
                <button onClick={handleSaveKey} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">Save</button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 px-3 py-1 rounded border border-green-200 w-full">
                <Check size={14} /> Key Saved
                <button onClick={handleClearKey} className="ml-auto text-xs text-gray-400 underline">Change</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT: Feed Column */}
          <div className="lg:col-span-7 xl:col-span-7 pb-10">
            {/* Header Desktop */}
            <div className="hidden lg:flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">For You</h1>
                <p className="text-gray-500">Curated based on your evolving interests</p>
              </div>
              
              <div className="flex gap-3 items-center">
                
                {/* Language Toggle Desktop */}
                <div className="flex items-center bg-white rounded-full border p-1 shadow-sm mr-2">
                   <Globe size={14} className="ml-2 text-gray-400" />
                   <div className="flex ml-2">
                      <button 
                        onClick={() => setLanguage('en')}
                        className={`px-3 py-1 text-xs rounded-full transition-all ${language === 'en' ? 'bg-black text-white font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        English
                      </button>
                      <button 
                        onClick={() => setLanguage('zh')}
                        className={`px-3 py-1 text-xs rounded-full transition-all ${language === 'zh' ? 'bg-black text-white font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        中文
                      </button>
                   </div>
                </div>

                {/* Desktop API Key Input Area */}
                <div className="mr-2">
                  {!isKeySaved ? (
                    <div className="flex items-center gap-2 bg-white p-1 pl-3 rounded-full border shadow-sm">
                      <Key size={14} className="text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Paste Gemini API Key..." 
                        className="w-48 text-sm outline-none text-gray-600"
                        value={tempKeyInput}
                        onChange={(e) => setTempKeyInput(e.target.value)}
                      />
                      <button 
                        onClick={handleSaveKey}
                        className="bg-black text-white px-3 py-1.5 rounded-full text-xs font-medium hover:bg-gray-800"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={handleClearKey}
                      className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-200 text-xs font-medium hover:bg-green-100 transition-colors"
                    >
                      <Check size={14} />
                      API Key Connected
                    </button>
                  )}
                </div>

                <button 
                  onClick={handleManualRefresh}
                  className="p-2 bg-white rounded-full shadow-sm border hover:bg-gray-50 active:scale-95 transition-all"
                >
                  <ArrowDown size={20} className={isRefreshing ? 'animate-bounce' : ''} />
                </button>
              </div>
            </div>

            {/* Feed List */}
            <div className={`space-y-6 transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`}>
              {visiblePosts.map((post) => (
                <PostCard 
                  key={post.id} 
                  post={post} 
                  language={language}
                  onNotInterested={handleNotInterestedClick} 
                />
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center mt-10 gap-4">
                <button 
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-full border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
                
                <span className="text-sm font-medium text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>

                <button 
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-full border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
            
            <div className="text-center py-6 text-gray-300 text-xs">
              Showing {visiblePosts.length} of {posts.length} posts
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