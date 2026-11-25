# XMLens

> **状態:** マイルストーン M0 配備済み（[`docs/legal/guard-verification.md`](./docs/legal/guard-verification.md) の捨てブランチによるガード手動検証はメンテナによる未実施タスクとして残存、M1 進行中）— MIT ライセンスのブラウザ完結型 XML 開発・構造可視化ワークベンチ

[English README (README.md)](./README.md)

## 概要

XMLens は、XML 文書の編集・検証・クエリ・変換・比較・構造可視化を行う、インストール不要の静的 Web アプリケーションです。LegalDocML (Akoma Ntoso)、LegalRuleML、CVRF、XLIFF などの XML 仕様を扱う OSS コミュニティや個人利用者を主な対象としています。

全体の計画と現在の実装状況は [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) および [`docs/feature-matrix.md`](./docs/feature-matrix.md) を参照してください。

## プライバシー方針

- **完全ローカル処理:** すべての XML 解析および処理はお使いのブラウザ内で実行されます。
- **アップロードなし・テレメトリなし:** 入力ファイルが端末外へ送信されることはなく、実行時の解析トラッキングや外部 CDN/フォントへの通信も行いません。

## 開発手順

必要環境: Node.js LTS (`>= 22.12.0`) および `npm`。

```bash
npm ci             # package-lock.json に基づき依存関係をインストール
npm run dev        # Vite 開発サーバを起動 (http://localhost:3000)
npm run check      # lint / format:check / typecheck / test / i18n:check / plugins:guard / license:check / notices:check を実行
npm run build      # dist/ に静的プロダクションビルドを出力
npm run preview    # プロダクションビルドをローカルでプレビュー
```

## サブパス配備 (GitHub Pages)

Vite ビルドでは `base: './'` を指定し、静的アセットを相対パスで解決するよう設定しています。そのため、ドメインルート (`/`) だけでなく GitHub Pages のリポジトリサブパス (例: `/xmlens/`) 配下でもそのまま動作します。

## ライセンス

このリポジトリに含まれるオリジナルのソースコードおよびドキュメントは [MIT License](./LICENSE) の下で提供されています。
