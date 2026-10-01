# ゲームで使う無料の文字

2026年10月1日、日本語が使えて、明るいゲーム画面に合う無料の文字を6種類集めました。
すべて SIL Open Font License 1.1 です。無料で使え、商用利用とファイルの配布もできます。
各配布元の `OFL.txt` を、文字のファイルと同じ場所に保存しています。

| 名前 | 見た目 | 今の使い方 | 配布元 |
| --- | --- | --- | --- |
| Mochiy Pop One | ふっくらした、元気な太い文字 | ゲーム名、大きな見出し | [Google Fonts](https://fonts.google.com/specimen/Mochiy+Pop+One) |
| Zen Maru Gothic | 丸くて読みやすい文字 | 説明、入力欄、ボタン、参加者名、得点。通常と太字を用意 | [Google Fonts](https://fonts.google.com/specimen/Zen+Maru+Gothic) |
| Yusei Magic | 手書きのような、やわらかい文字 | ホームの小さなひとこと、見本のタイトル | [Google Fonts](https://fonts.google.com/specimen/Yusei+Magic) |
| Dela Gothic One | どっしりした、とても太い文字 | 別案として保存 | [Google Fonts](https://fonts.google.com/specimen/Dela+Gothic+One) |
| Kiwi Maru | 少し落ち着いた丸い文字 | 別案として保存 | [Google Fonts](https://fonts.google.com/specimen/Kiwi+Maru) |
| Hachi Maru Pop | 細くて丸い、かわいい手書き風 | 別案として保存 | [Google Fonts](https://fonts.google.com/specimen/Hachi+Maru+Pop) |

## 保存場所

- 元の文字ファイルと利用の決まり: `client/assets/fonts/<配布元の名前>/`
- 配布元の住所、ファイルの大きさ、SHA-256: `client/assets/fonts/sources.json`
- 文字の使い分け: `client/src/theme/typography.js`
- Web用の文字ファイル: `client/src/theme/fontAssets.web.js`
- iOS / Android用の元の文字ファイル: `client/src/theme/fontAssets.js`

Webでは採用した4つのファイルだけを読み込みます。別案の3種類はゲームの読み込みに含めません。
元のTrueTypeファイルを、FontToolsでWOFF2へ変換しています。日本語の文字を減らす処理はしていません。
Web用4ファイルの合計は約6.38 MBです。ブラウザーは同じファイルを保存して次から使えます。
変換後のファイルと元のファイルで、使える文字が同じであることも確認しています。

## 画面に入れる仕組み

`App.js` で `expo-font` を使い、文字を読み込んでからゲームを表示します。
ファイルを読み込めなかった場合は、端末の文字でゲームを開きます。
`GameText.js` で、すべての説明と入力欄に同じ文字の決まりを使います。
太字には実際の太字ファイルを使います。ゲーム名の赤い部分など、入れ子の文字も親の文字を引き継ぎます。
ゲームの進み方、通信、採点は変えていません。

## 変換をやり直すとき

Pythonに `fonttools` と `brotli` がある状態で、次を実行します。

```sh
python client/assets/fonts/convert_web_fonts.py
```

配布元から取り直す場合は `sources.json` に書かれた住所を使い、元のファイルのSHA-256と利用の決まりを確認してください。
この変換をやり直しただけでは、公開中のゲームは変わりません。
