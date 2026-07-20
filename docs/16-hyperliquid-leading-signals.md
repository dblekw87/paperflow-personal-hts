# Hyperliquid XYZ 한국주식·원유 선행 보조지표

## 1. 결정

Hyperliquid의 XYZ HIP-3 perpetual market을 한국 현물 장전·장외 방향과 원유 흐름을 관찰하는 선택적 읽기 전용 공급자로 사용한다.

이 데이터는 코인 현물이 아니라 온체인 거래소에서 거래되는 전통자산 연동 무기한선물이다. KRX 현물, CME 선물 또는 공식 시초가 예측값이 아니므로 품질은 `ONCHAIN_TRADFI_PERP_PROXY`로 표시한다.

초기 UI 출력은 `장외 매수 우위`, `장외 매도 우위`, `판단 보류`다. 최소 60~120거래일 walk-forward 검증 전에는 상승 확률이나 매매 추천을 표시하지 않는다. 이 데이터로 앱의 모의 주문을 자동 제출하지 않는다.

## 2. 검증된 DEX와 instrument

2026-07-20 05:08 KST에 Hyperliquid mainnet 공개 API로 다음을 검증했다.

- DEX: `xyz`
- deployer: `0x88806a71d74ad0a510b350545c9ae490912f0888`
- XYZ 문서와 onchain `setOracle` 권한에 표시된 updater: `0x1234567890545d1df9ee64b35fdd16966e08acec`

`perpDexs`의 상위 `oracleUpdater` 필드는 현재 `null`일 수 있다. 앱은 이 값을 곧바로 “oracle 없음”으로 해석하지 않고 XYZ 문서, 허용된 `setOracle` subdeployer와 onchain metadata를 함께 검증한다.

| coin           | canonical 대상               | 계약 단위                 | 역할                 |
| -------------- | ---------------------------- | ------------------------- | -------------------- |
| `xyz:SMSN`     | `KRX:005930` 삼성전자        | 보통주 1주를 KRW→USD 환산 | 개별주 장외 보조지표 |
| `xyz:SKHX`     | `KRX:000660` SK하이닉스      | 보통주 1주를 KRW→USD 환산 | 개별주 장외 보조지표 |
| `xyz:HYUNDAI`  | `KRX:005380` 현대차          | 보통주 1주를 KRW→USD 환산 | 개별주 장외 보조지표 |
| `xyz:SKHY`     | `NASDAQ:SKHY` SK하이닉스 ADS | ADS 1주 = 보통주 0.1주    | 미국시장 교차검증    |
| `xyz:KR200`    | 한국 대형주 200 지수         | 지수 수준                 | 저유동 시 제외       |
| `xyz:EWY`      | MSCI South Korea ETF         | ETF 1주                   | 한국시장 교차검증    |
| `xyz:CL`       | WTI                          | 1배럴 가격 단위           | 원유 perp 프록시     |
| `xyz:BRENTOIL` | Brent                        | 1배럴 가격 단위           | 원유 perp 프록시     |

KOSDAQ 직접 연동 심볼은 확인되지 않았다. KOSPI·KOSDAQ 현물과 종목의 기준 가격은 계속 KIS/거래소 데이터다.

HIP-3 asset ID는 `100000 + perp_dex_index * 10000 + meta index`지만 읽기 전용 수집에는 coin 문자열을 사용한다. meta 배열 순서와 상품 명세는 바뀔 수 있으므로 asset ID를 하드코딩하지 않는다.

### SKHX와 SKHY

```text
xyz:SKHX = KRX 000660 보통주 1주
xyz:SKHY = Nasdaq SKHY ADS 1주 = 보통주 0.1주
```

둘을 같은 시계열로 합치거나 단순 평균하지 않는다.

```text
SKHY common-share equivalent USD = SKHY mark * 10
ADS basis bps = (SKHY mark * 10 / SKHX mark - 1) * 10,000
```

- 3% 이내: 교차 확인에 사용 가능
- 3~5%: 괴리 경고
- 5% 초과: `CROSS_MARKET_INCONSISTENCY`
- 10% 초과: 자동 방향 판단을 `NO_SIGNAL`로 차단

이 값은 초기 guardrail이며 실증 데이터로 재보정한다.

## 3. 가격 구조와 세션

XYZ가 instrument·oracle·leverage를 정의하고 HyperCore가 주문장·체결·funding·청산을 처리한다. XYZ perpetual은 USD oracle을 사용하며 USDC로 증거금과 손익을 정산한다.

한국 instrument의 외부 가격 세션은 KST 기준:

- 08:00~08:50
- 09:00~15:30
- 15:40~20:00

내부 가격 세션:

