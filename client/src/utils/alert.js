import { Alert as NativeAlert, Platform } from 'react-native';

// React Native Web's Alert is empty. Browser notices and two-way confirmations
// must also call the chosen action, while native keeps its normal dialogs.
const webAlert = {
  alert(title, message = '', buttons) {
    if (typeof window === 'undefined') return;
    const text = [title, message].filter(Boolean).join('\n\n');
    const choices = Array.isArray(buttons) && buttons.length ? buttons : [{ text: 'OK' }];
    if (choices.length === 1) {
      window.alert(text);
      choices[0].onPress?.();
      return;
    }
    const cancel = choices.find((choice) => choice.style === 'cancel') ?? choices[0];
    const proceed = choices.find((choice) => choice !== cancel) ?? choices[0];
    const confirmed = window.confirm(`${text}\n\nOK：${proceed.text ?? '進む'}\nキャンセル：${cancel.text ?? '戻る'}`);
    (confirmed ? proceed : cancel).onPress?.();
  },
};

export const Alert = Platform.OS === 'web' ? webAlert : NativeAlert;
