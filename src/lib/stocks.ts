// Coinbase Tokenized Stocks on Base (simulated stake for now).
export type Stock = { ticker: string; name: string; price: number; color: string };

export const STOCKS: Stock[] = [
  { ticker: "AAPL", name: "Apple", price: 232.1, color: "#d9d9d9" },
  { ticker: "TSLA", name: "Tesla", price: 251.4, color: "#e8473b" },
  { ticker: "NVDA", name: "NVIDIA", price: 128.7, color: "#76b900" },
  { ticker: "COIN", name: "Coinbase", price: 214.9, color: "#1652f0" },
  { ticker: "MSFT", name: "Microsoft", price: 418.3, color: "#00a4ef" },
  { ticker: "AMZN", name: "Amazon", price: 186.2, color: "#ff9900" },
  { ticker: "GOOGL", name: "Alphabet", price: 165.8, color: "#ea4335" },
  { ticker: "META", name: "Meta", price: 571.5, color: "#0668e1" },
];

export const GAME_CREATOR = "0x72110c7117Ee3D0BC77D4682107EA04b02312ED6" as const;
export const KICK_USD = 0.001;
