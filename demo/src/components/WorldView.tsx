/**
 * 세계관 뷰 컴포넌트
 * 장소, 조직, 개념/세계관 설정을 체계적으로 보여줌
 */

import { useState, useMemo } from 'react';
import { MapPin, Building, Lightbulb, ChevronRight, ChevronDown, Package, Globe, Filter, Star, Link2 } from 'lucide-react';
import { useStore } from '../store';
import type { Entity, HyperEdge } from '../types';

type WorldTab = 'locations' | 'organizations' | 'concepts' | 'items';

const TAB_CONFIG: { id: WorldTab; label: string; icon: typeof MapPin; color: string; gradient: string; emoji: string }[] = [
  { id: 'locations', label: '장소', icon: MapPin, color: '#22c55e', gradient: 'from-green-500 to-emerald-600', emoji: '📍' },
  { id: 'organizations', label: '조직', icon: Building, color: '#a855f7', gradient: 'from-purple-500 to-violet-600', emoji: '🏢' },
  { id: 'concepts', label: '세계관', icon: Lightbulb, color: '#6366f1', gradient: 'from-indigo-500 to-blue-600', emoji: '💡' },
  { id: 'items', label: '아이템', icon: Package, color: '#f59e0b', gradient: 'from-amber-500 to-orange-600', emoji: '📦' },
];

interface TreeNode {
  entity: Entity;
  children: TreeNode[];
  relatedCharacters: Entity[];
  relatedEdges: HyperEdge[];
}

