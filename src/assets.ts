import catalog from '../config/assets.json';

export type AssetSymbol = 'BTC' | 'SOL' | 'ETH' | 'HYPE';
export type Asset = Readonly<{
  symbol: AssetSymbol;
  name: string;
  slug: string;
  tradeUrl: string;
  icon: string;
}>;

/** Shared with the website and desktop packaging; an edition never changes its identity. */
export const ASSETS: readonly Asset[] = Object.freeze(catalog.map((asset) => Object.freeze(asset as Asset)));
export const DEFAULT_ASSET = ASSETS[0];

/** URL input is never used directly as a subscription, image path, or trade destination. */
export function getAsset(symbol: string | null | undefined): Asset {
  const normalized = symbol?.trim().toUpperCase();
  return ASSETS.find((asset) => asset.symbol === normalized) ?? DEFAULT_ASSET;
}
