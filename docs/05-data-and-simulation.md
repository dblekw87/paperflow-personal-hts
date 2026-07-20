# 데이터 모델과 모의체결

## 1. 원칙

- SQLite가 가상 계좌의 단일 진실 공급원이다.
- `fills`, `cash_ledger`, `domain_events`는 불변 기록이다.
- `cash_balances`, `positions`는 원장에서 재구축 가능한 projection이다.
- 주문·체결·현금·포지션·outbox 변경은 하나의 DB 트랜잭션이다.
- 가격·금액은 JS 부동소수점으로 영속화하지 않는다.
- 모든 계산은 정책 버전과 사용한 시장 이벤트를 추적할 수 있어야 한다.

## 2. 핵심 테이블

| 테이블                         | 목적                          | 주요 제약                                          |
| ------------------------------ | ----------------------------- | -------------------------------------------------- |
| `instruments`                  | 종목·거래소·통화·scale        | `id` unique                                        |
| `instrument_provider_mappings` | KIS 코드 매핑                 | provider + code unique                             |
| `market_sessions`              | 세션 시각·상태                | venue + session date                               |
| `quotes_latest`                | 최신 시세 projection          | instrument unique                                  |
| `orderbooks_latest`            | 최신 호가 projection          | instrument unique                                  |
| `candles`                      | 분/일봉                       | instrument + interval + session + opened_at unique |
| `ranking_snapshots`            | 원본/계산 순위                | query hash + as_of                                 |
| `news_items`                   | 뉴스 메타데이터               | provider + provider_item_id unique                 |
| `news_instrument_links`        | 뉴스-종목 연결                | pair unique                                        |
| `disclosures`                  | SEC·DART 원본 공시 메타데이터 | provider + filing id unique                        |
| `disclosure_events`            | 인수·매각 등 canonical event  | disclosure + event type                            |
| `disclosure_translations`      | 한국어 번역과 상태            | disclosure + locale + version                      |
| `provider_cursors`             | 증분 polling cursor           | provider + stream unique                           |
| `explanations`                 | 근거 묶음과 설명 결과         | instrument + window + version                      |
| `simulation_accounts`          | 로컬 가상 계좌                | account id                                         |
| `cash_balances`                | 현금 projection               | account + currency                                 |
| `cash_ledger`                  | 불변 현금 원장                | ledger entry id                                    |
| `orders`                       | 주문 aggregate                | account + client_order_id unique                   |
| `fills`                        | 불변 체결                     | fill id unique                                     |
| `position_lots`                | 체결 lot                      | lot id                                             |
| `position_projections`         | 보유 projection               | account + instrument                               |
| `portfolio_valuations`         | 시점별 평가                   | account + as_of                                    |
| `fx_rates`                     | 평가/환전 환율                | pair + as_of + source                              |
| `fee_profiles`                 | 시장별 비용 정책              | venue + effective_from + version                   |
| `domain_events`                | 감사 이벤트                   | event id unique                                    |
| `outbox_events`                | IPC/event 전달 보장           | event id unique                                    |
| `connection_events`            | 공급자 상태 이력              | occurred_at                                        |
| `app_settings`                 | 비민감 설정                   | key unique                                         |

비밀키와 token은 이 DB에 평문으로 저장하지 않는다.

## 3. 금액 표현

IPC와 도메인 명령에서는 decimal 문자열을 사용한다. DB는 종목별 `priceScale`과 통화별 최소 단위를 고려한 scaled integer 또는 exact decimal text를 사용한다.

```ts
interface Instrument {
  id: string;
  symbol: string;
  venue: string;
  timezone: string;
  currency: "KRW" | "USD";
  priceScale: number;
  quantityScale: number;
}
```

미국 주가는 단순히 센트 2자리만 있다고 가정하지 않는다. 반올림 방법과 scale은 instrument/venue 정책으로 결정한다.

## 4. 주문 계약과 상태

```ts
interface PlaceOrderCommand {
  clientOrderId: string;
  accountId: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: string;
  limitPrice?: string;
  timeInForce: "DAY";
  session: "REGULAR";
}
```

```text
RECEIVED
  ├─ REJECTED
  └─ ACCEPTED
       ├─ PARTIALLY_FILLED ─┬─ FILLED
       │                    └─ CANCELLED
       ├─ FILLED
       ├─ CANCELLED
       └─ EXPIRED
```

filled/cancelled/rejected/expired에서 open 상태로 되돌아갈 수 없다. 체결 수량 합은 주문 수량을 넘을 수 없다.

## 5. 주문 전 검증

1. schema와 `clientOrderId` 중복 여부
2. 지원 종목·시장·정규장 여부
3. 주문 유형별 필수 가격
4. 수량과 호가 단위
5. 최신 market snapshot의 신선도
6. 매수: 예상 원금 + 비용을 감당할 가용 현금
7. 매도: 예약 수량을 제외한 가용 보유량
8. 공매도 금지

