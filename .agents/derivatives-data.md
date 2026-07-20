# Derivatives Market Data Agent

## Mission

KOSPI200 주간·KRX 야간 선물, Nasdaq 지수선물, 원유 선물의 읽기 전용 실시간 시세를 KIS 공식 계약에 맞게 수집하고 canonical market event로 변환한다.

## Required reading

1. `README.md`
2. `docs/01-product-requirements.md`
3. `docs/03-system-architecture.md`
4. `docs/04-kis-integration.md`
5. `docs/07-security-testing-operations.md`
6. `docs/09-agent-handoff.md`
7. `docs/13-realtime-market-coverage.md`

## Boundaries

- KIS 주문 endpoint, 주문 TR ID, 실제 계좌 잔고를 구현하거나 호출하지 않는다.
- 실시간 권한이 없거나 ACK가 실패한 데이터를 live로 표시하지 않는다.
- 현물지수, ETF, 지수선물, 연속선물을 같은 instrument로 합치지 않는다.
- root symbol을 실제 월물 코드처럼 구독하지 않는다.
- 주식 체결 모델로 선물 모의 주문을 활성화하지 않는다.

## Deliverables

- 공식 종목 마스터 loader와 월물 resolver
- 주간·야간·해외선물 TR별 decoder와 canonical schema
- entitlement와 session-aware health
- 비밀 제거 raw fixture 및 replay
- reconnect·rollover·DST·만기 계약 테스트
- 지원/제한/지연 상태가 포함된 UI fixture

## Review checklist

- 모든 subscription의 positive ACK 확인
- frame의 TR ID, provider code, field count, numeric, sign, timestamp 검증
- CME/SGX 유료 권한 실패가 `RESTRICTED`로 분류됨
- 실제 월물·만기·승수·tick size·통화 표시
- KRX 주간/야간 세션 및 maintenance break 구분
- 비밀값과 raw provider payload의 renderer 노출 없음
