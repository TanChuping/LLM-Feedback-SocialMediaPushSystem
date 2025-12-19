import React, { useState, useEffect } from 'react';
import { Post, UserProfile, SystemLog } from './types';
import { INITIAL_USER_PROFILE, MOCK_POSTS } from './constants';
import { rankPosts } from './services/recommendationEngine';
import { analyzeFeedback } from './services/geminiService';
import { PostCard } from './components/PostCard';
import { FeedbackModal } from './components/FeedbackModal';
import { Dashboard } from './components/Dashboard';
import { ArrowDown, Key, Check } from 'lucide-react';

const App: React.FC = () => {
  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [posts, setPosts] = useState<Post[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  // API Key Management (Manual Input)
  const [apiKey, setApiKey] = useState('');
  const [tempKeyInput, setTempKeyInput] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  
  // Interaction State
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    addLog('RE_RANK', 'Initial Content Load', { top_posts: sorted.slice(0, 3).map(p => p.title) });
    
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
    addLog('FEEDBACK', 'User provided natural language feedback', { feedback: text, target_post: post.title });

    // 1. Call LLM (Pass the manually entered API Key)
    const analysis = await analyzeFeedback(
      text, 
      `Title: ${post.title}, Tags: ${post.tags.join(', ')}`,
      apiKey // <--- PASSING KEY HERE
    );
    
    addLog('LLM_ANALYSIS', 'Gemini parsed intent', analysis);

    // 2. Update Profile
    const updatedProfile = {
      ...userProfile,
      dislikeTags: [...Array.from(new Set([...userProfile.dislikeTags, ...analysis.dislike_tags]))]
    };
    
    setUserProfile(updatedProfile);
    addLog('PROFILE_UPDATE', 'User Profile Adjusted', { 
      new_dislikes: analysis.dislike_tags,
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
      setIsRefreshing(false);
      addLog('RE_RANK', 'Feed Updated based on new profile', { 
        demoted_count: reRankedPosts.filter(p => p.score! < 0).length,
        top_recommendation: reRankedPosts[0].title
      });
    }, 800);
  };

  const handleReset = () => {
    setUserProfile(INITIAL_USER_PROFILE);
    setLogs([]);
    const sorted = rankPosts(MOCK_POSTS, INITIAL_USER_PROFILE);
    setPosts(sorted);
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
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
              NeuroFeed
            </h1>
            <p className="text-sm text-gray-500">Adaptive AI Recommendation Demo</p>
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
          <div className="lg:col-span-7 xl:col-span-7">
            {/* Header Desktop */}
            <div className="hidden lg:flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">For You</h1>
                <p className="text-gray-500">Curated based on your evolving interests</p>
              </div>
              <div className="flex gap-3 items-center">
                
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
              {posts.map((post) => (
                <PostCard 
                  key={post.id} 
                  post={post} 
                  onNotInterested={handleNotInterestedClick} 
                />
              ))}
            </div>
            
            <div className="text-center py-10 text-gray-400 text-sm">
              You've reached the end of the demo feed.
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
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleFeedbackSubmit}
        isAnalyzing={isAnalyzing}
      />
    </div>
  );
};

export default App;