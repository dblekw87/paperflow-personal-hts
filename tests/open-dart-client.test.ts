import { describe, expect, it, vi } from "vitest";

import { OpenDartClient } from "../src/disclosures/open-dart-client.js";

describe("OpenDartClient", () => {
  it("normalizes filing dates without inventing a filing time", async () => {
    const client = new OpenDartClient({
      credentials: { crtfcKey: "a".repeat(40) },
      fetchImplementation: vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "000",
            message: "정상",
            page_no: 1,
            page_count: 100,
            total_count: 1,
            total_page: 1,
            list: [
              {
                corp_code: "00126380",
                corp_name: "삼성전자",
                stock_code: "005930",
                corp_cls: "Y",
                report_nm: "주요사항보고서",
                rcept_no: "20260720000001",
                flr_nm: "삼성전자",
                rcept_dt: "20260720",
                rm: "",
              },
            ],
          }),
        ),
      ) as typeof fetch,
    });
    const result = await client.listFilings({
      beginDate: "20260720",
      endDate: "20260720",
    });
    expect(result.items[0]).toMatchObject({
      providerFilingId: "20260720000001",
      stockCode: "005930",
      providerFiledDate: "20260720",
      providerFiledAtPrecision: "DATE",
      remarks: null,
    });
  });

  it("never includes crtfc_key in a network error", async () => {
    const secret = "z".repeat(40);
    const client = new OpenDartClient({
      credentials: { crtfcKey: secret },
      fetchImplementation: vi.fn(async (input: unknown) => {
        throw new Error(`offline ${String(input)}`);
      }) as typeof fetch,
    });
    const error = await client
      .listFilings({ beginDate: "20260720", endDate: "20260720" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).toContain("crtfc_key=[REDACTED]");
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("treats status 013 as a valid empty page", async () => {
    const client = new OpenDartClient({
      credentials: { crtfcKey: "a".repeat(40) },
      fetchImplementation: vi.fn(async () =>
        new Response(JSON.stringify({ status: "013", message: "조회 없음" })),
      ) as typeof fetch,
    });
    await expect(
      client.listFilings({ beginDate: "20260720", endDate: "20260720" }),
    ).resolves.toMatchObject({ items: [], totalCount: 0 });
  });
});
