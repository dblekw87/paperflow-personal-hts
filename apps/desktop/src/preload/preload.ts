import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_CHANNELS,
  isDesktopChartProjection,
  isDesktopInformationFeedProjection,
  isDesktopInstrumentSearchProjection,
  isDesktopMarketContextProjection,
  isAllowedExternalInformationUrl,
  isDesktopRankingProjection,
  isDesktopInvestorFlowProjection,
  isSearchableDomesticInstrumentQuery,
  type DesktopAccountProjection,
  type DesktopBootstrapProjection,
  type DesktopChartInterval,
  type DesktopChartProjection,
  type DesktopChartRange,
  type DesktopMarketProjection,
  type DesktopInformationFeedProjection,
  type DesktopInstrumentSearchProjection,
  type DesktopMarketContextProjection,
  type DesktopPaperOrderRequest,
  type DesktopPaperOrderResult,
  type DesktopRankingProjection,
  type DesktopRankingSort,
  type DesktopInvestorFlowProjection,
} from "../shared/desktop-contracts.js";

const APP_METADATA_CHANNEL = DESKTOP_CHANNELS.appMetadata;
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

type SystemTheme = "dark" | "light";

interface AppMetadata {
  readonly name: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly platform: string;
  readonly packaged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMarketProjection(value: unknown): value is DesktopMarketProjection {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === 1 &&
    typeof value["instrumentId"] === "string" &&
    typeof value["symbol"] === "string" &&
    typeof value["venue"] === "string" &&
    typeof value["currency"] === "string" &&
    (value["mode"] === "FIXTURE" || value["mode"] === "KIS_READ_ONLY") &&
    typeof value["connectionState"] === "string" &&
    typeof value["freshness"] === "string" &&
    typeof value["session"] === "string" &&
    isStringOrNull(value["price"]) &&
    isStringOrNull(value["change"]) &&
    isStringOrNull(value["changeRate"]) &&
    isStringOrNull(value["executionStrength"]) &&
    isStringOrNull(value["cumulativeVolume"]) &&
    isStringOrNull(value["cumulativeTurnover"]) &&
    isStringOrNull(value["openPrice"]) &&
    isStringOrNull(value["highPrice"]) &&
    isStringOrNull(value["lowPrice"]) &&
    Array.isArray(value["bids"]) &&
    Array.isArray(value["asks"]) &&
    isStringOrNull(value["totalBidQuantity"]) &&
    isStringOrNull(value["totalAskQuantity"]) &&
    isStringOrNull(value["providerTime"]) &&
    isStringOrNull(value["receivedAt"]) &&
    isStringOrNull(value["orderBookReceivedAt"]) &&
    isStringOrNull(value["tradeReceivedAt"]) &&
    isStringOrNull(value["orderBookOccurredAt"]) &&
    isStringOrNull(value["tradeOccurredAt"]) &&
    typeof value["sequence"] === "string" &&
    typeof value["statusMessage"] === "string"
  );
}

function isAccountProjection(
  value: unknown,
): value is DesktopAccountProjection {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === 1 &&
    typeof value["accountId"] === "string" &&
    typeof value["displayName"] === "string" &&
    typeof value["baseCurrency"] === "string" &&
    typeof value["cashMinor"] === "string" &&
    (value["storageState"] === "READY" || value["storageState"] === "ERROR") &&
    (value["simulationProfile"] === "INITIAL_CONSERVATIVE_V1" ||
      value["simulationProfile"] === "ADVANCED_QUEUE_V1") &&
    (value["queuePositionQuality"] === "NOT_APPLICABLE" ||
      value["queuePositionQuality"] === "QUEUE_ESTIMATED") &&
    isStringOrNull(value["queueSafetyFactor"]) &&
    (value["simulationProfile"] !== "ADVANCED_QUEUE_V1" ||
      (value["queuePositionQuality"] === "QUEUE_ESTIMATED" &&
        typeof value["queueSafetyFactor"] === "string" &&
        /^(?:[1-9]\d*)(?:\.\d+)?$/.test(value["queueSafetyFactor"]))) &&
    (value["simulationProfile"] !== "INITIAL_CONSERVATIVE_V1" ||
      (value["queuePositionQuality"] === "NOT_APPLICABLE" &&
        value["queueSafetyFactor"] === null)) &&
    Array.isArray(value["positions"]) &&
    value["positions"].every(
      (position) =>
        isRecord(position) &&
        typeof position["instrumentId"] === "string" &&
        typeof position["quantity"] === "string" &&
        isStringOrNull(position["averagePrice"]),
    ) &&
    Array.isArray(value["fills"]) &&
    value["fills"].every(
      (fill) =>
        isRecord(fill) &&
        typeof fill["fillId"] === "string" &&
        typeof fill["clientOrderId"] === "string" &&
        typeof fill["instrumentId"] === "string" &&
        (fill["side"] === "BUY" || fill["side"] === "SELL") &&
        typeof fill["price"] === "string" &&
        typeof fill["quantity"] === "string" &&
        typeof fill["filledAt"] === "string" &&
        (fill["completion"] === "PARTIAL" ||
          fill["completion"] === "FULL"),
    ) &&
    typeof value["statusMessage"] === "string"
  );
}

