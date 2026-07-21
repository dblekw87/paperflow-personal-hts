import type {
  DesktopAccountProjection,
  DesktopBootstrapProjection,
  DesktopChartInterval,
  DesktopChartProjection,
  DesktopChartRange,
  DesktopMarketProjection,
  DesktopInformationFeedProjection,
  DesktopInstrumentSearchProjection,
  DesktopMarketContextProjection,
  DesktopMarketCalendarProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
  DesktopRankingSort,
  DesktopInvestorFlowProjection,
  DesktopShortSellingProjection,
} from "../shared/desktop-contracts";

declare global {
  type PaperTradingSystemTheme = "dark" | "light";

  interface PaperTradingAppMetadata {
    readonly name: string;
    readonly version: string;
    readonly electronVersion: string;
    readonly platform: string;
    readonly packaged: boolean;
  }

  interface PaperTradingDesktopApi {
    readonly app: {
      readonly getMetadata: () => Promise<Readonly<PaperTradingAppMetadata>>;
    };
    readonly theme: {
      readonly getSystemPreference: () => PaperTradingSystemTheme;
      readonly onSystemPreferenceChanged: (
        listener: (theme: PaperTradingSystemTheme) => void,
      ) => () => void;
    };
    readonly bootstrap: {
      readonly get: () => Promise<Readonly<DesktopBootstrapProjection>>;
    };
    readonly market: {
      readonly connectReadOnly: () => Promise<
        Readonly<DesktopMarketProjection>
      >;
      readonly disconnect: () => Promise<Readonly<DesktopMarketProjection>>;
      readonly selectInstrument: (
        symbol: string,
      ) => Promise<Readonly<DesktopMarketProjection>>;
      readonly getWatchlistQuotes: (
        symbols: readonly string[],
      ) => Promise<readonly Readonly<import("../shared/desktop-contracts.js").DesktopWatchlistQuoteProjection>[]>;
      readonly onProjection: (
        listener: (projection: Readonly<DesktopMarketProjection>) => void,
      ) => () => void;
    };
    readonly charts: {
      readonly getHistory: (
        interval: DesktopChartInterval,
        range: DesktopChartRange,
      ) => Promise<Readonly<DesktopChartProjection>>;
      readonly onProjection: (
        listener: (projection: Readonly<DesktopChartProjection>) => void,
      ) => () => void;
    };
    readonly rankings: {
      readonly get: (
        market: "KRX" | "US",
        sort: DesktopRankingSort,
      ) => Promise<Readonly<DesktopRankingProjection>>;
    };
    readonly investorFlow: {
      readonly get: () => Promise<Readonly<DesktopInvestorFlowProjection>>;
    };
    readonly shortSelling: {
      readonly get: () => Promise<Readonly<DesktopShortSellingProjection>>;
    };
    readonly instruments: {
      readonly searchDomestic: (
        query: string,
      ) => Promise<Readonly<DesktopInstrumentSearchProjection>>;
      readonly searchUs: (
        query: string,
      ) => Promise<Readonly<DesktopInstrumentSearchProjection>>;
    };
    readonly marketContext: {
      readonly get: (
        forceRefresh?: boolean,
      ) => Promise<Readonly<DesktopMarketContextProjection>>;
    };
    readonly marketCalendar: {
      readonly get: (
        forceRefresh?: boolean,
      ) => Promise<Readonly<DesktopMarketCalendarProjection>>;
    };
    readonly information: {
      readonly getFeed: (
        forceRefresh?: boolean,
      ) => Promise<Readonly<DesktopInformationFeedProjection>>;
      readonly openExternal: (url: string) => Promise<boolean>;
    };
    readonly paper: {
      readonly submit: (
        request: Readonly<DesktopPaperOrderRequest>,
      ) => Promise<Readonly<DesktopPaperOrderResult>>;
      readonly onAccountProjection: (
        listener: (projection: Readonly<DesktopAccountProjection>) => void,
      ) => () => void;
    };
  }

  interface Window {
    readonly paperTradingDesktop: Readonly<PaperTradingDesktopApi>;
  }
}
