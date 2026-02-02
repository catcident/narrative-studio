/**
 * 세계관 뷰 컴포넌트
 * 장소, 조직, 개념/세계관 설정을 체계적으로 보여줌
 */

import { useState, useMemo } from 'react';
import { MapPin, Building, Lightbulb, ChevronRight, ChevronDown, Users, Package, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import type { Entity, HyperEdge } from '../types';

type WorldTab = 'locations' | 'organizations' | 'concepts' | 'items';

const TAB_CONFIG: { id: WorldTab; label: string; icon: typeof MapPin; color: string }[] = [
  { id: 'locations', label: '장소', icon: MapPin, color: '#22c55e' },
  { id: 'organizations', label: '조직', icon: Building, color: '#a855f7' },
  { id: 'concepts', label: '세계관', icon: Lightbulb, color: '#6366f1' },
  { id: 'items', label: '아이템', icon: Package, color: '#f59e0b' },
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

  // 카테고리별 엔티티 분류
  const categorizedEntities = useMemo(() => {
    if (!ontology) return { locations: [], organizations: [], concepts: [], items: [] };

    const entities = Object.values(ontology.entities);
    return {
      locations: entities.filter(e => e.category === 'location'),
      organizations: entities.filter(e => e.category === 'organization'),
      concepts: entities.filter(e => e.category === 'concept'),
      items: entities.filter(e => e.category === 'item'),
    };
  }, [ontology]);

  // 장소 계층 구조 생성
  const locationTree = useMemo(() => {
    if (!ontology) return [];

    const locations = categorizedEntities.locations;
    const edges = Object.values(ontology.hyperedges);
    const allEntities = Object.values(ontology.entities);

    // 포함 관계 찾기 (부모 -> 자식)
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

    // 엔티티와 연결된 캐릭터 찾기
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

    // 엔티티와 연결된 관계 찾기
    const getRelatedEdges = (entityId: string): HyperEdge[] => {
      return edges.filter(edge => edge.entities.includes(entityId));
    };

    // 트리 노드 생성
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

    // 루트 노드 찾기 (부모가 없는 장소)
    const rootLocations = locations.filter(loc => !childParentMap.has(loc.id));

    return rootLocations.map(buildNode);
  }, [ontology, categorizedEntities.locations]);

  // 조직 계층 구조 생성
  const organizationTree = useMemo(() => {
    if (!ontology) return [];

    const organizations = categorizedEntities.organizations;
    const edges = Object.values(ontology.hyperedges);

    // 소속 관계 찾기
    const orgMembers = new Map<string, Entity[]>();

    edges.forEach(edge => {
      if (edge.type === '소속' || edge.type === 'belongs_to') {
        edge.entities.forEach(entityId => {
          const entity = ontology.entities[entityId];
          if (entity?.category === 'organization') {
            if (!orgMembers.has(entityId)) {
              orgMembers.set(entityId, []);
            }
            // 다른 엔티티들을 멤버로 추가
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

  // 아이템 목록 (소유자 정보 포함)
  const itemsList = useMemo(() => {
    if (!ontology) return [];

    const items = categorizedEntities.items;
    const edges = Object.values(ontology.hyperedges);

    return items.map(item => {
      // 소유자 찾기
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
      <div className="h-full flex items-center justify-center bg-gray-50 text-gray-400">
        <div className="text-center">
          <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>데이터가 없습니다</p>
        </div>
      </div>
    );
  }

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.entity.id);
    const isSelected = selectedEntityId === node.entity.id;

    return (
      <div key={node.entity.id} className="select-none">
        <div
          className={`flex items-start gap-2 p-3 rounded-lg cursor-pointer transition-all ${
            isSelected
              ? 'bg-blue-50 border-2 border-blue-300'
              : 'hover:bg-gray-50 border-2 border-transparent'
          }`}
          style={{ marginLeft: depth * 24 }}
          onClick={() => selectEntity(node.entity.id)}
        >
          {/* 확장/축소 버튼 */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.entity.id);
              }}
              className="p-0.5 hover:bg-gray-200 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </button>
          ) : (
            <div className="w-5" />
          )}

          {/* 아이콘 */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: TAB_CONFIG.find(t =>
                t.id === activeTab ||
                (activeTab === 'locations' && node.entity.category === 'location') ||
                (activeTab === 'organizations' && node.entity.category === 'organization')
              )?.color + '20',
            }}
          >
            {activeTab === 'locations' && <MapPin className="w-4 h-4" style={{ color: '#22c55e' }} />}
            {activeTab === 'organizations' && <Building className="w-4 h-4" style={{ color: '#a855f7' }} />}
            {activeTab === 'concepts' && <Lightbulb className="w-4 h-4" style={{ color: '#6366f1' }} />}
            {activeTab === 'items' && <Package className="w-4 h-4" style={{ color: '#f59e0b' }} />}
          </div>

          {/* 정보 */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-800">{node.entity.name}</div>
            {node.entity.description && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {node.entity.description}
              </p>
            )}

            {/* 관련 캐릭터 */}
            {node.relatedCharacters.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <Users className="w-3 h-3 text-gray-400" />
                {node.relatedCharacters.slice(0, 5).map(char => (
                  <span
                    key={char.id}
                    className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded"
                  >
                    {char.name}
                  </span>
                ))}
                {node.relatedCharacters.length > 5 && (
                  <span className="text-xs text-gray-400">
                    +{node.relatedCharacters.length - 5}
                  </span>
                )}
              </div>
            )}

            {/* 관계 수 */}
            {node.relatedEdges.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {node.relatedEdges.length}개의 관계
              </div>
            )}
          </div>

          {/* 자식 수 */}
          {hasChildren && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {node.children.length}
            </span>
          )}
        </div>

        {/* 자식 노드 */}
        {hasChildren && isExpanded && (
          <div className="ml-2 border-l-2 border-gray-100">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
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
    <div className="h-full flex flex-col bg-gray-50">
      {/* 탭 헤더 */}
      <div className="p-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">세계관 설정</span>
        </div>

        {/* 탭 버튼 */}
        <div className="flex gap-1 mt-3">
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon;
            const count = tab.id === 'locations' ? categorizedEntities.locations.length :
                         tab.id === 'organizations' ? categorizedEntities.organizations.length :
                         tab.id === 'concepts' ? categorizedEntities.concepts.length :
                         categorizedEntities.items.length;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-white shadow-sm font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                style={activeTab === tab.id ? { color: tab.color } : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-gray-100' : 'bg-gray-200'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto p-3">
        {currentCount === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-4xl mb-2">
                {activeTab === 'locations' && '🗺️'}
                {activeTab === 'organizations' && '🏢'}
                {activeTab === 'concepts' && '💡'}
                {activeTab === 'items' && '📦'}
              </div>
              <p className="text-sm">
                {activeTab === 'locations' && '장소 정보가 없습니다'}
                {activeTab === 'organizations' && '조직 정보가 없습니다'}
                {activeTab === 'concepts' && '세계관 설정이 없습니다'}
                {activeTab === 'items' && '아이템 정보가 없습니다'}
              </p>
              <p className="text-xs mt-1 text-gray-300">
                소설을 다시 분석하면 추출됩니다
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {currentData.map(node => renderTreeNode(node))}
          </div>
        )}
      </div>

      {/* 하단 요약 */}
      <div className="p-3 bg-white border-t border-gray-200">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            총 {categorizedEntities.locations.length}개 장소 ·{' '}
            {categorizedEntities.organizations.length}개 조직 ·{' '}
            {categorizedEntities.concepts.length}개 세계관 설정 ·{' '}
            {categorizedEntities.items.length}개 아이템
          </span>
        </div>
      </div>
    </div>
  );
}
