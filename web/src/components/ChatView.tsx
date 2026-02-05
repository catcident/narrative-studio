/**
 * 소설 채팅 컴포넌트
 * 지식 그래프와 원본 텍스트를 기반으로 소설에 대해 대화
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Trash2, Settings, ChevronDown, History, Plus, X, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useStore, useModels } from '../store';
import { sendChatMessage, generateMessageId, type ChatMessage } from '../services/chat';
import { DEFAULT_MODEL } from '../types';

// 대화 세션 타입
interface ChatSession {
  id: string;
  graphId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;  // 첫 메시지 미리보기
}

// 대화 세션 저장소 키
const CHAT_SESSIONS_KEY = 'chat_sessions';

// 대화 세션 ID 생성
const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// 채팅 내역 저장 키
const getChatStorageKey = (sessionId: string) => `chat_messages_${sessionId}`;

// 세션 목록 가져오기
const getChatSessions = (): ChatSession[] => {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem(CHAT_SESSIONS_KEY);
  if (!saved) return [];
  try {
    return JSON.parse(saved);
  } catch {
    return [];
  }
};

// 세션 목록 저장
const saveChatSessions = (sessions: ChatSession[]) => {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
};

// 그래프 식별자 생성 (id 우선, 없으면 title 해시)
const getGraphIdentifier = (id?: string, title?: string): string => {
  if (id) return id;
  if (title) return `title_${title.replace(/\s+/g, '_').slice(0, 50)}`;
  return 'unknown';
};

// 특정 그래프의 세션 목록
const getSessionsForGraph = (graphId: string): ChatSession[] => {
  return getChatSessions().filter(s => s.graphId === graphId);
};

// 세션 생성
const createSession = (graphId: string, graphTitle: string): ChatSession => {
  const session: ChatSession = {
    id: generateSessionId(),
    graphId,
    title: `대화 ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    preview: '',
  };
  const sessions = getChatSessions();
  sessions.unshift(session);
  saveChatSessions(sessions);
  return session;
};

// 세션 업데이트
const updateSession = (sessionId: string, messages: ChatMessage[]) => {
  const sessions = getChatSessions();
  const idx = sessions.findIndex(s => s.id === sessionId);
  if (idx >= 0) {
    sessions[idx].updatedAt = new Date().toISOString();
    sessions[idx].messageCount = messages.length;
    const firstUserMsg = messages.find(m => m.role === 'user');
    sessions[idx].preview = firstUserMsg?.content.slice(0, 50) || '';
    // 최근 업데이트 순으로 정렬
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    saveChatSessions(sessions);
  }
};

// 세션 삭제
const deleteSession = (sessionId: string) => {
  const sessions = getChatSessions().filter(s => s.id !== sessionId);
  saveChatSessions(sessions);
  localStorage.removeItem(getChatStorageKey(sessionId));
};

/**
 * 텍스트에서 언급된 엔티티 ID 추출
 */
function extractMentionedEntities(
  text: string,
  entities: Record<string, { name: string; aliases?: string[] }>
): string[] {
  const mentioned = new Set<string>();
  const textLower = text.toLowerCase();

  Object.entries(entities).forEach(([id, entity]) => {
    // 이름으로 검색
    if (textLower.includes(entity.name.toLowerCase())) {
      mentioned.add(id);
    }
    // 별칭으로 검색
    entity.aliases?.forEach(alias => {
      if (textLower.includes(alias.toLowerCase())) {
        mentioned.add(id);
      }
    });
  });

  return Array.from(mentioned);
}

