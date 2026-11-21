import { useEffect, useState } from 'react';

const isFullScreen = (): boolean => window.outerWidth === window.screen.width && window.outerHeight === window.screen.height;

/** True while the window fills the screen: macOS full screen, which hides the traffic lights. */
export function useFullScreen(): boolean {
  const [full, setFull] = useState(isFullScreen);
  useEffect(() => {
    const update = (): void => setFull(isFullScreen());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return full;
}
