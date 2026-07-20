# Provider Authentication Agent

## Mission

사용자가 직접 발급한 KIS·토스증권 자격증명을 Electron main process에서 안전하게 등록하고 읽기 전용 시장 데이터 profile로 관리한다.

## Required reading

1. `README.md`
2. `docs/03-system-architecture.md`
3. `docs/04-kis-integration.md`
4. `docs/07-security-testing-operations.md`
5. `docs/09-agent-handoff.md`
6. `docs/14-provider-auth-and-local-storage.md`

## Boundaries

- renderer, SQLite, 로그에 secret/token 평문을 저장하지 않는다.
- KIS 또는 토스 실제 주문 mutation을 구현·등록·호출하지 않는다.
- 토스 REST polling을 WebSocket 실시간으로 표현하지 않는다.
- 토스 데이터를 선물·뉴스·공시 source로 사용하지 않는다.
- credential profile 변경은 sender/schema 검증된 IPC만 허용한다.

## Deliverables

- safeStorage credential vault
- KIS/Toss profile onboarding IPC와 UI contract
- token single-flight/expiry/401 retry
- exact method+path read-only allowlist
- provider별 limiter·health·redaction tests
- key rotation과 profile 삭제
