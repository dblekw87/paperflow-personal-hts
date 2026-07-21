# SEC·OpenDART 공시와 한국어 번역

## 현재 구현 상태

미국 종목 workspace에서는 현재 선택 ticker로 KIS 해외뉴스와 SEC ticker-CIK mapping을 다시 조회한다. 저장된 항목은 canonical 미국 instrument ID에 연결되므로 `선택 종목` 및 `관심 종목` 필터에서 함께 확인할 수 있다. 종목 전환 시 정보 cache를 무효화하며 SEC 원문 링크와 evidence ID를 유지한다.

2026-07-21 기준 `DART_CRTFC_KEY` 40자 검증, SEC app/version + 실제 연락 이메일 형식 검증, 공개 health boolean, DART query/error redaction, OpenDART `/api/list.json` 읽기 전용 client와 `013` 빈 응답 처리가 구현되어 있다. OpenDART 응답의 `rcept_dt`는 `providerFiledAtPrecision: DATE`로 보존해 접수 시각을 추측하지 않는다.

SEC EDGAR는 공식 ticker/CIK mapping과 issuer submissions를 조회하며 프로세스 공용 8 rps limiter, 403·429·5xx·network backoff, accession dedupe를 적용한다. KIS 국내·미국 뉴스 제목, SEC 공시 metadata, OpenDART 당일 공시는 SQLite v5의 불변 정보 원본·별도 번역 version·poll checkpoint에 저장되고 Electron 뉴스·공시 페이지에 투영된다. OpenDART는 최초 및 15분 주기로 전체 pagination을 reconciliation하고 그 사이에는 최신 100건을 확인하며 `rcept_no`로 dedupe한다. `/api/corpCode.xml` 원장은 하루 한 번 받아 `corp_code → stock_code` 보조 매핑에 사용하고 뉴스 화면에서 전체·선택 종목·관심 종목 필터를 제공한다. 페이지가 열린 동안 60초 주기로 근실시간 갱신하며 SEC form 명칭과 item 번호는 `PARTIAL` 한국어 번역으로 표시한다. `DART_CRTFC_KEY`가 없으면 provider를 `UNCONFIGURED`로 유지하고 키 저장 후 앱을 다시 시작하면 자동 활성화한다.

아직 구현되지 않은 범위는 SEC latest filings 시장 watcher, 관심종목 전체 CIK scheduler, OpenDART 정정 공시 relation 및 상세 주요사항 API, 공시 원문 분류·본문 전체 한국어 번역 queue다. KIS 뉴스는 권리 범위를 제목으로 제한하며 Reuters 본문을 수집하지 않는다.

## 1. 목표

국내·미국 종목의 신규 공시를 공급자가 공개한 직후 근실시간으로 감지해 종목 화면, 뉴스·시황, 움직임 설명에 표시한다.

핵심 대상:

- 인수·합병과 중요한 계약
- 사업·자산 취득 또는 매각
- 영업양수도
- 분할·분할합병·주식교환
- 지배권 변경과 대량보유
- 유상증자·채권 발행 등 자금조달
- 자사주·감자·상장폐지 관련 결정

공시는 1차 자료다. 뉴스보다 먼저 도착할 수 있으며, 번역·요약이 실패해도 원문 알림은 유실하지 않는다.

## 2. “실시간” 정의

SEC EDGAR와 OpenDART의 공개 조회 API에는 제품용 push WebSocket을 전제로 하지 않는다. 이 제품의 실시간은 다음 의미의 **근실시간**이다.

- 공급자 RSS/API에 노출된 후 watcher의 다음 polling 주기에 감지
- 운영 목표: 장중 p95 90초 이내 감지. 공급자 SLA가 아니며 보장값으로 표시하지 않음
- 실제 지연: 공급자 전파, rate limit, 네트워크, 장치 절전 상태의 영향을 받음
- 감지 시각과 공급자 접수 시각을 모두 표시해 지연을 숨기지 않음

초 단위 무제한 polling으로 “실시간”을 가장하지 않고 공급자 정책과 캐시 헤더를 따른다.

## 3. 공급자 아키텍처

```ts
interface DisclosureProvider {
  id: "SEC_EDGAR" | "OPEN_DART";
  poll(cursor: ProviderCursor): Promise<DisclosurePollResult>;
  getDocument(ref: DisclosureRef): Promise<DisclosureDocument>;
}

interface TranslationProvider {
  translate(input: TranslationInput): Promise<DisclosureTranslation>;
}
```

```text
Provider RSS/API
→ incremental poller
→ provider ID dedupe
→ ticker/corp mapping
→ raw disclosure metadata 저장
→ disclosure.received event 즉시 발행
→ event classifier
→ translation queue (미국)
→ disclosure.enriched event
→ UI / notification / explanation evidence
```

watcher, parser, 번역은 Electron renderer가 아니라 trading service utility process에서 실행한다.

## 4. SEC EDGAR

### 인증과 식별자

