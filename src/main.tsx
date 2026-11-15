import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/Root';
import './index.css';

// iOS Safari ignores user-scalable=no: stop its page pinch, so only the drawings (which handle
// their own pinch) zoom. Double-tap zoom is off through touch-action in index.css.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
