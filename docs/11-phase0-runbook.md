# Phase 0 실행 가이드

## 범위

현재 구현은 Phase 0A offline 계약 하네스와 Phase 0B opt-in live probe다.

- 국내 현재가 REST
- 국내 `H0STASP0`/`H0STCNT0`
- 미국 `HDFSASP0`/`HDFSCNT0`
- 4개 WebSocket layout, canonical normalization, synthetic fixture
- 읽기 전용 health report

분봉·순위·뉴스 실제 fixture, 장시간 reconnect 관찰, KRX/NXT/통합 결정은 Phase 0 후속 작업이다.

## 설치

```powershell
npm.cmd install
Copy-Item .env.local.example .env.local
```

`.env.local`에 다음을 입력한다.

```dotenv
KIS_DATA_ENV=paper
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_LIVE_ACK=READ_ONLY_MARKET_DATA
```

`.env.local`은 개발 CLI의 임시 방식이며 Git에서 제외된다. Electron 앱에서는 `safeStorage`로 교체한다.

## 오프라인 검증

```powershell
npm.cmd run check
```

외부 네트워크를 사용하지 않고 typecheck, fixture 계약, 안전 테스트, health를 실행한다.

## 실제 KIS 읽기 전용 검증

```powershell
npm.cmd run health:live
npm.cmd run probe:kr
npm.cmd run probe:us
```

- `health:live`: token, 국내 현재가, 국내 호가·체결
- `probe:kr`: 국내 호가·체결 WebSocket
- `probe:us`: 미국 1호가·체결 제공 여부

live 명령은 `KIS_LIVE_ACK=READ_ONLY_MARKET_DATA` 없이는 실행되지 않는다.

## 결과 해석

- `PASS`: 해당 계약 또는 live 확인 성공
- `WARN`: 연결됐지만 장 마감 등으로 frame이 없거나 credential이 없는 offline mode
- `FAIL`: schema, 인증, REST, WebSocket 오류
- `NOT_APPLICABLE`: 현재 Phase에 포함되지 않음

미국 probe가 frame을 받아도 observed delay를 측정하기 전까지 realtime 여부는 자동 확정하지 않는다. 호가는 공식 샘플 범위대로 1단계만 기록한다.

## 비밀정보 규칙

- 키를 명령행 인자로 넘기지 않는다.
- token과 approval key를 출력하거나 파일에 저장하지 않는다.
- health JSON에는 키 존재 여부만 포함한다.
- 실제 raw fixture를 저장하기 전 secret·계좌정보를 제거한다.

## 남은 Phase 0 Exit 항목

- 실제 익명 REST/WS fixture로 synthetic fixture 교체
- 국내 분봉·일봉, 순위, 뉴스 fixture
- 미국 provider 시각 기반 observed delay 측정
- disconnect/reconnect/resubscribe soak
- REST limiter 안전값 관찰
- KRX/NXT/통합 기본 표시 ADR
