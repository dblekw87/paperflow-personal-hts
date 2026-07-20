import { describe, expect, it } from "vitest";

import {
  isAllowedExternalInformationUrl,
  isDesktopInformationFeedProjection,
} from "../apps/desktop/src/shared/desktop-contracts.js";

function validProjection(): unknown {
  return {
    schemaVersion: 1,
    state: "PARTIAL",
    fetchedAt: "2026-07-20T11:00:00.000Z",
    statusMessage: "2개 provider 연결 · 로컬 저장 1건",
    sources: [
      {
        provider: "SEC_EDGAR",
        state: "READY",
        itemCount: 1,
        message: "최근 SEC 공시 1건 수신",
      },
      {
        provider: "OPEN_DART",
        state: "UNCONFIGURED",
        itemCount: 0,
        message: "OpenDART 키 발급 대기 중",
      },
    ],
    items: [
      {
        id: "sec-item-1",
        provider: "SEC_EDGAR",
        kind: "DISCLOSURE",
        titleOriginal: "8-K · Example Inc.",
        titleKorean: "주요 수시공시 · Example Inc.",
        summaryKorean: "SEC 항목 1.01",
        sourceName: "SEC EDGAR",
        sourceLanguage: "en",
        publishedAt: "2026-07-20T10:59:00.000Z",
        publishedAtPrecision: "SECOND",
        obtainedAt: "2026-07-20T11:00:00.000Z",
        canonicalUrl:
          "https://www.sec.gov/Archives/edgar/data/1/example-index.html",
        rights: "PUBLIC_FILING",
        relatedInstrumentIds: ["NASDAQ:EXMP"],
      },
    ],
  };
}

describe("desktop information feed IPC contract", () => {
  it("accepts a bounded local news and disclosure projection", () => {
    expect(isDesktopInformationFeedProjection(validProjection())).toBe(true);
  });

  it("rejects non-HTTPS links and unknown providers at the preload boundary", () => {
    const unsafe = validProjection() as {
      items: Array<Record<string, unknown>>;
    };
    unsafe.items[0] = {
      ...unsafe.items[0],
      canonicalUrl: "javascript:alert(1)",
      provider: "UNTRUSTED_PROVIDER",
    };
    expect(isDesktopInformationFeedProjection(unsafe)).toBe(false);
  });

  it("opens only credential-free official SEC HTTPS URLs externally", () => {
    expect(
      isAllowedExternalInformationUrl(
        "https://www.sec.gov/Archives/edgar/data/1/example-index.html",
      ),
    ).toBe(true);
    expect(
      isAllowedExternalInformationUrl("https://sec.gov/Archives/example"),
    ).toBe(true);
    expect(
      isAllowedExternalInformationUrl(
        "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260720000001",
      ),
    ).toBe(true);
    expect(
      isAllowedExternalInformationUrl("https://sec.gov.attacker.example/a"),
    ).toBe(false);
    expect(
      isAllowedExternalInformationUrl("https://user:secret@www.sec.gov/a"),
    ).toBe(false);
    expect(isAllowedExternalInformationUrl("javascript:alert(1)")).toBe(false);
  });
});
