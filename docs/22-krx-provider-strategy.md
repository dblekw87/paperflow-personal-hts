# KRX Provider Strategy

## 1. Decision

PaperFlow는 국내 시장 데이터 공급원을 다음처럼 분리한다.

| 데이터 | 1차 원천 | fallback | 이유 |
| --- | --- | --- | --- |
| 실시간 체결·호가 | KIS WebSocket | 없음 | 개인 계정으로 즉시 화면 반응성이 필요하고 KRX 실시간 feed는 별도 분배 계약 영역이다. |
| 차트 intraday/history | KIS REST | 없음 | 현재 제품의 chart readiness gate와 KIS fixture/contract test가 이미 구축되어 있다. |
| 일별 종목 매매정보·종목기본정보 | KRX OpenAPI | KIS master/ranking | KRX OpenAPI 공개 서비스 목록에 유가증권·코스닥 일별매매정보와 종목기본정보가 있다. |
| 투자자 수급 | KRX Data Marketplace 통계 CSV | KIS REST | KRX OpenAPI 목록에는 없지만 정보데이터시스템 `[12009] 투자자별 거래실적(개별종목)`의 `MDCSTAT02301` CSV 다운로드 payload가 확인됐다. |
| 공매도 거래 | KRX Data Marketplace 통계 CSV | unsupported | KRX 정보데이터시스템 `공매도 거래 > 종목별 공매도 거래`의 `MDCSTAT30101` CSV 다운로드 payload가 확인됐다. |
| 공매도 잔고 | KRX Data Marketplace 통계 CSV | unsupported | KRX 정보데이터시스템 `공매도 순보유잔고`의 `MDCSTAT30501` CSV 다운로드 payload가 확인됐다. |
| 대차잔고 | FreeSIS/KOFIA official row-level source when confirmed | unsupported | FreeSIS export는 확인됐지만 실제 row-level API 또는 안정적인 payload body가 확인되지 않아 보류한다. |
| IPO·상장 일정 | KIND official web/Excel | KRX OpenAPI when confirmed | KIND 공식 endpoint가 실제 동작 확인됐다. |
| 권리일정 | 공공데이터포털/KSD | provider error state | 예탁원 API 401은 키 승인/전파 또는 serviceKey 적용 문제로 분리해 표시한다. |

## 2. Current KRX Surface

공식 KRX OpenAPI 서비스 목록은 2010년 이후 데이터를 대상으로 하며, 주식 항목에는
유가증권·코스닥·코넥스 일별매매정보와 종목기본정보가 노출되어 있다.
서비스 이용방법은 로그인, 인증키 신청, API 서비스 목록/명세서 확인, 서비스 활용신청,
승인 후 사용 순서다. 요청 인증키는 HTTP header `AUTH_KEY`로 전달한다.

현재 공개 OpenAPI 페이지에서 `종목별 투자자별 수급` 또는 `공매도` endpoint는 확인하지
못했다. 따라서 이 저장소는 OpenAPI endpoint를 추측해 호출하지 않는다.

대신 KRX 정보데이터시스템 통계 화면에서 확인된 다운로드 원천은 별도
`KRX_DATA_PRODUCT` source로 분리한다. `[12009] 투자자별 거래실적(개별종목)`은
`/comm/fileDn/GenerateOTP/generate.cmd`에 `url=dbms/MDC/STAT/standard/MDCSTAT02301`을
포함한 form payload를 보내 OTP를 받고, `/comm/fileDn/download_csv/download.cmd`에
`code`를 POST해 CSV를 수신한다. 화면 단위가 `천주/백만원`이면 projection에는 주/원
단위로 정규화한다.

`공매도 거래 > 종목별 공매도 거래`는
`url=dbms/MDC/STAT/srt/MDCSTAT30101`, `searchType=1`, `secugrpId=BC`,
`inqCond=STMFRTSCIFDRFSSRSWBC`, `share=1`, `money=1` payload로 OTP를 생성한 뒤
CSV를 수신한다. 현재 구현은 전체 시장 CSV에서 선택 종목 코드를 찾아 공매도 거래량,
거래대금, 거래비중만 표시한다.

`공매도 순보유잔고`는 `url=dbms/MDC/STAT/srt/MDCSTAT30501`, `searchType=1`,
`mktTpCd`, `isuCd`, `share=1`, `money=1` payload로 OTP를 생성한 뒤 CSV를
수신한다. 현재 구현은 선택 종목의 공매도 잔고수량, 잔고금액, 잔고비중을 표시한다.

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
4. 부분 완료: 공매도 카드. KRX 통계 CSV `MDCSTAT30101`로 종목별 공매도 거래대금·비중, `MDCSTAT30501`로 공매도 순보유잔고를 표시하고, 대차잔고는 공식 row-level 원천 확인 전 `보류`로 둔다.
5. 완료: 투자자 수급 source badge. KRX source가 연결되면 `KRX_OPENAPI` 또는 `KRX_DATA_PRODUCT`, fallback은 `KIS_REST`로 표시한다.
6. 부분 완료: KRX 통계 CSV 수급 adapter. `[12009]` `MDCSTAT02301` 종목별 수급과 `[12008]` `MDCSTAT02201` 전체 시장 수급을 `KRX_DATA_PRODUCT`로 연결하고, 개인/외국인/기관합계 필수 row 누락 시 KIS fallback한다. 프로그램매매는 전용 payload 확인 전까지 KIS fallback을 유지한다.
7. 보류: FreeSIS/KOFIA 대차잔고는 공식 row-level 원천 또는 안정적인 export body 확인 전까지 연결하지 않는다.
8. 후속: 프로그램매매 CSV payload를 확인해 KRX 통계 다운로드 client에 추가한다.

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
- KRX 정보데이터시스템 `[12009] 투자자별 거래실적(개별종목)` Network payload에서
  `MDCSTAT02301`, `isuCd=KR7005930003`, `share=1`, `money=1`, `download_csv/download.cmd`
  code POST 패턴을 확인했다.
- KRX 정보데이터시스템 `[12008] 투자자별 거래실적` Network payload에서
  `MDCSTAT02201`, `mktId=ALL`, `share=2`, `money=3`, `download_csv/download.cmd`
  code POST 패턴을 확인했다.
- KRX 정보데이터시스템 `공매도 거래 > 종목별 공매도 거래` Network payload에서
  `MDCSTAT30101`, `searchType=1`, `mktId=STK`, `secugrpId=BC`,
  `inqCond=STMFRTSCIFDRFSSRSWBC`, `share=1`, `money=1`을 확인했다.
- KRX 정보데이터시스템 `공매도 순보유잔고` Network payload에서
  `MDCSTAT30501`, `searchType=1`, `mktTpCd=1`, `isuCd=KR7042700005`,
  `share=1`, `money=1`을 확인했다.
