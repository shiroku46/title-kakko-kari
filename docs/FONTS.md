# タイトルカッコカリで使う無料の文字

2026年10月1日、説明やボタンを読みやすくするため、Noto Sans JP に変えました。
通常の文字は400、太字は700です。大きな題名の絵と、説明に使う文字を分けています。

すべて SIL Open Font License 1.1 です。無料で使え、商用利用とファイルの配布もできます。
各配布元の `OFL.txt` を、文字のファイルと同じ場所に保存しています。

| 名前 | 見た目 | 今の使い方 | 配布元 |
| --- | --- | --- | --- |
| Noto Sans JP | すっきりした、読みやすい文字 | 説明、入力欄、ボタン、見出し、参加者名、得点 | [Google Fonts](https://fonts.google.com/specimen/Noto+Sans+JP) |
| Mochiy Pop One | ふっくらした、元気な太い文字 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Mochiy+Pop+One) |
| Zen Maru Gothic | 丸くてやわらかい文字 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Zen+Maru+Gothic) |
| Yusei Magic | 手書きのような、やわらかい文字 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Yusei+Magic) |
| Dela Gothic One | どっしりした、とても太い文字 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Dela+Gothic+One) |
| Kiwi Maru | 少し落ち着いた丸い文字 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Kiwi+Maru) |
| Hachi Maru Pop | 細くて丸い、かわいい手書き風 | 保存のみ。ゲームでは読み込みません | [Google Fonts](https://fonts.google.com/specimen/Hachi+Maru+Pop) |

## 保存場所

- 元の文字ファイルと利用の決まり: `client/assets/fonts/<配布元の名前>/`
- 配布元の住所、ファイルの大きさ、SHA-256: `client/assets/fonts/sources.json`
- 文字の使い分け: `client/src/theme/typography.js`
- Web用の文字ファイル: `client/src/theme/fontAssets.web.js`
- iOS / Android用の文字ファイル: `client/src/theme/fontAssets.js`

WebではNoto Sans JPの通常と太字、2つのWOFF2ファイルだけを読み込みます。
iOS / Androidでは、同じ通常と太字のTrueTypeファイルを読み込みます。
以前に集めた6種類は残していますが、ゲームの読み込みには含めません。
Web用2ファイルの合計は4,656,020 bytes（約4.66 MB）です。以前の約6.38 MBから小さくなりました。
ブラウザーは同じファイルを保存して次から使えます。

Google Fontsの元のファイル `NotoSansJP[wght].ttf` は、`NotoSansJP-Variable.ttf` としてそのまま保存しています。
FontToolsで400と700のTrueTypeファイルを作り、その2つをWOFF2へ変換しています。
日本語の文字を減らす処理はしていません。元の16,732文字と、すべてのUnicode文字表、文字の並びが同じことを確認しています。
また、タイトルカッコカリ、仮、説明、投票、得点、英字、数字など、画面で使う文字も確認しています。

元の利用の決まりで、作り変えた文字の名前に使えないのは「Source」です。
今回の文字の名前は「Noto Sans JP」で、ゲーム内の呼び名は `TahoiyaSans` と `TahoiyaSansBold` です。
作り変えたファイルにも、元の著作権と利用の決まりを残しています。

## 画面に入れる仕組み

`App.js` で `expo-font` を使い、文字を読み込んでからゲームを表示します。
ファイルを読み込めなかった場合は、端末の文字でゲームを開きます。
`GameText.js` で、すべての説明と入力欄に同じ文字の決まりを使います。
太字には実際の太字ファイルを使います。入れ子の文字も親の文字を引き継ぎます。
文字の太さは `fontWeight` で選びます。見出しは太字、説明は通常の文字です。
ゲームの進み方、通信、採点は変えていません。

## 変換をやり直すとき

Pythonに `fonttools` と `brotli` がある状態で、次を実行します。

```sh
python client/assets/fonts/convert_web_fonts.py
```

作成に使った道具の版、元のファイルと作り変えたファイルの大きさ、SHA-256は `sources.json` に記録しています。
同じ道具の版と元のファイルで作り直せます。元の文字と利用の決まりのSHA-256が違う場合は、作成を止めます。
配布元から取り直す場合は `sources.json` に書かれた住所を使い、元のファイルのSHA-256と利用の決まりを確認してください。
この変換をやり直しただけでは、公開中のゲームは変わりません。