- 공개 조회용 `data.sec.gov` API는 API key가 필요 없다.
- 모든 자동 요청에 앱 이름·버전·연락처를 포함한 선언된 `User-Agent`를 보낸다.
- ticker는 SEC의 ticker/exchange association 파일로 CIK에 연결하되 ticker mapping이 항상 존재한다고 가정하지 않는다.
- CIK는 SEC API 경로에서 10자리 zero-padding한다.
- SEC issuer의 영속 provider key는 ticker가 아니라 CIK다.

### 감지와 보강

1. EDGAR Latest Filings RSS를 form filter와 함께 polling해 시장 신규 공시를 빠르게 감지한다.
2. 관심·보유 종목은 `https://data.sec.gov/submissions/CIK##########.json`을 보조 polling한다.
3. accession number로 중복 제거한다.
4. filing index와 primary document는 신규 사건 또는 사용자가 열 때 가져온다.
5. XBRL `companyfacts`는 재무 수치 보강용이며 공시 도착 감지 수단으로 남용하지 않는다.
6. RSS는 가속 경로일 뿐 단일 진실 공급원이 아니다. submissions/API·index 재조정으로 RSS 누락을 복구한다.

SEC는 submissions API가 공시 전파 후 보통 1초 미만, XBRL API가 보통 1분 미만의 처리 지연을 가진다고 안내하지만 peak에는 더 길어질 수 있다.

### M&A·매각 분류

우선 감시 form/item:

- `8-K` / `8-K/A`
  - Item 1.01: 중요한 확정 계약
  - Item 2.01: 중요한 자산 취득 또는 처분 완료
  - Item 5.01: 지배권 변경
  - Item 8.01: 기타 중요 사건
  - Item 9.01: 재무제표·exhibit
- `S-4`: 합병·교환 관련 증권등록
- `PREM14A`, `DEFM14A`: 합병 등 주주투표 자료
- `SC TO-*`: 공개매수
- `SC 13D`, `SC 13D/A`: 5% 이상 보유와 지배 목적 가능성
- `6-K`: 미국 상장 외국기업 중요 보고

form/item만으로 거래 성격을 확정하지 않는다. exhibit와 원문에서 당사자, 금액, 대상, 계약/완료 상태를 근거 ID와 함께 추출한다.

### 접근 정책

- SEC 공개 자동 접근 상한은 현재 안내 기준 총 10 requests/second 이하
- 앱 내부 limiter는 이보다 보수적으로 시작
- 429 시 즉시 backoff
- `ETag`, `Last-Modified`, `Cache-Control`이 실제 응답에 있으면 존중하고, 없으면 body hash로 불변 응답 처리를 줄인다.
- User-Agent 미설정 요청 금지

## 5. OpenDART

### 인증과 식별자

- `DART_CRTFC_KEY`가 필요하며 제품 secret vault에 저장한다.
- `/api/corpCode.xml`의 ZIP/XML로 `stock_code ↔ corp_code`를 갱신한다.
- 상장 종목은 6자리 stock code, DART API는 8자리 corp code를 사용한다.
- OpenDART issuer의 영속 provider key는 종목코드가 아니라 `corp_code`다.

### 감지

- `/api/list.json`을 오늘 접수일, 최신 페이지 기준으로 증분 polling한다.
- `rcept_no`를 고유 provider filing ID로 사용한다.
- 정정 공시는 원 공시를 덮어쓰지 않고 amendment relation으로 연결한다.
- 전체 시장 polling 한 번으로 새 접수번호를 찾고 종목별 API를 반복 호출하지 않는다.
- 관심/보유 종목에 한해 상세 주요사항 API와 원문을 보강한다.
- `rcept_no`의 최댓값만 cursor로 삼지 않는다. 최근 접수 시간 구간을 겹쳐 재조회하고 filing ID로 dedupe한다.
- `/api/document.xml` 원문은 필요할 때 내려받아 원본 hash와 함께 보존한다.

OpenDART 안내상 일반적인 요청 제한 초과는 20,000건 이상에서 발생하지만 계정별 제한이 다를 수 있다. 실제 응답과 정책을 설정값으로 관리한다.

### 구조화 이벤트 API

OpenDART는 주요사항보고서와 증권신고서의 구조화 API를 제공한다. 우선 대상:

- 합병, 회사분할, 분할합병, 주식교환·이전
- 영업 양수·양도
- 유형자산 양수·양도
- 타법인 주식·출자증권 취득·처분
- 유상증자, 전환사채·신주인수권부사채 등 발행
- 자사주 취득·처분
- 감자

공시 목록의 보고서명 keyword는 빠른 후보 분류에만 사용하고, 가능하면 구조화 API 또는 원문으로 확정한다.

## 6. Canonical 모델

