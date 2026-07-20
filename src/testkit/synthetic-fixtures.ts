import { KIS_TR } from "../kis/endpoints.js";
import { KIS_WS_LAYOUTS, type SupportedWsTrId } from "../kis/ws/layouts.js";

type Overrides = Readonly<Record<string, string>>;

function recordValues(trId: SupportedWsTrId, overrides: Overrides): string[] {
  return KIS_WS_LAYOUTS[trId].map((field) => overrides[field] ?? "0");
}

export function syntheticWsFrame(
  trId: SupportedWsTrId,
  overrides: Overrides | Overrides[],
): string {
  const records = Array.isArray(overrides) ? overrides : [overrides];
  return `0|${trId}|${records.length.toString().padStart(3, "0")}|${records
    .flatMap((record) => recordValues(trId, record))
    .join("^")}`;
}

export const SYNTHETIC_FIXTURES = {
  domesticTrade: syntheticWsFrame(KIS_TR.domesticTrade, {
    MKSC_SHRN_ISCD: "005930",
    STCK_CNTG_HOUR: "101530",
    STCK_PRPR: "80000",
    PRDY_VRSS_SIGN: "2",
    PRDY_VRSS: "1000",
    PRDY_CTRT: "1.27",
    CNTG_VOL: "10",
    ACML_VOL: "1000000",
    ACML_TR_PBMN: "80000000000",
    CTTR: "109.00",
    BSOP_DATE: "20260720",
  }),
  domesticOrderBook: syntheticWsFrame(KIS_TR.domesticOrderBook, {
    MKSC_SHRN_ISCD: "005930",
    BSOP_HOUR: "101530",
    ASKP1: "80100",
    BIDP1: "80000",
    ASKP_RSQN1: "120",
    BIDP_RSQN1: "140",
    TOTAL_ASKP_RSQN: "1200",
    TOTAL_BIDP_RSQN: "1400",
  }),
  usTrade: syntheticWsFrame(KIS_TR.usTrade, {
    SYMB: "AAPL",
    XYMD: "20260719",
    XHMS: "101530",
    LAST: "250.125",
    SIGN: "2",
    DIFF: "2.500",
    RATE: "1.010",
    EVOL: "10",
    TVOL: "100000",
    TAMT: "25012500",
  }),
  usOrderBook: syntheticWsFrame(KIS_TR.usOrderBook, {
    symb: "AAPL",
    xymd: "20260719",
    xhms: "101530",
    bvol: "1000",
    avol: "900",
    pbid1: "250.120",
    pask1: "250.130",
    vbid1: "100",
    vask1: "90",
  }),
} as const;
