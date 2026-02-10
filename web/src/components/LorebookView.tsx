/**
 * 인물 카드 뷰어 — 왼쪽 포켓몬 스타일 카드 그리드 + 오른쪽 상세 패널
 * 캐릭터/크리처 엔티티의 프로필 정보만 표시 (세계관 설정은 WorldView에서 표시)
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, User, Search, Quote, Eye, Shirt, Brain, Swords,
  History, Target, Users, X, Cat, Box, Globe,
  ChevronDown, ChevronRight, RefreshCw, Loader2,
} from 'lucide-react';
import { useStore } from '../store';
import { useLorebookExtraction } from '../hooks/useLorebookExtraction';
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
  appearance:           { label: '외모',   icon: Eye,    color: '#be185d', bg: '#fdf2f8', border: '#fbcfe8' },
  outfit:               { label: '복장',   icon: Shirt,  color: '#c2410c', bg: '#fff7ed', border: '#fed7aa' },
  personality:          { label: '성격',   icon: Brain,  color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
  ability:              { label: '능력',   icon: Swords, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  background:           { label: '배경',   icon: History, color: '#4338ca', bg: '#eef2ff', border: '#c7d2fe' },
  motivation:           { label: '동기',   icon: Target, color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  relationship_detail:  { label: '관계',   icon: Users,  color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  lore:                 { label: '설정',   icon: Globe,  color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
};

const CHARACTER_CATEGORIES: LoreCategory[] = [
  'appearance', 'outfit', 'personality', 'ability', 'background',
  'motivation', 'relationship_detail',
];


function getEntityIcon(category?: EntityCategory) {
  switch (category) {
    case 'character': return User;
    case 'creature': return Cat;
    default: return Box;
  }
}

/** 엔티티 카테고리별 카드 테마 컬러 */
function getCardTheme(category?: EntityCategory): {
  gradient: string; border: string; iconBg: string; iconColor: string; accent: string; glow: string;
} {
  switch (category) {
    case 'character': return {
      gradient: 'from-blue-500 to-indigo-600',
      border: '#818cf8', iconBg: '#eef2ff', iconColor: '#4f46e5',
      accent: '#6366f1', glow: 'rgba(99,102,241,0.15)',
    };
    case 'creature': return {
      gradient: 'from-amber-500 to-orange-600',
      border: '#f59e0b', iconBg: '#fffbeb', iconColor: '#d97706',
      accent: '#f59e0b', glow: 'rgba(245,158,11,0.15)',
    };
    default: return {
      gradient: 'from-cyan-500 to-sky-600',
      border: '#06b6d4', iconBg: '#ecfeff', iconColor: '#0891b2',
      accent: '#06b6d4', glow: 'rgba(6,182,212,0.15)',
    };
  }
}

interface EntityCardData {
  name: string;
  entries: LoreEntry[];
  count: number;
}

