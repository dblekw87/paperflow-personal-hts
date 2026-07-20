# 실시간 시장·파생상품 커버리지

## 1. 목적

국내·미국 주식뿐 아니라 시장 방향을 판단하는 지수와 선물을 한 화면에서 본다. 모의 주문·잔고·손익은 계속 로컬 SQLite에서만 처리하고, KIS는 읽기 전용 시세 공급자로만 사용한다.

이 문서에서 `실시간`은 다음 조건을 모두 만족할 때만 표시한다.

- 공급자가 실시간 WebSocket 채널을 제공한다.
- 현재 App Key/계정에 해당 거래소 시세 권한이 있다.
- 구독 ACK가 성공했고 canonical decoder와 schema 검증을 통과한 frame이 계속 수신된다.
- provider 시각과 로컬 수신 시각으로 계산한 지연이 상품별 기준 이내다.

연결만 성공했거나 REST polling만 동작하면 `실시간`으로 표시하지 않는다.

## 2. 지원 매트릭스

현재 제품 UI에는 KOSPI·KOSDAQ·KOSPI200 공식 지수와
QQQ·SPY·IWM·USO·GLD ETF proxy의 KIS REST 스냅샷이 연결되어 있다.
REST 값은 새로 수신되어도 `DELAYED_OR_POLLING`으로 표시하며 WebSocket
`LIVE`로 승격하지 않는다. 실제 선물 타일은 실제 월물 resolver와 계정
권한 검증이 끝날 때까지 가격을 만들지 않고 `권한 필요/연결 예정` 상태를
유지한다.

| 화면 자산                      | 의미                           | KIS 수집 방식                 | 확인된 채널                                | 제품 상태                                   |
| ------------------------------ | ------------------------------ | ----------------------------- | ------------------------------------------ | ------------------------------------------- |
| KOSPI·KOSDAQ·KOSPI200 현물지수 | 국내 현물 시장 지수            | WebSocket + REST snapshot     | 국내지수 실시간체결 계열                   | 실시간 대상                                 |
| 국내 주식 NXT                  | 대체거래소 10호가·체결·장상태  | WebSocket                     | `H0NXASP0`, `H0NXCNT0`, `H0NXMKO0`         | 진단 검증 완료, 제품 UI는 표시 전용 연결 전 |
| KOSPI200 주간 지수선물         | KRX 정규 주간장 선물 실제 월물 | WebSocket 체결·호가 + REST    | `H0IFCNT0`, `H0IFASP0`                     | 실시간 대상, 공식 샘플상 실전 환경 전용     |
| KRX 야간 KOSPI200 선물         | KRX 야간 선물 실제 월물        | WebSocket 체결·호가 + REST    | `H0MFCNT0`, `H0MFASP0`                     | 실시간 대상, 장중 권한 검증 필요            |
| NASDAQ 상장 주식·ETF           | NASDAQ 거래소 개별 주식·ETF    | WebSocket 체결·호가 + REST    | 해외주식 `HDFSCNT0`, `HDFSASP0`            | 기존 실시간 대상                            |
| NASDAQ Composite/100 현물지수  | 현물 지수 값                   | KIS 해외지수 REST             | 분봉 `FHKST03030200`, 일봉 `FHKST03030100` | 전용 WS 없음, polling/지연 상태로 표시      |
| Russell 2000 방향              | 미국 소형주 시장 컨텍스트      | KIS 미국 ETF IWM 체결·호가    | `HDFSCNT0`, `HDFSASP0`                     | 무료 기본안 `PROXY_LIVE`; RUT/RTY가 아님    |
| E-mini/Micro Nasdaq 선물       | CME의 NQ/MNQ 실제 월물         | 해외선물 WebSocket 체결·5호가 | `HDFFF020`, `HDFFF010`                     | 실전 키와 CME 유료 실시간 시세 신청 후 대상 |
| WTI 원유 선물                  | CME/NYMEX의 CL/MCL 실제 월물   | 해외선물 WebSocket 체결·5호가 | `HDFFF020`, `HDFFF010`                     | 실전 키와 CME 유료 실시간 시세 신청 후 대상 |
| Brent 등 기타 원유 선물        | ICE 등 거래소 실제 월물        | 해외선물 WebSocket/REST       | 해외선물 공통 채널                         | 종목 마스터·계정 권한 장중 검증 후 활성화   |

`NASDAQ 현물`은 세 가지를 혼용하지 않는다.

- NASDAQ 상장 개별주식/ETF: 기존 해외주식 실시간 채널
- NASDAQ Composite 또는 Nasdaq-100 지수: 지수 자체
- NQ/MNQ: CME에서 거래되는 지수선물

