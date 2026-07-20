# 사용자 인증·데이터 공급자·로컬 저장소

## 1. 확정 원칙

- 앱의 계좌, 현금, 주문, 체결, 포지션, 설정, 공시 cursor는 사용자 PC의 SQLite에만 저장한다.
- KIS와 토스증권 자격증명은 사용자가 각 증권사에서 직접 발급해 앱에 등록한다.
- App Secret, client secret, access token은 SQLite에 평문 저장하지 않는다.
- Electron renderer는 자격증명, 원본 DB handle, Node API에 접근하지 않는다.
- KIS·토스증권의 실제 주문 mutation endpoint는 구현·등록·호출하지 않는다.
- KIS는 WebSocket 실시간 주 공급자, 토스증권은 REST polling 보조 공급자로 사용한다.

## 2. Electron 로컬 SQLite

운영 DB 경로는 Electron main process가 `app.getPath("userData")`로 정하고 storage service에 주입한다.

```text
{Electron userData}/storage/papertrading.sqlite3
```

개발 CLI에서는 명시적 경로를 사용할 수 있지만 운영 renderer가 파일 경로를 선택하거나 직접 열 수는 없다.

필수 설정:

- SQLite WAL
- `foreign_keys=ON`
- busy timeout
- migration transaction
- 앱 업데이트 전 backup
- 원장 UPDATE/DELETE 방지
- 금액·가격은 정확한 decimal text 또는 scaled integer

초기 테이블:

- `schema_migrations`
- `simulation_accounts`
- `cash_ledger`
- `provider_profiles`
- 후속 migration: instruments, orders, fills, positions, disclosures, translations, provider_cursors

`provider_profiles`에는 provider 이름, 활성 상태, credential vault reference, 마지막 health만 저장한다. 실제 secret과 token은 넣지 않는다.

## 3. 자격증명 저장

### 개발

`.env.local`은 개발 probe와 테스트용이다. Git에서 제외하며 배포 앱의 사용자 인증 방식이 아니다.

### Electron 운영

1. renderer의 설정 화면에서 사용자가 키를 입력한다.
2. preload가 좁은 `credentials.saveProviderProfile` IPC command만 노출한다.
3. main process가 payload schema와 sender를 검증한다.
4. secret은 Electron `safeStorage.encryptString()`으로 암호화한다.
5. 암호화 blob은 main 전용 credential vault 파일에 저장한다.
6. SQLite에는 opaque vault reference와 non-secret metadata만 저장한다.
7. renderer에는 `configured`, `lastVerifiedAt`, `status`만 반환한다.

로그, crash report, health JSON에는 키 길이·앞뒤 문자·token 일부도 출력하지 않는다.

## 4. KIS 사용자 등록

사용자가 KIS Developers에서 본인 App Key/App Secret을 발급한다. 설정 화면은 데이터 profile을 다음과 같이 분리한다.

```ts
interface KisDataProfile {
  environment: "paper" | "prod";
  credentialRef: string;
  enabledMarkets: Array<"KR_STOCK" | "US_STOCK" | "KR_DERIVATIVES">;
  executionMode: "LOCAL_SIMULATION";
}
```

- 현재 모의 키로 국내·미국 주식 시세를 우선 사용한다.
- 국내 지수선물은 추후 실전 읽기 전용 profile을 별도 등록한다.
- CME 유료 entitlement는 무료 기본안에서 사용하지 않는다.
- Nasdaq·Russell 2000·WTI 방향은 KIS 미국 ETF `QQQ`, `IWM`, `USO`를 `PROXY_LIVE`로 수신한다.
- profile을 `prod`로 등록해도 KIS 주문 endpoint는 allowlist 밖이다.

## 5. 토스증권 Open API 조사 결과

기준: 공식 Open API v1.2.4, 확인일 2026-07-20.

### 인증

- 토스증권 계좌 사용자가 WTS `설정 > Open API`에서 `client_id`, `client_secret`을 발급한다.
- OAuth 2.0 Client Credentials로 `POST /oauth2/token`을 호출한다.
- refresh token 없이 만료 시 재발급한다.
- client당 유효 token은 하나이므로 single-flight token manager가 필요하다.
- 허용 IP 등록이 필요하다.
- 시장 데이터는 Bearer token만 사용하고 계좌 header는 사용하지 않는다.

### 시장 데이터 범위