export function LorebookView() {
  const knowledgeGraph = useStore((s) => s.knowledgeGraph);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const { extractLorebook, isExtracting, progress, progressCurrent, progressTotal } = useLorebookExtraction();

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

  // 캐릭터/크리처 엔티티의 인물 카테고리 엔트리만 필터
  const entityCards = useMemo(() => {
    const entityMap: Record<string, LoreEntry[]> = {};
    for (const entry of entries) {
      // lore 카테고리 제외 (세계관 탭에서 표시)
      if (!CHARACTER_CATEGORIES.includes(entry.category)) continue;
      // 비인물 엔티티 제외
      const kgCat = entityCategoryMap[entry.entityName];
      if (kgCat && kgCat !== 'character' && kgCat !== 'creature') continue;

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
  }, [entries, entityCategoryMap, searchQuery]);

  const selectedCard = useMemo(() => {
    if (!selectedEntity) return null;
    return entityCards.find(c => c.name === selectedEntity) || null;
  }, [selectedEntity, entityCards]);

  // ─── 빈 상태 ───

  if (!knowledgeGraph) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <BookOpen aria-hidden="true" className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">데이터를 불러와주세요</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <BookOpen aria-hidden="true" className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500 font-medium">인물 카드 데이터가 없습니다</p>
          <p className="text-xs mt-1 text-gray-400">소설을 분석하면 인물 프로필이 추출됩니다</p>
          {isExtracting ? (
            <div className="mt-4 space-y-2" role="status">
              <div className="flex items-center justify-center gap-2 text-sm text-purple-600">
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                <span>{progress}</span>
              </div>
              {progressTotal > 0 && (
                <div className="w-48 mx-auto">
                  <div
                    className="h-1.5 bg-gray-200 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={progressCurrent}
                    aria-valuemin={0}
                    aria-valuemax={progressTotal}
                  >
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((progressCurrent / progressTotal) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{progressCurrent} / {progressTotal}</p>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => extractLorebook(knowledgeGraph)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
            >
              <BookOpen aria-hidden="true" className="w-4 h-4" />
              로어북 추출
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* ─── 헤더: 검색 + 갱신 ─── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{entityCards.length}명</span>
          <div className="relative w-48">
            <Search aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
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
                aria-label="검색 지우기"
              >
                <X aria-hidden="true" className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => extractLorebook(knowledgeGraph)}
            disabled={isExtracting}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isExtracting ? (
              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" />
            )}
            로어북 갱신
          </button>
        </div>
      </div>

      {/* ─── 추출 진행 배너 ─── */}
      {isExtracting && (
        <div className="flex-shrink-0 bg-purple-50 border-b border-purple-200 px-4 py-2" role="status">
          <div className="flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-3.5 h-3.5 text-purple-600 animate-spin" />
            <span className="text-xs text-purple-700">{progress}</span>
            {progressTotal > 0 && (
              <>
                <div
                  className="flex-1 h-1.5 bg-purple-200 rounded-full overflow-hidden max-w-xs"
                  role="progressbar"
                  aria-valuenow={progressCurrent}
                  aria-valuemin={0}
                  aria-valuemax={progressTotal}
                >
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((progressCurrent / progressTotal) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-purple-500">{progressCurrent}/{progressTotal}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 메인: 왼쪽 카드 그리드 + 오른쪽 상세 ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* 왼쪽: 카드 그리드 */}
        <div className={`overflow-y-auto p-4 ${selectedCard ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
          {entityCards.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Search aria-hidden="true" className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs">검색 결과가 없습니다</p>
            </div>
          ) : (
            <div className={`grid gap-3 ${
              selectedCard
                ? 'grid-cols-2 xl:grid-cols-3'
                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
            }`}>
              {entityCards.map(card => (
                <PokemonCard
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

// ─── 포켓몬 스타일 카드 ───

function PokemonCard({
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
  const theme = getCardTheme(kgCategory);
  const uniqueCats = new Set(card.entries.map(e => e.category));

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        isSelected ? 'ring-2 shadow-lg scale-[1.02]' : 'shadow-md'
      }`}
      style={{
        borderWidth: '2px',
        borderStyle: 'solid',
        borderColor: isSelected ? theme.accent : theme.border + '60',
        boxShadow: isSelected ? `0 4px 20px ${theme.glow}` : undefined,
        ringColor: theme.accent,
      }}
    >
      {/* 카드 상단 그라데이션 헤더 */}
      <div
        className={`bg-gradient-to-r ${theme.gradient} px-3 py-2.5 flex items-center gap-2`}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
          style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
        >
          <EntityIcon aria-hidden="true" className="w-3.5 h-3.5" style={{ color: theme.iconColor }} />
        </div>
        <span className="text-xs font-bold text-white truncate flex-1 drop-shadow-sm">
          {card.name}
        </span>
      </div>

      {/* 카드 바디 */}
      <div className="bg-white px-3 py-2.5">
        {/* 카테고리 뱃지 */}
        <div className="flex flex-wrap gap-1 mb-2">
          {Array.from(uniqueCats).slice(0, 4).map(cat => {
            const config = CATEGORY_CONFIG[cat as LoreCategory];
            if (!config) return null;
            return (
              <span
                key={cat}
                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: config.bg, color: config.color, border: `1px solid ${config.border}` }}
              >
                {config.label}
              </span>
            );
          })}
          {uniqueCats.size > 4 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500">
              +{uniqueCats.size - 4}
            </span>
          )}
        </div>

        {/* 대표 내용 미리보기 (첫 항목) */}
        <p className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed">
          {card.entries[0]?.content || ''}
        </p>
      </div>

      {/* 카드 하단 풋터 */}
      <div
        className="px-3 py-1.5 flex items-center justify-between"
        style={{ backgroundColor: theme.glow }}
      >
        <span className="text-[10px] font-bold" style={{ color: theme.accent }}>
          {card.count}개 항목
        </span>
        <span className="text-[9px] text-gray-400">
          {uniqueCats.size}종
        </span>
      </div>
    </button>
  );
}

// ─── 상세 패널 (오른쪽) — 카테고리별 접기/펼치기 ───

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
  const theme = getCardTheme(kgCategory);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // 카테고리별 그룹핑
  const byCategory: Record<string, LoreEntry[]> = {};
  for (const entry of card.entries) {
    if (!byCategory[entry.category]) byCategory[entry.category] = [];
    byCategory[entry.category].push(entry);
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => (sceneOrderMap[a.sceneId] ?? 0) - (sceneOrderMap[b.sceneId] ?? 0));
  }

  const orderedCats = CHARACTER_CATEGORIES.filter(cat => byCategory[cat]?.length);

  return (
    <div className="w-1/2 h-full flex flex-col bg-white">
      {/* 헤더 — 그라데이션 */}
      <div className={`flex-shrink-0 bg-gradient-to-r ${theme.gradient} px-4 py-3 flex items-center gap-3`}>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
          style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
        >
          <EntityIcon aria-hidden="true" className="w-5 h-5" style={{ color: theme.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white truncate drop-shadow-sm">{card.name}</h2>
          <p className="text-[11px] text-white/70">{card.count}개 항목</p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="p-1 rounded-md hover:bg-white/20 text-white/80 hover:text-white transition-colors"
        >
          <X aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {/* 카테고리별 내용 — 접기/펼치기 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {orderedCats.map(cat => {
          const config = CATEGORY_CONFIG[cat];
          const Icon = config.icon;
          const catEntries = byCategory[cat];
          const isCollapsed = collapsedCats.has(cat);
          const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;

          return (
            <div
              key={cat}
              className="rounded-lg overflow-hidden"
              style={{ border: `1.5px solid ${config.border}` }}
            >
              {/* 카테고리 헤더 — 클릭으로 접기/펼치기 */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:brightness-95 transition-all cursor-pointer"
                style={{ backgroundColor: config.bg }}
              >
                <ChevronIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: config.color }} />
                <Icon aria-hidden="true" className="w-3.5 h-3.5" style={{ color: config.color }} />
                <span className="text-xs font-bold" style={{ color: config.color }}>
                  {config.label}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: config.color + '18', color: config.color }}
                >
                  {catEntries.length}
                </span>
              </button>

              {/* 엔트리 목록 — 접혀있으면 숨김 */}
              {!isCollapsed && (
                <div className="bg-white divide-y divide-gray-100">
                  {catEntries.map(entry => (
                    <div key={entry.id} className="px-3 py-3">
                      <p className="text-[13px] text-gray-800 leading-relaxed">{entry.content}</p>
                      {entry.quote && (
                        <div
                          className="mt-2 px-3 py-2 rounded-md"
                          style={{ backgroundColor: '#faf5ff', borderLeft: `3px solid ${config.color}40` }}
                        >
                          <p className="text-xs text-purple-700 italic leading-relaxed flex items-start gap-1.5">
                            <Quote aria-hidden="true" className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-70" />
                            {entry.quote}
                          </p>
                        </div>
                      )}
                      <span className="text-[10px] text-gray-400 font-medium mt-1.5 block">
                        장면 {sceneOrderMap[entry.sceneId] ?? (parseInt(entry.sceneId.replace(/\D/g, ''), 10) || entry.sceneId)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
