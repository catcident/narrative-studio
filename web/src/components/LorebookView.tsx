/**
 * 로어북 뷰어 — 왼쪽 카드 그리드 + 오른쪽 상세 패널
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Globe, Search, Quote, Eye, Shirt, Brain, Swords,
  History, Target, Users, MapPin, Building, Package, Zap,
  MessageSquareQuote, X, Cat, Box,
} from 'lucide-react';
import { useStore } from '../store';
import type { LoreEntry, LoreCategory, EntityCategory } from '../types';

// ─── 카테고리 설정 ───

interface CategoryConfig {
  label: string;
  icon: typeof Eye;
  color: string;
  bg: string;
  border: string;
}

const CATEGORY_CONFIG: Record<LoreCategory, CategoryConfig> = {
  appearance:           { label: '외모',   icon: Eye,                color: '#be185d', bg: '#fdf2f8', border: '#fbcfe8' },
  outfit:               { label: '복장',   icon: Shirt,              color: '#c2410c', bg: '#fff7ed', border: '#fed7aa' },
  personality:          { label: '성격',   icon: Brain,              color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
  ability:              { label: '능력',   icon: Swords,             color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  background:           { label: '배경',   icon: History,            color: '#4338ca', bg: '#eef2ff', border: '#c7d2fe' },
  motivation:           { label: '동기',   icon: Target,             color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  relationship_detail:  { label: '관계',   icon: Users,              color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  quote:                { label: '대사',   icon: MessageSquareQuote, color: '#a21caf', bg: '#fdf4ff', border: '#f0abfc' },
  world_setting:        { label: '세계관', icon: Globe,              color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
  location_detail:      { label: '장소',   icon: MapPin,             color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  organization_detail:  { label: '조직',   icon: Building,           color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  item_detail:          { label: '아이템', icon: Package,            color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  event:                { label: '사건',   icon: Zap,                color: '#be123c', bg: '#fff1f2', border: '#fecdd3' },
};

const CHARACTER_CATEGORIES: LoreCategory[] = [
  'appearance', 'outfit', 'personality', 'ability', 'background',
  'motivation', 'relationship_detail', 'quote',
];

const WORLD_CATEGORIES: LoreCategory[] = [
  'world_setting', 'location_detail', 'organization_detail', 'item_detail', 'event',
];

// ─── 타입 탭 ───

type EntityTab = 'all' | 'character' | 'world' | 'location' | 'item' | 'event';

interface TabConfig {
  id: EntityTab;
  label: string;
  icon: typeof User;
  loreCategories: LoreCategory[];
  entityCategories?: EntityCategory[];
}

const TABS: TabConfig[] = [
  { id: 'all', label: '전체', icon: BookOpen, loreCategories: [...CHARACTER_CATEGORIES, ...WORLD_CATEGORIES] },
  { id: 'character', label: '인물', icon: User, loreCategories: CHARACTER_CATEGORIES, entityCategories: ['character', 'creature'] },
  { id: 'world', label: '세계관', icon: Globe, loreCategories: ['world_setting', 'organization_detail'] },
  { id: 'location', label: '장소', icon: MapPin, loreCategories: ['location_detail'], entityCategories: ['location'] },
  { id: 'item', label: '아이템', icon: Package, loreCategories: ['item_detail'], entityCategories: ['item'] },
  { id: 'event', label: '사건', icon: Zap, loreCategories: ['event'], entityCategories: ['event'] },
];

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

function getEntityColor(category?: EntityCategory): { text: string; bg: string; border: string } {
  switch (category) {
    case 'character': return { text: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' };
    case 'creature': return { text: '#d97706', bg: '#fffbeb', border: '#fde68a' };
    case 'location': return { text: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
    case 'organization': return { text: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' };
    case 'item': return { text: '#d97706', bg: '#fffbeb', border: '#fde68a' };
    case 'event': return { text: '#be123c', bg: '#fff1f2', border: '#fecdd3' };
    case 'concept': return { text: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' };
    default: return { text: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' };
  }
}

interface EntityCardData {
  name: string;
  entries: LoreEntry[];
  count: number;
}

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [activeTab, setActiveTab] = useState<EntityTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const entries = useMemo(() => {
    if (!knowledgeGraph?.lorebook) return [];
    return Object.values(knowledgeGraph.lorebook.entries);
  }, [knowledgeGraph]);

  const entityCategoryMap = useMemo(() => {
    if (!knowledgeGraph?.entities) return {};
    const map: Record<string, EntityCategory> = {};
    Object.values(knowledgeGraph.entities).forEach(e => {
      map[e.name] = e.category;
      e.aliases?.forEach(a => { map[a] = e.category; });
    });
    return map;
  }, [knowledgeGraph]);

  const sceneOrderMap = useMemo(() => {
    if (!knowledgeGraph?.snapshots) return {};
    const map: Record<string, number> = {};
    Object.entries(knowledgeGraph.snapshots).forEach(([id, snap]) => {
      map[id] = snap.order;
    });
    return map;
  }, [knowledgeGraph]);

  const matchesTab = (entityName: string, entry: LoreEntry, tab: TabConfig): boolean => {
    if (tab.id === 'all') return true;
    const kgCat = entityCategoryMap[entityName];
    if (kgCat) {
      if (tab.entityCategories?.includes(kgCat)) return tab.loreCategories.includes(entry.category);
      if (tab.entityCategories) return false;
    }
    return tab.loreCategories.includes(entry.category);
  };

  const tabCounts = useMemo(() => {
    const counts: Record<EntityTab, number> = { all: 0, character: 0, world: 0, location: 0, item: 0, event: 0 };
    for (const tab of TABS) {
      const names = new Set<string>();
      for (const entry of entries) {
        if (matchesTab(entry.entityName, entry, tab)) names.add(entry.entityName);
      }
      counts[tab.id] = names.size;
    }
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, entityCategoryMap]);

  const tabConfig = TABS.find(t => t.id === activeTab)!;

  const entityCards = useMemo(() => {
    const entityMap: Record<string, LoreEntry[]> = {};
    for (const entry of entries) {
      if (!matchesTab(entry.entityName, entry, tabConfig)) continue;
      if (!entityMap[entry.entityName]) entityMap[entry.entityName] = [];
      entityMap[entry.entityName].push(entry);
    }

    let cards: EntityCardData[] = Object.entries(entityMap)
      .map(([name, ents]) => ({ name, entries: ents, count: ents.length }))
      .sort((a, b) => b.count - a.count);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      cards = cards.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.entries.some(e => e.content.toLowerCase().includes(q) || (e.quote && e.quote.toLowerCase().includes(q)))
      );
    }

    return cards;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, activeTab, tabConfig, entityCategoryMap, searchQuery]);

  // 선택된 엔티티의 카드 데이터
  const selectedCard = useMemo(() => {
    if (!selectedEntity) return null;
    return entityCards.find(c => c.name === selectedEntity) || null;
  }, [selectedEntity, entityCards]);

  // 탭 전환 시 선택 초기화
  const handleTabChange = (tabId: EntityTab) => {
    setActiveTab(tabId);
    setSelectedEntity(null);
  };

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
    <div className="h-full flex flex-col bg-gray-50">
      {/* ─── 헤더: 탭 + 검색 ─── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {TABS.filter(tab => tab.id === 'all' || tabCounts[tab.id] > 0).map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                <span className={`text-[10px] px-1 rounded-full min-w-[16px] text-center ${
                  isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-200 text-gray-500'
                }`}>
                  {tabCounts[tab.id]}
                </span>
              </button>
            );
          })}

          <div className="h-5 w-px bg-gray-200 mx-1" />

          <div className="relative w-44">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
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
      </div>

      {/* ─── 메인: 왼쪽 카드 그리드 + 오른쪽 상세 ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* 왼쪽: 카드 그리드 */}
        <div className={`overflow-y-auto p-3 ${selectedCard ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
          {entityCards.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs">검색 결과가 없습니다</p>
            </div>
          ) : (
            <div className={`grid gap-2.5 ${
              selectedCard
                ? 'grid-cols-2 xl:grid-cols-3'
                : 'grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
            }`}>
              {entityCards.map(card => (
                <EntityCard
                  key={card.name}
                  card={card}
                  isSelected={selectedEntity === card.name}
                  kgCategory={entityCategoryMap[card.name]}
                  onClick={() => setSelectedEntity(
                    selectedEntity === card.name ? null : card.name
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* 오른쪽: 상세 패널 */}
        {selectedCard && (
          <DetailPanel
            card={selectedCard}
            kgCategory={entityCategoryMap[selectedCard.name]}
            sceneOrderMap={sceneOrderMap}
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── 엔티티 카드 (컴팩트) ───

function EntityCard({
  card,
  isSelected,
  kgCategory,
  onClick,
}: {
  card: EntityCardData;
  isSelected: boolean;
  kgCategory?: EntityCategory;
  onClick: () => void;
}) {
  const EntityIcon = getEntityIcon(kgCategory);
  const color = getEntityColor(kgCategory);

  // 보유 카테고리 수
  const uniqueCats = new Set(card.entries.map(e => e.category));

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border-2 p-3 transition-all hover:shadow-md ${
        isSelected
          ? 'border-blue-400 bg-blue-50 shadow-md ring-1 ring-blue-200'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {/* 아이콘 + 이름 */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
        >
          <EntityIcon className="w-3.5 h-3.5" style={{ color: color.text }} />
        </div>
        <span className="text-xs font-bold text-gray-900 truncate leading-tight">{card.name}</span>
      </div>

      {/* 카테고리 뱃지들 */}
      <div className="flex flex-wrap gap-1">
        {Array.from(uniqueCats).slice(0, 4).map(cat => {
          const config = CATEGORY_CONFIG[cat as LoreCategory];
          if (!config) return null;
          return (
            <span
              key={cat}
              className="text-[9px] px-1 py-0.5 rounded font-medium leading-none"
              style={{ backgroundColor: config.bg, color: config.color }}
            >
              {config.label}
            </span>
          );
        })}
        {uniqueCats.size > 4 && (
          <span className="text-[9px] px-1 py-0.5 rounded font-medium bg-gray-100 text-gray-500">
            +{uniqueCats.size - 4}
          </span>
        )}
      </div>

      {/* 건수 */}
      <div className="mt-2 text-[10px] text-gray-400 font-medium">
        {card.count}개 항목
      </div>
    </button>
  );
}

// ─── 상세 패널 (오른쪽) ───

function DetailPanel({
  card,
  kgCategory,
  sceneOrderMap,
  onClose,
}: {
  card: EntityCardData;
  kgCategory?: EntityCategory;
  sceneOrderMap: Record<string, number>;
  onClose: () => void;
}) {
  const EntityIcon = getEntityIcon(kgCategory);
  const color = getEntityColor(kgCategory);

  // 카테고리별 그룹핑
  const byCategory: Record<string, LoreEntry[]> = {};
  for (const entry of card.entries) {
    if (!byCategory[entry.category]) byCategory[entry.category] = [];
    byCategory[entry.category].push(entry);
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
  }

  const isChar = kgCategory === 'character' || kgCategory === 'creature' ||
    (!kgCategory && card.entries.some(e => CHARACTER_CATEGORIES.includes(e.category)));
  const orderedCats = (isChar ? CHARACTER_CATEGORIES : WORLD_CATEGORIES)
    .filter(cat => byCategory[cat]?.length);

  return (
    <div className="w-1/2 h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color.bg, border: `1px solid ${color.border}` }}
        >
          <EntityIcon className="w-4 h-4" style={{ color: color.text }} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900 truncate">{card.name}</h2>
          <p className="text-[11px] text-gray-400">{card.count}개 항목</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 카테고리별 내용 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {orderedCats.map(cat => {
          const config = CATEGORY_CONFIG[cat];
          const Icon = config.icon;
          const catEntries = byCategory[cat];

          return (
            <div
              key={cat}
              className="rounded-lg overflow-hidden"
              style={{ border: `1px solid ${config.border}` }}
            >
              {/* 카테고리 헤더 */}
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ backgroundColor: config.bg }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                <span className="text-xs font-bold" style={{ color: config.color }}>
                  {config.label}
                </span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: config.color + '18', color: config.color }}
                >
                  {catEntries.length}
                </span>
              </div>

              {/* 엔트리 목록 */}
              <div className="bg-white divide-y divide-gray-100">
                {catEntries.map(entry => (
                  <div key={entry.id} className="px-3 py-2.5">
                    <p className="text-[13px] text-gray-800 leading-relaxed">{entry.content}</p>
                    {entry.quote && (
                      <div
                        className="mt-1.5 px-2.5 py-1.5 rounded-md"
                        style={{ backgroundColor: '#faf5ff', borderLeft: '3px solid #c084fc' }}
                      >
                        <p className="text-xs text-purple-700 italic leading-relaxed flex items-start gap-1.5">
                          <Quote className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-70" />
                          {entry.quote}
                        </p>
                      </div>
                    )}
                    <span className="text-[10px] text-gray-400 font-medium mt-1 block">
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
  );
}
