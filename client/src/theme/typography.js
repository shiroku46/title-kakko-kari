import { Platform } from 'react-native';

// These names match the bundled faces loaded by App, on web and native.
export const fontFamilies = {
  display: 'TahoiyaSansBold',
  accent: 'TahoiyaSans',
  sans: 'TahoiyaSans',
  sansBold: 'TahoiyaSansBold',
  // Preserve existing theme consumers while replacing the old Mincho face.
  serif: 'TahoiyaSans',
  serifBold: 'TahoiyaSansBold',
};

export const fallbackFontFamily = Platform.select({
  web: 'system-ui, sans-serif',
  ios: 'System',
  default: 'sans-serif',
});

export const typeScale = {
  display: { fontSize: 46, lineHeight: 54 },
  titleXl: { fontSize: 36, lineHeight: 44 },
  titleLg: { fontSize: 28, lineHeight: 36 },
  titleMd: { fontSize: 22, lineHeight: 30 },
  titleSm: { fontSize: 18, lineHeight: 26 },
  bodyLg: { fontSize: 16, lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  bodySm: { fontSize: 13, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 11, lineHeight: 16 },
};