function isBootstrapProjection(
  value: unknown,
): value is DesktopBootstrapProjection {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 1 &&
    value["actualOrderCapability"] === "FORBIDDEN" &&
    isMarketProjection(value["market"]) &&
    isAccountProjection(value["account"]) &&
    isDesktopChartProjection(value["chart"])
  );
}

function isPaperOrderResult(value: unknown): value is DesktopPaperOrderResult {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 1 &&
    typeof value["requestId"] === "string" &&
    typeof value["accepted"] === "boolean" &&
    typeof value["status"] === "string" &&
    isStringOrNull(value["rejectionCode"]) &&
    isAccountProjection(value["account"]) &&
    isMarketProjection(value["market"])
  );
}

function isAppMetadata(value: unknown): value is AppMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string" &&
    "electronVersion" in value &&
    typeof value.electronVersion === "string" &&
    "platform" in value &&
    typeof value.platform === "string" &&
    "packaged" in value &&
    typeof value.packaged === "boolean"
  );
}

function getSystemTheme(): SystemTheme {
  return globalThis.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

const desktopApi = Object.freeze({
  app: Object.freeze({
    getMetadata: async (): Promise<Readonly<AppMetadata>> => {
      const result: unknown = await ipcRenderer.invoke(APP_METADATA_CHANNEL);
      if (!isAppMetadata(result)) {
        throw new Error("Invalid desktop app metadata.");
      }

      return Object.freeze({
        name: result.name,
        version: result.version,
        electronVersion: result.electronVersion,
        platform: result.platform,
        packaged: result.packaged,
      });
    },
  }),
  theme: Object.freeze({
    getSystemPreference: (): SystemTheme => getSystemTheme(),
    onSystemPreferenceChanged: (
      listener: (theme: SystemTheme) => void,
    ): (() => void) => {
      const mediaQuery = globalThis.matchMedia(DARK_SCHEME_QUERY);
      const handleChange = (): void => {
        listener(mediaQuery.matches ? "dark" : "light");
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    },
  }),
  bootstrap: Object.freeze({
    get: async (): Promise<Readonly<DesktopBootstrapProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.bootstrapGet,
      );
      if (!isBootstrapProjection(result)) {
        throw new Error("Invalid desktop bootstrap projection.");
      }
      return Object.freeze(result);
    },
  }),
  market: Object.freeze({
    connectReadOnly: async (): Promise<Readonly<DesktopMarketProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.marketConnect,
      );
      if (!isMarketProjection(result)) {
        throw new Error("Invalid market projection.");
      }
      return Object.freeze(result);
    },
    disconnect: async (): Promise<Readonly<DesktopMarketProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.marketDisconnect,
      );
      if (!isMarketProjection(result)) {
        throw new Error("Invalid market projection.");
      }
      return Object.freeze(result);
    },
    selectInstrument: async (
      symbol: string,
    ): Promise<Readonly<DesktopMarketProjection>> => {
      if (!/^[0-9A-Z]{6,7}$/.test(symbol)) {
        throw new Error("Unsupported domestic instrument symbol.");
      }
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.marketSelectInstrument,
        symbol,
      );
      if (!isMarketProjection(result)) {
        throw new Error("Invalid market projection.");
      }
      return Object.freeze(result);
    },
    onProjection: (
      listener: (projection: Readonly<DesktopMarketProjection>) => void,
    ): (() => void) => {
      const handleProjection = (
        _event: Electron.IpcRendererEvent,
        value: unknown,
      ) => {
        if (isMarketProjection(value)) {
          listener(Object.freeze(value));
        }
      };
      ipcRenderer.on(DESKTOP_CHANNELS.marketProjection, handleProjection);
      return () => {
        ipcRenderer.removeListener(
          DESKTOP_CHANNELS.marketProjection,
          handleProjection,
        );
      };
    },
  }),
  charts: Object.freeze({
    getHistory: async (
      interval: DesktopChartInterval,
      range: DesktopChartRange,
    ): Promise<Readonly<DesktopChartProjection>> => {
      if (
        !["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"].includes(
          interval,
        )
      ) {
        throw new Error("Unsupported chart interval.");
      }
      if (!["1D", "6M", "1Y", "5Y"].includes(range)) {
        throw new Error("Unsupported chart range.");
      }
      const isIntraday = [
        "1m",
        "5m",
        "15m",
        "30m",
        "60m",
        "4h",
      ].includes(interval);
      if ((isIntraday && range !== "1D") || (!isIntraday && range === "1D")) {
        throw new Error("Chart interval and range are incompatible.");
      }
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.chartGetHistory,
        interval,
        range,
      );
      if (!isDesktopChartProjection(result)) {
        throw new Error("Invalid chart projection.");
      }
      return Object.freeze(result);
    },
    onProjection: (
      listener: (projection: Readonly<DesktopChartProjection>) => void,
    ): (() => void) => {
      const handleProjection = (
        _event: Electron.IpcRendererEvent,
        value: unknown,
      ) => {
        if (isDesktopChartProjection(value)) {
          listener(Object.freeze(value));
        }
      };
      ipcRenderer.on(DESKTOP_CHANNELS.chartProjection, handleProjection);
      return () => {
        ipcRenderer.removeListener(
          DESKTOP_CHANNELS.chartProjection,
          handleProjection,
        );
      };
    },
  }),
  rankings: Object.freeze({
    getDomestic: async (
      sort: DesktopRankingSort,
    ): Promise<Readonly<DesktopRankingProjection>> => {
      if (
        ![
          "AVERAGE_VOLUME",
          "VOLUME_INCREASE",
          "TURNOVER",
          "CHANGE_RATE_GAINERS",
          "CHANGE_RATE_LOSERS",
        ].includes(sort)
      ) {
        throw new Error("Unsupported ranking sort.");
      }
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.rankingGet,
        sort,
      );
      if (!isDesktopRankingProjection(result)) {
        throw new Error("Invalid ranking projection.");
      }
      return Object.freeze(result);
    },
  }),
  investorFlow: Object.freeze({
    get: async (): Promise<Readonly<DesktopInvestorFlowProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.investorFlowGet,
      );
      if (!isDesktopInvestorFlowProjection(result)) {
        throw new Error("Invalid investor-flow projection.");
      }
      return Object.freeze(result);
    },
  }),
  instruments: Object.freeze({
    searchDomestic: async (
      rawQuery: string,
    ): Promise<Readonly<DesktopInstrumentSearchProjection>> => {
      const query = rawQuery.trim();
      if (!isSearchableDomesticInstrumentQuery(query)) {
        throw new Error("Unsupported instrument search query.");
      }
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.instrumentSearch,
        query,
      );
      if (!isDesktopInstrumentSearchProjection(result)) {
        throw new Error("Invalid instrument search projection.");
      }
      return Object.freeze(result);
    },
  }),
  marketContext: Object.freeze({
    get: async (
      forceRefresh = false,
    ): Promise<Readonly<DesktopMarketContextProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.marketContextGet,
        forceRefresh,
      );
      if (!isDesktopMarketContextProjection(result)) {
        throw new Error("Invalid market-context projection.");
      }
      return Object.freeze(result);
    },
  }),
  information: Object.freeze({
    getFeed: async (
      forceRefresh = false,
    ): Promise<Readonly<DesktopInformationFeedProjection>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.informationGet,
        forceRefresh,
      );
      if (!isDesktopInformationFeedProjection(result)) {
        throw new Error("Invalid information feed projection.");
      }
      return Object.freeze(result);
    },
    openExternal: async (url: string): Promise<boolean> => {
      if (!isAllowedExternalInformationUrl(url)) {
        throw new Error("Unsupported external information URL.");
      }
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.informationOpenExternal,
        url,
      );
      if (result !== true) {
        throw new Error("External information URL was not opened.");
      }
      return true;
    },
  }),
  paper: Object.freeze({
    submit: async (
      request: Readonly<DesktopPaperOrderRequest>,
    ): Promise<Readonly<DesktopPaperOrderResult>> => {
      const result: unknown = await ipcRenderer.invoke(
        DESKTOP_CHANNELS.paperSubmit,
        request,
      );
      if (!isPaperOrderResult(result)) {
        throw new Error("Invalid paper-order result.");
      }
      return Object.freeze(result);
    },
    onAccountProjection: (
      listener: (projection: Readonly<DesktopAccountProjection>) => void,
    ): (() => void) => {
      const handleProjection = (
        _event: Electron.IpcRendererEvent,
        value: unknown,
      ) => {
        if (isAccountProjection(value)) {
          listener(Object.freeze(value));
        }
      };
      ipcRenderer.on(DESKTOP_CHANNELS.accountProjection, handleProjection);
      return () => {
        ipcRenderer.removeListener(
          DESKTOP_CHANNELS.accountProjection,
          handleProjection,
        );
      };
    },
  }),
});

contextBridge.exposeInMainWorld("paperTradingDesktop", desktopApi);
