# KIS fixtures

`us-master-sample.cod`는 공식 해외 종목 마스터의 24개 탭 구분 필드 구조만 보존한 익명·최소 fixture다. NASDAQ/NYSE/AMEX 다운로드·CP949 decode·canonical 검색 contract는 `tests/us-instrument-master.test.ts`에서 검증한다.

이 디렉터리의 candle JSON은 KIS 공식 샘플 응답 필드만 남긴 합성·익명 fixture다. 순위·뉴스 JSON은 2026-07-20 KIS paper/prod 실제 읽기 전용 응답 중 계약 검증에 필요한 공개 필드만 비밀 없이 고정한 raw fixture다. 공개 종목명·종목코드·시장 수치·뉴스 제목은 포함하지만 어떤 fixture도 계정, 앱 키·시크릿, 접근 토큰이나 인증 헤더를 포함하지 않는다.

- 공식 참조: `koreainvestment/open-trading-api`
- 참조 commit: `885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc`
- 검증일: 2026-07-20
- 분봉: `FHKST03010200`, 당일 최대 30건/호출
- 일봉: `FHKST03010100`, 최대 100건/호출
- 국내 거래량·거래대금 순위: `FHPST01710000`, paper 실제 응답
- 미국 순위 계약 표본: `HHDFS76290000`/`HHDFS76310010`/`HHDFS76320010`/`HHDFS76330000`, 식별정보 없는 canonical 필드 표본
- 국내 등락률 순위: `FHPST01700000`, prod 실제 응답
- 국내 뉴스 제목: `FHKST01011800`, prod 실제 응답
- 해외 뉴스 제목: `HHPSTH60100C1`, prod 실제 응답
- 미국 분봉: `HHDFS76950200`, `us-intraday-chart.json` 익명 canonical fixture
- 미국 실시간: `us-ws-observed-layout.json`, prod 관측 71/26필드 메타데이터와 익명 contract test

분봉의 `acml_tr_pbmn`은 누적 거래대금이므로 개별 1분봉 거래대금으로 오인하지 않는다.
