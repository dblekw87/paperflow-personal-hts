import { describe, expect, it } from "vitest";

import { formatKrwTurnoverEok } from "../apps/desktop/src/renderer/lib/market-format.js";

describe("desktop Korean market value formatting", () => {
  it("renders KIS won amounts in 억원 units", () => {
    expect(formatKrwTurnoverEok("398800000000")).toBe("3,988억원");
    expect(formatKrwTurnoverEok("10575264659754")).toBe("105,752억원");
  });

  it("fails closed for missing or malformed provider values", () => {
    expect(formatKrwTurnoverEok(null)).toBe("—");
    expect(formatKrwTurnoverEok("10.5")).toBe("—");
  });
});
