# KRX Provider Strategy

## 1. Decision

PaperFlow는 국내 시장 데이터 공급원을 다음처럼 분리한다.

| 데이터 | 1차 원천 | fallback | 이유 |
| --- | --- | --- | --- |
| 실시간 체결·호가 | KIS WebSocket | 없음 | 개인 계정으로 즉시 화면 반응성이 필요하고 KRX 실시간 feed는 별도 분배 계약 영역이다. |
| 차트 intraday/history | KIS REST | 없음 | 현재 제품의 chart readiness gate와 KIS fixture/contract test가 이미 구축되어 있다. |
| 일별 종목 매매정보·종목기본정보 | KRX OpenAPI | KIS master/ranking | KRX OpenAPI 공개 서비스 목록에 유가증권·코스닥 일별매매정보와 종목기본정보가 있다. |
| 투자자 수급 | KRX Data Marketplace/data product | KIS REST | 거래소 원천이 더 적합하지만, 현재 공개 OpenAPI 목록에서는 수급 전용 endpoint가 확인되지 않았다. |
| 공매도 | KRX Data Marketplace/data product | unsupported | 공매도는 거래소 원천이 맞다. 확인된 OpenAPI endpoint 또는 별도 data product 계약 전에는 숫자를 만들지 않는다. |
| IPO·상장 일정 | KIND official web/Excel | KRX OpenAPI when confirmed | KIND 공식 endpoint가 실제 동작 확인됐다. |
| 권리일정 | 공공데이터포털/KSD | provider error state | 예탁원 API 401은 키 승인/전파 또는 serviceKey 적용 문제로 분리해 표시한다. |

## 2. Current KRX Surface

공식 KRX OpenAPI 서비스 목록은 2010년 이후 데이터를 대상으로 하며, 주식 항목에는
유가증권·코스닥·코넥스 일별매매정보와 종목기본정보가 노출되어 있다.
서비스 이용방법은 로그인, 인증키 신청, API 서비스 목록/명세서 확인, 서비스 활용신청,
승인 후 사용 순서다. 요청 인증키는 HTTP header `AUTH_KEY`로 전달한다.

현재 공개 페이지에서 `종목별 투자자별 수급` 또는 `공매도` OpenAPI endpoint는 확인하지
못했다. 따라서 이 저장소는 해당 endpoint를 추측해 호출하지 않는다.

## 3. Runtime Policy

- renderer에는 `KRX_OPENAPI_KEY`나 KIS token을 전달하지 않는다.
- KRX OpenAPI 호출은 main process/provider adapter에서만 수행한다.
- KRX가 연결된 항목은 projection `source`를 `KRX_OPENAPI` 또는
  `KRX_DATA_PRODUCT`로 표시한다.
- 미연결 항목이 KIS로 fallback하면 status message에 fallback 사유를 포함한다.
- 수급·공매도는 빈 값 또는 오류를 `0`으로 대체하지 않는다.
- 공매도 데이터가 연결되어도 로컬 모의투자 엔진의 공매도 주문 금지는 유지한다.

## 4. Implementation Priority

1. 완료: KRX OpenAPI 공통 client와 redaction/error contract.
2. 완료: KRX 일별매매정보 adapter: KOSPI `sto/stk_bydd_trd`, KOSDAQ `sto/ksq_bydd_trd`.
3. KRX 종목기본정보 adapter: KOSPI/KOSDAQ basic info를 KIS master fallback과 비교.
4. 수급 provider spike: 계정 내 명세서에서 수급 전용 API ID 또는 data product endpoint 확인.
5. 공매도 provider spike: 계정 내 명세서에서 공매도 거래/잔고 endpoint 확인.
6. 투자자 수급 UI source를 KRX로 전환하고 KIS 수급 adapter는 fallback로 격하.

2026-07-22 현재 Electron 국내 순위는 `TURNOVER`, `AVERAGE_VOLUME`,
`CHANGE_RATE_GAINERS`, `CHANGE_RATE_LOSERS`에서 KRX OpenAPI 일별매매정보를 먼저
시도한다. KRX host timeout, 미승인, 빈 응답이면 status message에 fallback 사유를 남기고
기존 KIS ranking adapter로 전환한다. `VOLUME_INCREASE`는 전영업일 비교 로직이 필요해
KIS fallback을 유지한다.

## 5. Evidence

- KRX OpenAPI 서비스 목록은 주식 `유가증권 일별매매정보`, `코스닥 일별매매정보`,
  `유가증권 종목기본정보`, `코스닥 종목기본정보` 등을 표시한다.
- KRX OpenAPI 이용방법은 인증키 신청, 명세서 확인, 활용신청, 승인 후 사용 순서다.
- KRX service detail page는 인증키를 request header `AUTH_KEY` 필드로 전달한다고 안내한다.