- 평일 08:50–09:00, 15:30–15:40, 20:00–다음날 08:00
- 금요일 20:00~월요일 08:00
- 한국 휴장일
- 외부 oracle datapoint가 30초 넘게 끊긴 구간

외부 세션은 기관 데이터 공급자의 실행가능 호가와 USD/KRW를 사용한다. 내부 세션은 마지막 외부 가격에서 시작해 XYZ 주문장의 impact bid/ask를 반영하는 1시간 시정수 EWMA로 oracle을 진행시킨다. 내부 가격은 24시간 심리를 보여줄 수 있지만 같은 주문장의 수급과 유동성에 영향을 받는다.

Mark는 oracle, oracle과 mid basis의 150초 EWMA, 최우선 bid·ask·최근 체결 중앙값을 조합한다. 단일 주식의 discovery bound는 기본 ±10%, 원유는 ±5%지만 이는 정확성을 보증하는 장치가 아니다.

## 4. 원유 해석

`xyz:CL`은 CME CL 실시간 주문장이나 만기 선물계약이 아니다.

| 상품     | 핵심 차이                                                             |
| -------- | --------------------------------------------------------------------- |
| CME CL   | 만기, CME 주문장·체결·결제, 1계약 1,000배럴                           |
| `xyz:CL` | 만기 없는 USDC 담보 perp, 1배럴 가격 단위, 자체 주문장·시간당 funding |
| USO      | 원유선물 포트폴리오 ETF, 운용보수·롤 비용·추적오차                    |

XYZ 원유의 외부 참조는 지정 선물 월물을 사용하고 롤 구간에 두 월물을 혼합한다. 현재 참조 월물과 롤 비중을 metadata version에 저장하고 정적 심볼로 하드코딩하지 않는다.

원유 방향 타일은 다음을 병렬 표시한다.

- `xyz:CL`: `ONCHAIN_TRADFI_PERP_PROXY`
- KIS `AMS:USO`: `PROXY_LIVE`
- 향후 허용되는 CME 지연/유료 시세: `DELAYED` 또는 `CME_REALTIME`

## 5. 읽기 전용 API

Public REST:

```http
POST https://api.hyperliquid.xyz/info

{"type":"perpDexs"}
{"type":"metaAndAssetCtxs","dex":"xyz"}
{"type":"perpAnnotation","coin":"xyz:SKHX"}
{"type":"l2Book","coin":"xyz:SKHX"}
{"type":"perpsAtOpenInterestCap","dex":"xyz"}
{"type":"candleSnapshot","req":{"coin":"xyz:SKHX","interval":"1m","startTime":0,"endTime":0}}
```

WebSocket:

```text
wss://api.hyperliquid.xyz/ws
```

```json
{"method":"subscribe","subscription":{"type":"allMids","dex":"xyz"}}
{"method":"subscribe","subscription":{"type":"allDexsAssetCtxs"}}
{"method":"subscribe","subscription":{"type":"activeAssetCtx","coin":"xyz:SKHX"}}
{"method":"subscribe","subscription":{"type":"bbo","coin":"xyz:SKHX"}}
{"method":"subscribe","subscription":{"type":"l2Book","coin":"xyz:SKHX"}}
{"method":"subscribe","subscription":{"type":"trades","coin":"xyz:SKHX"}}
{"method":"subscribe","subscription":{"type":"candle","coin":"xyz:SKHX","interval":"1m"}}
```

전체 context는 한 구독으로 받고 visible/관심 instrument만 BBO·L2·trades를 추가한다. `/exchange` signed action, wallet, private key와 주문 기능은 구현하지 않는다. 네트워크 allowlist는 정확히 `/info`와 WebSocket subscribe만 허용한다.

## 6. Metadata discovery

시작 시와 24시간마다:

1. `perpDexs`에서 `name === "xyz"`와 deployer를 확인한다.
2. `metaAndAssetCtxs(dex=xyz)` universe를 다시 읽는다.
3. `perpAnnotation`으로 기초자산, 단위, ADS ratio를 확인한다.
4. metadata hash와 version을 저장한다.
5. deployer, oracle updater, delisted, margin mode, leverage, OI cap 변경을 감지한다.
6. annotation이 예상 mapping과 다르면 `UNVERIFIED_INSTRUMENT`로 중단한다.

문서보다 runtime API의 현재 metadata와 cap을 우선하지만, 기초자산 정의가 충돌하면 신호를 만들지 않는다.

## 7. Canonical signal

```ts
interface CrossMarketSignalSnapshot {
  instrumentId: string;
  provider: "HYPERLIQUID";
  venue: "XYZ_HIP3";
  coin: string;
  quality: "ONCHAIN_TRADFI_PERP_PROXY";
  session: "EXTERNAL" | "INTERNAL";
  markPx: string;
  oraclePx: string;
  midPx?: string;
  fundingHourly: string;
  openInterest: string;
  openInterestNotionalUsd: string;
  dayNotionalVolumeUsd: string;
  receivedAt: string;
  metadataVersion: string;
}
```

