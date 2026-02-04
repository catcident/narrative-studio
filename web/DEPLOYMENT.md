# Character-Relationship-Chart 프로덕션 배포 가이드

## 개요

이 문서는 Character-Relationship-Chart를 Oracle Cloud에 Catcident 회원 전용 서비스로 배포하는 절차를 안내합니다.

- **인증**: catcident-backend OAuth 2.0 / OIDC 연동
- **인프라**: Docker Compose + Caddy 리버스 프록시
- **도메인**: storygraph.catcident.com

---

## 1. 사전 준비사항

### 1.1 서버 요구사항

- Docker 및 Docker Compose 설치
- Caddy 네트워크 존재 확인 (`docker network ls | grep caddy`)
- 최소 2GB RAM, 10GB 디스크

### 1.2 DNS 설정

```
storygraph.catcident.com → Oracle Cloud 서버 IP
```

DNS 전파에 최대 24시간이 소요될 수 있으므로 미리 설정하세요.

---

## 2. catcident-backend OAuth Application 등록

### 2.1 Django Admin 접속

```
https://catcident.com/admin/oauth2_provider/application/
```

### 2.2 Application 생성

**Add Application** 클릭 후 아래 값 입력:

| 필드 | 값 |
|------|-----|
| **User** | (관리자 계정 선택) |
| **Name** | Character Relationship Chart |
| **Client type** | Public |
| **Authorization grant type** | Authorization code |
| **Redirect uris** | `https://storygraph.catcident.com/api/auth/callback/catcident` |
| **Skip authorization** | ❌ (체크 해제) |
| **Algorithm** | RS256 |

### 2.3 Client ID 복사

저장 후 생성된 **Client ID**를 복사해 둡니다.
(Public 클라이언트이므로 Client Secret은 비어있음)

---

## 3. 환경 변수 설정

### 3.1 서버에서 `.env.local` 생성

```bash
cd /path/to/Character-Relationship-Chart/web
nano .env.local
```

### 3.2 환경 변수 내용

```bash
# ==========================================
# MongoDB 설정
# ==========================================
MONGO_URL=mongodb://storygraph_admin:YOUR_SECURE_PASSWORD@mongodb:27017/character_relationship_chart?authSource=admin
MONGO_USER=storygraph_admin
MONGO_PASSWORD=YOUR_SECURE_PASSWORD

# ==========================================
# OpenRouter API (LLM 분석용)
# ==========================================
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ==========================================
# NextAuth.js 설정
# ==========================================
# AUTH_SECRET 생성 방법: openssl rand -base64 32
AUTH_SECRET=생성된_32바이트_랜덤_문자열
AUTH_URL=https://storygraph.catcident.com

# ==========================================
# Catcident OAuth Provider
# ==========================================
AUTH_CATCIDENT_ISSUER=https://catcident.com
AUTH_CATCIDENT_ID=Django_Admin에서_복사한_Client_ID
AUTH_CATCIDENT_SECRET=
```

### 3.3 AUTH_SECRET 생성

```bash
openssl rand -base64 32
```

출력된 값을 `AUTH_SECRET`에 붙여넣습니다.

### 3.4 MongoDB 비밀번호 설정

강력한 비밀번호를 생성합니다:

```bash
openssl rand -base64 24
```

`MONGO_PASSWORD`와 `MONGO_URL`의 비밀번호 부분을 동일하게 설정합니다.

---

## 4. Caddy 설정

### 4.1 Caddyfile 수정

`/path/to/caddy/Caddyfile`에 아래 블록이 추가되어 있는지 확인:

```caddyfile
storygraph.catcident.com {
    reverse_proxy storygraph:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    encode zstd gzip
}
```

### 4.2 Caddy 네트워크 확인

```bash
docker network ls | grep caddy
```

없으면 생성:

```bash
docker network create caddy
```

---

## 5. 배포 실행

### 5.1 코드 가져오기

```bash
cd /path/to/Character-Relationship-Chart/web
git fetch origin
git checkout production
git pull origin production
```

### 5.2 Docker 이미지 빌드

```bash
docker compose build
```

빌드에 약 2-5분 소요됩니다.

### 5.3 서비스 시작

```bash
docker compose up -d
```

### 5.4 로그 확인

```bash
docker compose logs -f
```

정상 시작 확인:
- `storygraph` 서비스: `▲ Next.js` 출력 후 `Ready in...` 메시지
- `mongodb` 서비스: `Waiting for connections` 메시지

### 5.5 Caddy 리로드

