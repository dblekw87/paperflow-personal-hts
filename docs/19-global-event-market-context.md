# 글로벌 이벤트·거시상황과 한국시장 영향 컨텍스트

## 1. 목적

전쟁 발발·확전, 제재, 해상·에너지 차질뿐 아니라 중앙은행, 경제지표, 금리·달러·유동성, 재정·관세·수출통제, 선거·규제, 신용위기, 공급망, 원자재, 재해·감염병·사이버, 기업·산업 충격과 기술 경쟁을 감지하고 같은 시점의 한국시장 반응을 근거와 함께 설명한다. Moonshot AI·DeepSeek 같은 경쟁 AI 모델의 성능·가격·오픈소스 발표도 같은 증거 규칙으로 다룬다.

이 기능은 “전쟁 때문에 국내장이 하락했다”라고 단정하는 예측기가 아니다. 공식 사건의 공개 시각과 실제 시장 반응을 같은 시간축에 놓고 `공식 연결`, `가능한 시황 맥락`, `동시 발생`, `근거 부족`을 구분하는 point-in-time 설명기다.

## 2. 무료 개인용 기본 소스

| 용도                  | 기본 소스                               | 취급                                                                              |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| 빠른 사건 발견        | KIS 해외뉴스 제목 API                   | 제목·시각·링크 등 계약상 허용 필드만 저장한다. 제목만으로 사건을 확정하지 않는다. |
| 해상 보안             | UKMTO, US MARAD, IMO 등 공식 알림       | 공식 문서 ID·URL·hash·공개/수신 시각을 Evidence로 남긴다.                         |
| 전쟁·제재·외교        | 정부 외교·국방·제재기관, UN 공식 자료   | 1차 발표의 상태와 정정·해제 여부를 버전으로 보존한다.                             |
| 중앙은행·금리         | Fed/FOMC, BOK ECOS, ECB, BOJ            | 결정·성명·의사록·포워드가이던스와 공개 시각을 분리한다.                           |
| 미국 경제지표         | BLS, BEA, Census, EIA, USDA             | release calendar, actual, consensus, prior, revision과 원 발표기관을 보존한다.    |
| 한국 경제지표         | KOSIS, 관세청, 기재부, 산업부, BOK ECOS | 공표·정정 시각, 단위, 계절조정 여부와 revision을 보존한다.                        |
| 국채·달러             | US Treasury, Federal Reserve            | 무료 공식 자료의 실제 cadence에 맞춰 `DELAYED`로 표시한다.                        |
| 미국 기업·거래소 영향 | SEC EDGAR, Nasdaq Trader halt           | 기업 공시와 거래정지는 글로벌 사건 자체와 구분해 연결한다.                        |
| AI·기업 발표          | 모델 개발사 공식 발표, 기업 IR·SEC      | 모델 성능·가격·배포조건과 기업 실적·guidance를 각각 1차 사실로 보존한다.          |
| 한국시장 반응         | KIS canonical 시세                      | KOSPI·KOSDAQ, USD/KRW와 관련 종목·업종 basket의 실제 반응을 관측한다.             |
| 무료 Nasdaq 방향      | KIS `NASDAQ:QQQ`                        | `PROXY_LIVE` ETF 방향 지표다. Nasdaq 현물지수로 표시하지 않는다.                  |
| 무료 유가 방향        | KIS `NYSEARCA:USO`                      | `PROXY_LIVE` ETF 방향 지표다. CME WTI 선물·현물 유가로 표시하지 않는다.           |

KIS 뉴스는 조기 탐지 신호이며 공식 1차 소스로 교차 확인한다. Reuters는 무료 수집·스크래핑 대상이 아니다. 별도 데이터 라이선스와 사용 범위 식별자가 설정된 경우에만 `LICENSED_REUTERS` Evidence를 허용한다. 뉴스 본문을 권한 없이 수집하거나 재배포하지 않는다.

FRED는 여러 series를 찾고 맞추는 편의 aggregation source로만 고려한다. CPI는 BLS, GDP는 BEA, 국채 수익률은 US Treasury처럼 원 발표기관 provenance를 우선하며 FRED 수신 시각을 원 발표 시각으로 바꾸지 않는다.

### Coverage registry

