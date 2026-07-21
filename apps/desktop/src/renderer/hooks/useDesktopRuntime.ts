import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopAccountProjection,
  DesktopChartInterval,
  DesktopChartProjection,
  DesktopChartRange,
  DesktopMarketProjection,
  DesktopInformationFeedProjection,
  DesktopInstrumentSearchProjection,
  DesktopInvestorFlowProjection,
  DesktopMarketCalendarProjection,
  DesktopMarketContextProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
  DesktopRankingSort,
  DesktopShortSellingProjection,
} from "../../shared/desktop-contracts.js";
import { isCurrentDesktopRankingResponse } from "../../shared/desktop-contracts.js";

export interface DesktopRuntimeState {
  readonly market: DesktopMarketProjection | null;
  readonly account: DesktopAccountProjection | null;
  readonly chart: DesktopChartProjection | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly ranking: DesktopRankingProjection | null;
  readonly informationFeed: DesktopInformationFeedProjection | null;
  readonly marketCalendar: DesktopMarketCalendarProjection | null;
  readonly marketContext: DesktopMarketContextProjection | null;
  readonly investorFlow: DesktopInvestorFlowProjection | null;
  readonly shortSelling: DesktopShortSellingProjection | null;
  readonly instrumentSearch: DesktopInstrumentSearchProjection | null;
  readonly loadChartHistory: (
    interval: DesktopChartInterval,
    range: DesktopChartRange,
  ) => Promise<DesktopChartProjection | null>;
  readonly submitPaperOrder: (
    request: DesktopPaperOrderRequest,
  ) => Promise<DesktopPaperOrderResult | null>;
  readonly loadRanking: (
    market: "KRX" | "US",
    sort: DesktopRankingSort,
  ) => Promise<DesktopRankingProjection | null>;
  readonly selectInstrument: (
    symbol: string,
  ) => Promise<DesktopMarketProjection | null>;
  readonly searchDomesticInstruments: (
    query: string,
  ) => Promise<DesktopInstrumentSearchProjection | null>;
  readonly searchUsInstruments: (
    query: string,
  ) => Promise<DesktopInstrumentSearchProjection | null>;
  readonly loadInformationFeed: (
    forceRefresh?: boolean,
  ) => Promise<DesktopInformationFeedProjection | null>;
  readonly loadMarketCalendar: (
    forceRefresh?: boolean,
  ) => Promise<DesktopMarketCalendarProjection | null>;
  readonly loadMarketContext: (
    forceRefresh?: boolean,
  ) => Promise<DesktopMarketContextProjection | null>;
  readonly loadInvestorFlow: () => Promise<DesktopInvestorFlowProjection | null>;
  readonly loadShortSelling: () => Promise<DesktopShortSellingProjection | null>;
}

