import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TokenSelect, type Token } from "@/components/SwapPanel";
import { B20_TOKENS } from "@/lib/b20";

const tokens: Token[] = [
  { symbol: "ETH", name: "Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, color: "#627eea", isEth: true },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4b71b54bdA02913", decimals: 6, color: "#2775ca" },
  { symbol: "TSLAc", name: "Tesla", address: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8, color: "#3ed7c3" },
  { symbol: "NVDAc", name: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8, color: "#28835f" },
];

function setup(balances: Record<string, number>) {
  const onChange = vi.fn();
  render(<TokenSelect tokens={tokens} balances={new Map(Object.entries(balances))} value="ETH" onChange={onChange} />);
  return onChange;
}

describe("Swap token picker", () => {
  it("includes every base.org/assets stock (with Apple and Amazon) and unique addresses", () => {
    const syms = new Set(B20_TOKENS.map((t) => t.ticker));
    const addrs = new Set(B20_TOKENS.map((t) => t.address.toLowerCase()));
    expect(addrs.size).toBe(B20_TOKENS.length);
    expect(syms.size).toBe(B20_TOKENS.length);
    expect(B20_TOKENS.length).toBeGreaterThan(250);
    for (const s of ["AAPLc", "AMZNc", "NVDAc", "TSLAc", "DISc", "GOOGLc", "METAc"]) expect(syms.has(s)).toBe(true);
  });

  it("searches by name or symbol and selects a token", () => {
    const onChange = setup({});
    fireEvent.click(screen.getByRole("button", { name: /ETH/i }));
    expect(screen.getAllByText("TSLAc").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("Search stocks…"), { target: { value: "tesla" } });
    expect(screen.queryAllByText("NVDAc")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /TSLAc/ }));
    expect(onChange).toHaveBeenCalledWith("TSLAc");
  });

  it("sorts tokens you hold a balance of to the top", () => {
    setup({ NVDAc: 5 });
    fireEvent.click(screen.getByRole("button", { name: /ETH/i }));
    const items = screen.getAllByRole("button").filter((b) => /^NVDAc|^TSLAc/.test(b.textContent ?? ""));
    expect(items.length).toBe(2);
    expect(items[0]?.textContent?.startsWith("NVDAc")).toBe(true);
  });
});
