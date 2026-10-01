import React, { createContext, forwardRef, useContext } from 'react';
import { Text as NativeText, TextInput as NativeTextInput, StyleSheet } from 'react-native';
import { fallbackFontFamily, fontFamilies } from '../../theme/typography';

export const FontsLoadedContext = createContext(true);
const ParentTextContext = createContext(null);
const bundledFamilies = new Set(Object.values(fontFamilies));

function resolveTypography(style, parent, fontsLoaded) {
  const flat = StyleSheet.flatten(style) ?? {};
  const weight = flat.fontWeight ?? parent?.weight ?? '400';
  const isBold = weight === 'bold' || Number(weight) >= 600;
  let family = flat.fontFamily ?? parent?.family ?? fontFamilies.sans;

  if (family === fontFamilies.sans || family === fontFamilies.sansBold) {
    family = isBold ? fontFamilies.sansBold : fontFamilies.sans;
  }

  const isBundled = bundledFamilies.has(family);
  return {
    inherited: { family, weight },
    style: {
      fontFamily: isBundled && !fontsLoaded ? fallbackFontFamily : family,
      // Each loaded face has its own alias. Avoid fake browser bold and
      // unsupported native weight matching; use the actual bundled bold face.
      fontWeight: isBundled && fontsLoaded ? 'normal' : weight,
    },
  };
}

export const Text = forwardRef(function GameText({ style, children, ...props }, ref) {
  const parent = useContext(ParentTextContext);
  const fontsLoaded = useContext(FontsLoadedContext);
  const typography = resolveTypography(style, parent, fontsLoaded);

  return (
    <NativeText ref={ref} {...props} style={[style, typography.style]}>
      <ParentTextContext.Provider value={typography.inherited}>
        {children}
      </ParentTextContext.Provider>
    </NativeText>
  );
});

export const TextInput = forwardRef(function GameTextInput({ style, ...props }, ref) {
  const fontsLoaded = useContext(FontsLoadedContext);
  const typography = resolveTypography(style, null, fontsLoaded);
  return <NativeTextInput ref={ref} {...props} style={[style, typography.style]} />;
});
