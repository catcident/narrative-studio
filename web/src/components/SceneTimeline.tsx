/**
 * 장면 타임라인 컴포넌트
 * 시간 흐름이 보이는 시각적 타임라인
 * 범위 선택 기능 지원
 *
 * ⚠️ 중요: 장면은 반드시 순서대로(1,2,3,4...) 렌더링해야 함!
 *
 * 잘못된 방식 (화별 그룹화):
 *   scenes: [장면1(1화), 장면2(2화), 장면3(1화)]
 *   그룹화 후: 1화그룹(장면1,장면3) → 2화그룹(장면2)
 *   화면: 1, 3, 2 ← 순서 뒤죽박죽!
 *
 * 올바른 방식 (순서대로 렌더링):
 *   scenes를 그대로 map으로 렌더링
 *   화가 바뀔 때만 구분선 표시
 *   화면: 1, 2, 3 ← 순서 정상!
 */

import { useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, Minus, Search, X } from 'lucide-react';

interface Scene {
  sceneId: string;
  time?: string;
  location?: string;
  summary?: string;
  mood?: string;
  events?: string[];
  order?: number;
  chapter?: string | null;
  chapterNumber?: number | null;
}

interface Chapter {
  id: string;
  number: number;
  title: string;
  summary?: string;
}

interface Props {
  scenes: [string, Scene][];
  chapters?: Record<string, Chapter>;
  selectedSceneId: string | null;
  sceneRangeStart: string | null;
  sceneRangeEnd: string | null;
  onSelectScene: (sceneId: string | null) => void;
  onSelectRange: (start: string | null, end: string | null) => void;
}

