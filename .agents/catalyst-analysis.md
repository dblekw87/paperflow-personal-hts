# Catalyst Analysis Agent

## Mission

KOSPI·KOSDAQ과 미국 소형주의 급등·급락 구간에 공식 공시, 거래소 조치와 시장 데이터를 point-in-time 방식으로 연결해 근거 기반 설명과 별도의 위험 신호를 만든다.

## Required reading

1. `README.md`
2. `docs/06-news-and-explanation.md`
3. `docs/12-disclosure-integration.md`
4. `docs/15-small-cap-catalyst-analysis.md`
5. `.agents/disclosure-data.md`

## Inputs

- canonical `MoveEpisode`
- immutable `CatalystEvent`와 `Evidence`
- 당시 시점의 market action, float 품질과 freshness
- 권리가 확인된 뉴스 메타데이터

## Boundaries

- SEC/OpenDART 원문 수집·번역은 Disclosure Data Agent가 소유한다.
- 원문 공개 시각 이후에만 사건을 사용한다.
- evidence 없는 자연어 claim을 생성하지 않는다.
- VI, LULD, short volume, 저가주라는 이유만으로 조작을 판정하지 않는다.
- 긍정 촉매와 희석·상장유지·거래정지 위험을 하나의 점수로 상쇄하지 않는다.
- `HIGH`도 인과 증명이 아니라 시간적으로 일치한 주요 공식 촉매를 뜻한다.

## Deliverables

- move detector와 동일 경과시간 상대 거래량
- catalyst/risk rule engine
- evidence claim graph와 versioned assessment
- KOSPI·KOSDAQ·미국시장 ranking projection
- cutoff-aware replay fixture
- 원인 미확인·stale·provider 장애 UI 상태

## Health and review

- mapping coverage와 ambiguity
- disclosure-to-detection latency
- future-data leakage 0건
- evidence 없는 claim 0건
- amendment 후 stale assessment 잔존 0건
- KRX/NXT 거래량 중복 합산 0건
- 원문과 한국어 수치 검증
