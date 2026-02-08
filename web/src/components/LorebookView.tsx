/**
 * 로어북 뷰어 — 인물 프로필, 세계관, 대사 등을 카테고리/인물별로 탐색
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Globe, Filter, Search, ChevronDown, ChevronRight,
  Quote, Eye, Shirt, Brain, Swords, History, Target, Users,
  MapPin, Building, Package, Zap, MessageSquareQuote,
} from 'lucide-react';
import { useStore } from '../store';
import type { LoreEntry, LoreCategory } from '../types';

// ─── 카테고리 설정 ───

type CategoryGroup = 'character' | 'world';

interface CategoryConfig {
  label: string;
  icon: typeof Eye;
  color: string;
  group: CategoryGroup;
}

const CATEGORY_CONFIG: Record<LoreCategory, CategoryConfig> = {
  appearance:           { label: '외모',     icon: Eye,                color: '#ec4899', group: 'character' },
  outfit:               { label: '복장',     icon: Shirt,              color: '#f97316', group: 'character' },
  personality:          { label: '성격',     icon: Brain,              color: '#8b5cf6', group: 'character' },
  ability:              { label: '능력',     icon: Swords,             color: '#ef4444', group: 'character' },
  background:           { label: '배경',     icon: History,            color: '#6366f1', group: 'character' },
  motivation:           { label: '동기',     icon: Target,             color: '#14b8a6', group: 'character' },
  relationship_detail:  { label: '관계',     icon: Users,              color: '#3b82f6', group: 'character' },
  quote:                { label: '대사',     icon: MessageSquareQuote, color: '#d946ef', group: 'character' },
  world_setting:        { label: '세계관',   icon: Globe,              color: '#0ea5e9', group: 'world' },
  location_detail:      { label: '장소',     icon: MapPin,             color: '#22c55e', group: 'world' },
  organization_detail:  { label: '조직',     icon: Building,           color: '#a855f7', group: 'world' },
  item_detail:          { label: '아이템',   icon: Package,            color: '#f59e0b', group: 'world' },
  event:                { label: '사건',     icon: Zap,                color: '#e11d48', group: 'world' },
};

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as LoreCategory[];
const CHARACTER_CATEGORIES = ALL_CATEGORIES.filter(c => CATEGORY_CONFIG[c].group === 'character');
const WORLD_CATEGORIES = ALL_CATEGORIES.filter(c => CATEGORY_CONFIG[c].group === 'world');

type ViewBy = 'entity' | 'category' | 'scene';

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [viewBy, setViewBy] = useState<ViewBy>('entity');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<LoreCategory>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 로어북 엔트리 배열
  const entries = useMemo(() => {
    if (!knowledgeGraph?.lorebook) return [];
    return Object.values(knowledgeGraph.lorebook.entries);
  }, [knowledgeGraph]);

  // 필터링
  const filtered = useMemo(() => {
    let result = entries;

    // 카테고리 필터
    if (selectedCategories.size > 0) {
      result = result.filter(e => selectedCategories.has(e.category));
    }

    // 검색 필터
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.entityName.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (e.quote && e.quote.toLowerCase().includes(q))
      );
    }

    return result;
  }, [entries, selectedCategories, searchQuery]);

  // 장면 순서 매핑 (sceneId → order)
  const sceneOrderMap = useMemo(() => {
    if (!knowledgeGraph?.snapshots) return {};
    const map: Record<string, number> = {};
    Object.entries(knowledgeGraph.snapshots).forEach(([id, snap]) => {
      map[id] = snap.order;
    });
    return map;
  }, [knowledgeGraph]);

  // 엔티티별 그룹핑
  const byEntity = useMemo(() => {
    const groups: Record<string, LoreEntry[]> = {};
    for (const entry of filtered) {
      if (!groups[entry.entityName]) groups[entry.entityName] = [];
      groups[entry.entityName].push(entry);
    }
    // 각 그룹 내에서 장면 순 정렬
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
    }
    // 엔트리 수 내림차순으로 엔티티 정렬
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, sceneOrderMap]);

  // 카테고리별 그룹핑
  const byCategory = useMemo(() => {
    const groups: Record<string, LoreEntry[]> = {};
    for (const entry of filtered) {
      if (!groups[entry.category]) groups[entry.category] = [];
      groups[entry.category].push(entry);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
    }
    return ALL_CATEGORIES
      .filter(c => groups[c]?.length)
      .map(c => [c, groups[c]!] as [string, LoreEntry[]]);
  }, [filtered, sceneOrderMap]);

  // 장면별 그룹핑
  const byScene = useMemo(() => {
    const groups: Record<string, LoreEntry[]> = {};
    for (const entry of filtered) {
      if (!groups[entry.sceneId]) groups[entry.sceneId] = [];
      groups[entry.sceneId].push(entry);
    }
    // 장면 순서로 정렬
    return Object.entries(groups).sort((a, b) =>
      (sceneOrderMap[a[0]] ?? 0) - (sceneOrderMap[b[0]] ?? 0)
    );
  }, [filtered, sceneOrderMap]);

  const toggleCategory = (cat: LoreCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 장면 라벨
  const getSceneLabel = (sceneId: string) => {
    const snap = knowledgeGraph?.snapshots?.[sceneId];
    if (!snap) return sceneId;
    const order = snap.order;
    const summary = snap.summary ? ` — ${snap.summary.slice(0, 40)}` : '';
    return `장면 ${order}${summary}`;
  };

  // ─── 빈 상태 ───

  if (!knowledgeGraph) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center text-gray-400">
          <BookOpen className="w-16 h-16 mx-auto mb-3 opacity-30" />
          <p>데이터를 불러와주세요</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center p-8 bg-white/60 rounded-3xl">
          <BookOpen className="w-16 h-16 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-600 font-medium">로어북 데이터가 없습니다</p>
          <p className="text-sm mt-2 text-gray-400">
            소설을 새로 분석하면 인물 프로필, 세계관, 대사 등이 추출됩니다
          </p>
        </div>
      </div>
    );
  }

  // ─── 엔트리 카드 ───

  const renderEntry = (entry: LoreEntry, showEntity: boolean = true, showScene: boolean = true) => {
    const config = CATEGORY_CONFIG[entry.category];
    const Icon = config.icon;

    return (
      <div
        key={entry.id}
        className="group p-3 bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all"
      >
        <div className="flex items-start gap-2">
          {/* 카테고리 아이콘 */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: config.color + '18' }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
          </div>

          <div className="flex-1 min-w-0">
            {/* 헤더: 엔티티명 + 카테고리 + 장면 */}
            <div className="flex items-center gap-2 flex-wrap">
              {showEntity && (
                <span className="text-sm font-semibold text-gray-800">{entry.entityName}</span>
              )}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                style={{ backgroundColor: config.color }}
              >
                {config.label}
              </span>
              {showScene && (
                <span className="text-[10px] text-gray-400">
                  {getSceneLabel(entry.sceneId)}
                </span>
              )}
            </div>

            {/* 내용 */}
            <p className="text-sm text-gray-700 mt-1 leading-relaxed">{entry.content}</p>

            {/* 인용문 */}
            {entry.quote && (
              <div className="mt-2 flex items-start gap-1.5 pl-2 border-l-2 border-purple-200">
                <Quote className="w-3 h-3 text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-purple-700 italic leading-relaxed">
                  &ldquo;{entry.quote}&rdquo;
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── 그룹 렌더링 ───

  const renderGroupedEntries = () => {
    const data = viewBy === 'entity' ? byEntity
               : viewBy === 'category' ? byCategory
               : byScene;

    if (data.length === 0) {
      return (
        <div className="text-center py-12 text-gray-400">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">검색 결과가 없습니다</p>
        </div>
      );
    }

    return data.map(([groupKey, groupEntries]) => {
      const isExpanded = expandedGroups.has(groupKey);
      const count = groupEntries.length;

      // 그룹 헤더 라벨
      let label: string;
      let icon: React.ReactNode = null;
      if (viewBy === 'entity') {
        label = groupKey;
        // 엔티티 이름으로 KG에서 카테고리 조회
        const entity = knowledgeGraph ? Object.values(knowledgeGraph.entities).find(e => e.name === groupKey) : null;
        if (entity?.category === 'character') {
          icon = <User className="w-4 h-4 text-blue-500" />;
        } else {
          icon = <Globe className="w-4 h-4 text-emerald-500" />;
        }
      } else if (viewBy === 'category') {
        const config = CATEGORY_CONFIG[groupKey as LoreCategory];
        label = config?.label || groupKey;
        const CatIcon = config?.icon || Zap;
        icon = <CatIcon className="w-4 h-4" style={{ color: config?.color }} />;
      } else {
        label = getSceneLabel(groupKey);
        icon = <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-600">{sceneOrderMap[groupKey] ?? '?'}</div>;
      }

      return (
        <div key={groupKey} className="mb-2">
          {/* 그룹 헤더 */}
          <button
            onClick={() => toggleGroup(groupKey)}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors text-left"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            )}
            {icon}
            <span className="font-semibold text-sm text-gray-800 flex-1 truncate">{label}</span>
            <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">{count}</span>
          </button>

          {/* 그룹 내용 */}
          {isExpanded && (
            <div className="mt-1.5 ml-6 space-y-1.5">
              {groupEntries.map(entry => renderEntry(
                entry,
                viewBy !== 'entity',  // 엔티티뷰에서는 이름 숨김
                viewBy !== 'scene',   // 장면뷰에서는 장면 숨김
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── 카테고리 카운트 ───

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-white to-purple-50">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">로어북</h2>
              <p className="text-xs text-gray-500">
                {entries.length}개 기록 · {byEntity.length}개 엔티티
              </p>
            </div>
          </div>

          {/* 보기 방식 */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {([
              { id: 'entity' as ViewBy, label: '엔티티별' },
              { id: 'category' as ViewBy, label: '카테고리별' },
              { id: 'scene' as ViewBy, label: '장면별' },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => { setViewBy(tab.id); setExpandedGroups(new Set()); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewBy === tab.id
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 검색 + 카테고리 필터 */}
        <div className="flex items-center gap-3">
          {/* 검색 */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="이름, 내용, 대사 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-300"
            />
          </div>

          {/* 카테고리 필터 칩 */}
          <div className="flex items-center gap-1 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-gray-400 mr-1" />
            {ALL_CATEGORIES.filter(c => categoryCounts[c]).map(cat => {
              const config = CATEGORY_CONFIG[cat];
              const isActive = selectedCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${
                    isActive
                      ? 'text-white shadow-sm'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  style={isActive ? { backgroundColor: config.color } : undefined}
                >
                  {config.label}
                  <span className={isActive ? 'opacity-80' : 'text-gray-400'}>
                    {categoryCounts[cat] || 0}
                  </span>
                </button>
              );
            })}
            {selectedCategories.size > 0 && (
              <button
                onClick={() => setSelectedCategories(new Set())}
                className="text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-1"
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto">
          {renderGroupedEntries()}
        </div>
      </div>

      {/* 하단 요약 */}
      <div className="flex-shrink-0 px-6 py-2.5 bg-white/80 backdrop-blur border-t border-gray-100">
        <div className="flex items-center gap-4 text-xs overflow-x-auto">
          <span className="text-gray-400 flex-shrink-0">인물:</span>
          {CHARACTER_CATEGORIES.filter(c => categoryCounts[c]).map(cat => {
            const config = CATEGORY_CONFIG[cat];
            return (
              <div key={cat} className="flex items-center gap-1 flex-shrink-0">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-gray-500">{config.label} <span className="font-bold text-gray-700">{categoryCounts[cat]}</span></span>
              </div>
            );
          })}
          <span className="text-gray-300">|</span>
          <span className="text-gray-400 flex-shrink-0">세계:</span>
          {WORLD_CATEGORIES.filter(c => categoryCounts[c]).map(cat => {
            const config = CATEGORY_CONFIG[cat];
            return (
              <div key={cat} className="flex items-center gap-1 flex-shrink-0">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-gray-500">{config.label} <span className="font-bold text-gray-700">{categoryCounts[cat]}</span></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
