import { useWindowDimensions } from 'react-native';

const BREAKPOINTS = { mobile: 768, pc: 1024 };
export const CONTENT_MAX_WIDTH = 1280;

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();

  const isMobile = width < BREAKPOINTS.mobile;
  const isTablet = width >= BREAKPOINTS.mobile && width < BREAKPOINTS.pc;
  const isPC = width >= BREAKPOINTS.pc;

  const contentPadding = isPC ? 32 : isMobile ? 16 : 24;
  const columns = isMobile ? 1 : isTablet ? 2 : 3;

  return { width, height, isMobile, isTablet, isPC, contentPadding, columns, CONTENT_MAX_WIDTH };
}
