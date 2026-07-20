# 보안·테스트·운영

## 1. 위협 모델

보호 대상:

- KIS App Key/Secret, access token, WebSocket approval key
- 로컬 가상 계좌·주문·거래 일지
- Electron의 파일시스템·프로세스 권한
- 뉴스 등 외부에서 들어오는 문자열과 URL

주요 위험:

- XSS가 renderer 권한을 통해 비밀키·DB·파일에 접근
- 과도한 IPC가 renderer 입력으로 임의 파일·네트워크 작업 실행
- 로그와 crash report에 비밀정보 노출
- 실제 주문 URL이 실수로 연결
- stale/지연 데이터를 실시간으로 오인해 모의체결
- DB 중간 실패로 현금·포지션 불일치
- 외부 뉴스 링크를 이용한 임의 scheme 실행

## 2. Electron 보안 기준

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  preload
}
```

- local packaged UI만 로드한다.
- restrictive CSP를 사용하고 `unsafe-eval`, 외부 script를 허용하지 않는다.
- preload는 한 IPC 메시지당 한 의미의 메서드만 노출한다.
- `ipcRenderer`, `send`, `invoke`, `on` 자체를 renderer로 전달하지 않는다.
- 모든 IPC 입력은 preload와 service 양쪽에서 검증한다.
- IPC sender와 frame origin을 검증한다.
- `will-navigate`와 새 창 생성을 기본 거부한다.
- `shell.openExternal`은 파싱한 HTTPS URL의 allowlist를 통과한 경우만 호출한다.
- remote code, `<webview>`, 임의 plugin은 MVP에서 사용하지 않는다.
- 현재 지원되는 Electron release와 보안 패치를 유지한다.

근거:

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)

## 3. 자격증명

- App Key/Secret은 main process의 Electron `safeStorage`로 암호화한다.
- Windows에서는 OS 계정 범위 보호를 사용하되 동일 사용자 권한의 다른 앱까지 완전 격리되는 것으로 과장하지 않는다.
- access token과 approval key는 가능하면 메모리에만 유지한다.
- 저장이 필요하면 암호화하고 만료 시 삭제한다.
- 키 입력 UI는 기존 값을 다시 보여주지 않고 등록 여부와 마지막 검증 시각만 표시한다.
- renderer와 trading service 사이에도 비밀값을 보내지 않는다. main이 제한된 credential channel로 service에 전달한다.
- 로그 redaction 대상: authorization, appkey, appsecret, token, approval key, 계좌번호.

[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)의 비동기 API를 우선 사용한다.

## 4. 실제 주문 방지

이 항목은 안전 불변식이다.

- `kis-adapter` endpoint registry에 시세·정보 API만 등록한다.
- 주문 path/TR ID 상수는 제품 코드에 포함하지 않는다.
- 네트워크 mock/통합 테스트는 `/order`, 주문 TR ID 또는 알려진 주문 URL 호출을 실패시킨다.
- `ExecutionMode` 타입은 `LOCAL_SIMULATION`만 허용한다.
- UI 설정으로 실전 주문을 켤 수 없다.
- build scan이 금지 경로와 주문 함수명을 검사한다.
- 외부 MCP를 붙이더라도 실전 주문 tool은 allowlist에서 제외한다.

## 5. 테스트 피라미드

### 단위

- money scale, rounding, 수수료·세금·환율
- 한국/미국 세션, DST, 휴장·반일장
- candle bucket, OHLCV, late tick revision
- 주문 상태 전이와 취소 가능 조건
- 시장가/지정가/부분체결
- 뉴스 중복과 종목 연결
- 설명 confidence와 counter-evidence

### 계약

- 익명화한 KIS REST/WS fixture → canonical schema
- endpoint registry request parameter와 response decoder
- IPC request/result/event Zod schema
- DB migration checksum
- 뉴스 provider schema

### 통합

- fake KIS REST/WS의 heartbeat, 단절, 재연결, 재구독
- 인증 만료와 동시 갱신
- rate limit, backoff, stale 전파
- 중복·역순·지연 tick
- 주문 체결 DB 트랜잭션 rollback
- crash recovery와 outbox 재처리

### replay/property

- 동일 tick stream + 주문 = 동일 fill
- 원장 합계 보존
- 음수 포지션 금지
- fill 합계 ≤ 주문 수량
- terminal order 역전 금지
- 중복 명령이 현금을 두 번 바꾸지 않음

### E2E/부하

- 앱 설정 → 종목 검색 → 호가/차트 → 주문 → 체결 → 포트폴리오
- WebSocket 6시간 이상 soak
- 다수 관심종목과 renderer backpressure
- 대량 순위/뉴스 virtual scroll
- 앱 강제 종료 후 복구
- 로그/DB/IPC에 비밀값이 없는지 검사

## 6. 테스트 fixture 정책

- 실제 KIS 응답은 자격증명·계좌·개인 식별자를 제거한다.
- fixture에는 source commit, API 함수, TR ID, 수집 환경, 수집일을 기록한다.
- 정상, 빈 결과, pagination, 오류, 필드 누락, 잘못된 숫자 사례를 둔다.
- provider 필드가 바뀌면 fixture와 decoder diff를 함께 review한다.
- 실시간 테스트는 녹화 frame replay를 기본으로 하고 실제 API 테스트는 수동/제한된 별도 suite로 둔다.

## 7. 관측성

구조화 로그 필드:

```text
timestamp, level, component, event, requestId, traceId,
environment, trId, instrumentId, latencyMs, queueDepth,
reconnectCount, errorCode
```

진단 화면:

- REST 인증 상태와 만료 예정
- WebSocket 상태·재연결 횟수·마지막 수신
- 구독 종목 수와 우선순위
- rate limiter queue와 최근 제한 오류
- event 처리 지연과 renderer stream backlog
- DB WAL 크기, integrity 결과, 마지막 backup
- 뉴스 provider 상태
- stale quote/ranking 수

주문·체결·현금 변경은 일반 로그와 별도로 append-only domain event를 남긴다.

## 8. 오류와 사용자 메시지

- provider 원본 오류는 진단에 보존하되 비밀값을 제거한다.
- UI에는 재시도 가능 여부와 마지막 정상 데이터 시각을 보여준다.
- 캐시를 반환하면 “성공”만 보내지 않고 `stale=true`와 사유를 함께 보낸다.
- KIS 장애가 로컬 DB 조회를 막지 않아야 한다.
- 시장가 주문이 stale로 거부되면 사용한 threshold와 마지막 quote 시각을 설명한다.

## 9. 백업·복원

- 마이그레이션 전 자동 backup
- 사용자가 요청한 수동 backup
- backup 파일에 schema version과 checksum
- 복원 전 현재 DB backup
- 복원 뒤 `integrity_check`, foreign key check, ledger projection rebuild 비교
- 실패한 복원은 기존 DB를 바꾸지 않음

## 10. 배포

- Windows 우선 signed installer를 목표로 한다.
- source map과 crash log 배포 정책에서 비밀정보를 제외한다.
- auto-update는 MVP 이후, 도입 시 서명 검증을 필수로 한다.
- 앱 버전, DB schema, KIS adapter contract version을 진단 화면에 표시한다.
- 실사용 키가 없는 demo fixture mode를 제공해 UI/E2E를 재현한다.
