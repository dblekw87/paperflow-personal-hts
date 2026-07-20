# 뉴스와 움직임 설명

## 1. 목표와 경계

이 기능은 종목 움직임을 이해할 근거를 한곳에 모으는 도구다. 투자 추천이나 확정적 인과 판정기가 아니다.

- “A 때문에 올랐다” 대신 “A가 같은 시간대에 관측된 가능 요인”이라고 표현한다.
- 출처가 없거나 시간적으로 맞지 않는 사건을 만들지 않는다.
- 뉴스가 없어도 수급·시장 동조만으로 원인을 확정하지 않는다.
- 공급자가 허용하지 않는 본문을 저장·요약·재배포하지 않는다.

## 2. 공급자 구조

```ts
interface NewsProvider {
  id: string;
  listMarketNews(query: MarketNewsQuery): Promise<NewsItem[]>;
  listInstrumentNews(query: InstrumentNewsQuery): Promise<NewsItem[]>;
}

interface ExplanationProvider {
  explain(context: ExplanationContext): Promise<InstrumentExplanation>;
}
```

MVP의 첫 번째 뉴스 어댑터는 KIS 국내 `news_title`, 해외 `news_title`/`brknews_title`이다. 응답이 제목 중심이므로 본문·정교한 미국 뉴스가 필요하면 라이선스가 확인된 별도 provider를 후속으로 추가한다.

## 3. 뉴스 모델

```ts
interface NewsItem {
  id: string;
  providerId: string;
  providerItemId: string;
  title: string;
  publisher?: string;
  url?: string;
  publishedAt: string;
  collectedAt: string;
  language: "ko" | "en";
  market: "KR" | "US";
  instrumentIds: string[];
  rights: "TITLE_LINK_ONLY" | "SUMMARY_ALLOWED" | "BODY_ALLOWED";
}
```

중복 우선순위:

1. provider item ID
2. 정규화 canonical URL
3. 발행 시각 window 안의 정규화 제목 hash

종목 연결은 공급자 코드, 제목의 명시적 ticker/종목명, 검증된 alias 순서로 한다. 동명이인은 자동 확정하지 않는다.

## 4. 근거 생성

설명 window마다 다음을 계산한다.

- 가격: 1분/5분/당일 수익률, 갭, 고점·저점 돌파
- 활동성: 거래량 z-score, 거래대금 증가율, 직전 구간 대비 급증
- 상대성과: 시장 지수·업종 대비 초과 등락
- 수급: 외국인·기관, 체결강도, bid/ask imbalance
- 동조: 같은 업종/테마 종목의 동시 움직임
- 이벤트: window 전후에 발행된 관련 뉴스·공시
- 반대 근거: 뉴스 시각 불일치, 업종 전체 동조, 데이터 stale

모든 evidence는 값, 기준, 단위, 산출 시각, source ID를 가진다.

공시는 뉴스보다 우선순위가 높은 1차 evidence로 취급한다. SEC accession number 또는 DART 접수번호, 원문 URL, 접수 시각을 반드시 보존한다. 번역문은 evidence 원문이 아니라 파생 표현이며 사용자가 원문으로 이동할 수 있어야 한다.

## 5. 결과 계약

```ts
interface InstrumentExplanation {
  instrumentId: string;
  window: { from: string; to: string };
  observed: {
    changeRate: string;
    volumeZScore?: string;
    turnoverGrowthRate?: string;
  };
  possibleFactors: Array<{
    label: string;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    evidenceIds: string[];
    rationale: string;
  }>;
  counterEvidenceIds: string[];
  generatedAt: string;
  modelVersion: string;
  disclaimer: string;
}
```

### 신뢰도 기준

- `HIGH`: 시간적으로 일치하는 신뢰 가능한 뉴스/공시와 2개 이상의 정량 신호
- `MEDIUM`: 뉴스 또는 공시는 있으나 정량 확인이 제한적이거나, 강한 정량 신호가 여러 개 있음
- `LOW`: 상관 신호만 있고 사건 근거가 없거나 데이터 일부가 stale
- 근거 없음: possible factor를 만들지 않고 `확인 가능한 원인이 없습니다` 반환

높음도 인과가 확정되었다는 뜻은 아니다.

## 6. 규칙 기반 MVP

1. 움직임 threshold를 넘으면 evidence window를 연다.
2. 가격·거래량·거래대금·상대성과·수급을 계산한다.
3. window 전후 관련 뉴스와 공시를 연결한다.
4. 시간 일치와 source quality로 점수를 부여한다.
5. template으로 가능한 요인과 불확실성을 작성한다.
6. 사용자가 근거를 클릭하면 뉴스 또는 해당 차트 구간으로 이동한다.

예:

> 10:15~10:25에 주가가 4.2% 상승했고 거래대금은 전일 동시간 대비 3.1배였습니다. 10:12에 관련 뉴스가 확인되어 가능한 요인으로 분류했습니다. 업종도 1.4% 상승해 일부는 시장 동조일 수 있습니다. 신뢰도: 보통.

## 7. 선택적 LLM 요약

LLM은 evidence bundle의 문장화에만 사용한다.

- 입력에는 허용된 evidence와 뉴스 메타데이터만 포함
- 출력 JSON schema 강제
- evidence ID 없는 주장은 거부
- 링크와 수치의 원문 일치 검증
- provider/model/prompt version 저장
- 실패 시 규칙 기반 결과로 fallback
- 원격 LLM 사용 여부와 전달 데이터는 설정에서 명시

MCP는 에이전트가 근거를 조사하는 보조 수단이 될 수 있지만, 앱 내부 explanation의 실시간 필수 의존성으로 두지 않는다.

## 8. 뉴스 권리와 외부 링크

- 기본은 `TITLE_LINK_ONLY`
- 본문 수집은 약관과 라이선스 확인 후 provider별로 승인
- 링크는 `https`와 허용 scheme을 검증하고 OS 브라우저로 연다.
- 앱 내부 remote page 로딩과 webview는 MVP에서 사용하지 않는다.
- 로컬 개인용이라도 제3자 배포·재전송 기능은 만들지 않는다.

## 9. 수용 기준

- 모든 factor는 하나 이상의 evidence ID를 가진다.
- 수치 근거에는 비교 기준과 기준 시각이 보인다.
- stale 데이터만 있을 때 medium/high를 반환하지 않는다.
- 뉴스 시각이 가격 움직임 뒤에 있으면 선행 원인처럼 서술하지 않는다.
- 관련 뉴스가 없으면 기사나 사건을 생성하지 않는다.
- 근거 클릭이 저장된 수치/뉴스 또는 차트 window로 이동한다.