시장가 주문은 snapshot이 stale이면 기본 거부한다. 지정가는 접수할 수 있지만 체결에는 live 데이터가 필요하다.

## 6. 체결 모델

체결기는 교체 가능한 인터페이스다.

```ts
interface FillModel {
  match(order: OpenOrder, market: MarketSnapshot): FillDecision[];
}
```

### MVP 기본 `BOOK_DEPTH_V1`

- 시장가 매수는 ask ladder, 시장가 매도는 bid ladder를 순서대로 소비한다.
- 지정가 매수는 최우선 ask가 지정가 이하일 때, 지정가 매도는 최우선 bid가 지정가 이상일 때 후보가 된다.
- 관측 호가 잔량과 설정된 participation rate 범위에서만 부분체결한다.
- 호가가 없고 마지막 체결가만 있을 경우 기본 거부한다. fallback을 켜면 명시적 슬리피지를 적용하고 fill에 기록한다.
- 동일 입력 market event stream과 동일 주문은 동일 fill을 생성해야 한다.
- 실제 거래소 큐 우선순위를 재현하지 못한다는 점을 UI에 표시한다.

후속 비교용 프로필:

- `TOUCH`: 반대 최우선 호가에 닿으면 설정 비율 체결
- `TRADE_THROUGH`: 실제 체결가가 지정가를 통과했을 때만 체결

각 fill은 `fillModelVersion`, `marketEventId`, bid/ask/last, slippage, fee profile version을 저장한다.

## 7. 원장 트랜잭션

### 매수 체결

하나의 트랜잭션에서:

1. fill 추가
2. 주문 filled quantity와 상태 변경
3. 예약 현금 감소
4. 체결 원금·수수료 현금 원장 기록
5. position lot 추가
6. cash/position projection 갱신
7. domain event와 outbox 추가

### 매도 체결

하나의 트랜잭션에서:

1. fill 추가
2. 주문 상태 변경
3. 예약 수량 감소
4. 정의된 평균단가법으로 실현손익 계산
5. 매도대금·비용·세금 원장 기록
6. lot/projection 갱신
7. domain event와 outbox 추가

어느 단계든 실패하면 전체를 rollback한다.

## 8. 현금과 결제

현금 projection은 최소한 다음을 구분한다.

- `settled`: 결제 완료
- `available`: 새 주문에 사용 가능
- `reserved`: open 주문에 예약
- `unsettled`: 체결됐지만 결제 규칙상 대기

MVP에서 결제를 즉시 처리할 수 있지만 스키마와 정책은 분리한다. 시장별 결제 규칙은 하드코딩하지 않고 versioned policy로 둔다.

KRW/USD 환전은 `FX_DEBIT`, `FX_CREDIT`, 비용 항목을 가진 명시적 원장 거래다. 평가용 환율 변경은 현금 원장을 바꾸지 않는다.

## 9. 손익

- 미실현손익 = 현재 평가액 - 잔여 취득원가
- 실현손익 = 매도대금 - 매도된 수량의 취득원가 - 귀속 비용/세금
- 총 손익은 실현, 미실현, 배당, 비용, 세금, 환차손익을 분리해 제시한다.
- 오래된 quote 또는 FX로 계산한 valuation은 `quality=STALE`이다.
- KRW 환산 총자산에는 사용한 FX rate와 `fxRateAsOf`를 저장한다.

세부 귀속·반올림 규칙은 golden test fixture로 고정한다.

## 10. 캔들·순위 보존

- raw tick은 기본 미저장 또는 1~7일 제한 보존
- 1분봉은 장기 보존
- 5분 이상 분봉은 1분봉에서 재생성 가능
- 순위 snapshot은 비교 기준 재현에 필요한 기간만 보존
- 주문·체결·현금 원장·감사 이벤트는 삭제하지 않음
- vacuum/checkpoint는 UI가 한가한 시점에 실행

## 11. DB 운영

- `PRAGMA journal_mode=WAL`
- foreign keys ON
- busy timeout
- utility process 한 개만 writer
- migration checksum
- 마이그레이션 전 backup
- 앱 정상 종료 시 checkpoint
- backup 복원 뒤 integrity check와 원장→projection 재구축 검증

## 12. 불변식 테스트

- 모든 통화에서 원장 합계와 cash projection이 일치한다.
- 포지션 수량은 fill과 lot으로 재구축한 값과 일치한다.
- 공매도 금지 모드에서 수량은 음수가 될 수 없다.
- fill 합은 order quantity를 초과하지 않는다.
- 같은 `clientOrderId`는 잔액을 두 번 바꾸지 않는다.
- 완료 주문은 다시 open 상태가 되지 않는다.
- 같은 시세 replay는 같은 체결·손익을 만든다.
