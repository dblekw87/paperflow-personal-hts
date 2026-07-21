import { KIS_TR } from "../endpoints.js";

export const DOMESTIC_TRADE_FIELDS = [
  "MKSC_SHRN_ISCD",
  "STCK_CNTG_HOUR",
  "STCK_PRPR",
  "PRDY_VRSS_SIGN",
  "PRDY_VRSS",
  "PRDY_CTRT",
  "WGHN_AVRG_STCK_PRC",
  "STCK_OPRC",
  "STCK_HGPR",
  "STCK_LWPR",
  "ASKP1",
  "BIDP1",
  "CNTG_VOL",
  "ACML_VOL",
  "ACML_TR_PBMN",
  "SELN_CNTG_CSNU",
  "SHNU_CNTG_CSNU",
  "NTBY_CNTG_CSNU",
  "CTTR",
  "SELN_CNTG_SMTN",
  "SHNU_CNTG_SMTN",
  "CCLD_DVSN",
  "SHNU_RATE",
  "PRDY_VOL_VRSS_ACML_VOL_RATE",
  "OPRC_HOUR",
  "OPRC_VRSS_PRPR_SIGN",
  "OPRC_VRSS_PRPR",
  "HGPR_HOUR",
  "HGPR_VRSS_PRPR_SIGN",
  "HGPR_VRSS_PRPR",
  "LWPR_HOUR",
  "LWPR_VRSS_PRPR_SIGN",
  "LWPR_VRSS_PRPR",
  "BSOP_DATE",
  "NEW_MKOP_CLS_CODE",
  "TRHT_YN",
  "ASKP_RSQN1",
  "BIDP_RSQN1",
  "TOTAL_ASKP_RSQN",
  "TOTAL_BIDP_RSQN",
  "VOL_TNRT",
  "PRDY_SMNS_HOUR_ACML_VOL",
  "PRDY_SMNS_HOUR_ACML_VOL_RATE",
  "HOUR_CLS_CODE",
  "MRKT_TRTM_CLS_CODE",
  "VI_STND_PRC",
] as const;

export const DOMESTIC_ORDERBOOK_FIELDS = [
  "MKSC_SHRN_ISCD",
  "BSOP_HOUR",
  "HOUR_CLS_CODE",
  "ASKP1",
  "ASKP2",
  "ASKP3",
  "ASKP4",
  "ASKP5",
  "ASKP6",
  "ASKP7",
  "ASKP8",
  "ASKP9",
  "ASKP10",
  "BIDP1",
  "BIDP2",
  "BIDP3",
  "BIDP4",
  "BIDP5",
  "BIDP6",
  "BIDP7",
  "BIDP8",
  "BIDP9",
  "BIDP10",
  "ASKP_RSQN1",
  "ASKP_RSQN2",
  "ASKP_RSQN3",
  "ASKP_RSQN4",
  "ASKP_RSQN5",
  "ASKP_RSQN6",
  "ASKP_RSQN7",
  "ASKP_RSQN8",
  "ASKP_RSQN9",
  "ASKP_RSQN10",
  "BIDP_RSQN1",
  "BIDP_RSQN2",
  "BIDP_RSQN3",
  "BIDP_RSQN4",
  "BIDP_RSQN5",
  "BIDP_RSQN6",
  "BIDP_RSQN7",
  "BIDP_RSQN8",
  "BIDP_RSQN9",
  "BIDP_RSQN10",
  "TOTAL_ASKP_RSQN",
  "TOTAL_BIDP_RSQN",
  "OVTM_TOTAL_ASKP_RSQN",
  "OVTM_TOTAL_BIDP_RSQN",
  "ANTC_CNPR",
  "ANTC_CNQN",
  "ANTC_VOL",
  "ANTC_CNTG_VRSS",
  "ANTC_CNTG_VRSS_SIGN",
  "ANTC_CNTG_PRDY_CTRT",
  "ACML_VOL",
  "TOTAL_ASKP_RSQN_ICDC",
  "TOTAL_BIDP_RSQN_ICDC",
  "OVTM_TOTAL_ASKP_ICDC",
  "OVTM_TOTAL_BIDP_ICDC",
  "STCK_DEAL_CLS_CODE",
] as const;

// KIS H0STASP0 currently emits three undocumented trailing fields in the
// paper environment (observed 2026-07-20). Keep the official 59-field layout
// as the compatibility baseline and accept only this exact 62-field variant.
// The extension is intentionally not normalized until KIS publishes names.
export const DOMESTIC_ORDERBOOK_TRAILING_EXTENSION_FIELDS = [
  "KIS_UNDOCUMENTED_TRAILING_1",
  "KIS_UNDOCUMENTED_TRAILING_2",
  "KIS_UNDOCUMENTED_TRAILING_3",
] as const;

export const DOMESTIC_ORDERBOOK_EXTENDED_FIELDS = [
  ...DOMESTIC_ORDERBOOK_FIELDS,
  ...DOMESTIC_ORDERBOOK_TRAILING_EXTENSION_FIELDS,
] as const;

export const NXT_ORDERBOOK_MID_FIELDS = [
  "KMID_PRC",
  "KMID_TOTAL_RSQN",
  "KMID_CLS_CODE",
] as const;

export const NXT_ORDERBOOK_NMID_FIELDS = [
  "NMID_PRC",
  "NMID_TOTAL_RSQN",
  "NMID_CLS_CODE",
] as const;

