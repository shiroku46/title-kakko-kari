import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen   from './src/screens/HomeScreen';
import LobbyScreen  from './src/screens/LobbyScreen';
import GameScreen   from './src/screens/GameScreen';
import ResultScreen from './src/screens/ResultScreen';
import RulesScreen  from './src/screens/RulesScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F7F7F7' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home"   component={HomeScreen} />
        <Stack.Screen name="Lobby"  component={LobbyScreen} />
        <Stack.Screen name="Game"   component={GameScreen} />
        <Stack.Screen name="Result" component={ResultScreen} />
        <Stack.Screen name="Rules"  component={RulesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
