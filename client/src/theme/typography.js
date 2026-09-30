import { Platform } from 'react-native';

export const fontFamilies = Platform.select({
  ios: {
    serif: 'HiraMinProN-W6',
    serifBold: 'HiraMinProN-W6',
    sans: 'HiraginoSans-W3',
    sansBold: 'HiraginoSans-W6',
  },
  android: {
    serif: 'serif',
    serifBold: 'serif',
    sans: 'sans-serif',
    sansBold: 'sans-serif-condensed',
  },
  default: {
    serif: "'BIZ UDPMincho', 'Noto Serif JP', serif",
    serifBold: "'BIZ UDPMincho', 'Noto Serif JP', serif",
    sans: "'BIZ UDPGothic', 'Noto Sans JP', sans-serif",
    sansBold: "'BIZ UDPGothic', 'Noto Sans JP', sans-serif",
  },
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