QQQ와 NQ는 Nasdaq-100 지수의 대체 표현으로 볼 수 있지만 동일 상품이나 동일 가격이 아니므로 UI에서 별도 instrument로 표시한다.

### 무료 기본 시장 컨텍스트

| 목적              | KIS 구독 코드 | 품질         | 동일하지 않은 상품     |
| ----------------- | ------------- | ------------ | ---------------------- |
| Nasdaq-100 방향   | `NAS:QQQ`     | `PROXY_LIVE` | NQ/MNQ 선물            |
| Russell 2000 방향 | `AMS:IWM`     | `PROXY_LIVE` | RUT 지수, RTY/M2K 선물 |
| WTI 방향          | `AMS:USO`     | `PROXY_LIVE` | CL/MCL 선물            |

세 종목은 KIS 공식 미국 종목 마스터에서 각각 `NASQQQ`, `AMSIWM`, `AMSUSO`로 확인했다. 여기서 `NAS`·`AMS`는 KIS 구독용 provider market code다. Canonical listing venue는 QQQ=`NASDAQ`, IWM·USO=`NYSEARCA`로 별도 저장한다. ETF의 운용보수, 현금 보유, 롤 비용, 미국주식 거래시간 때문에 기초지수·선물과 괴리가 생길 수 있다. 정규장 밖 선물 움직임이나 futures order book을 제공하지 않으며 선물 가격으로 모의체결하지 않는다.

이 문서의 `주간 선물`은 KRX 정규 주간장 선물을 뜻한다. 주 단위 만기 상품을 뜻한다면 이는 weekly futures가 아니라 주간 만기 옵션 범위이므로 별도 옵션 instrument와 TR로 설계한다.

KIS 공식 범위에서 Nasdaq Composite/NDX 지수는 REST 분봉 polling이며 tick WebSocket이 아니다. 지수 자체의 tick 실시간이 필수라면 Nasdaq GIDS/Basic 등 적법한 정식 공급자 adapter를 별도 계약해야 한다.

### NXT와 통합 시세 경계

