import { useEffect, useState } from 'react';
import { startMarketFeed } from './feed';
import { initialSnapshot } from './model';

export function useMarket() {
  const [market, setMarket] = useState(initialSnapshot);
  useEffect(() => startMarketFeed(setMarket), []);
  return market;
}