원화 내재가격:

```text
implied KRW = Korean common-share mark USD * USDKRW
gap bps = 10,000 * (implied KRW / last KRX reference KRW - 1)
```

특징량:

- 내부 세션의 external close 대비 log return
- mark/oracle basis bps
- 15분·60분 OI 명목 변화
- 같은 요일·세션 대비 volume acceleration
- impact bid/ask spread와 지정 notional slippage
- OI cap utilization
- KR200·EWY·반도체 바스켓을 제거한 개별 종목 residual
- SKHX/SKHY ADS basis와 cross-market consensus

가격↑·OI↑ 같은 조합은 신규 방향 포지션 유입 가능성일 뿐 실제 long/short 주체를 증명하지 않는다.

초기 연구 점수:

```text
score =
  0.45 * residual gap z-score
+ 0.15 * volume acceleration z-score
+ 0.15 * price/OI alignment
+ 0.10 * funding crowding adjustment
+ 0.15 * cross-market consensus
```

예측 대상은 `다음 시초가 gap`, `시초 후 5분`, `당일 종가`를 분리한다. 장외 perp는 시초가 gap에는 도움이 될 수 있으나 종가 방향까지 같은 신뢰도를 갖는다고 가정하지 않는다.

## 8. 유동성·stale guardrail

초기 bootstrap 기준:

| 등급 | 24h 명목 거래대금 |      명목 OI | impact spread |      cap |
| ---- | ----------------: | -----------: | ------------: | -------: |
| 강함 |          $5M 이상 |     $5M 이상 |     20bp 이하 | 90% 미만 |
| 약함 |          $1M 이상 |     $1M 이상 |     35bp 이하 | 90% 미만 |
| 제외 |      위 기준 미달 | 위 기준 미달 |          과대 | cap 도달 |

30일 이상 저장 후 같은 요일·세션의 percentile 기준으로 바꾼다. `KR200`처럼 이름은 적합해도 유동성이 낮으면 신호에서 제외한다.

Freshness:

- 전체 WS frame 15초 없음: `WARN`
- 30초 없음: reconnect와 REST resnapshot
- asset context 수신 age 15초 초과: `STALE_WARN`
- 30초 초과: 신호 제외
- book timestamp 5초 초과: impact 경고
- 15초 초과: book 기반 특징 제외
- 외부 세션에서 oracle datapoint 30초 단절: `INTERNAL_SESSION_LOW_QUALITY`
- 30초 ping, reconnect 후 snapshot·candle backfill

## 9. 출력과 검증

예시:

```text
SK하이닉스 장외 선행 보조지표
방향: 장외 매수 우위
품질: 중간
세션: XYZ 내부 가격
근거: SKHX gap, OI 증가, 거래대금
경고: SKHY ADS와 큰 괴리 — 자동 판단 보류
```

Walk-forward 검증:

- cutoff 이후 KRX·공시 데이터를 feature에 넣지 않는다.
- KRX 다음 시초가, 5분, 종가 수익률을 별도 label로 평가한다.
- 방향 정확도 외에 Brier score, calibration, no-signal coverage와 거래비용 후 결과를 기록한다.
- 동일 기간 단순 전일 미국시장·EWY 기준보다 나은지 비교한다.
- regime·세션·유동성별 결과와 최대 오판 구간을 공개한다.
- 기준 성능을 충족하지 못하면 방향 badge를 없애고 원시 지표만 표시한다.

## 10. 저장과 정책

- decimal 원문은 문자열로 저장
- provider, dex, coin, event/receive 시각, session, quality, metadata version 저장
- context 1–5초, OI/funding 10초–1분, candle 장기 보관
- 전체 L2는 단기 또는 미보관하고 BBO·impact depth 집계 위주
- 개인 로컬 표시·연구 범위로 제한
- trade.xyz UI를 scraping하지 않고 Hyperliquid 공개 API를 사용
- 외부 재배포·판매는 별도 라이선스 검토 전 금지

## 11. 공식 근거

- [Hyperliquid HIP-3](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)
- [Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Hyperliquid Asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids)
- [XYZ architecture](https://docs.trade.xyz/)
- [XYZ Korea instrument와 세션](https://docs.trade.xyz/asset-directory/korea)
- [XYZ oracle](https://docs.trade.xyz/perp-mechanics/oracle-price)
- [XYZ mark price](https://docs.trade.xyz/perp-mechanics/mark-price)
- [XYZ funding](https://docs.trade.xyz/perp-mechanics/funding)
- [XYZ specification index](https://docs.trade.xyz/consolidated-resources/specification-index)