| 기능                 | 국내 주식              | 미국 주식             | 비고                                  |
| -------------------- | ---------------------- | --------------------- | ------------------------------------- |
| 현재가               | 지원                   | 지원                  | `GET /api/v1/prices`, 최대 200 symbol |
| 호가                 | 지원                   | 지원                  | `GET /api/v1/orderbook`               |
| 최근 체결            | 지원                   | 지원                  | `GET /api/v1/trades`, 최대 50         |
| 1분·일봉             | 지원                   | 지원                  | `GET /api/v1/candles`, 최대 200       |
| 종목 정보            | 지원                   | 지원                  | `GET /api/v1/stocks`                  |
| 거래대금·거래량 랭킹 | 지원                   | 지원                  | realtime duration 지원                |
| 상승·하락 랭킹       | 지원                   | 지원                  | realtime duration 미지원              |
| 환율                 | KRW↔USD                | KRW↔USD               | 약 1분 갱신 참고값                    |
| 장 캘린더            | KRX·NXT                | day/pre/regular/after | 지원                                  |
| 시장 지수            | KOSPI·KOSDAQ·한국 국채 | 미국 지수 미지원      | REST                                  |
| 뉴스·공시            | 미지원                 | 미지원                | SEC/OpenDART 별도                     |
| 선물·CME             | 미지원                 | 미지원                | NQ·CL 공급원으로 사용 불가            |

공식 OpenAPI는 현재 REST만 제공하고 WebSocket은 추후 지원 예정이라고 명시한다. 홈페이지 소개 문구와 충돌할 때 canonical OpenAPI를 따른다.

### Rate limits

| 그룹                   | 현재 문서상 TPS |
| ---------------------- | --------------: |
| AUTH                   |               5 |
| STOCK                  |               5 |
| MARKET_INFO            |               3 |
| MARKET_DATA            |              10 |
| MARKET_DATA_CHART      |               5 |
| RANKING                |               5 |
| MARKET_INDICATOR_PRICE |              10 |
| MARKET_INDICATOR       |              10 |
| MARKET_INDICATOR_CHART |               5 |

실제 값은 응답의 `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`를 우선한다.

## 6. Provider 우선순위

```text
국내·미국 체결/호가
  1. KIS WebSocket
  2. KIS REST snapshot
  3. Toss REST polling (사용자가 별도 등록한 경우)

랭킹·환율·캘린더
  1. KIS 지원 API
  2. Toss REST 보조/교차검증

NQ·WTI 방향
  1. KIS QQQ/IWM/USO WebSocket, quality=PROXY_LIVE
  2. 실제 CME 계약은 무료 모드에서 비활성

공시
  SEC EDGAR / OpenDART
```

공급자 값이 다르면 임의 평균을 내지 않는다. source, provider timestamp, receivedAt, quality를 함께 저장하고 UI에서 선택할 수 있게 한다.

토스 REST 값은 `POLLING_REALTIME_CLAIMED`로 분류한다. WebSocket tick처럼 표시하지 않고 관찰된 지연을 health와 UI에 노출한다.

## 7. 토스 주문 endpoint 차단

같은 `/api/v1/orders` 경로에 GET과 POST가 함께 있으므로 URL 문자열만 검사하면 안 된다. HTTP method와 path의 exact allowlist를 사용한다.

금지 mutation:

- `POST /api/v1/orders`
- `POST /api/v1/orders/{orderId}/modify`
- `POST /api/v1/orders/{orderId}/cancel`
- `POST /api/v1/conditional-orders`
- 조건주문 modify/delete

초기 Toss adapter는 시장 데이터 GET과 OAuth token 발급만 등록한다. 계좌·보유·실제 주문 endpoint도 로컬 모의투자에는 필요하지 않으므로 기본 비활성이다.

## 8. 저장·이용권 주의

토스증권 공개 개발 문서에서 응답의 장기 저장·재배포 권한은 확인되지 않았다.

- 개인 화면 표시와 필요한 최소 캐시만 사용
- 외부 전송·재배포 금지
- 원본 tick 장기 보존보다 canonical snapshot·관찰 지표 우선
- WTS 신청 과정의 최신 Open API 약관을 사용자가 확인
- 약관 확인 전 Toss 데이터는 장기 historical DB의 source로 사용하지 않음

## 9. 온보딩 UI

설정 > 데이터 공급자:

- KIS 모의 시세: App Key, App Secret, 연결 테스트
- KIS 실전 읽기 전용: 선택 사항, 별도 profile
- 토스증권: client ID, client secret, 허용 IP 안내, 연결 테스트
- SEC: User-Agent 연락처
- OpenDART: 인증키

각 profile은 `미설정/검증 중/정상/권한 제한/만료/차단` 상태와 마지막 검증 시각만 표시한다.

## 10. 공식 자료

- [KIS Developers](https://apiportal.koreainvestment.com/)
- [토스증권 Open API 가이드](https://developers.tossinvest.com/docs)
- [토스증권 canonical OpenAPI](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)
- [토스증권 Open API 소개](https://home.tossinvest.com/ko/open-api)