// The official KIS sample publishes 65 fields. The KIS paper environment was
// observed on 2026-07-20 emitting the first 62 fields (through KMID_CLS_CODE).
// Keep both exact layouts fail-closed; never reinterpret the KRX 62-field
// undocumented variant as NXT.
export const NXT_ORDERBOOK_PAPER_FIELDS = [
  ...DOMESTIC_ORDERBOOK_FIELDS,
  ...NXT_ORDERBOOK_MID_FIELDS,
] as const;

export const NXT_ORDERBOOK_FIELDS = [
  ...NXT_ORDERBOOK_PAPER_FIELDS,
  ...NXT_ORDERBOOK_NMID_FIELDS,
] as const;

export const NXT_TRADE_FIELDS = DOMESTIC_TRADE_FIELDS.map((field) =>
  field === "CCLD_DVSN" ? "CNTG_CLS_CODE" : field,
) as readonly string[];

export const NXT_MARKET_STATUS_FIELDS = [
  "MKSC_SHRN_ISCD",
  "TRHT_YN",
  "TR_SUSP_REAS_CNTT",
  "MKOP_CLS_CODE",
  "ANTC_MKOP_CLS_CODE",
  "MRKT_TRTM_CLS_CODE",
  "DIVI_APP_CLS_CODE",
  "ISCD_STAT_CLS_CODE",
  "VI_CLS_CODE",
  "OVTM_VI_CLS_CODE",
  "EXCH_CLS_CODE",
] as const;

export const US_ORDERBOOK_FIELDS = [
  "symb",
  "zdiv",
  "xymd",
  "xhms",
  "kymd",
  "khms",
  "bvol",
  "avol",
  "bdvl",
  "advl",
  "pbid1",
  "pask1",
  "vbid1",
  "vask1",
  "dbid1",
  "dask1",
] as const;

export const US_TRADE_FIELDS = [
  "SYMB",
  "ZDIV",
  "TYMD",
  "XYMD",
  "XHMS",
  "KYMD",
  "KHMS",
  "OPEN",
  "HIGH",
  "LOW",
  "LAST",
  "SIGN",
  "DIFF",
  "RATE",
  "PBID",
  "PASK",
  "VBID",
  "VASK",
  "EVOL",
  "TVOL",
  "TAMT",
  "BIVL",
  "ASVL",
  "STRN",
  "MTYP",
] as const;

// KIS prod emits RSYM ahead of the older published layouts. HDFSASP0 also
// extends the one-level quote with levels 2..10 (six values per level).
// This exact 71-field shape was observed on 2026-07-21.
export const US_ORDERBOOK_OBSERVED_FIELDS = [
  "rsym",
  ...US_ORDERBOOK_FIELDS,
  ...Array.from({ length: 9 }, (_, index) => index + 2).flatMap((level) => [
    `pbid${level}`,
    `pask${level}`,
    `vbid${level}`,
    `vask${level}`,
    `dbid${level}`,
    `dask${level}`,
  ]),
] as readonly string[];

export const US_TRADE_OBSERVED_FIELDS = ["RSYM", ...US_TRADE_FIELDS] as const;

export const KIS_WS_LAYOUTS = {
  [KIS_TR.domesticOrderBook]: DOMESTIC_ORDERBOOK_FIELDS,
  [KIS_TR.domesticTrade]: DOMESTIC_TRADE_FIELDS,
  [KIS_TR.domesticNxtOrderBook]: NXT_ORDERBOOK_FIELDS,
  [KIS_TR.domesticNxtTrade]: NXT_TRADE_FIELDS,
  [KIS_TR.domesticNxtMarketStatus]: NXT_MARKET_STATUS_FIELDS,
  [KIS_TR.domesticUnifiedOrderBook]: NXT_ORDERBOOK_FIELDS,
  [KIS_TR.domesticUnifiedTrade]: NXT_TRADE_FIELDS,
  [KIS_TR.usOrderBook]: US_ORDERBOOK_FIELDS,
  [KIS_TR.usTrade]: US_TRADE_FIELDS,
} as const;

export type SupportedWsTrId = keyof typeof KIS_WS_LAYOUTS;

export function isSupportedWsTrId(value: string): value is SupportedWsTrId {
  return Object.hasOwn(KIS_WS_LAYOUTS, value);
}

export function resolveWsLayout(
  trId: SupportedWsTrId,
  fieldsPerRecord: number,
): readonly string[] | null {
  const officialLayout = KIS_WS_LAYOUTS[trId];
  if (fieldsPerRecord === officialLayout.length) {
    return officialLayout;
  }
  if (
    trId === KIS_TR.domesticOrderBook &&
    fieldsPerRecord === DOMESTIC_ORDERBOOK_EXTENDED_FIELDS.length
  ) {
    return DOMESTIC_ORDERBOOK_EXTENDED_FIELDS;
  }
  if (
    (trId === KIS_TR.domesticNxtOrderBook ||
      trId === KIS_TR.domesticUnifiedOrderBook) &&
    fieldsPerRecord === NXT_ORDERBOOK_PAPER_FIELDS.length
  ) {
    return NXT_ORDERBOOK_PAPER_FIELDS;
  }
  if (
    trId === KIS_TR.usOrderBook &&
    fieldsPerRecord === US_ORDERBOOK_OBSERVED_FIELDS.length
  ) {
    return US_ORDERBOOK_OBSERVED_FIELDS;
  }
  if (
    trId === KIS_TR.usTrade &&
    fieldsPerRecord === US_TRADE_OBSERVED_FIELDS.length
  ) {
    return US_TRADE_OBSERVED_FIELDS;
  }
  return null;
}
