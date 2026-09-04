# 유튜브 API 쿼터 측정기

여러 GCP 프로젝트(라이브모아 1~4, 정치탈탈 등)의 유튜브 Data API 일일 쿼터를
15분마다 자동 체크해서 대시보드(`docs/index.html`, GitHub Pages)로 보여주고,
80% 넘으면 텔레그램으로 경보를 보낸다.

## 현재 상태 (2026-09-04)

- **한도(limit)**: Service Usage API로 무료 확인 — 정상 작동
- **소비량(usage)**: 결제 계정 연결 한도 문제로 아직 미계측. `scripts/check-quota.mjs`의
  `entry.usage`에 값만 채우면(Cloud Monitoring 연동 또는 자체계측) 대시보드·경보 모두
  자동으로 살아난다.

## 구성

- `projects.json` — 모니터링 대상 GCP 프로젝트 목록
- `scripts/check-quota.mjs` — 체크 스크립트 (Node, `google-auth-library` 사용)
- `.github/workflows/quota-check.yml` — 15분마다 실행하는 GitHub Actions
- `docs/index.html` + `docs/data.json` — GitHub Pages 대시보드

## 프로젝트 추가하는 법

1. 해당 GCP 프로젝트에 서비스계정(`yt-quota-reader`) 생성 + `서비스 사용량 뷰어` 역할 부여
2. JSON 키 발급
3. `projects.json`에 한 줄 추가 (label / projectId / secretName)
4. GitHub 저장소 Settings → Secrets에 `secretName`으로 키 JSON 전체를 등록

## 시크릿 목록

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — 경보 발송용
- `GCP_SA_*` — 프로젝트별 서비스계정 키 (projects.json의 secretName과 매칭)
