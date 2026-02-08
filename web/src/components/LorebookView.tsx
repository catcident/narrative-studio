/**
 * 로어북 뷰어 — 인물 프로필, 세계관, 대사 등을 카테고리/인물별로 탐색
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Globe, Search, ChevronDown, ChevronRight,
  Quote, Eye, Shirt, Brain, Swords, History, Target, Users,
  MapPin, Building, Package, Zap, MessageSquareQuote, X,
} from 'lucide-react';
import { useStore } from '../store';
import type { LoreEntry, LoreCategory } from '../types';

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

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as LoreCategory[];

type ViewBy = 'entity' | 'category' | 'scene';

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [viewBy, setViewBy] = useState<ViewBy>('entity');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<LoreCategory | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 로어북 엔트리 배열
  const entries = useMemo(() => {
    if (!knowledgeGraph?.lorebook) return [];
    return Object.values(knowledgeGraph.lorebook.entries);
  }, [knowledgeGraph]);

  // 필터링
  const filtered = useMemo(() => {
    let result = entries;
    if (selectedCategory) {
      result = result.filter(e => e.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.entityName.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (e.quote && e.quote.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, selectedCategory, searchQuery]);

  // 장면 순서 매핑
  const sceneOrderMap = useMemo(() => {
    if (!knowledgeGraph?.snapshots) return {};
    const map: Record<string, number> = {};
    Object.entries(knowledgeGraph.snapshots).forEach(([id, snap]) => {
      map[id] = snap.order;
    });
    return map;
  }, [knowledgeGraph]);

  // 그룹핑 (공통)
  const sortByScene = (arr: LoreEntry[]) =>
    arr.sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));

  const grouped = useMemo(() => {
    const groups: Record<string, LoreEntry[]> = {};
    for (const entry of filtered) {
      const key = viewBy === 'entity' ? entry.entityName
                : viewBy === 'category' ? entry.category
                : entry.sceneId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    }
    for (const key of Object.keys(groups)) sortByScene(groups[key]);

    const entries = Object.entries(groups);
    if (viewBy === 'entity') return entries.sort((a, b) => b[1].length - a[1].length);
    if (viewBy === 'category') {
      const order = ALL_CATEGORIES as string[];
      return entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    }
    return entries.sort((a, b) => (sceneOrderMap[a[0]] ?? 0) - (sceneOrderMap[b[0]] ?? 0));
  }, [filtered, viewBy, sceneOrderMap]);

  const uniqueEntityCount = useMemo(() => {
    const names = new Set(filtered.map(e => e.entityName));
    return names.size;
  }, [filtered]);

  // 카테고리별 카운트
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.category] = (counts[e.category] || 0) + 1;
    return counts;
  }, [entries]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const getSceneLabel = (sceneId: string) => {
    const snap = knowledgeGraph?.snapshots?.[sceneId];
    if (!snap) return sceneId;
    return `장면 ${snap.order}${snap.summary ? ` — ${snap.summary.slice(0, 30)}` : ''}`;
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

  // ─── 엔트리 카드 ───

  const renderEntry = (entry: LoreEntry, showEntity: boolean, showScene: boolean) => {
    const config = CATEGORY_CONFIG[entry.category];
    const Icon = config.icon;

    return (
      <div key={entry.id} className="py-2.5 px-3 hover:bg-gray-50 rounded-lg transition-colors">
        {/* 메타 라인 */}
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className="w-3 h-3 flex-shrink-0" style={{ color: config.color }} />
          {showEntity && (
            <span className="text-xs font-semibold text-gray-700">{entry.entityName}</span>
          )}
          <span
            className="text-[10px] px-1.5 py-px rounded font-medium"
            style={{ backgroundColor: config.color + '15', color: config.color }}
          >
            {config.label}
          </span>
          {showScene && (
            <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
              장면 {sceneOrderMap[entry.sceneId] ?? '?'}
            </span>
          )}
        </div>

        {/* 내용 */}
        <p className="text-[13px] text-gray-700 leading-relaxed pl-[18px]">{entry.content}</p>

        {/* 인용문 */}
        {entry.quote && (
          <div className="mt-1.5 ml-[18px] pl-2.5 border-l-2 border-purple-200">
            <p className="text-xs text-purple-600/80 italic leading-relaxed flex items-start gap-1">
              <Quote className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 opacity-60" />
              {entry.quote}
            </p>
          </div>
        )}
      </div>
    );
  };

  // ─── 그룹 헤더 ───

  const getGroupHeader = (groupKey: string): { label: string; icon: React.ReactNode } => {
    if (viewBy === 'entity') {
      const entity = Object.values(knowledgeGraph.entities).find(e => e.name === groupKey);
      return {
        label: groupKey,
        icon: entity?.category === 'character'
          ? <User className="w-3.5 h-3.5 text-blue-500" />
          : <Globe className="w-3.5 h-3.5 text-emerald-500" />,
      };
    }
    if (viewBy === 'category') {
      const config = CATEGORY_CONFIG[groupKey as LoreCategory];
      const CatIcon = config?.icon || Zap;
      return {
        label: config?.label || groupKey,
        icon: <CatIcon className="w-3.5 h-3.5" style={{ color: config?.color }} />,
      };
    }
    return {
      label: getSceneLabel(groupKey),
      icon: <div className="w-3.5 h-3.5 rounded bg-blue-100 flex items-center justify-center text-[8px] font-bold text-blue-600">{sceneOrderMap[groupKey] ?? '?'}</div>,
    };
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-gray-200">
        {/* 상단: 제목 + 보기방식 */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-bold text-gray-800">로어북</h2>
            <span className="text-xs text-gray-400">
              {filtered.length}개 기록 · {uniqueEntityCount}개 엔티티
            </span>
          </div>

          <div className="flex bg-gray-100 rounded-md p-0.5">
            {([
              { id: 'entity' as ViewBy, label: '엔티티별' },
              { id: 'category' as ViewBy, label: '카테고리별' },
              { id: 'scene' as ViewBy, label: '장면별' },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => { setViewBy(tab.id); setExpandedGroups(new Set()); }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewBy === tab.id
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 하단: 검색 + 카테고리 필터 */}
        <div className="flex items-center gap-2">
          <div className="relative w-52">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-300 focus:border-purple-300 bg-gray-50"
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

          <div className="h-4 w-px bg-gray-200" />

          {/* 카테고리 필터 */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {ALL_CATEGORIES.filter(c => categoryCounts[c]).map(cat => {
              const config = CATEGORY_CONFIG[cat];
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(isActive ? null : cat)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'text-white'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                  style={isActive ? { backgroundColor: config.color } : undefined}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto p-3 space-y-1">
          {grouped.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs">검색 결과가 없습니다</p>
            </div>
          ) : (
            grouped.map(([groupKey, groupEntries]) => {
              const isExpanded = expandedGroups.has(groupKey);
              const { label, icon } = getGroupHeader(groupKey);

              return (
                <div key={groupKey} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    }
                    {icon}
                    <span className="text-sm font-medium text-gray-800 flex-1 truncate">{label}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{groupEntries.length}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-50 divide-y divide-gray-50">
                      {groupEntries.map(entry => renderEntry(
                        entry,
                        viewBy !== 'entity',
                        viewBy !== 'scene',
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
