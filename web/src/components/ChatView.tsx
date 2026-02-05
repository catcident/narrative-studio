/**
 * 소설 채팅 컴포넌트
 * 지식 그래프와 원본 텍스트를 기반으로 소설에 대해 대화
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Trash2, Settings, ChevronDown } from 'lucide-react';
import { useStore } from '../store';
import { sendChatMessage, generateMessageId, type ChatMessage } from '../services/chat';
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../types';

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
  const { knowledgeGraph, originalText, setChatMentionedEntities } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        { knowledgeGraph, originalText },
        selectedModel,
        (chunk) => {
          fullResponse += chunk;
          setStreamingContent(fullResponse);
        }
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

  // 대화 초기화
  const handleClear = () => {
    if (messages.length === 0) return;
    if (confirm('대화 내용을 모두 삭제하시겠습니까?')) {
      setMessages([]);
    }
  };

  // 모델 정보 가져오기
  const currentModel = AVAILABLE_MODELS.find(m => m.id === selectedModel) || AVAILABLE_MODELS[0];

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
                    {AVAILABLE_MODELS.map(model => (
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

            {/* 대화 초기화 */}
            <button
              onClick={handleClear}
              disabled={messages.length === 0}
              className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="대화 초기화"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

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
            <div className="flex-1 bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                {streamingContent}
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
        className={`flex-1 max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? 'bg-green-500 text-white rounded-tr-none'
            : 'bg-white rounded-tl-none'
        }`}
      >
        <div className={`prose prose-sm max-w-none whitespace-pre-wrap ${isUser ? 'prose-invert' : ''}`}>
          {message.content}
        </div>
        <div className={`text-xs mt-1 ${isUser ? 'text-green-100' : 'text-gray-400'}`}>
          {message.timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
