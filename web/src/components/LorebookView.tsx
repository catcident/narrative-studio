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
  categories: LoreCategory[];
  entityCategories?: EntityCategory[];
}

const TABS: TabConfig[] = [
  { id: 'all', label: '전체', icon: BookOpen, categories: [...CHARACTER_CATEGORIES, ...WORLD_CATEGORIES] },
  { id: 'character', label: '인물', icon: User, categories: CHARACTER_CATEGORIES, entityCategories: ['character', 'creature'] },
  { id: 'world', label: '세계관', icon: Globe, categories: ['world_setting', 'organization_detail'] },
  { id: 'location', label: '장소', icon: MapPin, categories: ['location_detail'], entityCategories: ['location'] },
  { id: 'item', label: '아이템', icon: Package, categories: ['item_detail'], entityCategories: ['item'] },
  { id: 'event', label: '사건', icon: Zap, categories: ['event'], entityCategories: ['event'] },
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

  // 엔티티가 현재 탭에 해당하는지 판별
  const matchesTab = (entityName: string, entry: LoreEntry, tab: TabConfig): boolean => {
    if (tab.id === 'all') return true;
    const tabCats = tab.categories;
    if (tab.id === 'character') {
      const kgCat = entityCategoryMap[entityName];
      const isCharEntity = kgCat && (tab.entityCategories || []).includes(kgCat);
      const isCharCategory = tabCats.includes(entry.category);
      return (isCharEntity && isCharCategory) || (!kgCat && isCharCategory);
    }
    return tabCats.includes(entry.category);
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
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* 탭 */}
          <div className="flex items-center gap-1">
            {TABS.filter(tab => tabCounts[tab.id] > 0).map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setExpandedCards(new Set()); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  <span className={`text-[10px] ${isActive ? 'text-blue-400' : 'text-gray-400'}`}>
                    {tabCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 구분선 */}
          <div className="h-5 w-px bg-gray-200" />

          {/* 검색 */}
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-300 bg-gray-50"
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

          <span className="text-[11px] text-gray-400 ml-auto">{entityCards.length}개 항목</span>
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
          <div className="max-w-5xl mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {entityCards.map(card => {
              const isExpanded = expandedCards.has(card.name);
              const kgCat = entityCategoryMap[card.name];
              const EntityIcon = getEntityIcon(kgCat);

              // 카테고리별 그룹핑
              const byCategory: Record<string, LoreEntry[]> = {};
              for (const entry of card.entries) {
                if (!byCategory[entry.category]) byCategory[entry.category] = [];
                byCategory[entry.category].push(entry);
              }
              // 정렬
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
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                >
                  {/* 카드 헤더 */}
                  <button
                    onClick={() => toggleCard(card.name)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    }
                    <EntityIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="text-sm font-semibold text-gray-900 flex-1 truncate">{card.name}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{card.count}</span>
                  </button>

                  {/* 접힌 상태: 카테고리 뱃지 */}
                  {!isExpanded && categoryBadges.length > 0 && (
                    <div className="px-4 pb-2.5 flex flex-wrap gap-1">
                      {categoryBadges.map(({ cat, config, count }) => (
                        <span
                          key={cat}
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: config.color + '12', color: config.color }}
                        >
                          {config.label} {count}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 펼친 상태: 카테고리별 세부 정보 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {orderedCats.map(cat => {
                        const config = CATEGORY_CONFIG[cat];
                        const Icon = config.icon;
                        const catEntries = byCategory[cat];

                        return (
                          <div key={cat}>
                            {/* 카테고리 서브헤더 */}
                            <div className="flex items-center gap-1.5 px-4 py-2 bg-gray-50/70">
                              <Icon className="w-3 h-3" style={{ color: config.color }} />
                              <span className="text-[11px] font-semibold" style={{ color: config.color }}>
                                {config.label}
                              </span>
                              <span className="text-[10px] text-gray-400">{catEntries.length}</span>
                            </div>

                            {/* 엔트리 */}
                            <div className="divide-y divide-gray-50">
                              {catEntries.map(entry => (
                                <div key={entry.id} className="px-4 py-2">
                                  <p className="text-[13px] text-gray-700 leading-relaxed">{entry.content}</p>
                                  {entry.quote && (
                                    <div className="mt-1 pl-2 border-l-2 border-purple-200">
                                      <p className="text-xs text-purple-600/80 italic leading-relaxed flex items-start gap-1">
                                        <Quote className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 opacity-60" />
                                        {entry.quote}
                                      </p>
                                    </div>
                                  )}
                                  <span className="text-[10px] text-gray-400 mt-0.5 block">
                                    장면 {sceneOrderMap[entry.sceneId] ?? '?'}
                                  </span>
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