export function WorldView() {
  const { ontology, selectEntity, selectedEntityId } = useStore();
  const [activeTab, setActiveTab] = useState<WorldTab>('locations');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [minImportance, setMinImportance] = useState<number>(1);

  // 카테고리별 엔티티 분류 (중요도 필터 적용)
  const categorizedEntities = useMemo(() => {
    if (!ontology) return { locations: [], organizations: [], concepts: [], items: [] };

    const entities = Object.values(ontology.entities);
    const filterByImportance = (e: Entity) =>
      minImportance <= 1 || (e.importance || 5) >= minImportance;

    return {
      locations: entities.filter(e => e.category === 'location' && filterByImportance(e)),
      organizations: entities.filter(e => e.category === 'organization' && filterByImportance(e)),
      concepts: entities.filter(e => e.category === 'concept' && filterByImportance(e)),
      items: entities.filter(e => e.category === 'item' && filterByImportance(e)),
    };
  }, [ontology, minImportance]);

  // 전체 카운트 (필터 전)
  const totalCounts = useMemo(() => {
    if (!ontology) return { locations: 0, organizations: 0, concepts: 0, items: 0 };
    const entities = Object.values(ontology.entities);
    return {
      locations: entities.filter(e => e.category === 'location').length,
      organizations: entities.filter(e => e.category === 'organization').length,
      concepts: entities.filter(e => e.category === 'concept').length,
      items: entities.filter(e => e.category === 'item').length,
    };
  }, [ontology]);

  // 장소 계층 구조 생성
  const locationTree = useMemo(() => {
    if (!ontology) return [];

    const locations = categorizedEntities.locations;
    const edges = Object.values(ontology.hyperedges);

    const parentChildMap = new Map<string, string[]>();
    const childParentMap = new Map<string, string>();

    edges.forEach(edge => {
      if (edge.type === '포함' || edge.type === 'contains') {
        const [parentId, childId] = edge.entities;
        if (parentId && childId) {
          if (!parentChildMap.has(parentId)) {
            parentChildMap.set(parentId, []);
          }
          parentChildMap.get(parentId)!.push(childId);
          childParentMap.set(childId, parentId);
        }
      }
    });

    const getRelatedCharacters = (entityId: string): Entity[] => {
      const relatedIds = new Set<string>();
      edges.forEach(edge => {
        if (edge.entities.includes(entityId)) {
          edge.entities.forEach(id => {
            const entity = ontology.entities[id];
            if (entity && entity.category === 'character') {
              relatedIds.add(id);
            }
          });
        }
      });
      return Array.from(relatedIds).map(id => ontology.entities[id]).filter(Boolean);
    };

    const getRelatedEdges = (entityId: string): HyperEdge[] => {
      return edges.filter(edge => edge.entities.includes(entityId));
    };

    const buildNode = (entity: Entity): TreeNode => {
      const childIds = parentChildMap.get(entity.id) || [];
      const children = childIds
        .map(id => ontology.entities[id])
        .filter(Boolean)
        .filter(e => e.category === 'location')
        .map(child => buildNode(child));

      return {
        entity,
        children,
        relatedCharacters: getRelatedCharacters(entity.id),
        relatedEdges: getRelatedEdges(entity.id),
      };
    };

    const rootLocations = locations.filter(loc => !childParentMap.has(loc.id));
    return rootLocations.map(buildNode);
  }, [ontology, categorizedEntities.locations]);

  // 조직 계층 구조 생성
  const organizationTree = useMemo(() => {
    if (!ontology) return [];

    const organizations = categorizedEntities.organizations;
    const edges = Object.values(ontology.hyperedges);
    const orgMembers = new Map<string, Entity[]>();

    edges.forEach(edge => {
      if (edge.type === '소속' || edge.type === 'belongs_to') {
        edge.entities.forEach(entityId => {
          const entity = ontology.entities[entityId];
          if (entity?.category === 'organization') {
            if (!orgMembers.has(entityId)) {
              orgMembers.set(entityId, []);
            }
            edge.entities.forEach(memberId => {
              if (memberId !== entityId) {
                const member = ontology.entities[memberId];
                if (member) {
                  orgMembers.get(entityId)!.push(member);
                }
              }
            });
          }
        });
      }
    });

    return organizations.map(org => ({
      entity: org,
      children: [] as TreeNode[],
      relatedCharacters: orgMembers.get(org.id) || [],
      relatedEdges: edges.filter(e => e.entities.includes(org.id)),
    }));
  }, [ontology, categorizedEntities.organizations]);

  // 아이템 목록
  const itemsList = useMemo(() => {
    if (!ontology) return [];

    const items = categorizedEntities.items;
    const edges = Object.values(ontology.hyperedges);

    return items.map(item => {
      const ownerEdges = edges.filter(e =>
        e.entities.includes(item.id) &&
        (e.type === '소유' || e.type === 'owns')
      );

      const owners: Entity[] = [];
      ownerEdges.forEach(edge => {
        edge.entities.forEach(id => {
          if (id !== item.id) {
            const entity = ontology.entities[id];
            if (entity) owners.push(entity);
          }
        });
      });

      return {
        entity: item,
        children: [] as TreeNode[],
        relatedCharacters: owners,
        relatedEdges: edges.filter(e => e.entities.includes(item.id)),
      };
    });
  }, [ontology, categorizedEntities.items]);

  // 개념 목록
  const conceptsList = useMemo(() => {
    if (!ontology) return [];

    const concepts = categorizedEntities.concepts;
    const edges = Object.values(ontology.hyperedges);

    return concepts.map(concept => ({
      entity: concept,
      children: [] as TreeNode[],
      relatedCharacters: [],
      relatedEdges: edges.filter(e => e.entities.includes(concept.id)),
    }));
  }, [ontology, categorizedEntities.concepts]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  if (!ontology) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center text-gray-400">
          <Globe className="w-16 h-16 mx-auto mb-3 opacity-30" />
          <p>데이터를 불러와주세요</p>
        </div>
      </div>
    );
  }

  const currentTabConfig = TAB_CONFIG.find(t => t.id === activeTab)!;

  const renderCard = (node: TreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.entity.id);
    const isSelected = selectedEntityId === node.entity.id;
    const importance = node.entity.importance || 5;

    return (
      <div key={node.entity.id} className="select-none" style={{ marginLeft: depth * 16 }}>
        <div
          className={`group relative p-4 rounded-2xl cursor-pointer transition-all duration-300 ${
            isSelected
              ? 'bg-white shadow-lg ring-2'
              : 'bg-white/60 hover:bg-white hover:shadow-md'
          }`}
          style={isSelected ? {
            '--tw-ring-color': currentTabConfig.color,
          } as React.CSSProperties : undefined}
          onClick={() => selectEntity(node.entity.id)}
        >
          {/* 중요도 인디케이터 */}
          {importance >= 7 && (
            <div
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
              style={{ backgroundColor: currentTabConfig.color }}
            >
              <Star className="w-3 h-3 text-white fill-white" />
            </div>
          )}

          <div className="flex items-start gap-3">
            {/* 확장 버튼 + 아이콘 */}
            <div className="flex items-center gap-1">
              {hasChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(node.entity.id);
                  }}
                  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              )}
              <div
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${currentTabConfig.gradient} flex items-center justify-center shadow-lg`}
              >
                <currentTabConfig.icon className="w-5 h-5 text-white" />
              </div>
            </div>

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-800">{node.entity.name}</h3>
                {hasChildren && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
                    style={{ backgroundColor: currentTabConfig.color }}
                  >
                    {node.children.length}
                  </span>
                )}
              </div>

              {node.entity.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                  {node.entity.description}
                </p>
              )}

              {/* 관련 캐릭터 */}
              {node.relatedCharacters.length > 0 && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex -space-x-2">
                    {node.relatedCharacters.slice(0, 4).map((char) => (
                      <div
                        key={char.id}
                        className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 border-2 border-white flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
                        title={char.name}
                      >
                        {char.name[0]}
                      </div>
                    ))}
                    {node.relatedCharacters.length > 4 && (
                      <div className="w-6 h-6 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-[9px] font-medium text-gray-500">
                        +{node.relatedCharacters.length - 4}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {node.relatedCharacters.map(c => c.name).slice(0, 3).join(', ')}
                    {node.relatedCharacters.length > 3 && ` 외 ${node.relatedCharacters.length - 3}명`}
                  </span>
                </div>
              )}

              {/* 관계 수 */}
              {node.relatedEdges.length > 0 && (
                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <Link2 className="w-3 h-3" />
                  <span>{node.relatedEdges.length}개의 관계</span>
                </div>
              )}
            </div>

            {/* 중요도 바 */}
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 h-3 rounded-full"
                    style={{
                      backgroundColor: i < Math.ceil(importance / 2)
                        ? currentTabConfig.color
                        : '#e5e7eb'
                    }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-gray-400">{importance}/10</span>
            </div>
          </div>
        </div>

        {/* 자식 노드 */}
        {hasChildren && isExpanded && (
          <div className="mt-2 ml-4 pl-4 border-l-2 space-y-2" style={{ borderColor: currentTabConfig.color + '30' }}>
            {node.children.map(child => renderCard(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const currentData = activeTab === 'locations' ? locationTree :
                      activeTab === 'organizations' ? organizationTree :
                      activeTab === 'concepts' ? conceptsList :
                      itemsList;

  const currentCount = activeTab === 'locations' ? categorizedEntities.locations.length :
                       activeTab === 'organizations' ? categorizedEntities.organizations.length :
                       activeTab === 'concepts' ? categorizedEntities.concepts.length :
                       categorizedEntities.items.length;

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${currentTabConfig.gradient} flex items-center justify-center shadow-lg`}>
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">세계관 설정집</h2>
              <p className="text-xs text-gray-500">스토리의 배경과 요소들</p>
            </div>
          </div>

          {/* 중요도 필터 */}
          <div className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-xl">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-500">중요도</span>
            <input
              type="range"
              min="1"
              max="10"
              value={minImportance}
              onChange={(e) => setMinImportance(Number(e.target.value))}
              className="w-24 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-xs font-bold text-indigo-600 w-8">
              {minImportance > 1 ? `${minImportance}+` : '전체'}
            </span>
          </div>
        </div>

        {/* 탭 버튼 */}
        <div className="flex gap-2">
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon;
            const count = tab.id === 'locations' ? categorizedEntities.locations.length :
                         tab.id === 'organizations' ? categorizedEntities.organizations.length :
                         tab.id === 'concepts' ? categorizedEntities.concepts.length :
                         categorizedEntities.items.length;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? 'text-white shadow-lg scale-105'
                    : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}
                style={isActive ? {
                  background: `linear-gradient(135deg, ${tab.color}, ${tab.color}dd)`,
                } : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-white/20' : 'bg-gray-100'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto p-4">
        {currentCount === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center p-8 bg-white/60 rounded-3xl">
              <div className="text-6xl mb-4">{currentTabConfig.emoji}</div>
              <p className="text-gray-600 font-medium">
                {activeTab === 'locations' && '장소 정보가 없습니다'}
                {activeTab === 'organizations' && '조직 정보가 없습니다'}
                {activeTab === 'concepts' && '세계관 설정이 없습니다'}
                {activeTab === 'items' && '아이템 정보가 없습니다'}
              </p>
              <p className="text-sm mt-2 text-gray-400">
                소설을 다시 분석하면 추출됩니다
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {currentData.map(node => renderCard(node))}
          </div>
        )}
      </div>

      {/* 하단 요약 */}
      <div className="flex-shrink-0 px-6 py-3 bg-white/80 backdrop-blur border-t border-gray-100">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            {TAB_CONFIG.map(tab => {
              const count = tab.id === 'locations' ? categorizedEntities.locations.length :
                           tab.id === 'organizations' ? categorizedEntities.organizations.length :
                           tab.id === 'concepts' ? categorizedEntities.concepts.length :
                           categorizedEntities.items.length;
              const total = tab.id === 'locations' ? totalCounts.locations :
                           tab.id === 'organizations' ? totalCounts.organizations :
                           tab.id === 'concepts' ? totalCounts.concepts :
                           totalCounts.items;

              return (
                <div key={tab.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tab.color }} />
                  <span className="text-gray-500">
                    {tab.label} <span className="font-bold text-gray-700">{count}</span>
                    {minImportance > 1 && <span className="text-gray-400">/{total}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {minImportance > 1 && (
            <span className="text-indigo-600 font-medium">
              중요도 {minImportance}+ 필터 적용
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
