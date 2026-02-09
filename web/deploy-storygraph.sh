#!/bin/bash
# StoryGraph 프론트엔드 배포 스크립트
# web/ 디렉토리에서 실행

set -e # 오류 발생 시 스크립트 중단

# --- 설정 ---
# 환경 변수 파일: .env (기본값) + .env.local (프로덕션 민감 정보)
# --env-file은 ${VARIABLE} 치환에 사용됨 (env_file: 디렉티브와 별개)
ENV_FILES="--env-file .env --env-file .env.local"
COMPOSE_FILES="-f docker-compose.yml"
HEALTHCHECK_TIMEOUT=120  # healthcheck 최대 대기 시간 (초)
CHECK_INTERVAL=10
# --- 설정 끝 ---

# 시간 측정 함수
function print_elapsed() {
    local start=$1
    local end=$(date +%s)
    local elapsed=$((end - start))
    echo "⏱️  $2 (${elapsed}초)"
}

# 전체 배포 시작 시간
DEPLOY_START=$(date +%s)

echo "🚀 StoryGraph 배포 프로세스 시작..."

# 현재 디렉토리가 web/인지 확인
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml을 찾을 수 없습니다."
    echo "스크립트를 web/ 디렉토리에서 실행했는지 확인하세요."
    exit 1
fi

# 프로덕션 환경 확인
if [ ! -f ".env.local" ]; then
    echo "⚠️  경고: .env.local 파일을 찾을 수 없습니다."
    read -p "프로덕션 환경이 맞습니까? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "배포 취소됨"
        exit 1
    fi
fi

# 1. 도커 이미지 빌드 (환경 변수로 캐시 옵션 제어)
STEP_START=$(date +%s)
NO_CACHE="${NO_CACHE:-false}"
if [ "$NO_CACHE" = "true" ]; then
    echo "🔨 도커 이미지 빌드 중... (캐시 없음)"
    docker compose $ENV_FILES $COMPOSE_FILES build --no-cache
else
    echo "🔨 도커 이미지 빌드 중... (캐시 사용)"
    docker compose $ENV_FILES $COMPOSE_FILES build
fi
if [ $? -ne 0 ]; then
    echo "❌ 도커 이미지 빌드 실패"
    exit 1
fi
print_elapsed $STEP_START "빌드 완료"

# 2. 기존 컨테이너 중지 (볼륨은 유지 — mongodb_data 보존)
STEP_START=$(date +%s)
echo "🛑 기존 컨테이너 중지 중..."
docker compose $ENV_FILES $COMPOSE_FILES down --remove-orphans
if [ $? -ne 0 ]; then
    echo "❌ 컨테이너 중지 실패"
    exit 1
fi
print_elapsed $STEP_START "중지 완료"

# 3. 새 컨테이너 시작 (백그라운드)
STEP_START=$(date +%s)
echo "🚀 새 컨테이너 시작 중..."
docker compose $ENV_FILES $COMPOSE_FILES up -d
if [ $? -ne 0 ]; then
    echo "❌ 컨테이너 시작 실패"
    exit 1
fi

# 4. StoryGraph 서비스 준비 대기
# 127.0.0.1: Alpine에서 localhost→IPv6 해석 방지
# /api/config: 인증 미들웨어 우회 (공개 API)
echo "⏳ StoryGraph 서비스 준비 대기 중 (최대 ${HEALTHCHECK_TIMEOUT}초)..."

ELAPSED=0
while [ $ELAPSED -lt $HEALTHCHECK_TIMEOUT ]; do
    if docker compose $ENV_FILES $COMPOSE_FILES exec -T storygraph \
        wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:3000/api/config > /dev/null 2>&1; then
        echo "✅ StoryGraph 서비스 준비 완료"
        print_elapsed $STEP_START "서비스 시작 완료"
        break
    fi

    echo "  대기 중... (${ELAPSED}초)"

    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

# 타임아웃 체크
if [ $ELAPSED -ge $HEALTHCHECK_TIMEOUT ]; then
    echo "❌ 헬스체크 타임아웃 (${HEALTHCHECK_TIMEOUT}초)"
    echo "컨테이너 로그 확인: docker compose $ENV_FILES $COMPOSE_FILES logs storygraph"
    exit 1
fi

# 5. 도커 시스템 정리
STEP_START=$(date +%s)
echo "🧹 미사용 도커 리소스 정리 중..."
docker system prune -af
if [ $? -ne 0 ]; then
    echo "⚠️ 도커 시스템 정리 중 오류 발생, 하지만 배포 프로세스는 계속 진행됨"
fi
print_elapsed $STEP_START "정리 완료"

echo ""
echo "✅ StoryGraph 배포 완료!"
print_elapsed $DEPLOY_START "총 소요 시간"
echo ""
echo "ℹ️ 유용한 명령어:"
echo "   서비스 상태: docker compose $ENV_FILES $COMPOSE_FILES ps"
echo "   앱 로그:     docker compose $ENV_FILES $COMPOSE_FILES logs storygraph"
echo "   DB 로그:     docker compose $ENV_FILES $COMPOSE_FILES logs mongodb"
echo "   전체 로그:   docker compose $ENV_FILES $COMPOSE_FILES logs -f"
