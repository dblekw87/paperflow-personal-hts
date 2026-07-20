# ADR-001: 제품 런타임은 KIS API에 직접 연동한다

- 상태: 승인
- 결정일: 2026-07-20

## 맥락

참조 저장소는 KIS REST/WebSocket Python 예제, KIS Code Assistant MCP, KIS Trading MCP를 제공한다. Electron 앱이 실시간 호가·체결·차트를 받는 경로로 직접 API와 MCP 중 하나를 선택해야 한다.

## 결정

- Electron 제품의 데이터 플레인은 TypeScript KIS 어댑터가 REST/WebSocket을 직접 호출한다.
- KIS Code Assistant MCP는 개발 중 API 검색과 공식 샘플 탐색에 사용한다.
- KIS Trading MCP는 수동 검증이나 에이전트 분석에 선택적으로 사용하지만 UI 실시간 경로에는 두지 않는다.
- 모의 주문 엔진은 어떤 KIS 주문 API도 호출하지 않는다.

## 근거

- 호가·체결은 지속 구독, 역압, 재연결, 구독 우선순위 제어가 필요하다. 직접 WebSocket이 이 책임을 가장 명확하게 가진다.
- MCP를 런타임 중간 계층으로 두면 Python/Docker 프로세스, 전송 계층, 스키마 변환, 장애 지점과 패키징 부담이 추가된다.
- Code Assistant MCP의 목적은 API와 예제 검색이지 실시간 시장 데이터 버스가 아니다.
- 공식 Python 예제의 인증, TR ID, 파라미터, 파싱 규칙은 TypeScript 포트의 검증 기준으로 재사용할 수 있다.

## 결과

### 장점

- 단일 Electron 배포물과 일관된 TypeScript 도메인 모델
- 낮은 지연과 구독 수명주기 직접 제어
- renderer와 KIS 사이에 명시적인 main/utility process 보안 경계
- MCP 장애가 제품 시세 기능에 영향을 주지 않음

### 비용

- 필요한 KIS 인증·REST·WebSocket 프로토콜을 TypeScript로 구현해야 한다.
- 공식 Python 샘플 업데이트와의 차이를 계약 테스트로 추적해야 한다.
- WebSocket 메시지 스키마와 암호화된 통보 처리 필요 시 별도 구현이 필요하다.

## 재검토 조건

- KIS가 공식 TypeScript SDK 또는 제품용 안정적 스트리밍 SDK를 제공할 때
- Trading MCP가 지속 구독, 역압, 버전 계약, 데스크톱 임베딩을 공식 지원할 때
- Python 분석 엔진이 제품의 필수 기능이 되어 sidecar 비용보다 재사용 가치가 커질 때
