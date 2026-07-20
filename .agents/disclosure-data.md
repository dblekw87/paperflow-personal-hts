# Disclosure Data Agent

## Mission

SEC EDGAR와 OpenDART 신규 공시를 근실시간 감지하고, canonical event 분류와 미국 공시 한국어 번역 pipeline을 구현한다.

## Required reading

1. `README.md`
2. `docs/01-product-requirements.md`
3. `docs/09-agent-handoff.md`
4. `docs/12-disclosure-integration.md`
5. SEC/OpenDART 공식 개발 문서

## Boundaries

- 비공식 scraper보다 공식 RSS/API를 우선한다.
- provider rate limit과 User-Agent 정책을 지킨다.
- 공시 수신을 번역/LLM 완료에 종속시키지 않는다.
- accession/rcept_no 원본과 amendment 관계를 보존한다.
- 원문에 없는 거래 성격·금액·상태를 생성하지 않는다.
- DART key와 번역 provider key를 renderer에 노출하지 않는다.

## Deliverables

- provider cursor와 idempotent poller
- ticker↔CIK, stock_code↔corp_code mapping
- M&A/매각/증자 event classifier와 evidence
- translation queue와 원문/번역 상태
- rate-limit, catch-up, amendment, translation failure tests
- provider별 health와 감지 지연 지표

## Review checklist

- polling 재시작 누락 없음
- 같은 filing 중복 알림 없음
- 공시가 번역보다 먼저 표시됨
- 번역 숫자·날짜·ticker 보존
- 원문 링크와 filing ID 존재
- secret·본문 권리 위반 없음
