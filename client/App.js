import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/screens/HomeScreen';
import NameEntryScreen from './src/screens/NameEntryScreen';
import LobbyScreen from './src/screens/LobbyScreen';
import GameScreen from './src/screens/GameScreen';
import ResultScreen from './src/screens/ResultScreen';
import RulesScreen from './src/screens/RulesScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import { colors } from './src/theme';
import { fontAssets } from './src/theme/fontAssets';
import { GAME_NAME } from './src/theme/brand';
import { FontsLoadedContext, Text } from './src/components/ui/GameText';
import RoomBgm from './src/components/RoomBgm';

const Stack = createNativeStackNavigator();

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const navigationRef = useNavigationContainerRef();
  const [inRoom, setInRoom] = useState(false);
  const updateRoom = () => setInRoom(['NameEntry', 'Lobby', 'Game', 'Result'].includes(navigationRef.getCurrentRoute()?.name));

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
      <NavigationContainer ref={navigationRef} onReady={updateRoom} onStateChange={updateRoom}
        documentTitle={{ formatter: () => GAME_NAME }}>
        <StatusBar style="dark" />
        <View style={styles.app}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvas },
            animation: 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="NameEntry" component={NameEntryScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Lobby" component={LobbyScreen} />
          <Stack.Screen name="Game" component={GameScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />
          <Stack.Screen name="Rules" component={RulesScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
        </Stack.Navigator>
        <RoomBgm active={inRoom} />
        </View>
      </NavigationContainer>
    </FontsLoadedContext.Provider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    gap: 12,
  },
  loadingText: { color: colors.navy, fontSize: 14 },
});
