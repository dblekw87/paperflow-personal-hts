import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ShortSellingPanel safety", () => {
  it("renders unsupported provider states without synthetic short-selling values", () => {
    const component = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "renderer",
        "components",
        "organisms",
        "ShortSellingPanel.tsx",
      ),
      "utf8",
    );
    expect(component).toContain("KRX 공매도 거래·잔고");
    expect(component).toContain("FINRA/거래소 short interest");
    expect(component).toContain("미제공");
    expect(component).toContain("공매도 주문 금지는 유지");
    expect(component).not.toMatch(/SYNTHETIC_UI_FIXTURE|mockShort|shortRatio:|shortBalance:/i);
  });

  it("is mounted in the trading workspace", () => {
    const app = readFileSync(
      join(
        process.cwd(),
        "apps",
        "desktop",
        "src",
        "renderer",
        "app",
        "App.tsx",
      ),
      "utf8",
    );
    expect(app).toContain("ShortSellingPanel");
    expect(app).toContain('marketScope={isUsSelection ? "US" : "KR"}');
  });
});