export function SceneTimeline({
  scenes,
  chapters,
  selectedSceneId,
  sceneRangeStart,
  sceneRangeEnd,
  onSelectScene,
  onSelectRange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [rangeSelecting, setRangeSelecting] = useState<'start' | 'end' | null>(null);
  const [showJumpInput, setShowJumpInput] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

  // 현재 선택된 장면 인덱스
  const currentIndex = selectedSceneId
    ? scenes.findIndex(([id]) => id === selectedSceneId)
    : -1;

  // 범위 인덱스
  const rangeStartIndex = sceneRangeStart
    ? scenes.findIndex(([id]) => id === sceneRangeStart)
    : -1;
  const rangeEndIndex = sceneRangeEnd
    ? scenes.findIndex(([id]) => id === sceneRangeEnd)
    : -1;

  // 스크롤 상태 업데이트
  const updateScrollState = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    updateScrollState();
    const ref = scrollRef.current;
    if (ref) {
      ref.addEventListener('scroll', updateScrollState);
      return () => ref.removeEventListener('scroll', updateScrollState);
    }
  }, [scenes]);

  // 선택된 장면으로 스크롤
  useEffect(() => {
    if (selectedSceneId && scrollRef.current) {
      const selectedEl = scrollRef.current.querySelector(`[data-scene-id="${selectedSceneId}"]`);
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedSceneId]);

  // 자동 재생
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      const nextIndex = currentIndex + 1;
      if (nextIndex >= scenes.length) {
        setIsPlaying(false);
      } else {
        onSelectScene(scenes[nextIndex][0]);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [isPlaying, currentIndex, scenes, onSelectScene]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 300;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const prevScene = () => {
    if (currentIndex > 0) {
      onSelectScene(scenes[currentIndex - 1][0]);
    }
  };

  const nextScene = () => {
    if (currentIndex < scenes.length - 1) {
      onSelectScene(scenes[currentIndex + 1][0]);
    } else if (currentIndex === -1 && scenes.length > 0) {
      onSelectScene(scenes[0][0]);
    }
  };

  const togglePlay = () => {
    if (!isPlaying && currentIndex === -1) {
      onSelectScene(scenes[0][0]);
    }
    setIsPlaying(!isPlaying);
  };

  // 장면으로 점프
  const jumpToScene = (index: number) => {
    if (index >= 0 && index < scenes.length) {
      onSelectScene(scenes[index][0]);
    }
  };

  // 점프 입력 처리
  const handleJumpSubmit = () => {
    const num = parseInt(jumpValue);
    if (!isNaN(num) && num >= 1 && num <= scenes.length) {
      jumpToScene(num - 1);
      setShowJumpInput(false);
      setJumpValue('');
    }
  };

  // 범위 모드 토글
  const toggleRangeMode = () => {
    if (isRangeMode) {
      // 범위 모드 종료
      setIsRangeMode(false);
      setRangeSelecting(null);
      onSelectRange(null, null);
    } else {
      // 범위 모드 시작
      setIsRangeMode(true);
      setRangeSelecting('start');
      onSelectScene(null);
    }
  };

  // 장면 클릭 핸들러
  const handleSceneClick = (sceneId: string, index: number) => {
    if (isRangeMode) {
      if (rangeSelecting === 'start') {
        onSelectRange(sceneId, null);
        setRangeSelecting('end');
      } else if (rangeSelecting === 'end') {
        // 시작보다 앞이면 swap
        if (index < rangeStartIndex) {
          onSelectRange(sceneId, sceneRangeStart);
        } else {
          onSelectRange(sceneRangeStart, sceneId);
        }
        setRangeSelecting(null);
      } else {
        // 이미 범위가 설정되어 있으면 다시 시작
        onSelectRange(sceneId, null);
        setRangeSelecting('end');
      }
    } else {
      onSelectScene(sceneId);
    }
  };

  // 인덱스가 범위 안에 있는지 확인
  const isInRange = (index: number): boolean => {
    if (rangeStartIndex === -1) return false;
    if (rangeEndIndex === -1) return index === rangeStartIndex;
    const start = Math.min(rangeStartIndex, rangeEndIndex);
    const end = Math.max(rangeStartIndex, rangeEndIndex);
    return index >= start && index <= end;
  };

  // 범위 정보 텍스트
  const getRangeInfo = (): string => {
    if (rangeStartIndex !== -1 && rangeEndIndex !== -1) {
      const start = Math.min(rangeStartIndex, rangeEndIndex) + 1;
      const end = Math.max(rangeStartIndex, rangeEndIndex) + 1;
      return `장면 ${start} ~ ${end} (${end - start + 1}개)`;
    }
    if (rangeStartIndex !== -1) {
      return `시작: 장면 ${rangeStartIndex + 1} (끝점 선택 중...)`;
    }
    return '시작점을 선택하세요';
  };

  const hasChapters = chapters && Object.keys(chapters).length > 0;

  // 장 제목 가져오기
  const getChapterTitle = (chapterNum: number): string => {
    if (!chapters || chapterNum === 0) return '';
    const chapterId = `C${String(chapterNum).padStart(4, '0')}`;
    return chapters[chapterId]?.title || `제${chapterNum}장`;
  };

  return (
    <div className="bg-white border-b border-gray-200">
      {/* 타임라인 헤더 */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">장면 타임라인</span>
          {isRangeMode ? (
            <span className="text-xs text-purple-600 font-medium">
              {getRangeInfo()}
            </span>
          ) : (
            <span className="text-xs text-gray-400">
              {currentIndex >= 0 ? `${currentIndex + 1} / ${scenes.length}` : `전체 ${scenes.length}개`}
            </span>
          )}
        </div>

        {/* 컨트롤 */}
        <div className="flex items-center gap-1">
          {/* 범위 선택 버튼 */}
          <button
            onClick={toggleRangeMode}
            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
              isRangeMode
                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="범위 선택 모드"
          >
            <Minus className="w-3 h-3" />
            {isRangeMode ? '범위' : '범위'}
          </button>

          {/* 점프 입력 */}
          {showJumpInput ? (
            <div className="flex items-center gap-1 ml-2">
              <input
                type="number"
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJumpSubmit();
                  if (e.key === 'Escape') {
                    setShowJumpInput(false);
                    setJumpValue('');
                  }
                }}
                placeholder={`1-${scenes.length}`}
                className="w-16 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                autoFocus
                min={1}
                max={scenes.length}
              />
              <button
                onClick={handleJumpSubmit}
                className="p-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setShowJumpInput(false);
                  setJumpValue('');
                }}
                className="p-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowJumpInput(true)}
              className="p-1 text-gray-600 hover:bg-gray-100 rounded"
              title="장면으로 이동"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {/* 재생 버튼 (범위 모드에서는 숨김) */}
          {!isRangeMode && (
            <button
              onClick={togglePlay}
              className={`p-1.5 rounded ${
                isPlaying ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title={isPlaying ? '정지' : '자동 재생'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
          )}

          {/* 이전/다음 */}
          {!isRangeMode && (
            <div className="flex items-center border-l border-gray-200 pl-2 ml-1">
              <button
                onClick={prevScene}
                disabled={currentIndex <= 0}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={nextScene}
                disabled={currentIndex >= scenes.length - 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 범위 모드 안내 */}
      {isRangeMode && rangeSelecting && (
        <div className="px-4 py-2 bg-purple-50 border-b border-purple-100">
          <p className="text-xs text-purple-700">
            {rangeSelecting === 'start'
              ? '👆 시작 장면을 클릭하세요'
              : '👆 끝 장면을 클릭하세요'}
          </p>
        </div>
      )}

      {/* 타임라인 바 */}
      <div className="relative px-4 py-3">
        {/* 스크롤 버튼 */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white shadow-md rounded-full hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white shadow-md rounded-full hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        )}

        {/* 타임라인 */}
        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="flex items-center min-w-max px-6">
            {/* 시작 마커 */}
            <div className="flex flex-col items-center mr-2">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <div className="text-[10px] text-gray-400 mt-1">시작</div>
            </div>

            {/* 연결선 */}
            <div className="w-8 h-0.5 bg-gradient-to-r from-gray-300 to-blue-300" />

            {/* 장면들을 순서대로 렌더링 (화가 바뀔 때 구분선 표시) */}
            {scenes.map(([sceneId, scene], index) => {
              const isSelected = sceneId === selectedSceneId;
              const isPast = currentIndex >= 0 && index < currentIndex;
              const isCurrent = index === currentIndex;
              const inRange = isInRange(index);
              const isRangeStart = sceneId === sceneRangeStart;
              const isRangeEnd = sceneId === sceneRangeEnd;

              // 이전 장면과 화가 다른지 확인
              const prevScene = index > 0 ? scenes[index - 1][1] : null;
              const isNewChapter = hasChapters && prevScene && scene.chapterNumber !== prevScene.chapterNumber;
              const chapterTitle = scene.chapterNumber ? getChapterTitle(scene.chapterNumber) : '';
              const isFirstScene = index === 0 && hasChapters && scene.chapterNumber;

              return (
                <div key={sceneId} className="flex items-center">
                  {/* 화 구분선 (화가 바뀔 때) */}
                  {isNewChapter && (
                    <div className="flex flex-col items-center mx-2">
                      <div className="w-0.5 h-12 bg-gradient-to-b from-transparent via-orange-300 to-transparent" />
                    </div>
                  )}

                  {/* 장면 노드 */}
                  <div className="flex flex-col items-center">
                    {/* 화 제목 (첫 장면이거나 화가 바뀔 때) */}
                    {(isFirstScene || isNewChapter) && chapterTitle && (
                      <div className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded mb-1 text-center truncate max-w-[120px]" title={chapterTitle}>
                        {chapterTitle}
                      </div>
                    )}

                    <button
                      data-scene-id={sceneId}
                      onClick={() => handleSceneClick(sceneId, index)}
                      className="relative flex flex-col items-center group transition-all duration-200"
                    >
                      {/* 노드 */}
                      <div
                        className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          text-xs font-bold transition-all duration-200
                          ${isRangeMode && inRange
                            ? 'bg-purple-500 text-white ring-4 ring-purple-200'
                            : isRangeMode && rangeSelecting
                              ? 'bg-purple-100 text-purple-600 hover:bg-purple-200 hover:ring-2 hover:ring-purple-300'
                              : isSelected
                                ? 'bg-blue-500 text-white ring-4 ring-blue-200 scale-110'
                                : isPast
                                  ? 'bg-blue-400 text-white'
                                  : 'bg-gray-200 text-gray-600 hover:bg-blue-100 hover:text-blue-600'
                          }
                        `}
                      >
                        {index + 1}
                      </div>

                      {/* 범위 표시 마커 */}
                      {(isRangeStart || isRangeEnd) && (
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                          <div className={`px-1 py-0.5 rounded text-[8px] font-bold ${
                            isRangeStart ? 'bg-purple-600 text-white' : 'bg-purple-400 text-white'
                          }`}>
                            {isRangeStart ? 'A' : 'B'}
                          </div>
                        </div>
                      )}

                      {/* 시간 라벨 */}
                      <div
                        className={`
                          mt-1 max-w-[60px] text-center truncate
                          ${inRange ? 'text-purple-600 font-medium' :
                            isSelected ? 'text-blue-600 font-medium' : 'text-gray-500'}
                          text-[10px] leading-tight
                        `}
                        title={scene.time || `장면 ${index + 1}`}
                      >
                        {scene.time || `장면 ${index + 1}`}
                      </div>

                      {/* 현재 마커 (일반 모드) */}
                      {!isRangeMode && isCurrent && (
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                        </div>
                      )}
                    </button>
                  </div>

                  {/* 연결선 (다음 장면이 있을 때) */}
                  {index < scenes.length - 1 && (
                    <div
                      className={`
                        w-8 h-0.5 mx-0.5
                        ${inRange && isInRange(index + 1) ? 'bg-purple-400' :
                          isPast || isCurrent ? 'bg-blue-400' : 'bg-gray-200'}
                        transition-colors duration-200
                      `}
                    />
                  )}
                </div>
              );
            })}

            {/* 끝 마커 */}
            <div className="w-8 h-0.5 bg-gradient-to-r from-blue-300 to-gray-300" />
            <div className="flex flex-col items-center ml-2">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <div className="text-[10px] text-gray-400 mt-1">끝</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
