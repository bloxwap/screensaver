import { useEffect, useState } from 'react';
import { DEFAULT_ASSET, getAsset, type Asset } from '../assets';
import { startMarketFeed } from './feed';
import { initialSnapshot } from './model';

export function useMarket(asset: Asset = DEFAULT_ASSET) {
  const selected = getAsset(asset.symbol);
  const [state, setState] = useState(() => ({ symbol: selected.symbol, snapshot: initialSnapshot() }));
  useEffect(() => {
    let stop: (() => void) | undefined;
    const resume = () => {
      if (stop) return;
      setState({ symbol: selected.symbol, snapshot: initialSnapshot() });
      stop = startMarketFeed((snapshot) => setState({ symbol: selected.symbol, snapshot }), selected);
    };
    const suspend = () => { stop?.(); stop = undefined; };
    // Browsers may keep a page alive in the back/forward cache without unmounting React.
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    resume();
    return () => {
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
      suspend();
    };
  }, [selected]);
  // Do not render the previous edition's quote during the render before effect cleanup.
  return state.symbol === selected.symbol ? state.snapshot : initialSnapshot();
}
