/**
 * 채팅에서 언급된 엔티티 패널
 * 채팅 답변에서 언급된 인물/엔티티 목록 표시
 */

import { User, MapPin, Building, Sword, Clock, Zap, Info, Heart, MessageCircle } from 'lucide-react';
import { useStore } from '../store';
import type { EntityCategory, Entity } from '../types';

// 카테고리 아이콘
const CATEGORY_ICONS: Record<EntityCategory, any> = {
  character: User,
  location: MapPin,
  organization: Building,
  item: Sword,
  creature: Zap,
  event: Clock,
  concept: Info,
  time_period: Clock,
  status: Info,
  emotion: Heart,
};

const CATEGORY_LABELS: Record<EntityCategory, string> = {
  character: '인물',
  location: '장소',
  organization: '조직',
  item: '아이템',
  creature: '생물',
  event: '사건',
  concept: '개념',
  time_period: '시간',
  status: '상태',
  emotion: '감정',
};

const CATEGORY_COLORS: Record<EntityCategory, string> = {
  character: 'bg-blue-500',
  location: 'bg-green-500',
  organization: 'bg-purple-500',
  item: 'bg-amber-500',
  creature: 'bg-red-500',
  event: 'bg-pink-500',
  concept: 'bg-indigo-500',
  time_period: 'bg-teal-500',
  status: 'bg-slate-500',
  emotion: 'bg-rose-500',
};

export function ChatMentionedPanel() {
  const { knowledgeGraph, chatMentionedEntities, selectEntity } = useStore();

  // 언급된 엔티티 목록 가져오기
  const mentionedEntities: Entity[] = chatMentionedEntities
    .map(id => knowledgeGraph?.entities[id])
    .filter((e): e is Entity => !!e);

  // 카테고리별로 그룹화
  const groupedEntities = mentionedEntities.reduce((acc, entity) => {
    const category = entity.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(entity);
    return acc;
  }, {} as Record<EntityCategory, Entity[]>);

  if (mentionedEntities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-white text-gray-400 p-6">
        <div className="text-center">
          <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">채팅에서 질문하면</p>
          <p className="text-sm">답변에 등장한 인물/엔티티가</p>
          <p className="text-sm">여기에 표시됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-gray-800">
            답변에서 언급된 항목
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {mentionedEntities.length}개의 엔티티가 언급됨
        </p>
      </div>

      {/* 엔티티 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(groupedEntities).map(([category, entities]) => {
          const Icon = CATEGORY_ICONS[category as EntityCategory] || Info;
          const label = CATEGORY_LABELS[category as EntityCategory] || category;
          const color = CATEGORY_COLORS[category as EntityCategory] || 'bg-gray-500';

          return (
            <div key={category}>
              {/* 카테고리 헤더 */}
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1 rounded ${color} text-white`}>
                  <Icon className="w-3 h-3" />
                </div>
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {label} ({entities.length})
                </span>
              </div>

              {/* 엔티티 목록 */}
              <div className="space-y-2">
                {entities.map(entity => (
                  <button
                    key={entity.id}
                    onClick={() => selectEntity(entity.id)}
                    className="w-full p-3 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{entity.name}</span>
                      {entity.aliases && entity.aliases.length > 0 && (
                        <span className="text-xs text-gray-400">
                          ({entity.aliases[0]})
                        </span>
                      )}
                    </div>
                    {entity.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {entity.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
