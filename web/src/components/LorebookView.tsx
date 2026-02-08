/**
 * 로어북 뷰어 — 엔티티별 카드, 상단 탭으로 타입 필터
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Globe, Search, Quote, Eye, Shirt, Brain, Swords,
  History, Target, Users, MapPin, Building, Package, Zap,
  MessageSquareQuote, X, ChevronDown, ChevronRight, Cat, Box,
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
  /** 이 탭에서 보여줄 로어 카테고리 */
  loreCategories: LoreCategory[];
  /** 이 탭에 매칭되는 KG 엔티티 카테고리 */
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

/** 엔티티 카테고리에 따른 색상 */
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

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [activeTab, setActiveTab] = useState<EntityTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

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

  /**
   * 엔티티가 현재 탭에 해당하는지 판별
   * - 'all' 탭: 모든 엔트리 포함
   * - 다른 탭: KG 엔티티 카테고리 우선 확인, 없으면 로어 카테고리로 판별
   */
  const matchesTab = (entityName: string, entry: LoreEntry, tab: TabConfig): boolean => {
    if (tab.id === 'all') return true;

    const kgCat = entityCategoryMap[entityName];

    // KG에서 엔티티 카테고리를 알고 있는 경우
    if (kgCat) {
      if (tab.entityCategories?.includes(kgCat)) {
        // 이 탭의 엔티티 타입에 매칭 → 해당 탭의 로어 카테고리 엔트리만 표시
        return tab.loreCategories.includes(entry.category);
      }
      // 다른 탭의 엔티티 타입 → 이 탭에 표시 안 함
      // 단, 세계관 탭은 엔티티 카테고리 필터 없이 로어 카테고리만으로 판별
      if (tab.entityCategories) return false;
    }

    // KG에 없는 엔티티이거나 entityCategories 필터 없는 탭(세계관)
    // → 로어 카테고리로만 판별
    return tab.loreCategories.includes(entry.category);
  };

  // 탭별 카운트
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

  // 현재 탭 + 검색 필터 적용된 엔티티 카드 데이터
  const tabConfig = TABS.find(t => t.id === activeTab)!;

  const entityCards = useMemo(() => {
    const entityMap: Record<string, LoreEntry[]> = {};
    for (const entry of entries) {
      if (!matchesTab(entry.entityName, entry, tabConfig)) continue;
      if (!entityMap[entry.entityName]) entityMap[entry.entityName] = [];
      entityMap[entry.entityName].push(entry);
    }

    let cards = Object.entries(entityMap)
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

  const toggleCard = (name: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
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
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* 탭 */}
          <div className="flex items-center gap-1">
            {TABS.filter(tab => tab.id === 'all' || tabCounts[tab.id] > 0).map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setExpandedCards(new Set()); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  <span className={`text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center ${
                    isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {tabCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 구분선 */}
          <div className="h-6 w-px bg-gray-200" />

          {/* 검색 */}
          <div className="relative w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="이름 또는 내용 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <span className="text-[11px] text-gray-400 ml-auto font-medium">{entityCards.length}개 항목</span>
        </div>
      </div>

      {/* ─── 카드 그리드 ─── */}
      <div className="flex-1 overflow-auto">
        {entityCards.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">검색 결과가 없습니다</p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {entityCards.map(card => {
              const isExpanded = expandedCards.has(card.name);
              const kgCat = entityCategoryMap[card.name];
              const EntityIcon = getEntityIcon(kgCat);
              const entityColor = getEntityColor(kgCat);

              // 카테고리별 그룹핑
              const byCategory: Record<string, LoreEntry[]> = {};
              for (const entry of card.entries) {
                if (!byCategory[entry.category]) byCategory[entry.category] = [];
                byCategory[entry.category].push(entry);
              }
              // 장면 순서 정렬
              for (const cat of Object.keys(byCategory)) {
                byCategory[cat].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
              }
              const isChar = kgCat === 'character' || kgCat === 'creature' || (!kgCat && card.entries.some(e => CHARACTER_CATEGORIES.includes(e.category)));
              const orderedCats = (isChar ? CHARACTER_CATEGORIES : WORLD_CATEGORIES)
                .filter(cat => byCategory[cat]?.length);

              // 접힌 상태: 카테고리 요약 뱃지
              const categoryBadges = orderedCats.map(cat => ({
                cat,
                config: CATEGORY_CONFIG[cat],
                count: byCategory[cat].length,
              }));

              return (
                <div
                  key={card.name}
                  className={`rounded-xl border-2 shadow-sm transition-all ${
                    isExpanded
                      ? 'shadow-md border-blue-200 bg-white'
                      : 'border-gray-200 bg-white hover:shadow-md hover:border-gray-300'
                  }`}
                >
                  {/* ── 카드 헤더 ── */}
                  <button
                    onClick={() => toggleCard(card.name)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: entityColor.bg, border: `1px solid ${entityColor.border}` }}
                    >
                      <EntityIcon className="w-4 h-4" style={{ color: entityColor.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-gray-900 block truncate">{card.name}</span>
                      {/* 접힌 상태: 카테고리 뱃지 인라인 */}
                      {!isExpanded && categoryBadges.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {categoryBadges.map(({ cat, config, count }) => (
                            <span
                              key={cat}
                              className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ backgroundColor: config.bg, color: config.color, border: `1px solid ${config.border}` }}
                            >
                              {config.label} {count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {card.count}
                      </span>
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-blue-500" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />
                      }
                    </div>
                  </button>

                  {/* ── 펼친 상태: 카테고리별 세부 정보 ── */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
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
                            <div className="bg-white">
                              {catEntries.map((entry, idx) => (
                                <div
                                  key={entry.id}
                                  className={`px-3 py-2.5 ${idx !== catEntries.length - 1 ? 'border-b border-gray-100' : ''}`}
                                >
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
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-400 font-medium">
                                      장면 {sceneOrderMap[entry.sceneId] ?? '?'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
