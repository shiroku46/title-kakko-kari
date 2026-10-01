import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/screens/HomeScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import ResultScreen from './src/screens/ResultScreen';
import RulesScreen from './src/screens/RulesScreen';
import { colors } from './src/theme';
import { fontAssets } from './src/theme/fontAssets';
import { GAME_NAME } from './src/theme/brand';
import { FontsLoadedContext, Text } from './src/components/ui/GameText';

const Stack = createNativeStackNavigator();

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  if (!fontsLoaded && !fontError) {
    return (
      <FontsLoadedContext.Provider value={false}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.red} />
          <Text style={styles.loadingText} accessibilityLiveRegion="polite">
            ゲームの準備中…
          </Text>
        </View>
      </FontsLoadedContext.Provider>
    );
  }

  return (
    <FontsLoadedContext.Provider value={fontsLoaded}>
      <NavigationContainer documentTitle={{ formatter: () => GAME_NAME }}>
        <StatusBar style="dark" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvas },
            animation: 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Lobby" component={LobbyScreen} />
          <Stack.Screen name="Game" component={GameScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="Rules" component={RulesScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </FontsLoadedContext.Provider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    gap: 12,
  },
  loadingText: { color: colors.navy, fontSize: 14 },
});
