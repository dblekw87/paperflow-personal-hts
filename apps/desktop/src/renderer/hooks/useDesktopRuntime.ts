import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopAccountProjection,
  DesktopChartInterval,
  DesktopChartProjection,
  DesktopChartRange,
  DesktopMarketProjection,
  DesktopInformationFeedProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
  DesktopRankingSort,
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
  readonly loadChartHistory: (
    interval: DesktopChartInterval,
    range: DesktopChartRange,
  ) => Promise<DesktopChartProjection | null>;
  readonly submitPaperOrder: (
    request: DesktopPaperOrderRequest,
  ) => Promise<DesktopPaperOrderResult | null>;
  readonly loadDomesticRanking: (
    sort: DesktopRankingSort,
  ) => Promise<DesktopRankingProjection | null>;
  readonly selectInstrument: (
    symbol: string,
  ) => Promise<DesktopMarketProjection | null>;
  readonly loadInformationFeed: (
    forceRefresh?: boolean,
  ) => Promise<DesktopInformationFeedProjection | null>;
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
  const requestedChart = useRef<string | null>(null);
  const activeInstrumentId = useRef<string | null>(null);
  const instrumentSelectionSequence = useRef(0);
  const rankingRequestSequence = useRef(0);

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

  const loadDomesticRanking = useCallback(
    async (
      sort: DesktopRankingSort,
    ): Promise<DesktopRankingProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++rankingRequestSequence.current;
      setRanking({
        schemaVersion: 1,
        market: "KRX",
        sort,
        state: "LOADING",
        items: [],
        source: "KIS_REST",
        fetchedAt: null,
        statusMessage: "KIS 읽기 전용 거래 순위를 불러오는 중입니다.",
      });
      try {
        const projection = await api.rankings.getDomestic(sort);
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
        setError("KIS 국내 거래 순위를 불러오지 못했습니다.");
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

  const selectInstrument = useCallback(
    async (symbol: string): Promise<DesktopMarketProjection | null> => {
      const api = window.paperTradingDesktop;
      if (!api) return null;
      const requestSequence = ++instrumentSelectionSequence.current;
      const expectedInstrumentId = `KRX:${symbol}`;
      activeInstrumentId.current = expectedInstrumentId;
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

  return {
    market,
    account,
    chart,
    loading,
    error,
    ranking,
    informationFeed,
    loadChartHistory,
    loadDomesticRanking,
    selectInstrument,
    loadInformationFeed,
    submitPaperOrder,
  };
}
