# AGENTS.md — Atopy Sanctuary 開発ハンドオフ

**目的**: 任意のAIエージェント（Claude Code / Antigravity 等）が本プロジェクトの作業を切れ目なく引き継ぐための運用文書。
**最終更新**: 2026-04-17 / commit `0ecf528`（Batch A UX改善）

---

## 1. プロジェクト概要

- **本番URL**: <https://atopy-sanctuary.com/>（HTTPS・カスタムドメイン）
- **GitHub**: <https://github.com/daishi-creative/atopy-sanctuary>
- **ホスティング**: GitHub Pages（`main` ブランチ自動デプロイ、約1〜2分で反映）
- **DB**: Firebase Firestore（プロジェクト名 `atopy-sanctuary`）
- **API キー注入**: GitHub Actions Secrets の `FIREBASE_API_KEY` を `index.html` の `__FIREBASE_API_KEY__` プレースホルダーに sed 置換（公開リポジトリでも安全）
- **現在の投稿数**: 5件（Tomo・spright・M・だいしすと・ダイシテスト／テスト投稿2件含む）
- **管理画面**: `Ctrl + Shift + A` キーコンボで起動（`?admin` URLパラメータは廃止済み）

## 2. 重要な運用ワークフロー

### ファイル同期パス（**必ず守る**）

3つのコピーが存在するため、編集後は全てに同期する必要がある：

| パス | 役割 |
|---|---|
| `/tmp/atopy-work/` | Claude Code の作業用ステージング |
| `/tmp/atopy-sanctuary/` | git clone（commit/push用） |
| `/Users/ishidahiroki/AIBrain/v2/2nd-Brain/01_プロジェクト/02_LightWork/01_アトピー0プロジェクト/` | 2nd Brain同期コピー（ドキュメント + コード） |

#### 標準フロー（コード変更時）

手順：(1) 好きな作業ディレクトリで編集 → (2) 上記3箇所に同期コピー → (3) `/tmp/atopy-sanctuary/` で commit & push。

```bash
cp <edited> /tmp/atopy-work/
cp <edited> /tmp/atopy-sanctuary/
cp <edited> "/Users/ishidahiroki/AIBrain/v2/2nd-Brain/01_プロジェクト/02_LightWork/01_アトピー0プロジェクト/"
cd /tmp/atopy-sanctuary && git add <files> && git commit -m "..." && git push origin main
```

### ドキュメント更新（コード変更後 **必ず**）

1. `Master_Log.md` の該当セクションに commit hash + 実装内容を追記
2. `memory/project_atopy_sanctuary.md`（Claude Code auto-memory）も更新
3. `Active_Context.md` の「直近の主要実装」を最新化
4. `python3 00_システム/devtools/md_audit.py <file.md>` で検証

## 3. 技術スタック

- **フロントエンド**: Vanilla JS / CSS（ビルド工程なし・直接編集）
- **主要ファイル**: `index.html` / `app.js` / `style.css` / `ogp.png`
- **外部サービス**: Firebase Firestore（リアルタイム同期・`onSnapshot`）
- **デプロイ**: GitHub Actions（`.github/workflows/`）→ GitHub Pages

## 4. 重要なアーキテクチャ規約（リグレッション要注意）

### 4.1 カード展開 z-index 階層

```text
voice-card(5) → card-expand-backdrop(4900) → voice-card.expanded(5000) → handle-history-modal(5100)
```

- **展開時は `openCardExpanded(card)`／閉じる時は `closeExpandedCard(card)`**
- `visualizeHighlight` は**廃止済み**。再導入禁止（他カードの opacity 操作で消失バグの原因）
- `.voice-card.expanded` に必ず `animation: none !important`（floatDrift/floatRise との競合解消）
- `body.mousedown` ハンドラには `.voice-card` と `#card-expand-backdrop` のガード必須

### 4.2 モバイルカード幅

- `max-width: calc(100vw / 3)` に必ずクランプ
- `widthMap` も isMobile 時に同比率でクランプ: `Math.min(baseWidth, Math.floor(window.innerWidth / 3))`

### 4.3 iOS Safari 対応

- `input` は `font-size: 16px`（auto-zoom対策）
- オーバーレイは `height: 100dvh`（キーボード表示時のズレ対策）
- バックドロップには touchend ハンドラ必須（click 非発火の保険）

### 4.4 モデレーション仕様

```text
投稿 → moderateVoice()
  ├─ SENSITIVE_WORDS（死ね/自殺 等・16語）→ status: 'pending'
  ├─ DRUG_KEYWORDS × RESULT_KEYWORDS → status: 'approved' + ※体験談バッジ
  └─ 通常 → status: 'approved'（即座に宇宙に浮かぶ）
```

- `SENSITIVE_WORDS` から `無理`・`嫌だ`・`SHINE` は除外済み（日常語の誤検知対策）
- テスト投稿フィルター: ハンドル/本文に「テスト」を含む投稿は GLOBAL_VOICES から除外（意図した動作）

### 4.5 Xシェア（ディープリンク）

`shareToX(message, handle)` は UA判定で分岐：