```bash
cd /path/to/caddy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 6. 배포 검증

### 6.1 헬스 체크

```bash
curl -I https://storygraph.catcident.com/
```

예상 응답: `HTTP/2 200` 또는 `HTTP/2 302` (로그인 리다이렉트)

### 6.2 SSL 인증서 확인

```bash
curl -vI https://storygraph.catcident.com/ 2>&1 | grep "SSL certificate"
```

### 6.3 로그인 테스트

1. 브라우저에서 `https://storygraph.catcident.com/` 접속
2. 로그인 페이지로 리다이렉트 확인
3. "Catcident 계정으로 로그인" 버튼 클릭
4. catcident.com으로 리다이렉트 확인
5. Catcident 계정으로 로그인
6. 동의 화면 확인 후 승인
7. storygraph.catcident.com으로 복귀 확인

### 6.4 기능 테스트

1. 텍스트 업로드 및 분석 실행
2. 지식 그래프 저장
3. 저장된 데이터 목록 확인
4. 로그아웃 후 재로그인 시 데이터 유지 확인

---

## 7. 문제 해결

### 7.1 로그인 후 콜백 오류

**증상**: `OAUTH_CALLBACK_ERROR` 또는 리다이렉트 실패

**해결**:
1. Django Admin에서 Redirect URI 확인
2. `AUTH_CATCIDENT_ID`가 올바른지 확인
3. `AUTH_URL`이 `https://storygraph.catcident.com`인지 확인

### 7.2 MongoDB 연결 실패

**증상**: `MongoServerError: Authentication failed`

**해결**:
1. `MONGO_PASSWORD`와 `MONGO_URL`의 비밀번호 일치 확인
2. MongoDB 컨테이너 재시작: `docker compose restart mongodb`

### 7.3 502 Bad Gateway

**증상**: Caddy에서 502 오류

**해결**:
1. storygraph 컨테이너 상태 확인: `docker compose ps`
2. storygraph 로그 확인: `docker compose logs storygraph`
3. Caddy 네트워크 연결 확인: `docker network inspect caddy`

### 7.4 SSL 인증서 오류

**증상**: 브라우저에서 인증서 경고

**해결**:
1. DNS 전파 확인: `dig storygraph.catcident.com`
2. Caddy 로그 확인: `docker compose logs caddy`
3. 필요시 Caddy 재시작: `docker compose restart caddy`

---

## 8. 운영 명령어

### 서비스 재시작

```bash
docker compose restart storygraph
```

### 로그 확인

```bash
docker compose logs -f --tail=100 storygraph
```

### 서비스 중지

```bash
docker compose down
```

### 데이터 포함 완전 삭제 (주의!)

```bash
docker compose down -v
```

### 이미지 재빌드

```bash
docker compose build --no-cache
docker compose up -d
```

---

## 9. 보안 체크리스트

- [ ] `.env.local`에 강력한 `MONGO_PASSWORD` 설정
- [ ] `.env.local`에 고유한 `AUTH_SECRET` 설정
- [ ] `.env.local` 파일 권한 제한: `chmod 600 .env.local`
- [ ] HTTPS 강제 적용 확인
- [ ] Caddy 보안 헤더 적용 확인

---

## 10. 백업

### MongoDB 데이터 백업

```bash
docker compose exec mongodb mongodump --out=/data/backup --authenticationDatabase=admin -u storygraph_admin -p YOUR_PASSWORD
docker cp $(docker compose ps -q mongodb):/data/backup ./backup_$(date +%Y%m%d)
```

### 복원

```bash
docker cp ./backup_YYYYMMDD $(docker compose ps -q mongodb):/data/backup
docker compose exec mongodb mongorestore /data/backup --authenticationDatabase=admin -u storygraph_admin -p YOUR_PASSWORD
```

---

## 11. 개발 환경 (LAN)

내부 네트워크 개발 환경용 설정입니다.

### 11.1 DNS 설정

```
storygraph.catcident.lan → 개발 서버 IP
```

### 11.2 OAuth Application 등록 (개발용)

Django Admin에서 별도 Application 생성 또는 기존 Application에 Redirect URI 추가:

| 필드 | 값 |
|------|-----|
| **Redirect uris** | `https://storygraph.catcident.lan/api/auth/callback/catcident` |

> 기존 프로덕션 Application에 Redirect URI를 줄바꿈으로 추가할 수 있습니다.

### 11.3 환경 변수 (개발)

```bash
AUTH_URL=https://storygraph.catcident.lan
```

### 11.4 Caddy 설정 (개발)

```caddyfile
storygraph.catcident.lan {
    reverse_proxy storygraph:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }

    tls internal

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    encode zstd gzip
}
```

> `tls internal`은 Caddy가 자체 서명 인증서를 생성합니다. 개발 환경에서만 사용하세요.
