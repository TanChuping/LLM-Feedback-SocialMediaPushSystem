import React, { useEffect, useRef } from 'react';
import { UserProfile, SystemLog } from '../types';
import { Activity, User, Terminal, Tag, RefreshCcw } from 'lucide-react';

interface DashboardProps {
  userProfile: UserProfile;
  logs: SystemLog[];
  onReset: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, logs, onReset }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="sticky top-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Activity className="text-blue-600" />
          System Internals
        </h2>
        <button 
          onClick={onReset}
          className="text-xs flex items-center gap-1 text-gray-500 hover:text-red-600 transition-colors"
        >
          <RefreshCcw size={14} />
          Reset Demo
        </button>
      </div>

      {/* User Persona Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 border-b border-blue-100 flex items-center gap-3">
          <div className="bg-blue-100 p-2 rounded-full text-blue-600">
             <User size={20} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">{userProfile.name}</h3>
            <p className="text-xs text-blue-600 font-medium">Live User Profile Model</p>
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Interest Vectors (Likes)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {userProfile.likeTags.map(tag => (
                <span key={tag} className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded border border-green-100">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              Negative Filter (Dislikes)
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
              {userProfile.dislikeTags.length === 0 ? (
                <span className="text-xs text-gray-400 italic">No negative filters yet...</span>
              ) : (
                userProfile.dislikeTags.map(tag => (
                  <span key={tag} className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded border border-red-100 animate-in zoom-in duration-300">
                    {tag}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Logs Console */}
      <div className="bg-gray-900 rounded-2xl shadow-lg overflow-hidden flex flex-col h-[400px]">
        <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center gap-2 text-gray-300 text-sm font-mono">
            <Terminal size={16} />
            <span>algorithm_events.log</span>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
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
                <div className="bg-black/30 p-2 rounded text-gray-400 whitespace-pre-wrap break-words">
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
