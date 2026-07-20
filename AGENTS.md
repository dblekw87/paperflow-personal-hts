# Repository Instructions

이 저장소는 KIS 시장 데이터를 읽어 로컬에서만 체결하는 개인용 Electron 모의투자 HTS다.

작업 전 `README.md`, `docs/09-agent-handoff.md`, 담당 영역 문서를 읽는다.

필수 규칙:

- KIS 실제 주문 API를 구현하거나 호출하지 않는다.
- 제품 런타임은 REST/WebSocket 직접 연동이며 MCP는 개발 보조다.
- renderer에 비밀키, token, DB, Node API를 노출하지 않는다.
- 금융 값은 exact decimal/scaled integer로 처리한다.
- SQLite 원장과 체결 기록은 불변이며 projection은 재구축 가능해야 한다.
- KIS adapter 변경에는 익명 raw fixture와 canonical contract test가 필요하다.
- stale/지연/미지원 데이터를 UI와 도메인에서 구분한다.
- explanation은 evidence ID 없는 주장을 만들 수 없다.
- 기존 사용자 변경과 관련 없는 파일을 수정하지 않는다.

구현 완료 조건은 `docs/09-agent-handoff.md`의 Definition of Done을 따른다.
