/**
 * 엔티티 선택 사이드바 컴포넌트
 * 카테고리별로 엔티티를 표시하고 체크박스로 선택 가능
 */

import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { Entity, EntityCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../constants';

// CATEGORY_INFO를 공유 상수에서 조합
const CATEGORY_INFO: Record<EntityCategory, { label: string; color: string }> = Object.fromEntries(
  (Object.keys(CATEGORY_COLORS) as EntityCategory[]).map(cat => [
    cat,
    { label: CATEGORY_LABELS[cat], color: CATEGORY_COLORS[cat] },
  ])
) as Record<EntityCategory, { label: string; color: string }>;

interface Props {
  entities: Entity[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function EntitySelector({ entities, selectedIds, onSelectionChange }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<EntityCategory>>(
    new Set(['character'])
  );

  // 카테고리별로 그룹화 + 등장 횟수로 정렬
  const categorizedEntities = useMemo(() => {
    const grouped: Partial<Record<EntityCategory, Entity[]>> = {};

    entities.forEach(entity => {
      const category = entity.category || 'character';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category]!.push(entity);
    });

    // 각 카테고리 내에서 등장 횟수(scenes 길이)로 정렬
    Object.keys(grouped).forEach(cat => {
      grouped[cat as EntityCategory]!.sort((a, b) => {
        const aCount = a.scenes?.length || 0;
        const bCount = b.scenes?.length || 0;
        return bCount - aCount;
      });
    });

    return grouped;
  }, [entities]);

  // 검색 필터링
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return categorizedEntities;

    const query = searchQuery.toLowerCase();
    const filtered: Partial<Record<EntityCategory, Entity[]>> = {};

    Object.entries(categorizedEntities).forEach(([cat, ents]) => {
      const matches = ents!.filter(e =>
        e.name.toLowerCase().includes(query) ||
        e.aliases?.some(a => a.toLowerCase().includes(query))
      );
      if (matches.length > 0) {
        filtered[cat as EntityCategory] = matches;
      }
    });

    return filtered;
  }, [categorizedEntities, searchQuery]);

  const toggleCategory = (category: EntityCategory) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleEntity = (entityId: string) => {
    if (selectedIds.includes(entityId)) {
      onSelectionChange(selectedIds.filter(id => id !== entityId));
    } else {
      onSelectionChange([...selectedIds, entityId]);
    }
  };

  const selectAllInCategory = (category: EntityCategory) => {
    const categoryEntities = filteredEntities[category] || [];
    const categoryIds = categoryEntities.map(e => e.id);
    const allSelected = categoryIds.every(id => selectedIds.includes(id));

    if (allSelected) {
      // 모두 선택됨 -> 모두 해제
      onSelectionChange(selectedIds.filter(id => !categoryIds.includes(id)));
    } else {
      // 일부 또는 없음 -> 모두 선택
      const newSelection = new Set(selectedIds);
      categoryIds.forEach(id => newSelection.add(id));
      onSelectionChange(Array.from(newSelection));
    }
  };

  // 카테고리 순서 정의
  const categoryOrder: EntityCategory[] = [
    'character', 'location', 'item', 'organization',
    'event', 'concept', 'creature', 'time_period', 'status', 'emotion'
  ];

  const sortedCategories = categoryOrder.filter(cat => filteredEntities[cat]?.length);

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* 검색 */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {selectedIds.length}개 선택됨 / 총 {entities.length}개
        </div>
      </div>

      {/* 선택된 항목 (상단 고정) */}
      {selectedIds.length > 0 && (
        <div className="p-2 border-b border-gray-100 bg-blue-50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-blue-700">선택됨</span>
            <button
              onClick={() => onSelectionChange([])}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              초기화
            </button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {selectedIds.map(id => {
              const entity = entities.find(e => e.id === id);
              if (!entity) return null;
              const info = CATEGORY_INFO[entity.category] || CATEGORY_INFO.character;
              return (
                <button
                  key={id}
                  onClick={() => toggleEntity(id)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-xs rounded text-white"
                  style={{ backgroundColor: info.color }}
                >
                  {entity.name}
                  <span className="opacity-70">×</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 카테고리별 목록 */}
      <div className="flex-1 overflow-y-auto">
        {sortedCategories.map(category => {
          const info = CATEGORY_INFO[category];
          const categoryEntities = filteredEntities[category] || [];
          const isExpanded = expandedCategories.has(category);
          const selectedCount = categoryEntities.filter(e => selectedIds.includes(e.id)).length;
          const allSelected = selectedCount === categoryEntities.length && categoryEntities.length > 0;

          return (
            <div key={category} className="border-b border-gray-100">
              {/* 카테고리 헤더 */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: info.color }}
                  />
                  <span className="text-sm font-medium text-gray-700">{info.label}</span>
                  <span className="text-xs text-gray-400">({categoryEntities.length})</span>
                </div>
                {selectedCount > 0 && (
                  <span className="text-xs text-blue-600 font-medium">
                    {selectedCount}
                  </span>
                )}
              </button>

              {/* 카테고리 내 엔티티 목록 */}
              {isExpanded && (
                <div className="pb-2">
                  {/* 전체 선택/해제 */}
                  <button
                    onClick={() => selectAllInCategory(category)}
                    className="w-full flex items-center gap-2 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                      allSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {allSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    전체 {allSelected ? '해제' : '선택'}
                  </button>

                  {/* 엔티티 목록 */}
                  {categoryEntities.map(entity => {
                    const isSelected = selectedIds.includes(entity.id);
                    const sceneCount = entity.scenes?.length || 0;

                    return (
                      <button
                        key={entity.id}
                        onClick={() => toggleEntity(entity.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 ${
                          isSelected ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`text-sm truncate flex-1 ${
                          isSelected ? 'text-blue-700 font-medium' : 'text-gray-700'
                        }`}>
                          {entity.name}
                        </span>
                        {sceneCount > 0 && (
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {sceneCount}회
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