- NXT 공식 정규시장 시간은 프리마켓 `08:00~08:50`, 메인마켓
  `09:00:30~15:20`, 애프터마켓 호가접수 `15:30~20:00`·매매체결
  `15:40~20:00`이다. 운영시간은
  [넥스트레이드 거래제도](https://www.nextrade.co.kr/menu/transactionSys.do)를
  기준으로 하되, 앱은 벽시계만으로 체결을 열지 않고 venue 장상태와 실제
  NXT 호가·체결 frame을 함께 확인한다.
- NXT 전용 호가 `H0NXASP0`, 체결 `H0NXCNT0`, 장상태 `H0NXMKO0`을 한 세트로 취급한다.
- 2026-07-20 KIS paper의 삼성전자 진단에서 세 구독 ACK가 모두 성공했고 15초 동안 호가·체결 333 records를 schema 오류 없이 수신했다.
- 공식 NXT 호가는 65필드지만 같은 모의 환경에서 62필드가 관측됐다. 두 exact layout 외 필드 수는 fail closed한다.
- 통합 `H0UNASP0/H0UNCNT0`은 시장 전체 표시·스캐너 용도다. 호가 단계와 체결의 실제 실행 거래소 attribution이 없어 NXT/KRX queue나 SOR 모의체결의 근거로 사용하지 않는다.
- 동일 주식의 보유량은 security 수준에서 합산하되 주문·체결·queue·sequence는 execution venue별로 분리해야 한다. 이 storage/projection migration과 NXT 장상태 canonical adapter가 끝날 때까지 NXT 주문은 잠근다.

## 3. 권한과 환경 분리

로컬 모의투자 여부와 시장 데이터 계정 환경을 분리한다.

```text
simulation.mode = LOCAL_PAPER
marketData.environment = PAPER | PRODUCTION_READ_ONLY
marketData.entitlements = KR_EQUITY | US_EQUITY | KR_DERIVATIVES | CME_REALTIME | ...
```

- KIS 공식 샘플은 국내 지수선물 실시간 체결·호가를 실전계좌 전용으로 명시한다.
- 해외선물 샘플은 모의 해외선물 경로를 제공하지 않고 CME·SGX 실시간 시세 유료 신청을 요구한다. 신청 뒤 이용 계좌별 access token 발급 후 동기화에 최대 약 2시간이 걸릴 수 있다고 안내한다.
- 따라서 현재 모의 App Key만으로 모든 파생상품이 실시간 수신된다고 가정하지 않는다.
- 시세용 실전 키를 사용해도 KIS 주문 endpoint registry는 만들지 않는다. 주문은 항상 로컬 simulator로만 전달한다.
- entitlement가 없거나 negative subscription ACK가 오면 즉시 `RESTRICTED`로 표시하고 지연/빈 데이터를 실시간처럼 대체하지 않는다.
- CME 미신청 시 확인되는 종목등록 실패 메시지는 진단 원문을 비밀 제거해 보존하되 UI에는 `CME_REALTIME_ENTITLEMENT_REQUIRED`처럼 안정된 오류 코드로 표시한다.

필요한 환경 변수는 값 없이 이름만 정의한다.

```dotenv
KIS_DATA_ENV=paper
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_HTS_ID=
CME_DATA_MODE=proxy
KIS_NASDAQ_PROXY_EXCHANGE=NAS
KIS_NASDAQ_PROXY_SYMBOL=QQQ
KIS_RUSSELL_PROXY_EXCHANGE=AMS
KIS_RUSSELL_PROXY_SYMBOL=IWM
KIS_OIL_PROXY_EXCHANGE=AMS
KIS_OIL_PROXY_SYMBOL=USO
```

실전 읽기 전용 데이터를 사용할 때는 향후 OS credential vault에서 별도 profile로 관리한다. renderer와 로그에는 어느 키나 토큰도 전달하지 않는다.

### Snapshot·차트 REST 기준

| 대상                   | 현재가/호가                       | 분봉            | 기간 차트                                                    |
| ---------------------- | --------------------------------- | --------------- | ------------------------------------------------------------ |
| Nasdaq 현물지수        | 지수 조회 계열                    | `FHKST03030200` | `FHKST03030100`                                              |
| 해외선물 NQ/MNQ·CL/MCL | `HHDFC55010000` / `HHDFC86000000` | `HHDFC55020400` | 일·주·월 `HHDFC55020100` / `HHDFC55020000` / `HHDFC55020300` |
| 국내 지수선물 주간     | `FHMIF10000000` / `FHMIF10010000` | `FHKIF03020200` | `FHKIF03020100`                                              |

KRX 야간선물은 공개 샘플에서 야간 전용 REST snapshot을 확인하지 못했다. 장중 spike로 주간 REST의 야간 반영 여부를 검증하기 전에는 WS 첫 정상 frame까지 `loading`, 마지막 로컬 snapshot은 `stale`로 표시한다.

## 4. 종목 마스터와 월물

선물은 `NQ`, `CL` 같은 root symbol만 구독하지 않고 실제 거래 가능한 월물 코드를 구독한다.

- 국내 주간 선물: 국내 지수선물옵션 종목 마스터
- KRX 야간 선물: KRX 야간/CME 연계 종목 마스터 중 현재 공식 파일
- 해외선물: `ffcode.mst` 계열 해외선물옵션 종목 마스터

`Instrument`에는 다음을 추가한다.

```ts
interface DerivativeInstrument {
  instrumentId: string;
  providerCode: string;
  rootSymbol: string;
  venue: string;
  assetClass: "INDEX_FUTURE" | "ENERGY_FUTURE" | "COMMODITY_FUTURE";
  currency: string;
  expiry: string;
  lastTradeAt?: string;
  multiplier: string;
  tickSize: string;
  tickValue?: string;
  priceScale: string;
  sessionCalendarId: string;
  entitlementId?: string;
}
```

최근월 자동 선택은 거래량·미결제약정·만기까지 남은 일수를 근거로 하며, 선택된 실제 월물을 화면에 항상 표시한다. 차트용 연속선물은 별도 synthetic instrument로 만들고 실제 월물 가격과 혼동하지 않는다. 롤오버 시점과 보정 방식도 차트에 표시한다.

해외선물 가격은 종목 마스터의 계산 소수점 필드를 적용해 exact decimal로 변환한다. IEEE-754 float로 원본 가격 scale을 추측하지 않는다.

## 5. 장 세션과 시간

선물은 “24시간”으로 뭉뚱그리지 않는다.

- 거래소별 정규 세션, 야간 세션, 일일 정산, maintenance break를 캘린더로 관리한다.
- 미국 선물 시각은 거래소 timezone과 UTC instant를 함께 저장하고 DST를 처리한다.
- 국내 주간/야간 선물은 서로 다른 session ID를 사용하되 동일 기초자산 관계를 가진다.
- 장 마감과 휴식 시간의 무수신은 장애가 아니다. 예상 세션 중 무수신만 health 경고로 판단한다.
- 휴장·조기종료·서머타임 변경은 설정값 하드코딩이 아니라 달력/장운영 API로 보정한다.

## 6. 실시간 파이프라인

```text
KIS approval key
→ product/contract subscription registry
→ positive ACK 확인
→ TR별 raw decoder
→ numeric/sign/timestamp/instrument 검증
→ canonical trade/orderbook event
→ latest projection + candle + scanner
→ MessagePort batch
→ React renderer
```

구독 관리자는 다음을 보장한다.

- `(environment, trId, providerCode)` 중복 제거
- 요청한 모든 채널의 positive ACK 추적
- negative ACK, 권한 오류, 비정상 close를 health 실패로 반영
- 실제 수신 frame의 provider code가 요청 월물과 일치하는지 검증
- 재연결 후 종목 마스터·현재 월물·REST snapshot 재동기화
- visible/관심/보유/미체결 종목 우선순위와 구독 상한 적용

## 7. UI

시장 상단 스트립:

- KOSPI, KOSDAQ, KOSPI200
- KOSPI200 주간 선물
- KOSPI200 야간 선물
- Nasdaq Composite 또는 Nasdaq-100 현물지수
- NQ/MNQ 최근월
- Russell 2000 프록시 IWM
- WTI CL/MCL 최근월

각 타일은 상품명, 실제 월물, 현재가, 등락률, 거래량, 미결제약정 지원 여부, 세션, 통화, provider 시각, 수신 지연, 권한 상태를 표시한다.

필수 상태:

- `LIVE`
- `DELAYED`
- `STALE`
- `CLOSED`
- `RECONNECTING`
- `RESTRICTED`
- `UNSUPPORTED`
- `ROLLOVER_PENDING`
- `DELAYED_OR_POLLING`

현물지수 REST polling 값을 선물 WebSocket 값처럼 애니메이션하지 않는다. 권한이 없으면 신청 필요 사유를 표시하고 마지막 값은 지연 시각과 함께 읽기 전용으로 남긴다.

## 8. 모의체결 범위

시세 표시와 모의 거래 지원을 분리한다.

- Phase 1: 주식·ETF 모의거래, 파생상품은 시세·차트·상관관계 표시만
- 후속 Phase: 선물 전용 가상 증거금, 계약승수, tick value, 일일정산, 만기·롤오버, 강제청산 규칙을 구현한 뒤 모의 주문 활성화

주식용 현금 차감 모델로 선물을 체결하지 않는다. 파생상품 simulator가 완성되기 전에는 주문 버튼을 `분석 전용`으로 잠근다.

## 9. 검증과 수용 기준

- 공식 종목 마스터에서 실제 월물을 resolve하고 만료 종목을 구독하지 않는다.
- 모든 요청 채널의 positive ACK와 실제 canonical frame을 받아야 live probe가 PASS한다.
- CME 권한이 없는 계정은 NQ/CL을 `RESTRICTED`로 정확히 진단한다.
- 무료 기본안의 QQQ·IWM·USO에는 `PROXY_LIVE`와 실제 추종 대상이 함께 표시된다.
- KRX 주간·야간 세션을 구분하고 예상 휴식 중 무수신을 장애로 오판하지 않는다.
- 체결·호가의 숫자, 부호, timestamp, instrument가 schema 검증을 통과하지 않으면 UI에 반영하지 않는다.
- 장중 replay에서 NQ/CL 및 KOSPI200 주·야간 fixture를 각각 검증한다.
- renderer에 providerCode/원본 TR payload/비밀키가 노출되지 않는다.

## 10. 구현 순서

1. 종목 마스터 loader와 derivative canonical contract
2. KOSPI200 주간 체결·호가 decoder
3. KRX 야간 선물 체결·호가 decoder
4. 해외선물 공통 체결·호가 decoder
5. entitlement probe와 세션-aware health
6. NQ/MNQ·CL/MCL 장중 익명 fixture 계약 테스트
7. 시장 스트립·선물 workspace·차트
8. 연속선물과 롤오버
9. 별도 파생상품 모의체결 엔진

## 11. 근거

- [KIS Developers API 목록](https://apiportal.koreainvestment.com/apiservice-category): 국내 지수선물, KRX 야간선물, 해외선물옵션 실시간 체결·호가
- [KIS 공식 `open-trading-api`](https://github.com/koreainvestment/open-trading-api):
  - `index_futures_realtime_conclusion`, `index_futures_realtime_quote`
  - `krx_ngt_futures_ccnl`, `krx_ngt_futures_asking_price`
  - `overseas_futureoption/ccnl`, `overseas_futureoption/asking_price`
  - `stocks_info/domestic_index_future_code.py`
  - `stocks_info/domestic_cme_future_code.py`
  - `stocks_info/overseas_future_code.py`

TR ID, 종목코드, 지원 환경, 유료 시세 조건은 변경될 수 있다. 구현과 장중 health check 때 최신 포털·종목 마스터·공식 샘플을 다시 대조한다.
