/**
 * 로어북 뷰어 — 인물/세계관/장소별로 상세 프로필 탐색
 * 좌측: 엔티티 타입별 탭 + 엔티티 목록
 * 우측: 선택된 엔티티의 카테고리별 상세 정보
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Globe, Search, Quote, Eye, Shirt, Brain, Swords,
  History, Target, Users, MapPin, Building, Package, Zap,
  MessageSquareQuote, X, Cat, Box,
} from 'lucide-react';
import { useStore } from '../store';
import type { LoreEntry, LoreCategory, EntityCategory } from '../types';

// ─── 로어 카테고리 설정 ───

interface CategoryConfig {
  label: string;
  icon: typeof Eye;
  color: string;
}

const CATEGORY_CONFIG: Record<LoreCategory, CategoryConfig> = {
  appearance:           { label: '외모',   icon: Eye,                color: '#ec4899' },
  outfit:               { label: '복장',   icon: Shirt,              color: '#f97316' },
  personality:          { label: '성격',   icon: Brain,              color: '#8b5cf6' },
  ability:              { label: '능력',   icon: Swords,             color: '#ef4444' },
  background:           { label: '배경',   icon: History,            color: '#6366f1' },
  motivation:           { label: '동기',   icon: Target,             color: '#14b8a6' },
  relationship_detail:  { label: '관계',   icon: Users,              color: '#3b82f6' },
  quote:                { label: '대사',   icon: MessageSquareQuote, color: '#d946ef' },
  world_setting:        { label: '세계관', icon: Globe,              color: '#0ea5e9' },
  location_detail:      { label: '장소',   icon: MapPin,             color: '#22c55e' },
  organization_detail:  { label: '조직',   icon: Building,           color: '#a855f7' },
  item_detail:          { label: '아이템', icon: Package,            color: '#f59e0b' },
  event:                { label: '사건',   icon: Zap,                color: '#e11d48' },
};

// 인물 관련 카테고리 (인물 상세에서 표시)
const CHARACTER_CATEGORIES: LoreCategory[] = [
  'appearance', 'outfit', 'personality', 'ability', 'background',
  'motivation', 'relationship_detail', 'quote',
];

// 세계관/기타 카테고리
const WORLD_CATEGORIES: LoreCategory[] = [
  'world_setting', 'location_detail', 'organization_detail', 'item_detail', 'event',
];

// ─── 엔티티 타입 탭 ───

type EntityTab = 'character' | 'world' | 'location' | 'organization' | 'item' | 'event';

interface TabConfig {
  id: EntityTab;
  label: string;
  icon: typeof User;
  // 이 탭에 표시할 로어 카테고리
  categories: LoreCategory[];
  // KG 엔티티 카테고리와 매칭 (없으면 로어에서 자체 판별)
  entityCategories?: EntityCategory[];
}

const TABS: TabConfig[] = [
  {
    id: 'character', label: '인물', icon: User,
    categories: CHARACTER_CATEGORIES,
    entityCategories: ['character', 'creature'],
  },
  {
    id: 'world', label: '세계관', icon: Globe,
    categories: ['world_setting'],
  },
  {
    id: 'location', label: '장소', icon: MapPin,
    categories: ['location_detail'],
    entityCategories: ['location'],
  },
  {
    id: 'organization', label: '조직', icon: Building,
    categories: ['organization_detail'],
    entityCategories: ['organization'],
  },
  {
    id: 'item', label: '아이템', icon: Package,
    categories: ['item_detail'],
    entityCategories: ['item'],
  },
  {
    id: 'event', label: '사건', icon: Zap,
    categories: ['event'],
    entityCategories: ['event'],
  },
];

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [activeTab, setActiveTab] = useState<EntityTab>('character');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 모든 로어북 엔트리
  const entries = useMemo(() => {
    if (!knowledgeGraph?.lorebook) return [];
    return Object.values(knowledgeGraph.lorebook.entries);
  }, [knowledgeGraph]);

  // KG 엔티티 이름 → 카테고리 매핑
  const entityCategoryMap = useMemo(() => {
    if (!knowledgeGraph?.entities) return {};
    const map: Record<string, EntityCategory> = {};
    Object.values(knowledgeGraph.entities).forEach(e => {
      map[e.name] = e.category;
      e.aliases?.forEach(a => { map[a] = e.category; });
    });
    return map;
  }, [knowledgeGraph]);

  // 장면 순서 매핑
  const sceneOrderMap = useMemo(() => {
    if (!knowledgeGraph?.snapshots) return {};
    const map: Record<string, number> = {};
    Object.entries(knowledgeGraph.snapshots).forEach(([id, snap]) => {
      map[id] = snap.order;
    });
    return map;
  }, [knowledgeGraph]);

  // 현재 탭에 해당하는 엔티티 목록 (엔트리 수 기준 정렬)
  const tabConfig = TABS.find(t => t.id === activeTab)!;

  const tabEntities = useMemo(() => {
    // 이 탭의 카테고리에 해당하는 엔트리 찾기
    const tabCats = new Set(tabConfig.categories);
    const tabEntityCats = new Set(tabConfig.entityCategories || []);

    // 엔티티 이름별로 엔트리 그룹핑
    const entityMap: Record<string, LoreEntry[]> = {};
    for (const entry of entries) {
      // 인물 탭: KG에서 character/creature로 분류된 엔티티의 인물 카테고리 엔트리
      // 세계관/장소/조직/아이템/사건 탭: 해당 로어 카테고리 엔트리
      if (activeTab === 'character') {
        // 인물: KG 엔티티 카테고리가 character/creature이고, 인물 관련 로어 카테고리
        const kgCat = entityCategoryMap[entry.entityName];
        if (kgCat && tabEntityCats.has(kgCat) && tabCats.has(entry.category)) {
          if (!entityMap[entry.entityName]) entityMap[entry.entityName] = [];
          entityMap[entry.entityName].push(entry);
        }
        // KG에 없지만 인물 관련 카테고리인 엔트리도 포함
        else if (!kgCat && tabCats.has(entry.category)) {
          if (!entityMap[entry.entityName]) entityMap[entry.entityName] = [];
          entityMap[entry.entityName].push(entry);
        }
      } else {
        // 비인물 탭: 해당 로어 카테고리 엔트리
        if (tabCats.has(entry.category)) {
          if (!entityMap[entry.entityName]) entityMap[entry.entityName] = [];
          entityMap[entry.entityName].push(entry);
        }
      }
    }

    // 엔트리 수 기준 내림차순 정렬
    return Object.entries(entityMap)
      .map(([name, entries]) => ({ name, count: entries.length, entries }))
      .sort((a, b) => b.count - a.count);
  }, [entries, activeTab, tabConfig, entityCategoryMap]);

  // 검색 필터
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return tabEntities;
    const q = searchQuery.toLowerCase();
    return tabEntities.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.entries.some(entry => entry.content.toLowerCase().includes(q))
    );
  }, [tabEntities, searchQuery]);

  // 선택된 엔티티의 카테고리별 엔트리
  const selectedEntityEntries = useMemo(() => {
    if (!selectedEntity) return null;
    const entityData = tabEntities.find(e => e.name === selectedEntity);
    if (!entityData) return null;

    // 카테고리별 그룹핑
    const byCategory: Record<string, LoreEntry[]> = {};
    for (const entry of entityData.entries) {
      if (!byCategory[entry.category]) byCategory[entry.category] = [];
      byCategory[entry.category].push(entry);
    }

    // 장면 순서로 정렬
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
    }

    // 카테고리 순서 유지
    const orderedCategories = (activeTab === 'character' ? CHARACTER_CATEGORIES : WORLD_CATEGORIES)
      .filter(cat => byCategory[cat]?.length);

    return { name: entityData.name, count: entityData.count, byCategory, orderedCategories };
  }, [selectedEntity, tabEntities, sceneOrderMap, activeTab]);

  // 탭별 엔트리 카운트
  const tabCounts = useMemo(() => {
    const counts: Record<EntityTab, number> = { character: 0, world: 0, location: 0, organization: 0, item: 0, event: 0 };
    for (const tab of TABS) {
      const tabCats = new Set(tab.categories);
      const tabEntityCats = new Set(tab.entityCategories || []);
      const entityNames = new Set<string>();
      for (const entry of entries) {
        if (tab.id === 'character') {
          const kgCat = entityCategoryMap[entry.entityName];
          if ((kgCat && tabEntityCats.has(kgCat) && tabCats.has(entry.category)) ||
              (!kgCat && tabCats.has(entry.category))) {
            entityNames.add(entry.entityName);
          }
        } else {
          if (tabCats.has(entry.category)) entityNames.add(entry.entityName);
        }
      }
      counts[tab.id] = entityNames.size;
    }
    return counts;
  }, [entries, entityCategoryMap]);

  // ─── 빈 상태 ───

  if (!knowledgeGraph) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">데이터를 불러와주세요</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500 font-medium">로어북 데이터가 없습니다</p>
          <p className="text-xs mt-1 text-gray-400">소설을 분석하면 인물 프로필, 세계관, 대사 등이 추출됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-gray-50">
      {/* ─── 좌측: 탭 + 엔티티 목록 ─── */}
      <div className="w-64 flex-shrink-0 flex flex-col bg-white border-r border-gray-200">
        {/* 탭 */}
        <div className="flex-shrink-0 border-b border-gray-100">
          <div className="flex flex-wrap gap-0.5 p-2">
            {TABS.filter(tab => tabCounts[tab.id] > 0).map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSelectedEntity(null); setSearchQuery(''); }}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {tab.label}
                  <span className={`text-[10px] ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>
                    {tabCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 검색 */}
        <div className="flex-shrink-0 p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300 bg-gray-50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* 엔티티 목록 */}
        <div className="flex-1 overflow-auto">
          {filteredEntities.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-xs">항목 없음</p>
            </div>
          ) : (
            <div className="px-1 pb-2">
              {filteredEntities.map(entity => {
                const isSelected = selectedEntity === entity.name;
                const kgEntity = knowledgeGraph.entities
                  ? Object.values(knowledgeGraph.entities).find(e => e.name === entity.name)
                  : null;
                const EntityIcon = getEntityIcon(kgEntity?.category);

                return (
                  <button
                    key={entity.name}
                    onClick={() => setSelectedEntity(isSelected ? null : entity.name)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <EntityIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                    <span className="text-[13px] font-medium flex-1 truncate">{entity.name}</span>
                    <span className={`text-[10px] tabular-nums ${isSelected ? 'text-blue-400' : 'text-gray-400'}`}>
                      {entity.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── 우측: 상세 보기 ─── */}
      <div className="flex-1 overflow-auto">
        {!selectedEntityEntries ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">좌측에서 항목을 선택하세요</p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto p-4">
            {/* 엔티티 헤더 */}
            <div className="flex items-center gap-2.5 mb-4">
              {(() => {
                const kgEntity = knowledgeGraph.entities
                  ? Object.values(knowledgeGraph.entities).find(e => e.name === selectedEntityEntries.name)
                  : null;
                const EntityIcon = getEntityIcon(kgEntity?.category);
                return <EntityIcon className="w-5 h-5 text-blue-500" />;
              })()}
              <h2 className="text-lg font-bold text-gray-900">{selectedEntityEntries.name}</h2>
              <span className="text-xs text-gray-400">{selectedEntityEntries.count}개 기록</span>
            </div>

            {/* 카테고리별 섹션 */}
            <div className="space-y-4">
              {selectedEntityEntries.orderedCategories.map(cat => {
                const config = CATEGORY_CONFIG[cat];
                const Icon = config.icon;
                const catEntries = selectedEntityEntries.byCategory[cat];

                return (
                  <div key={cat} className="bg-white rounded-lg border border-gray-100">
                    {/* 카테고리 헤더 */}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-50">
                      <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                      <span className="text-[13px] font-semibold" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-[10px] text-gray-400">{catEntries.length}</span>
                    </div>

                    {/* 엔트리 목록 */}
                    <div className="divide-y divide-gray-50">
                      {catEntries.map(entry => (
                        <div key={entry.id} className="px-3.5 py-2.5">
                          <p className="text-[13px] text-gray-700 leading-relaxed">{entry.content}</p>
                          {entry.quote && (
                            <div className="mt-1.5 pl-2.5 border-l-2 border-purple-200">
                              <p className="text-xs text-purple-600/80 italic leading-relaxed flex items-start gap-1">
                                <Quote className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 opacity-60" />
                                {entry.quote}
                              </p>
                            </div>
                          )}
                          <span className="text-[10px] text-gray-400 mt-1 block">
                            장면 {sceneOrderMap[entry.sceneId] ?? '?'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getEntityIcon(category?: EntityCategory) {
  switch (category) {
    case 'character': return User;
    case 'creature': return Cat;
    case 'location': return MapPin;
    case 'organization': return Building;
    case 'item': return Package;
    case 'event': return Zap;
    case 'concept': return Globe;
    default: return Box;
  }
}