“거시상황을 다 분석한다”는 말은 모든 source가 실시간이라는 뜻이 아니다. 앱은 지정학·해상·중앙은행·경제지표·금리/달러·재정/통상·정책/규제·신용·공급망·원자재·재해/보건/사이버·기업/산업·기술·미국시장·한국시장·번역 범주를 registry에 모두 등록하고 다음 상태 중 하나를 표시한다.

- `AVAILABLE`: provider와 최근 성공 시각이 확인됨
- `DELAYED` / `STALE`: 관측 지연 또는 오래된 자료와 reason 표시
- `MISSING`: 구성했으나 이번 자료가 누락됨
- `UNSUPPORTED`: 무료 기본안에서 지원하지 않음

각 항목은 provider, release calendar/cadence, 실제 latency, revision policy, rights와 last success를 가진다. source가 없거나 장애면 추정값을 만들지 않는다.

## 3. 실시간의 의미

- KIS WebSocket 시장 반응은 feed 상태가 정상일 때 `LIVE`로 표시한다.
- KIS 해외뉴스 제목과 공식기관 자료는 공급자 제한을 지키는 polling 기반 `NEAR_REAL_TIME` 또는 `DELAYED`다.
- 모든 카드에 `publishedAt`, `obtainedAt`, `detectedAt`, 분석 `cutoffAt`, 관측 지연과 freshness를 표시한다.
- 공식 사이트 장애, polling 지연, 번역 대기는 빈 결과와 구분한다.
- 늦게 발견한 문서를 과거 시점에 알고 있었던 것처럼 사용하지 않는다.

따라서 사용자는 사건을 빠르게 인지할 수 있지만, “어떤 전쟁도 발생 즉시 반드시 감지한다”는 보장은 하지 않는다.

어떤 중앙은행·지표·정책·재해·기업 발표도 전부 실시간으로 보장하지 않는다. 예정 공표는 calendar를 사용하고 event-driven source는 provider별 polling을 사용하며, revision은 기존 값을 덮어쓰지 않고 version으로 보존한다.

## 3.1 분석 taxonomy

- 중앙은행: 정책금리, 양적긴축/완화, 점도표, 성명·기자회견·포워드가이던스
- 경제지표: CPI/PPI, 고용·실업률, GDP, PMI, 소매판매, 산업생산, 무역
- 금융여건: 미국 2년·10년 국채금리, 달러, 신용·은행·유동성 위기
- 정책: 재정·세금·관세·수출통제, 선거·정부정책·산업규제
- 실물충격: 공급망·파업, 원유·가스·금속·농산물, 자연재해·감염병·사이버/인프라
- 기업·산업: 주요 기업 실적·guidance, 거래정지, 산업 수요·공급 충격
- 기술 경쟁: AI 모델 성능·가격·라이선스와 반도체·클라우드 전달경로

경제지표 surprise는 원 release의 `actual`, 별도 권리·조사 provenance가 있는 `consensus`, 최초 `prior`, `revisedPrior`, 단위, `releaseAt`, release Evidence와 consensus Evidence를 저장한다. `surprise = actual - consensus`를 exact decimal로 계산하고 `ABOVE/IN_LINE/BELOW_CONSENSUS`는 그 부호만 뜻한다. CPI 상방 surprise가 “좋다/나쁘다” 같은 투자 해석을 뜻하지 않는다. 라이선스가 있는 consensus가 없으면 `NO_CONSENSUS`이며 surprise를 만들지 않는다.

## 4. 이벤트 처리

```text
KIS 해외뉴스 제목 ─┐
UKMTO/MARAD/정부 ──┼─> 권리 검사 ─> 정규화 ─> 중복·정정 연결 ─> 한국어 번역
SEC/Nasdaq 공식자료 ┘                                      │
                                                          ├─> 사건 타임라인
KIS 시장 데이터 ─> 시점별 시장반응 관측 ────────────────────┤
                                                          └─> 영향 컨텍스트
```

중복 키는 provider 사건 ID와 정규화된 사건 fingerprint를 함께 쓴다. 동일 fingerprint의 업데이트는 `supersedesEventId`로 이전 version을 명시해야 한다. 철회·종료·정정은 이전 레코드를 덮어쓰지 않고 새 이벤트로 연결한다.

영문 자료는 원문 제목과 한국어 번역을 분리 저장한다. 번역 상태는 `PENDING`, `COMPLETE`, `FAILED`로 보이고, 영문 사건은 한국어 번역 완료 전 최종 영향 설명에 사용하지 않는다. 숫자·시간·지명·선박명·제재 대상은 번역 후 원문과 구조화 값이 일치하는지 검사한다.