export function ChatView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const originalText = useStore((s) => s.originalText);
  const setChatMentionedEntities = useStore((s) => s.setChatMentionedEntities);
  const models = useModels();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 그래프 식별자
  const graphIdentifier = knowledgeGraph
    ? getGraphIdentifier(knowledgeGraph.metadata.id, knowledgeGraph.metadata.title)
    : null;

  // 세션 목록 로드
  const loadSessions = useCallback(() => {
    if (!graphIdentifier) return;
    const graphSessions = getSessionsForGraph(graphIdentifier);
    setSessions(graphSessions);
  }, [graphIdentifier]);

  // 세션 메시지 로드
  const loadSessionMessages = useCallback((session: ChatSession) => {
    const storageKey = getChatStorageKey(session.id);
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const restored = parsed.map((m: ChatMessage & { timestamp: string }) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
        setMessages(restored);

        // 마지막 AI 답변에서 언급된 엔티티 복원
        if (knowledgeGraph) {
          const lastAssistant = [...restored].reverse().find((m: ChatMessage) => m.role === 'assistant');
          if (lastAssistant) {
            const mentionedIds = extractMentionedEntities(lastAssistant.content, knowledgeGraph.entities);
            setChatMentionedEntities(mentionedIds);
          }
        }
        return restored;
      } catch {
        return [];
      }
    }
    return [];
  }, [knowledgeGraph, setChatMentionedEntities]);

  // 지식 그래프 변경 시: 가장 최근 세션 로드 또는 새 세션 생성
  useEffect(() => {
    if (!graphIdentifier || !knowledgeGraph) return;

    loadSessions();
    const graphSessions = getSessionsForGraph(graphIdentifier);

    if (graphSessions.length > 0) {
      // 가장 최근 세션 로드
      const latestSession = graphSessions[0];
      setCurrentSession(latestSession);
      loadSessionMessages(latestSession);
    } else {
      // 새 세션 생성
      const newSession = createSession(graphIdentifier, knowledgeGraph.metadata.title);
      setCurrentSession(newSession);
      setMessages([]);
      setChatMentionedEntities([]);
      loadSessions();
    }
  }, [graphIdentifier, knowledgeGraph?.metadata.title]);

  // 메시지 변경 시 저장
  useEffect(() => {
    if (!currentSession || messages.length === 0) return;
    const storageKey = getChatStorageKey(currentSession.id);
    localStorage.setItem(storageKey, JSON.stringify(messages));
    updateSession(currentSession.id, messages);
    loadSessions();
  }, [messages, currentSession?.id]);

  // 자동 스크롤
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // 메시지 전송
  const handleSend = async () => {
    if (!input.trim() || isLoading || !knowledgeGraph) return;

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      const allMessages = [...messages, userMessage];
      let fullResponse = '';

      await sendChatMessage(
        allMessages,
        { knowledgeGraph, originalText: originalText || undefined },
        selectedModel,
        (chunk) => {
          fullResponse += chunk;
          setStreamingContent(fullResponse);
        },
        knowledgeGraph.metadata.id  // graphId 전달 (임베딩 검색용)
      );

      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent('');

      // 답변에서 언급된 엔티티 추출하여 store에 저장
      const mentionedIds = extractMentionedEntities(fullResponse, knowledgeGraph.entities);
      setChatMentionedEntities(mentionedIds);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Enter로 전송 (Shift+Enter는 줄바꿈)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 현재 대화 초기화 (내용만 삭제)
  const handleClear = () => {
    if (messages.length === 0) return;
    if (confirm('현재 대화 내용을 모두 삭제하시겠습니까?')) {
      setMessages([]);
      setChatMentionedEntities([]);
      if (currentSession) {
        localStorage.removeItem(getChatStorageKey(currentSession.id));
        updateSession(currentSession.id, []);
        loadSessions();
      }
    }
  };

  // 새 대화 시작
  const handleNewChat = () => {
    if (!graphIdentifier || !knowledgeGraph) return;
    const newSession = createSession(graphIdentifier, knowledgeGraph.metadata.title);
    setCurrentSession(newSession);
    setMessages([]);
    setChatMentionedEntities([]);
    loadSessions();
    setShowHistoryPanel(false);
  };

  // 대화 세션 선택
  const handleSelectSession = (session: ChatSession) => {
    setCurrentSession(session);
    loadSessionMessages(session);
    setShowHistoryPanel(false);
  };

  // 대화 세션 삭제
  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;

    deleteSession(sessionId);
    loadSessions();

    // 현재 세션이 삭제된 경우
    if (currentSession?.id === sessionId) {
      const remaining = getSessionsForGraph(graphIdentifier || '');
      if (remaining.length > 0) {
        setCurrentSession(remaining[0]);
        loadSessionMessages(remaining[0]);
      } else if (knowledgeGraph && graphIdentifier) {
        // 새 세션 생성
        const newSession = createSession(graphIdentifier, knowledgeGraph.metadata.title);
        setCurrentSession(newSession);
        setMessages([]);
        setChatMentionedEntities([]);
        loadSessions();
      }
    }
  };

  // 모델 정보 가져오기
  const currentModel = models.find(m => m.id === selectedModel) || models[0];

  if (!knowledgeGraph) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">소설을 먼저 분석해주세요</p>
          <p className="text-sm">분석된 소설에 대해 질문할 수 있습니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 헤더 */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              소설 채팅
            </h2>
            <p className="text-xs text-gray-500">
              "{knowledgeGraph.metadata.title}"에 대해 질문하세요
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* 모델 선택 */}
            <div className="relative">
              <button
                onClick={() => setShowModelSelect(!showModelSelect)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span className="max-w-[120px] truncate">{currentModel.name}</span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {showModelSelect && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="p-2 border-b border-gray-100">
                    <span className="text-xs text-gray-500">모델 선택</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {models.map(model => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setShowModelSelect(false);
                        }}
                        className={`w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${
                          model.id === selectedModel ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div>
                          <div className="text-sm font-medium">{model.name}</div>
                          <div className="text-xs text-gray-500">{model.description}</div>
                        </div>
                        {model.id === selectedModel && (
                          <span className="text-blue-500 text-xs">선택됨</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 대화 기록 */}
            <button
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                showHistoryPanel
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title="대화 기록"
            >
              <History className="w-4 h-4" />
              <span>기록</span>
              {sessions.length > 1 && (
                <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded-full">
                  {sessions.length}
                </span>
              )}
            </button>

            {/* 대화 초기화 */}
            <button
              onClick={handleClear}
              disabled={messages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="대화 초기화"
            >
              <Trash2 className="w-4 h-4" />
              <span>초기화</span>
            </button>
          </div>
        </div>
      </div>

      {/* 대화 기록 패널 */}
      {showHistoryPanel && (
        <div className="flex-shrink-0 bg-gray-50 border-b border-gray-200 max-h-64 overflow-y-auto">
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">대화 기록</span>
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                새 대화
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">
                저장된 대화가 없습니다
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors group ${
                      currentSession?.id === session.id
                        ? 'bg-blue-100 border border-blue-200'
                        : 'bg-white border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {session.preview || session.title}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6">
                        {session.messageCount}개 메시지 · {new Date(session.updatedAt).toLocaleDateString('ko-KR')}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="삭제"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <div className="text-center text-gray-500 py-8">
            <p className="mb-4">소설에 대해 무엇이든 물어보세요!</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                '주인공은 누구야?',
                '등장인물들 관계 설명해줘',
                '이 소설의 주제는 뭐야?',
                '가장 중요한 장면은?',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setInput(suggestion)}
                  className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* 스트리밍 중인 응답 */}
        {streamingContent && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              AI
            </div>
            <div className="flex-1 bg-white rounded-2xl rounded-tl-none px-5 py-4 shadow-sm">
              <div className="chat-markdown text-gray-800 leading-relaxed">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
                <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
              </div>
            </div>
          </div>
        )}

        {/* 로딩 표시 (스트리밍 시작 전) */}
        {isLoading && !streamingContent && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white flex-shrink-0">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <div className="bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
              <span className="text-gray-500">생각 중...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            style={{ minHeight: '48px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-400 text-center">
          지식 그래프와 원본 텍스트를 참고하여 답변합니다
        </div>
      </div>

      {/* 모델 선택 드롭다운 외부 클릭 닫기 */}
      {showModelSelect && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowModelSelect(false)}
        />
      )}
    </div>
  );
}

/**
 * 메시지 버블 컴포넌트
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${
          isUser ? 'bg-green-500' : 'bg-blue-500'
        }`}
      >
        {isUser ? '나' : 'AI'}
      </div>
      <div
        className={`flex-1 max-w-[85%] rounded-2xl shadow-sm ${
          isUser
            ? 'bg-green-500 text-white rounded-tr-none px-4 py-3'
            : 'bg-white rounded-tl-none px-5 py-4'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div className="chat-markdown text-gray-800 leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        <div className={`text-xs mt-2 ${isUser ? 'text-green-100' : 'text-gray-400'}`}>
          {message.timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
