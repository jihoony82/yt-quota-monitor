# 유튜브 API 쿼터 측정기

여러 GCP 프로젝트(라이브모아 1~4, 정치탈탈 등)의 유튜브 Data API 일일 쿼터를
15분마다 자동 체크해서 대시보드(`docs/index.html`, GitHub Pages)로 보여주고,
80% 넘으면 텔레그램으로 경보를 보낸다.

## 현재 상태 (2026-09-05)

- **한도(limit)**: Service Usage API로 무료 확인 — 정상 작동
- **소비량(usage)**: ⚠️ **공식 API로는 불가능하다고 결론.** 결제 계정을 라이브모아 메인에
  연결하고 Cloud Monitoring API(`serviceruntime.googleapis.com/quota/allocation/usage`)로
  테스트했으나, 유튜브 Data API 같은 구식(Service Management 방식) 쿼터는 이 지표에
  데이터가 아예 안 쌓인다(iam.googleapis.com 같은 신식 쿼터만 잡힘). 콘솔 화면에 보이는
  "현재 사용량" 숫자는 `cloudconsole-pa.clients6.google.com`의 **비공개 내부 GraphQL**
  (QuotasEntityService)에서 오는 것으로, 브라우저 로그인 세션 전용이라 서비스계정으로
  호출 불가. → **실제 소비량을 자동화하려면 자체계측(각 파이프라인이 API 호출마다 직접
  카운트, 라이브모아가 이미 하는 방식)이 유일한 길.** `scripts/check-quota.mjs`의
  `entry.usage`에 값만 채우면 대시보드·경보 모두 자동으로 살아난다.

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
