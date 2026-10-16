// Real Base DeFi integrations used for one-click deposits from the game.
import { parseAbi } from "viem";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4b71b54bdA02913" as const;
export const USDC_DECIMALS = 6;
export const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
export const AERO_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" as const;
export const AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as const;

export const aaveAbi = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);
export const vaultAbi = parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256)"]);
export const aeroFactoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, bool stable) view returns (address)"]);
export const aeroRouterAbi = parseAbi([
  "function quoteAddLiquidity(address tokenA, address tokenB, bool stable, address _factory, uint256 amountADesired, uint256 amountBDesired) view returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)",
]);
