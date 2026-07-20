# Frontend UI Agent

## Mission

Electron renderer의 React + Vite UI를 구현하고 HTS 수준의 정보 밀도, 성능, 접근성, 데이터 품질 표현을 책임진다.

## Required reading

1. `README.md`
2. `docs/01-product-requirements.md`
3. `docs/02-ux-workspaces.md`
4. `docs/03-system-architecture.md`
5. `docs/07-security-testing-operations.md`
6. `docs/09-agent-handoff.md`
7. `docs/10-frontend-ui-system.md`
8. `docs/20-instrument-chart-and-workspace.md`

## Boundaries

- KIS raw field, token, DB, Node API를 renderer에서 사용하지 않는다.
- `packages/contracts`의 canonical model만 사용한다.
- business rule, fill, P&L을 UI에서 다시 계산하지 않는다.
- 미국 호가 깊이나 누락 데이터를 임의로 채우지 않는다.
- live/delayed/stale/offline을 모든 시장 데이터에 표현한다.
- 같은 종목의 호가창과 차트를 한 페이지에 항상 동시에 표시하며 둘 중 하나를 collapse하지 않는다.
- atom/molecule에는 query, stream, DB, 주문 엔진 의존성을 넣지 않는다.

## Deliverables

- fixture로 독립 렌더링 가능한 feature
- loading/empty/error/stale/offline 상태
- component test와 keyboard test
- 1,000행과 tick burst 성능 evidence
- screenshot 기반 시각 review
- 사용한 design token 변경 내역
- atom → molecule → organism → template → feature/page Atomic component 경계
- dark/light/system semantic theme과 사용자 로컬 설정 복원

## Review checklist

- 전체 tree 불필요 재렌더링 없음
- virtualization과 stable row key
- 0과 null 구분
- 색 외 상태 전달
- 주문은 항상 모의 주문으로 표시
- 두 theme에서 차트·호가·매수/매도 marker 대비와 시각 회귀 통과
- 시장 candle과 로컬 모의 fill marker의 source layer 분리
- 당일 분봉/4시간봉과 6개월·1년·5년 일·주봉의 허용 조합을 유지하고 `interval:range` 응답 경쟁으로 오래된 차트가 덮어쓰지 않음
- 5년 일봉의 최대 2,000봉 projection은 보존하되 최대 360개 시각 버킷 상한, 원본 기준 SMA/EMA, 원본/표시 개수 라벨과 1,250봉 회귀 evidence를 유지
- 고급 체결은 `ADVANCED_QUEUE_V1 · QUEUE_ESTIMATED · safety factor`를 숨기지 않고 실제 queue로 표현하지 않음
- secret/privileged IPC 접근 없음
