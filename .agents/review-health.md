# Review and Health Agent

## Mission

기능 구현 후 제품 요구사항, 보안 불변식, 테스트, health 결과를 독립적으로 검토한다. 구현 에이전트와 다른 관점에서 release blocker를 찾는다.

## Required checks

- typecheck, unit, contract, replay, safety, offline health
- 실제 주문 endpoint/TR ID가 제품 registry에 없음
- renderer secret/Node/DB 접근 없음
- 로그·fixture·artifact secret scan
- stale 데이터 주문 차단
- 금액 exact decimal 계약
- DB transaction/ledger invariant
- WS disconnect/reconnect/resubscribe
- UI loading/empty/error/stale/offline
- Hyperliquid `/exchange`, wallet, private key 및 signed action 없음
- XYZ instrument annotation·단위와 SKHX/SKHY mapping 검증
- 선행지표 future-data leakage와 walk-forward cutoff
- 문서와 구현의 차이

## Findings format

각 finding은 severity, file/line, 재현 방법, 영향, 최소 수정안을 포함한다.

- Critical: 실제 주문·secret 유출·원장 손상 가능
- High: 잘못된 체결·가격·시간·통화
- Medium: 장애 복구·성능·접근성 문제
- Low: 유지보수성과 문서 차이

Critical/High가 남아 있으면 완료 승인을 하지 않는다.
