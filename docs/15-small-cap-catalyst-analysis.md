# 국내·미국 소형주 급등 원인 분석

## 1. 목적과 표현 원칙

KOSPI·KOSDAQ과 Nasdaq·NYSE·NYSE American 종목의 급등 구간을 감지하고, 당시 확인할 수 있었던 공식 공시·거래소 조치·시장 데이터를 시간순으로 결합한다.

이 기능은 인과관계나 시세 방향을 확정하지 않는다. 화면에는 다음 세 가지를 분리해 표시한다.

- `확인된 주요 촉매`: 상승 시작 전 또는 직전에 공개된 공식 자료
- `시장구조 추정`: 거래량·거래대금·회전율·호가 변화만으로 관측한 보조 설명
- `급등 위험 신호`: 희석, 상장유지, 거래정지, 투자경고 등 하락 위험

`잡주`, `펌프앤덤프`, `사기주`는 분석 판정값으로 사용하지 않는다. microcap·저가주·저유동성은 사용자가 바꿀 수 있는 탐색 필터다.

## 2. 급등 구간 감지

`MoveEpisode`는 종목·venue·session별로 생성한다.

- 1분·5분·15분 및 전일 종가 대비 수익률
- 동일 장 경과시간의 과거 20거래일 중앙값 대비 상대 거래량
- 거래대금, 거래대금 증가율과 가속도
- spread, 호가잔량 불균형, 체결 공백
- 상장주식수 또는 품질이 표시된 추정 유통주식수 대비 회전율
- 국내 VI와 미국 LULD/거래정지 상태

장 초반 누적 거래량을 과거 종일 거래량과 비교하지 않는다. KRX와 NXT 데이터는 venue별로 보존하고, 중복 체결 가능성을 제거하지 못하면 통합 거래량을 만들지 않는다.

## 3. 국내 촉매와 위험

### OpenDART

- 유상·무상증자, 감자
- CB·BW·EB 발행, 전환가액 조정과 실제 전환청구
- 합병·분할·주식교환, 영업·유형자산 양수도
- 타법인 주식 취득·처분, 최대주주·대량보유 변화
- 자기주식 취득·처분
- 단일판매·공급계약, 소송, 영업정지, 회생
- 정정·철회·계약 해지

### KRX/KIND

- 거래정지·재개, 정적·동적 VI, 단기과열
- 투자주의·투자경고·투자위험
- 관리종목, KOSDAQ 투자주의환기종목
- 불성실공시 사전예고·지정
- 조회공시 요구·답변
- 상장적격성 심사와 상장폐지 관련 상태

VI나 투자경고만으로 시세조종을 단정하지 않는다. 반복 증자·CB/BW, 전환가 조정, 최대주주 변경, 계약 정정·철회는 촉매와 별개의 위험 카드로 노출한다.

## 4. 미국 촉매와 위험

- 8-K/6-K: 중요 계약, 인수·매각, 사모, 지배권 변경
- S-1/S-3와 amendment: 등록 가능 상태
- 424B4/424B5: 공모·ATM 조건
- EX-4/EX-10: warrant, convertible, sales agreement 세부 조건
- S-4, proxy, Schedule TO/13D: M&A·공개매수·대량보유
- 역분할, Nasdaq/NYSE 상장유지·미제출·상장폐지 상태
- Nasdaq/NYSE halt와 SEC trading suspension

등록신고서가 있다는 사실과 실제 주식 판매를 구분한다. 발행 한도, 실제 판매액, warrant 행사가, 잠재 희석량도 별도 사실로 저장한다. LULD와 규제 거래정지는 같은 사건으로 처리하지 않는다.

미국 short interest는 FINRA 공표 기준일이 있는 snapshot으로만 표시한다. 일별 short-sale volume을 short interest 또는 숏스퀴즈 증거라고 표현하지 않는다. 무료 공식 자료로 확인할 수 없는 실시간 borrow rate는 `UNSUPPORTED`다.

## 5. Canonical contract

```ts
interface CatalystEvent {
  id: string;
  instrumentId: string;
  provider:
    | "SEC_EDGAR"
    | "OPEN_DART"
    | "KRX_KIND"
    | "NASDAQ"
    | "NYSE"
    | "NXT"
    | "ISSUER_IR";
  providerEventId: string;
  type: CatalystType;
  lifecycle:
    | "PROPOSED"
    | "FILED"
    | "EFFECTIVE"
    | "COMPLETED"
    | "EXERCISED"
    | "CANCELLED"
    | "AMENDED"
    | "UNKNOWN";
  impact: "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL" | "UNKNOWN";
  publishedAt: string;
  detectedAt: string;
  effectiveAt?: string;
  facts: Array<{ key: string; value: string; unit?: string; asOf?: string }>;
  evidenceIds: string[];
  amendmentOf?: string;
}

interface MoveEpisode {
  id: string;
  instrumentId: string;
  venue: string;
  session: "PRE" | "REGULAR" | "AFTER";
  startedAt: string;
  peakAt?: string;
  returnPct: string;
  relativeVolume?: string;
  turnoverValue?: { value: string; currency: string };
  floatTurnover?: string;
  spreadBps?: string;
  dataQuality: "LIVE" | "DELAYED" | "STALE" | "PARTIAL";
}

interface CatalystAssessment {
  id: string;
  moveEpisodeId: string;
  verdict:
    | "PRIMARY_EVENT_TIMING_MATCH"
    | "ASSOCIATED_PRIMARY_EVENT"
    | "MARKET_STRUCTURE_ONLY"
    | "NO_VERIFIED_CATALYST";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  catalystIds: string[];
  riskSignalIds: string[];
  claims: Array<{ id: string; textKo: string; evidenceIds: string[] }>;
  cutoffAt: string;
  version: number;
}
```