export function useDesktopRuntime(): DesktopRuntimeState {
  const [market, setMarket] = useState<DesktopMarketProjection | null>(null);
  const [account, setAccount] = useState<DesktopAccountProjection | null>(null);
  const [chart, setChart] = useState<DesktopChartProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ranking, setRanking] =
    useState<DesktopRankingProjection | null>(null);
  const [informationFeed, setInformationFeed] =
    useState<DesktopInformationFeedProjection | null>(null);
  const [marketCalendar, setMarketCalendar] =
    useState<DesktopMarketCalendarProjection | null>(null);
  const [marketContext, setMarketContext] =
    useState<DesktopMarketContextProjection | null>(null);
  const [investorFlow, setInvestorFlow] =
    useState<DesktopInvestorFlowProjection | null>(null);
  const [shortSelling, setShortSelling] =
    useState<DesktopShortSellingProjection | null>(null);
  const [instrumentSearch, setInstrumentSearch] =
    useState<DesktopInstrumentSearchProjection | null>(null);
  const requestedChart = useRef<string | null>(null);
  const activeInstrumentId = useRef<string | null>(null);
  const instrumentSelectionSequence = useRef(0);
  const rankingRequestSequence = useRef(0);
  const marketContextRequestSequence = useRef(0);
  const marketCalendarRequestSequence = useRef(0);
  const investorFlowRequestSequence = useRef(0);
  const shortSellingRequestSequence = useRef(0);
  const instrumentSearchSequence = useRef(0);

  useEffect(() => {
    const api = window.paperTradingDesktop;
    if (!api) {
      setLoading(false);
      return;
    }
    let active = true;
    const unsubscribe = api.market.onProjection((projection) => {
      if (
        active &&
        (activeInstrumentId.current === null ||
          projection.instrumentId === activeInstrumentId.current)
      ) {
        activeInstrumentId.current = projection.instrumentId;
        setMarket(projection);
      }
    });
    const unsubscribeAccount = api.paper.onAccountProjection((projection) => {
      if (active) setAccount(projection);
    });
    const unsubscribeChart = api.charts.onProjection((projection) => {
      if (
        active &&
        projection.instrumentId === activeInstrumentId.current &&
        (requestedChart.current === null ||
          `${projection.instrumentId}:${projection.interval}:${projection.range}` ===
            requestedChart.current)
      ) {
        setChart(projection);
      }
    });

    void api.bootstrap
      .get()
      .then((bootstrap) => {
        if (!active) return null;
        setAccount(bootstrap.account);
        if (instrumentSelectionSequence.current !== 0) return null;
        activeInstrumentId.current = bootstrap.market.instrumentId;
        setMarket(bootstrap.market);
        setChart(bootstrap.chart);
        return api.market.connectReadOnly();
      })
      .then((projection) => {
        if (
          active &&
          projection &&
          instrumentSelectionSequence.current === 0 &&
          projection.instrumentId === activeInstrumentId.current
        ) {
          setMarket(projection);
        }
      })
      .catch(() => {
        if (active) {
          setError("Electron 로컬 projection을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeAccount();
      unsubscribeChart();
    };
  }, []);

  const loadMarketContext = useCallback(
    async (
      forceRefresh = false,
    ): Promise<DesktopMarketContextProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++marketContextRequestSequence.current;
      setMarketContext((current) => ({
        schemaVersion: 1,
        state: "LOADING",
        items: current?.items ?? [],
        fetchedAt: current?.fetchedAt ?? null,
        statusMessage: "KIS 시장 지수·프록시를 갱신하는 중입니다.",
      }));
      try {
        const projection = await api.marketContext.get(forceRefresh);
        if (requestSequence !== marketContextRequestSequence.current) {
          return null;
        }
        setMarketContext(projection);
        return projection;
      } catch {
        if (requestSequence === marketContextRequestSequence.current) {
          setMarketContext((current) => ({
            schemaVersion: 1,
            state: "ERROR",
            items: current?.items ?? [],
            fetchedAt: current?.fetchedAt ?? null,
            statusMessage: "KIS 시장 현황 projection을 불러오지 못했습니다.",
          }));
        }
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!window.paperTradingDesktop) return;
    void loadMarketContext(false);
    const timer = window.setInterval(() => {
      void loadMarketContext(false);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadMarketContext]);

  const loadInvestorFlow = useCallback(
    async (): Promise<DesktopInvestorFlowProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const expectedInstrumentId = activeInstrumentId.current;
      const requestSequence = ++investorFlowRequestSequence.current;
      setInvestorFlow((current) => ({
        schemaVersion: 1,
        state: "LOADING",
        source: "KIS_REST",
        fetchedAt: current?.fetchedAt ?? null,
        instrument: current?.instrument ?? null,
        markets: current?.markets ?? [],
        statusMessage: "KIS 투자자·프로그램 수급을 조회하는 중입니다.",
      }));
      try {
        const projection = await api.investorFlow.get();
        if (
          requestSequence !== investorFlowRequestSequence.current ||
          (projection.instrument !== null &&
            projection.instrument.instrumentId !== expectedInstrumentId)
        ) return null;
        setInvestorFlow(projection);
        return projection;
      } catch {
        if (requestSequence === investorFlowRequestSequence.current) {
          setInvestorFlow((current) => ({
            schemaVersion: 1,
            state: "ERROR",
            source: "KIS_REST",
            fetchedAt: current?.fetchedAt ?? null,
            instrument: null,
            markets: [],
            statusMessage: "KIS 투자자 수급 projection을 불러오지 못했습니다.",
          }));
        }
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!window.paperTradingDesktop || !market?.instrumentId) return;
    void loadInvestorFlow();
    const timer = window.setInterval(() => void loadInvestorFlow(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadInvestorFlow, market?.instrumentId]);

  const loadShortSelling = useCallback(
    async (): Promise<DesktopShortSellingProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const expectedInstrumentId = activeInstrumentId.current;
      const requestSequence = ++shortSellingRequestSequence.current;
      setShortSelling((current) => ({
        schemaVersion: 1,
        state: "LOADING",
        source: current?.source ?? "UNSUPPORTED",
        instrumentId: expectedInstrumentId ?? current?.instrumentId ?? "KRX:000000",
        symbol: expectedInstrumentId?.split(":")[1] ?? current?.symbol ?? "000000",
        marketScope: expectedInstrumentId?.startsWith("KRX:") ? "KR" : "US",
        fetchedAt: current?.fetchedAt ?? null,
        trade: current?.trade ?? null,
        balance: current?.balance ?? null,
        lendingBalance: current?.lendingBalance ?? null,
        statusMessage: "KRX 공매도 통계를 조회하는 중입니다.",
      }));
      try {
        const projection = await api.shortSelling.get();
        if (
          requestSequence !== shortSellingRequestSequence.current ||
          projection.instrumentId !== expectedInstrumentId
        ) {
          return null;
        }
        setShortSelling(projection);
        return projection;
      } catch {
        if (requestSequence === shortSellingRequestSequence.current) {
          setShortSelling((current) => ({
            schemaVersion: 1,
            state: "ERROR",
            source: "UNSUPPORTED",
            instrumentId: expectedInstrumentId ?? current?.instrumentId ?? "KRX:000000",
            symbol: expectedInstrumentId?.split(":")[1] ?? current?.symbol ?? "000000",
            marketScope: expectedInstrumentId?.startsWith("KRX:") ? "KR" : "US",
            fetchedAt: current?.fetchedAt ?? null,
            trade: null,
            balance: null,
            lendingBalance: null,
            statusMessage: "공매도 projection을 불러오지 못했습니다.",
          }));
        }
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!window.paperTradingDesktop || !market?.instrumentId) return;
    void loadShortSelling();
    const timer = window.setInterval(() => void loadShortSelling(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadShortSelling, market?.instrumentId]);

  const submitPaperOrder = useCallback(
    async (
      request: DesktopPaperOrderRequest,
    ): Promise<DesktopPaperOrderResult | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      try {
        const result = await api.paper.submit(request);
        setMarket(result.market);
        setAccount(result.account);
        setError(null);
        return result;
      } catch {
        setError("로컬 모의주문을 처리하지 못했습니다.");
        return null;
      }
    },
    [],
  );

  const loadChartHistory = useCallback(
    async (
      interval: DesktopChartInterval,
      range: DesktopChartRange,
    ): Promise<DesktopChartProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const instrumentId = activeInstrumentId.current;
      if (instrumentId === null) return null;
      const requestKey = `${instrumentId}:${interval}:${range}`;
      requestedChart.current = requestKey;
      try {
        const projection = await api.charts.getHistory(interval, range);
        if (
          requestedChart.current === requestKey &&
          projection.instrumentId === instrumentId
        ) {
          setChart(projection);
          setError(
            projection.state === "ERROR"
              ? projection.statusMessage
              : null,
          );
        }
        return projection;
      } catch {
        if (requestedChart.current === requestKey) {
          setError("KIS 차트 데이터를 불러오지 못했습니다.");
        }
        return null;
      }
    },
    [],
  );

  const loadRanking = useCallback(
    async (
      market: "KRX" | "US",
      sort: DesktopRankingSort,
    ): Promise<DesktopRankingProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++rankingRequestSequence.current;
      setRanking({
        schemaVersion: 1,
        market,
        sort,
        state: "LOADING",
        items: [],
        source: "KIS_REST",
        fetchedAt: null,
        statusMessage: "KIS 읽기 전용 거래 순위를 불러오는 중입니다.",
      });
      try {
        const projection = await api.rankings.get(market, sort);
        if (
          !isCurrentDesktopRankingResponse({
            requestSequence,
            currentSequence: rankingRequestSequence.current,
            requestedSort: sort,
            responseSort: projection.sort,
          })
        ) {
          return null;
        }
        setRanking(projection);
        setError(
          projection.state === "ERROR" ? projection.statusMessage : null,
        );
        return projection;
      } catch {
        if (requestSequence !== rankingRequestSequence.current) {
          return null;
        }
        setError(`KIS ${market === "US" ? "미국" : "국내"} 거래 순위를 불러오지 못했습니다.`);
        return null;
      }
    },
    [],
  );

  const loadInformationFeed = useCallback(
    async (
      forceRefresh = false,
    ): Promise<DesktopInformationFeedProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      setInformationFeed((current) => ({
        schemaVersion: 1,
        state: "LOADING",
        items: current?.items ?? [],
        sources: current?.sources ?? [],
        fetchedAt: current?.fetchedAt ?? null,
        statusMessage: "실제 뉴스·공시를 갱신하는 중입니다.",
      }));
      try {
        const projection = await api.information.getFeed(forceRefresh);
        setInformationFeed(projection);
        setError(
          projection.state === "ERROR" ? projection.statusMessage : null,
        );
        return projection;
      } catch {
        setError("뉴스·공시 projection을 불러오지 못했습니다.");
        return null;
      }
    },
    [],
  );

  const loadMarketCalendar = useCallback(
    async (
      forceRefresh = false,
    ): Promise<DesktopMarketCalendarProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++marketCalendarRequestSequence.current;
      setMarketCalendar((current) => ({
        schemaVersion: 1,
        state: "LOADING",
        events: current?.events ?? [],
        sources: current?.sources ?? [],
        fetchedAt: current?.fetchedAt ?? null,
        source: current?.source ?? "FIXTURE",
        statusMessage: "국내·미국 시장 이벤트 캘린더를 갱신하는 중입니다.",
      }));
      try {
        const projection = await api.marketCalendar.get(forceRefresh);
        if (requestSequence !== marketCalendarRequestSequence.current) {
          return null;
        }
        setMarketCalendar(projection);
        setError(projection.state === "ERROR" ? projection.statusMessage : null);
        return projection;
      } catch {
        if (requestSequence === marketCalendarRequestSequence.current) {
          setMarketCalendar((current) => ({
            schemaVersion: 1,
            state: "ERROR",
            events: current?.events ?? [],
            sources: current?.sources ?? [],
            fetchedAt: current?.fetchedAt ?? null,
            source: current?.source ?? "FIXTURE",
            statusMessage: "시장 이벤트 캘린더 projection을 불러오지 못했습니다.",
          }));
        }
        return null;
      }
    },
    [],
  );

  const selectInstrument = useCallback(
    async (symbol: string): Promise<DesktopMarketProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++instrumentSelectionSequence.current;
      const usSelection = /^(NAS|NYS|AMS):(.+)$/.exec(symbol);
      const expectedInstrumentId = usSelection === null
        ? `KRX:${symbol}`
        : `${usSelection[1] === "NAS" ? "NASDAQ" : usSelection[1] === "NYS" ? "NYSE" : "AMEX"}:${usSelection[2]}`;
      activeInstrumentId.current = expectedInstrumentId;
      investorFlowRequestSequence.current += 1;
      shortSellingRequestSequence.current += 1;
      setInvestorFlow(null);
      setShortSelling(null);
      try {
        requestedChart.current = null;
        setChart(null);
        const projection = await api.market.selectInstrument(symbol);
        if (
          requestSequence !== instrumentSelectionSequence.current ||
          projection.instrumentId !== expectedInstrumentId
        ) {
          return null;
        }
        setMarket(projection);
        setError(null);
        return projection;
      } catch {
        if (requestSequence === instrumentSelectionSequence.current) {
          setError("선택한 종목의 KIS workspace를 열지 못했습니다.");
        }
        return null;
      }
    },
    [],
  );

  const searchDomesticInstruments = useCallback(
    async (
      query: string,
    ): Promise<DesktopInstrumentSearchProjection | null> => {
      const api = window.paperTradingDesktop;
      const normalizedQuery = query.trim();
      const requestSequence = ++instrumentSearchSequence.current;
      if (!api || normalizedQuery.length === 0) {
        setInstrumentSearch(null);
        return null;
      }
      try {
        const projection =
          await api.instruments.searchDomestic(normalizedQuery);
        if (
          requestSequence !== instrumentSearchSequence.current ||
          projection.query !== normalizedQuery
        ) {
          return null;
        }
        setInstrumentSearch(projection);
        return projection;
      } catch {
        if (requestSequence === instrumentSearchSequence.current) {
          setInstrumentSearch({
            schemaVersion: 1,
            query: normalizedQuery,
            state: "ERROR",
            items: [],
            source: "CACHED_KIS_MASTER",
            stale: true,
            fetchedAt: null,
            statusMessage: "종목 검색 데이터를 불러오지 못했습니다.",
          });
        }
        return null;
      }
    },
    [],
  );

  const searchUsInstruments = useCallback(
    async (query: string): Promise<DesktopInstrumentSearchProjection | null> => {
      const api = window.paperTradingDesktop;
      const normalizedQuery = query.trim();
      const requestSequence = ++instrumentSearchSequence.current;
      if (!api || normalizedQuery.length === 0) {
        setInstrumentSearch(null);
        return null;
      }
      try {
        const projection = await api.instruments.searchUs(normalizedQuery);
        if (requestSequence !== instrumentSearchSequence.current || projection.query !== normalizedQuery) return null;
        setInstrumentSearch(projection);
        return projection;
      } catch {
        if (requestSequence === instrumentSearchSequence.current) {
          setInstrumentSearch({
            schemaVersion: 1, query: normalizedQuery, state: "ERROR", items: [],
            source: "CACHED_KIS_MASTER", stale: true, fetchedAt: null,
            statusMessage: "미국 종목 검색 데이터를 불러오지 못했습니다.",
          });
        }
        return null;
      }
    },
    [],
  );

  return {
    market,
    account,
    chart,
    loading,
    error,
    ranking,
    informationFeed,
    marketCalendar,
    marketContext,
    investorFlow,
    shortSelling,
    instrumentSearch,
    loadChartHistory,
    loadRanking,
    selectInstrument,
    searchDomesticInstruments,
    searchUsInstruments,
    loadInformationFeed,
    loadMarketCalendar,
    loadMarketContext,
    loadInvestorFlow,
    loadShortSelling,
    submitPaperOrder,
  };
}