- **iOS**: `twitter://post?message=${encodedFull}` → 失敗時 1.5秒後に `window.open(webUrl)`
- **Android**: `intent://post?message=${encodedFull}#Intent;scheme=twitter;package=com.twitter.android;S.browser_fallback_url=${encodedWeb};end`
- **Desktop**: `window.open(webUrl)`

**ハッシュタグ**: `#アトピー #アトピーサンクチュアリ #希望力` を必ず末尾に付与。
**絶対に削除しない**: このiOS/Android分岐は過去に1度リグレッションで削除され復元している。

### 4.6 シェアボタンのイベント伝播

`.share-btn` には必ず 3種のイベントで `stopPropagation()`:

```js
btn.addEventListener('mousedown', (e) => e.stopPropagation());
btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
btn.addEventListener('click', (e) => { e.stopPropagation(); shareToX(message, handle); });
```

未設定だとカードのドラッグ判定に吸われて展開カードが閉じる → ボタンが反応しないバグになる。

### 4.7 タッチ領域（WCAG 2.5.5）

全インタラクティブ要素は `min-width: 44px; min-height: 44px` を厳守（share-btn / close-btn / mode-btn / hamburger 等）。

### 4.8 モバイル北極星バー

モバイル（`@media` の中）では `.polaris-banner { display: none !important }` を**書かない**。代わりに：

```css
body:not(.list-mode) .master-header { position: fixed; top:0; /* ... */ }
body:not(.list-mode) .polaris-banner { display: block !important; /* ... */ }
```

これも過去にリグレッションで消された箇所。

## 5. 最近のコミット履歴（直近5件）

```text
0ecf528 feat: Batch A UX改善 — タッチ領域統一・エラー自動スクロール・二重送信防止・Xアプリ連携
e4559cb fix: 宇宙モード展開カードのシェアボタン不動作・Xアプリディープリンク修正
fb73473 feat: 北極星60文字切り詰め・Xシェアアプリ対応・モバイル北極星表示
48b3a01 fix: カード再クリックで全カード消失バグ修正・モバイルカード幅1/3制限・プロ品質UX総点検
61bd3dc Remove temporary duplicate-cleanup button (cleanup completed)
```

## 6. 次の実装キュー

### Batch B（中優先・UX品質向上）

| # | タスク | 実装指針 |
|---|---|---|
| B1 | マニフェストのアコーディオン化 | `.sacred-manifesto` を `<details>` でラップ、初期は閉じる |
| B2 | 初回訪問オンボーディング | localStorage `onboarded=true` フラグで1回限り。宇宙UIの操作説明ツールチップ |
| B3 | `/privacy.html` 新規ページ | プライバシーポリシー（Firebase利用・匿名保証・削除依頼窓口） |
| B4 | ロードマップ出口戦略の具体化 | 「集めた声の最終活用先」を明記（ロビー活動・書籍化・登壇資料等） |

### Batch C（低優先・スケール対策）

| # | タスク | メモ |
|---|---|---|
| C1 | 共鳴ボタン（わかるリアクション） | Firestore に `resonance_count` フィールド追加 |
| C2 | Firestore セキュリティルール強化 | 現状 open。書き込み・更新の条件整理 |
| C3 | タグ拡張（部位／ライフステージ／期間） | 検索性向上・Phase 2 対応 |
| C4 | レポート機能 | `reports` コレクション追加・通報UI |
| C5 | エコーチェンバー対策 | 北極星の type バランシング（負の声に偏らせない） |
| C6 | STRONG_CLAIMS を自動 pending | 「完治しました」等を手動承認フローへ |
| C7 | 管理パスワード → Firebase Auth 化 | 現状ハードコード |

### 最優先（すぐできる・非実装系）

- **YouTube 概要欄・SNS の URL を `https://atopy-sanctuary.com/` に更新**（5分）

## 7. 既知の設計ギャップ

- `STRONG_CLAIMS`（完治しました等）は `design.md` では自動 `pending` 予定だが、現状 `isMedical=true`（バッジのみ）。投稿増加後に格上げ検討。

## 8. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| `Master_Log.md` | プロジェクト全体ログ（Phase戦略・実装履歴） |
| `design.md` | 初期デザイン設計書（カラー・コンポーネント・アニメーション） |
| `newdesign.md` | 追加デザイン設計 |
| `codecheck0416.md` | 外部UXオーディット結果（Batch A の元ネタ） |
| `memory/project_atopy_sanctuary.md` | Claude Code auto-memory（実装状況サマリ） |

## 9. Antigravity 引き継ぎ時の注意

- **リグレッション常習箇所**（過去に勝手に元に戻された箇所）:
  1. `shareToX` の iOS/Android ディープリンク分岐
  2. モバイル北極星バー固定表示
  3. 免責文「投稿をもって」（「送信をもって」に戻さない）
  4. `voices.json` 移行ボタン（削除済み・再追加しない）
  5. `#admin-status` div（管理画面内インラインメッセージ用・削除しない）

- **index.htmlの自動フォーマット**に注意。エディタ設定で4スペースインデント・トレーリングスペース除去等が効くと diff が巨大化する。フォーマッタを通す場合は既存インデントに合わせる。

- コード修正後は必ず本番URLで動作確認。**型チェックやテストスイートは機能の正しさを保証しない**（このプロジェクトはテストなし・ビルドなし）。
