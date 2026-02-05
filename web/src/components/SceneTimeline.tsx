/**
 * 장면 타임라인 컴포넌트
 * 시간 흐름이 보이는 시각적 타임라인
 * 범위 선택 기능 지원
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

  const currentIndex = selectedSceneId
    ? scenes.findIndex(([id]) => id === selectedSceneId)
    : -1;

  const currentScene = selectedSceneId
    ? scenes.find(([id]) => id === selectedSceneId)?.[1]
    : null;

  // 범위 인덱스 계산
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

  // 장별로 장면 그룹화
  const groupedScenes = scenes.reduce((acc, [sceneId, scene], index) => {
    const chapterNum = scene.chapterNumber || 0;
    if (!acc[chapterNum]) {
      acc[chapterNum] = [];
    }
    acc[chapterNum].push({ sceneId, scene, index });
    return acc;
  }, {} as Record<number, { sceneId: string; scene: Scene; index: number }[]>);

  const chapterNumbers = Object.keys(groupedScenes).map(Number).sort((a, b) => a - b);
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

        <div className="flex items-center gap-2">
          {/* 전체 보기 */}
          <button
            onClick={() => {
              onSelectScene(null);
              onSelectRange(null, null);
              setIsRangeMode(false);
              setRangeSelecting(null);
              setIsPlaying(false);
            }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              !selectedSceneId && !sceneRangeStart
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            전체
          </button>

          {/* 범위 선택 토글 */}
          <button
            onClick={toggleRangeMode}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              isRangeMode
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Minus className="w-3 h-3" aria-hidden="true" />
            범위
          </button>

          {/* 재생/정지 */}
          {!isRangeMode && (
            <button
              onClick={togglePlay}
              className={`p-1.5 rounded-md transition-colors ${
                isPlaying ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title={isPlaying ? '정지' : '자동 재생'}
              aria-label={isPlaying ? '정지' : '자동 재생'}
            >
              {isPlaying ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
            </button>
          )}

          {/* 이전/다음 */}
          {!isRangeMode && (
            <div className="flex items-center border-l border-gray-200 pl-2 ml-1">
              <button
                onClick={prevScene}
                disabled={currentIndex <= 0}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="이전 장면"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={nextScene}
                disabled={currentIndex >= scenes.length - 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="다음 장면"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
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
            aria-label="왼쪽으로 스크롤"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" aria-hidden="true" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white shadow-md rounded-full hover:bg-gray-50"
            aria-label="오른쪽으로 스크롤"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" aria-hidden="true" />
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

            {hasChapters ? (
              // 장별 그룹화 표시
              chapterNumbers.map((chapterNum, chapterIdx) => {
                const chapterScenes = groupedScenes[chapterNum];
                const chapterTitle = getChapterTitle(chapterNum);

                return (
                  <div key={chapterNum} className="flex items-center">
                    {/* 장 구분선 (첫 번째 장 제외) */}
                    {chapterIdx > 0 && (
                      <div className="flex flex-col items-center mx-2">
                        <div className="w-0.5 h-12 bg-gradient-to-b from-transparent via-orange-300 to-transparent" />
                      </div>
                    )}

                    {/* 장 그룹 */}
                    <div className="flex flex-col">
                      {/* 장 제목 */}
                      {chapterNum > 0 && (
                        <div className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded mb-1 text-center truncate max-w-[200px]" title={chapterTitle}>
                          {chapterTitle}
                        </div>
                      )}

                      {/* 장면들 */}
                      <div className="flex items-center">
                        {chapterScenes.map(({ sceneId, scene, index }, sceneIdx) => {
                          const isSelected = sceneId === selectedSceneId;
                          const isPast = currentIndex >= 0 && index < currentIndex;
                          const isCurrent = index === currentIndex;
                          const inRange = isInRange(index);
                          const isRangeStart = sceneId === sceneRangeStart;
                          const isRangeEnd = sceneId === sceneRangeEnd;

                          return (
                            <div key={sceneId} className="flex items-center">
                              {/* 장면 노드 */}
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
                                  {scene.time || `${index + 1}`}
                                </div>

                                {/* 현재 마커 (일반 모드) */}
                                {!isRangeMode && isCurrent && (
                                  <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                                  </div>
                                )}
                              </button>

                              {/* 연결선 (같은 장 내) */}
                              {sceneIdx < chapterScenes.length - 1 && (
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
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              // 장 구분 없이 단순 표시
              scenes.map(([sceneId, scene], index) => {
                const isSelected = sceneId === selectedSceneId;
                const isPast = currentIndex >= 0 && index < currentIndex;
                const isCurrent = index === currentIndex;
                const inRange = isInRange(index);
                const isRangeStart = sceneId === sceneRangeStart;
                const isRangeEnd = sceneId === sceneRangeEnd;

                return (
                  <div key={sceneId} className="flex items-center">
                    {/* 장면 노드 */}
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
                          mt-1 max-w-[80px] text-center truncate
                          ${inRange ? 'text-purple-600 font-medium' :
                            isSelected ? 'text-blue-600 font-medium' : 'text-gray-500'}
                          text-[10px] leading-tight
                        `}
                        title={scene.time || `장면 ${index + 1}`}
                      >
                        {scene.time || `장면 ${index + 1}`}
                      </div>

                      {/* 장소 (선택 시) */}
                      {scene.location && (
                        <div
                          className={`
                            text-[9px] text-gray-400 max-w-[80px] truncate
                            ${isSelected || inRange ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                            transition-opacity
                          `}
                        >
                          {scene.location}
                        </div>
                      )}

                      {/* 현재 마커 (일반 모드) */}
                      {!isRangeMode && isCurrent && (
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                        </div>
                      )}
                    </button>

                    {/* 연결선 */}
                    {index < scenes.length - 1 && (
                      <div
                        className={`
                          w-12 h-0.5 mx-1
                          ${inRange && isInRange(index + 1) ? 'bg-purple-400' :
                            isPast || isCurrent ? 'bg-blue-400' : 'bg-gray-200'}
                          transition-colors duration-200
                        `}
                      />
                    )}
                  </div>
                );
              })
            )}

            {/* 연결선 */}
            <div className="w-8 h-0.5 bg-gradient-to-r from-blue-300 to-gray-300" />

            {/* 끝 마커 */}
            <div className="flex flex-col items-center ml-2">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <div className="text-[10px] text-gray-400 mt-1">끝</div>
            </div>
          </div>
        </div>

        {/* 프로그레스 바 */}
        <div className="mt-3 mx-6 h-1 bg-gray-100 rounded-full overflow-hidden">
          {isRangeMode && rangeStartIndex !== -1 ? (
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{
                marginLeft: `${(Math.min(rangeStartIndex, rangeEndIndex !== -1 ? rangeEndIndex : rangeStartIndex) / scenes.length) * 100}%`,
                width: rangeEndIndex !== -1
                  ? `${((Math.abs(rangeEndIndex - rangeStartIndex) + 1) / scenes.length) * 100}%`
                  : `${(1 / scenes.length) * 100}%`
              }}
            />
          ) : (
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{
                width: currentIndex >= 0
                  ? `${((currentIndex + 1) / scenes.length) * 100}%`
                  : '0%'
              }}
            />
          )}
        </div>

        {/* 장면 점프 슬라이더 */}
        <div className="mt-2 mx-6 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={scenes.length - 1}
            value={currentIndex >= 0 ? currentIndex : 0}
            onChange={(e) => jumpToScene(parseInt(e.target.value))}
            className="flex-1 h-1 accent-blue-500 cursor-pointer"
          />
          {showJumpInput ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={scenes.length}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJumpSubmit()}
                placeholder={`1-${scenes.length}`}
                className="w-16 px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleJumpSubmit}
                className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                이동
              </button>
              <button
                onClick={() => { setShowJumpInput(false); setJumpValue(''); }}
                className="p-0.5 text-gray-400 hover:text-gray-600"
                aria-label="닫기"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowJumpInput(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 rounded"
              title="장면으로 이동"
            >
              <Search className="w-3 h-3" aria-hidden="true" />
              <span className="text-gray-600 font-medium">
                {currentIndex >= 0 ? currentIndex + 1 : 1} / {scenes.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 선택된 장면/범위 정보 */}
      {(currentScene || (sceneRangeStart && sceneRangeEnd)) && (
        <div className="px-4 pb-3">
          <div className={`p-3 rounded-lg ${
            isRangeMode ? 'bg-gradient-to-r from-purple-50 to-pink-50' : 'bg-gradient-to-r from-blue-50 to-indigo-50'
          }`}>
            {isRangeMode && sceneRangeStart && sceneRangeEnd ? (
              // 범위 정보 표시
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded">
                    범위 선택됨
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {getRangeInfo()}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  선택한 범위의 모든 관계가 관계도에 표시됩니다
                </p>
              </div>
            ) : currentScene ? (
              // 단일 장면 정보 표시
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                      장면 {currentIndex + 1}
                    </span>
                    {currentScene.time && currentScene.time !== `장면 ${currentIndex + 1}` && (
                      <span className="text-sm font-medium text-gray-700">
                        {currentScene.time}
                      </span>
                    )}
                  </div>
                  {currentScene.location && (
                    <div className="text-xs text-gray-500 mt-1">
                      📍 {currentScene.location}
                    </div>
                  )}
                </div>
                {currentScene.mood && (
                  <span className="px-2 py-0.5 bg-white/70 text-gray-600 rounded text-xs">
                    {currentScene.mood}
                  </span>
                )}
              </div>
            ) : null}
            {currentScene?.summary && !isRangeMode && (
              <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                {currentScene.summary}
              </p>
            )}
            {currentScene?.events && currentScene.events.length > 0 && !isRangeMode && (
              <div className="mt-2 flex flex-wrap gap-1">
                {currentScene.events.map((event: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-white/70 text-gray-600 rounded text-xs">
                    {event}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
