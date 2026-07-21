import { describe, expect, it } from "vitest";

import { truncateUsPrice } from "../apps/desktop/src/renderer/model/price-display.js";

describe("truncateUsPrice", () => {
  it("cuts after two decimal places without rounding", () => {
    expect(truncateUsPrice("944.5799")).toBe("944.57");
    expect(truncateUsPrice("1,234.9999")).toBe("1,234.99");
    expect(truncateUsPrice("0.0099")).toBe("0.00");
  });

  it("pads prices that have fewer than two decimal places", () => {
    expect(truncateUsPrice("25")).toBe("25.00");
    expect(truncateUsPrice("25.1")).toBe("25.10");
  });
});