```ts
interface Evidence {
  id: string;
  instrumentIds: string[];
  tier:
    | "REGULATOR_EXCHANGE"
    | "ISSUER_FILED"
    | "ISSUER_IR"
    | "MARKET_DATA"
    | "LICENSED_NEWS";
  providerDocumentId: string;
  canonicalUrl: string;
  documentHash: string;
  publishedAt: string;
  obtainedAt: string;
}
```

모든 자연어 claim에는 하나 이상의 실제 Evidence가 연결돼야 한다. Evidence의 대상 종목은 move 종목과 일치하고 `publishedAt`과 `obtainedAt`이 분석 cutoff 이전이어야 한다. 원문, 한국어 번역, 구조화 사건, 현재 상태 projection과 설명을 서로 덮어쓰지 않는다.

## 6. 시간과 신뢰도 규칙

- `HIGH`: 종목 mapping이 확정되고 구체적인 공식 사건이 상승 직전 공개됨
- `MEDIUM`: 공식 사건의 시간은 가깝지만 직접 반응인지 불확실함
- `LOW`: 섹터 동조·가격·거래량 등 시장 데이터만 존재
- `NONE`: 분석 cutoff까지 관련 공식 자료를 확인하지 못함

공시 시각이 상승 시작보다 늦으면 `POST_MOVE_CONFIRMATION`이며 원인 후보에서 제외한다. 오래된 shelf·계약을 새로운 당일 촉매로 재사용하지 않는다. 정정·철회가 들어오면 이전 설명은 `STALE` 처리하고 새 version을 만든다.

권장 UI 문구:

- “정규장 시작 전에 DART 공급계약 공시가 발표돼 상승 직전 확인된 주요 공식 촉매입니다.”
- “관련 공시의 시각은 근접하지만 가격 상승의 직접 원인으로 확정할 수 없습니다.”
- “조회 기준시각까지 공식 촉매를 확인하지 못했습니다. 거래량·회전율 급증은 관측됐지만 원인 증거는 아닙니다.”

## 7. 실시간 처리 흐름

```text
KIS 체결·호가 ──> Move detector ───────────────┐
OpenDART/SEC ──> Disclosure normalizer ────────┤
KRX/Nasdaq/NYSE ─> Market-action normalizer ───┼─> Catalyst assessment
뉴스/IR ───────> Rights-aware evidence ────────┘          │
                                                           ├─> 근거 카드
                                                           └─> 위험 카드
```

수집 장애는 독립적으로 표시한다. 공시 수집 실패, 번역 실패, 분석 실패가 서로의 원본 데이터를 삭제하거나 가리지 않아야 한다.

## 8. UI 요구사항

- KOSPI와 KOSDAQ을 별도 tab/filter로 제공
- 상승률·하락률·거래량·거래대금·거래대금 증가율 ranking 제공
- 종목 행에 공식 촉매 유무, 위험 신호 수, 분석 cutoff와 freshness 표시
- 상세 패널에서 상승 타임라인과 공시 공개 시각을 같은 축에 표시
- 촉매와 희석·거래정지 위험을 색과 영역으로 분리
- 미국 원문과 한국어 번역을 함께 열 수 있고 accession·원문 링크 제공
- 근거 없음, provider 장애, 장 마감, stale 상태를 서로 다른 상태로 표현

## 9. Health와 검증

- provider별 최근 성공 시각과 poll 지연
- 종목↔CIK, 종목코드↔corp_code mapping 실패율
- 중복·누락·amendment 연결 검사
- event 공개 시각과 move 시작 시각의 timezone 검증
- 수치·통화·주식수·행사가의 원문/번역 일치 검사
- KRX/NXT venue 중복 합산 방지
- stale float로 계산한 회전율 경고
- evidence 없는 claim 생성 금지 테스트
- 미래 시점 자료를 과거 분석에 넣지 않는 point-in-time replay

## 10. 공식 근거

- [OpenDART 주요사항보고서 API](https://opendart.fss.or.kr/guide/main.do?apiGrpCd=DS005)
- [KRX 변동성완화장치](https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T7.jsp)
- [SEC Form 8-K](https://www.sec.gov/files/form8-k.pdf)
- [Nasdaq 거래정지 코드](https://www.nasdaqtrader.com/Trader.aspx?id=TradeHaltCodes)
- [FINRA short interest 설명](https://www.finra.org/investors/insights/short-interest)
- [SEC microcap 위험 안내](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/investor-2)