## 5. 한국시장 반응 채널

각 사건 전후의 고정 window에서 다음을 관측한다.

- KOSPI·KOSDAQ 수익률과 거래대금 변화
- USD/KRW 방향과 변화율
- `NASDAQ:QQQ`와 미국 반도체·클라우드 종목의 실제 수익률·거래량·거래대금
- `NYSEARCA:IWM` Russell 방향 proxy와 `NYSEARCA:EWY` 한국주식 방향 proxy
- US Treasury 공식 2년·10년 수익률과 Fed broad-dollar series: 무료 기본안은 `DELAYED`이며 live tick이 아님
- `NYSEARCA:USO`의 유가 방향 proxy
- 원유·가스·금속·농산물: verified provider가 없으면 coverage를 `UNSUPPORTED`로 유지
- 운송·항공: 원가 상승과 항로 우회 민감도
- 정유: 재고·crack spread 등 별도 근거가 없으면 유가 상승만으로 수혜를 확정하지 않음
- 방산: 공식 계약·예산·수주 근거와 단순 테마 동조를 분리
- 전력·반도체 등: 환율·에너지비·위험회피와 개별 업황 신호를 함께 비교
- AI 경쟁 발표: 더 낮은 추론비용·유사 성능이 기존 AI 투자 회수기간과 고평가 기대를 낮출 수 있다는 전달경로를 가설로 제시하되, 실제 미국·한국 시장 반응이 없으면 영향으로 판정하지 않음

업종 basket은 구성 종목·가중치·기준시각을 버전으로 남긴다. KOSPI와 KOSDAQ의 반응이 다르거나 환율·유가가 반대 방향이면 이를 counter-evidence로 표시한다.

AI 발표 분석은 `발표 사실`, `시장 반응`, `전달경로 가설`을 분리한다. 모델 개발사 공식 자료에서 benchmark 조건·가격 단위·라이선스·공개 시각을 확인하고, 기업 IR·SEC 공시에서 실적과 guidance를 별도 Evidence로 둔다. 같은 구간의 미국 금리 변화, 기존 기업 실적, 규제·수출통제, 지수 전반 risk-off는 counter-evidence 또는 대안 가설이다. benchmark가 다르거나 재현되지 않은 성능 비교를 우열의 확정 사실로 쓰지 않는다.

직접 한국시장 canonical ID는 KIS 정규화 계층의 `KRX:KOSPI`, `KRX:KOSDAQ`, `FX:USDKRW`다. role 이름만 한국시장이고 실제 instrument나 source가 다른 observation은 거절한다.

## 6. 설명과 신뢰도

화면 표현은 다음 네 단계만 사용한다.

- `OFFICIAL_LINKAGE`: 공식 자료가 연결 관계를 직접 명시하고 한국시장 반응도 관측됨
- `PLAUSIBLE_CONTEXT`: 사건 시각과 경제적 전달 경로가 타당하나 직접 인과는 미확정
- `OBSERVED_COINCIDENCE`: 같은 구간에 가격 반응만 관측
- `INSUFFICIENT_EVIDENCE`: cutoff까지 공식 사건 또는 시장 반응이 부족

`HIGH`는 공식 1차 Evidence, stale하지 않은 KOSPI·KOSDAQ·USD/KRW 직접 반응, counter-evidence 검토가 모두 있을 때만 허용한다. KIS 뉴스 제목이나 Reuters 기사만으로 `HIGH`를 만들지 않는다. `MEDIUM` 이상 설명은 반대 신호 또는 대안 가설을 반드시 기록한다.

권장 문구:

- “UKMTO 공식 주의보 공개 후 KOSPI 하락과 원/달러 상승이 함께 관측됐습니다. 시간·전달 경로는 부합하지만 직접 인과로 확정할 수 없습니다.”
- “호르무즈 관련 제목이 탐지됐으나 공식 자료를 아직 확인하지 못했습니다.”
- “USO ETF가 상승했습니다. 무료 유가 방향 proxy이며 CME WTI 선물 시세가 아닙니다.”
- “경쟁 AI 모델의 가격 발표 후 QQQ와 반도체 종목의 거래대금 증가·하락이 관측됐습니다. valuation 압력이라는 전달경로는 가능하지만 금리와 기업 실적 영향도 있어 직접 인과로 확정할 수 없습니다.”