```ts
interface Disclosure {
  id: string;
  provider: "SEC_EDGAR" | "OPEN_DART";
  providerFilingId: string; // accession number | rcept_no
  instrumentIds: string[];
  issuerId: string; // CIK | corp_code
  formType: string;
  originalTitle: string;
  originalLanguage: "en" | "ko";
  filingUrl: string;
  filedAt: string;
  detectedAt: string;
  amendmentOf?: string;
}

type DisclosureEventType =
  | "MATERIAL_AGREEMENT"
  | "ACQUISITION"
  | "DISPOSITION"
  | "BUSINESS_TRANSFER"
  | "ASSET_ACQUISITION"
  | "ASSET_DISPOSITION"
  | "MERGER"
  | "SPIN_OFF"
  | "SHARE_EXCHANGE"
  | "CHANGE_OF_CONTROL"
  | "CAPITAL_RAISE"
  | "BUYBACK"
  | "TENDER_OFFER"
  | "OTHER";

interface DisclosureEvent {
  disclosureId: string;
  type: DisclosureEventType;
  status:
    "PROPOSED" | "AGREED" | "APPROVED" | "COMPLETED" | "CANCELLED" | "UNKNOWN";
  parties: string[];
  amount?: { value: string; currency: string };
  effectiveDate?: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: Array<{
    documentRef: string;
    section: string;
    excerptHash: string;
  }>;
}
```

금액, 날짜, 상태가 원문에 없으면 null/unknown으로 두고 추정하지 않는다.
공급자 원문과 metadata는 immutable 원본으로 저장하고 번역·분류·요약 projection이 이를 덮어쓰지 않는다.

## 7. 미국 공시 한국어 번역

### 표시 순서

1. 공시 감지 즉시 원문 제목, form, 접수 시각, 링크를 표시
2. 상태 `번역 대기` 표시
3. 제목과 핵심 사실을 한국어로 번역
4. 완료되면 한국어를 기본 표시하고 `원문 보기` 제공

### 번역 모델

```ts
interface DisclosureTranslation {
  disclosureId: string;
  locale: "ko-KR";
  status: "PENDING" | "RUNNING" | "PARTIAL" | "COMPLETED" | "FAILED" | "STALE";
  translatedTitle?: string;
  translatedSummary?: string;
  terminology: Array<{ source: string; translated: string }>;
  provider: string;
  modelVersion: string;
  generatedAt?: string;
}
```

### 번역 안전 규칙

- 회사명, 인명, ticker, accession, 날짜, 금액을 임의 변경하지 않음
- acquisition과 merger, agreement와 completion을 구분
- 번역 입력 문서 hash와 번역 version 저장
- 원문에 없는 해석·투자 판단 추가 금지
- 자동 번역과 자동 요약임을 표시
- 번역 실패 시 지수 backoff 후 재시도하되 원문 알림은 유지
- 중요 숫자는 번역 후 원문과 programmatic comparison
- 긴 문서는 segment별 상태와 hash를 저장해 일부 실패를 `PARTIAL`로 표시
- 원문 변경이나 정정 공시로 입력 hash가 달라지면 기존 번역을 `STALE`로 표시
- 일·월 번역 문자/토큰 예산을 두고 중요 공시·관심·보유 종목을 우선 처리

## 8. Polling 정책

초기 설정 예:

- SEC latest RSS: 미국 평일 활성 시간 30초, 비활성 시간 5분
- SEC 관심 CIK submissions: 활성 시간 60초, watchlist 수에 따라 분산
- OpenDART RSS: 국내 활성 시간 30초
- OpenDART `/api/list.json` 최신 1페이지: 활성 시간 60초
- SEC index와 OpenDART 최근 시간구간 전체 reconciliation: 15분
- corp/CIK master: 하루 1회 또는 수동 갱신
- 원문·구조화 상세: 신규 후보에 한해 queue 처리

모든 provider는 단일 polling owner, cursor, jitter, backoff를 가진다. 앱 절전 복귀 시 마지막 cursor부터 catch-up하고 동일 filing ID를 두 번 알리지 않는다.

## 9. UI

- 국내/미국 공시 통합 feed와 provider filter
- 종목 workspace의 `공시` 탭
- 인수·매각·증자 등 event badge
- 접수 시각, 감지 지연, amendment 표시
- 미국 공시 한국어/원문 toggle
- 번역 대기·완료·실패 상태
- 공시 evidence를 움직임 설명에서 뉴스보다 우선 표시
- 공시 수신과 번역 완료 알림을 구분

## 10. 테스트와 수용 기준

- 같은 accession/rcept_no가 한 번만 신규 알림을 만든다.
- amendment는 원 공시와 연결되고 원본을 덮어쓰지 않는다.
- polling 중단 후 재시작하면 cursor로 누락을 따라잡는다.
- 429/제한 오류에 backoff하고 다른 provider를 막지 않는다.
- 공시 감지 이벤트는 번역 완료를 기다리지 않는다.
- 번역 실패해도 원문 링크와 원본 metadata가 남는다.
- 번역의 날짜·금액·ticker가 원문과 일치한다.
- 설명 factor가 공시를 인용하면 provider filing ID와 원문 링크를 가진다.
- secret은 renderer, URL 로그, artifact에 나타나지 않는다.

## 11. 공식 자료

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC RSS Feeds](https://www.sec.gov/about/rss-feeds)
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [OpenDART API 소개](https://opendart.fss.or.kr/intro/main.do)
- [OpenDART API 목록](https://opendart.fss.or.kr/intro/infoApiList.do)
- [OpenDART 공시검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001)
- [OpenDART 고유번호](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018)