## 7. Point-in-time 불변식

- 사건과 Evidence는 `publishedAt <= obtainedAt <= detectedAt <= asOfAt <= cutoffAt`을 만족한다.
- `asOfAt`은 assessment에 실제 포함된 정보의 최대 시각이고 `cutoffAt`은 분석 실행 경계다. 모든 사건·Evidence·번역·시장 관측은 `asOfAt <= cutoffAt` 안에 있어야 한다.
- claim은 실제 Evidence ID를 하나 이상 가진다.
- assessment·channel·claim·counter-evidence의 observation ID는 모두 존재해야 한다.
- 같은 Evidence·observation ID의 중복 입력을 거절한다.
- market observation은 exact decimal string을 사용하며 window 미래 자료를 포함하지 않는다.
- stale·delayed·proxy 상태를 live 또는 공식 benchmark로 승격하지 않는다.
- AI 모델 benchmark·가격·라이선스 사실, 기업 실적, 시장 반응과 valuation 전달경로 가설을 서로 다른 claim으로 둔다.
- 상관관계는 인과관계가 아니다. 계약 enum에는 일반적인 `CAUSED_BY` 판정 자체가 없다.

## 8. UI

종목 차트·호가가 함께 있는 단일 종목 workspace 안에 `글로벌 시황` 패널을 둔다.

- 상단: 사건 제목 한국어, 원문 보기, source badge, severity, freshness
- 타임라인: 공식 공개·앱 수신·번역 완료·한국시장 반응 시각
- 반응 strip: KOSPI, KOSDAQ, USD/KRW, 미국 금리·달러, QQQ/IWM/USO/EWY proxy, 관련 업종
- 설명 카드: 관계 수준, confidence, evidence, counter-evidence
- 상태: 공식 확인 대기, 번역 대기, 지연, stale, 철회, 공급자 장애

차트에는 사건 공개 marker를 선택적으로 표시하되 그 marker를 매수·매도 신호로 표현하지 않는다.

## 9. Health와 테스트

- provider별 최근 성공·실패·poll 지연
- 공식 source URL·문서 hash·권리 상태
- provider ID/fingerprint 중복과 supersedes chain
- published/obtained/detected/translated/cutoff 순서
- 영어 사건 한국어 번역 누락
- evidence 없는 claim, 알 수 없는 observation
- 미래 시점 Evidence·시장 반응 유입
- KIS 뉴스 제목을 공식 확정으로 승격하는 오류
- Reuters license reference 없는 입력
- `NYSEARCA:USO`를 CME·WTI 선물 live로 오표시하는 오류
- `NASDAQ:QQQ`를 Nasdaq 현물지수로 오표시하는 오류
- `NYSEARCA:IWM`·`NYSEARCA:EWY`를 Russell/KOSPI 공식 지수로 오표시하는 오류
- delayed US Treasury/Fed series를 live quote로 표시하는 오류
- actual-consensus와 surprise 값·부호 불일치
- coverage category 누락 또는 `MISSING`·`UNSUPPORTED` 은폐
- AI 모델 발표 사실 없이 기술주·반도체 하락 원인을 확정하는 오류
- 금리·실적 등 동시 요인을 counter-evidence에서 누락하는 오류

현재 계약은 수집기나 스크래퍼를 구현하지 않는다. provider adapter를 추가할 때에는 이용조건·호출 제한을 검토하고 익명 fixture와 contract test를 별도로 추가한다.

## 10. 공식 참고

- UKMTO: `https://www.ukmto.org/`
- US Maritime Administration advisories: `https://www.maritime.dot.gov/msci-advisories`
- SEC EDGAR: `https://www.sec.gov/edgar/search/`
- Nasdaq Trader halts: `https://www.nasdaqtrader.com/Trader.aspx?id=TradeHalts`
- US Treasury OFAC: `https://ofac.treasury.gov/`
- Federal Reserve/FOMC: `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`
- BLS release calendar: `https://www.bls.gov/schedule/`
- BEA release schedule: `https://www.bea.gov/news/schedule`
- US Treasury interest rates: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates`
- EIA: `https://www.eia.gov/`
- BOK ECOS: `https://ecos.bok.or.kr/`
- KOSIS: `https://kosis.kr/`
- UN press releases: `https://press.un.org/`

공식 URL 구조와 제공 정책은 바뀔 수 있으므로 adapter 구현 시점에 다시 확인한다.
