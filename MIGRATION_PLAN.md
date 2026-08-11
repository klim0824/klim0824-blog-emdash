# klim0824-blog → EmDash 移行計画

microCMS + Next.js 12(`klim0824-blog`)を EmDash + Astro + Cloudflare Workers/D1(`klim0824-blog-emdash`)へ完全移行する。移行後は microCMS を廃止し EmDash へ一本化する。

- 旧リポジトリ: `~/git/github.com/klim0824/klim0824-blog`
- 新リポジトリ: `~/git/github.com/klim0824/klim0824-blog-emdash`(本ファイルが置かれているリポジトリ)
- 本番ドメイン: `blog.klim0824.dev`(同一ドメインを維持したまま移行)

## 移行元データの実態(microCMS, MCP経由で実データ確認済み)

| エンドポイント | 件数 | 備考 |
|---|---|---|
| `articles` | 9件(2022-03〜2026-01、下書きなし) | 年次振り返り4本、イベントレポート数本、技術記事2本 |
| `categories` | 8件 | Thought / Essay / Trip / Frontend / Backend / Software / Hobby / etc.(フラット、階層なし) |
| `tags` | 16件、**全件アイコン画像あり** | microCMS/React/Next.js/Node.js/TypeScript/JavaScript/Homebrew/Windows/Mac/SourceTree/Git/Tampermonkey/VirtualBox/VSCode/WordPress/Web の実ブランドロゴ。記事詳細ページで実際に表示されている(装飾ではなく実使用) |
| `accounts` | 8件 | Official Website / RSS / GitHub / はてなブックマーク / Twitter / Facebook / Instagram / Tumblr。**`image`フィールドは旧実装で未使用**(アイコンは`public/icons/accounts/*.svg`をidで手動対応づけ)。`color`はホバー時fill色として使用 |
| `meta`(シングルトン) | 1件 | サイトタイトル/URL/description(実質は著者bio)/author(氏名)/author-id(Twitterハンドル用)/author-image |

`pages`相当のエンドポイントは存在せず、旧サイトに`/about`ページ自体が無かった。

### 本文(`content`)の実際の書式

生HTML文字列。実データ2記事分(2022年最古/2025-2026年最新)を確認。

- 見出し: h2〜h4、`id`属性が自動採番(TOC用)
- リスト: `ul`/`ol`が最大3階層までネスト
- コードブロック: `<pre><code>`、**言語指定なし**(旧実装はビルド時に`highlight.js`の`highlightAuto`で自動検出・後付け)
- 太字/斜体/下線/取り消し線: 確認した2記事では**一度も未使用**
- インライン`style`(`color`, `text-align:center`など): 画像・リンク・spanに散発的に使用
- 画像: `alt`はほぼ空文字だが、稀に実際の説明文が入っている例もあり(空と決め打ち不可)
- 埋め込み: Twitter公式oEmbed形式(`<blockquote class="twitter-tweet">`+`<script async src="platform.twitter.com/widgets.js">`)の生HTMLがそのまま挿入されている。**`dangerouslySetInnerHTML`経由だとscriptは実行されないため、旧サイトでは実際にはツイートカードとして表示されていない**(確認できた事実、推測ではない)
- 記事末尾の`<hr>`は本文ではなくテンプレート側UI(シェアボタン上の区切り線)

## EmDash側で判明した重要な仕様

- 投稿には`created_at`/`updated_at`/`published_at`が自動付与されるシステムフィールドがあり、公開日時の設計は基本不要
- taxonomy term(カテゴリ・タグ)は`slug`/`label`/`parentId`/`description`のみを持ち、**画像フィールドは無い**
- リッチエディタはYouTube/Vimeo/Twitterの埋め込みをネイティブPortableTextブロックとしてサポート。加えて変換しきれないHTML用の「HTMLブロック」(サニタイズ付き)がフォールバックとして標準搭載されている(WordPress/Contentfulインポート機能もこれを使う設計)
- `seed.json`は`$media: { url, alt, filename, caption }`で外部URLから画像を自動ダウンロードしR2などのメディアライブラリに登録できる。`applySeed`は冪等
- `seed.json`の`redirects[]`はローカルパス→ローカルパスのみサポート。**外部URLへのリダイレクトは不可**(バリデーションで弾かれる)
- `settings.social`は`twitter`/`github`/`facebook`/`instagram`/`linkedin`/`youtube`の固定スキーマ(任意のリストではない)
- `bylines`は`id`/`slug`/`displayName`/`bio`/`websiteUrl`/`isGuest`を持つが、**アバター画像フィールドは無い**
- コレクションslugの予約語: `content`/`media`/`users`/`revisions`/`taxonomies`/`options`/`audit_logs`

## 確定した設計(grillingセッションで合意)

### URL / ルーティング

- 記事URLは旧サイトと同じ `/articles/{YYYYMMDD}/{slug}` 構造を維持する(EmDash既定の`/posts/{slug}`は不採用)。理由: 技術記事・イベント記事では公開日がURLから判別できることが重要という要件のため
- `posts`コレクションに **`published_date`(date型)をカスタムフィールドとして追加**し、URLの日付部分と表示用の公開日はこのフィールドから組み立てる。EmDashのシステム`published_at`には依存しない(将来の再編集で値が動くリスクを避けるため、また過去日付での上書き可否が未確認のため)
  - 今後新しい記事を書く際も、このフィールドを都度入力する運用になる
- URLの日付部分が実際の`published_date`と食い違うリクエストが来た場合は、正しいURLへ**301リダイレクト**する
- カテゴリ/タグはEmDash既定の`/category/{slug}`・`/tag/{slug}`へ移行。旧`/categories/{id}`(microCMSの`id`をそのままslugとして流用可能)は`seed.json`の`redirects[]`で301リダイレクトする
- `pages`コレクションは廃止する(移行元データが無いため)。`/about`は`src/pages/about.astro`を新規作成し、`Astro.redirect("https://www.klim0824.dev/", 301)`で外部サイトへリダイレクトする(seed.jsonのredirectsは外部URL非対応のため、Astroページとして実装)
- ヘッダーのプライマリメニューから「About」は外す(Home / Posts のみ)。`/about`リダイレクトは、直接踏んだ人向けの保険としてのみ存在させる
- 本番ドメインは`blog.klim0824.dev`を維持し、`settings.url`もこれに合わせる

### コンテンツスキーマ

- `posts`: `title` / `featured_image` / `content`(portableText) / `excerpt` / `published_date`(新規追加)
- カテゴリタクソノミー: `seed.json`のダミー3件(development/design/notes)を、実データの8件(Thought/Essay/Trip/Frontend/Backend/Software/Hobby/etc.)に差し替え。フラットのまま、改名なし
- タグタクソノミー: 実データの16件を移行。**タグに画像フィールドが無いため、`tag_icons`という小さな別コレクション(タグslug + アイコン画像)を新設**し、タグ表示コンポーネントがslugで突き合わせて表示する
- テンプレートのダミーコンテンツ(3カテゴリ・ダミータグ・ダミー投稿7本・ダミーbylines・`sections`・footerのダミー文言)はすべて削除し、実データに置き換える

### サイト設定 / 著者情報

- `settings.title` = 「🐺 射撃しつつ後退」(旧ブログのタイトルをそのまま維持)
- `settings.tagline` は**保留(未決定、TBD)**。プレースホルダー文言のまま残さず、空にしておく
- `settings.logo` に著者写真(旧`meta.author-image`)を設定
- `settings.social`(twitter/github/facebook/instagram)に対応する4件を移行。**はてなブックマーク・Tumblr・公式サイト・RSSは`accounts`ごと廃止**(公式サイトへの導線は`/about`リダイレクトで代替、RSSは`/rss.xml`への通常リンクで十分)
- `bylines`に「くりむ」の1件(`displayName`/`bio`=旧`meta.description`/`websiteUrl`)を追加し、全9記事のbylineとして紐付ける

### サイドバー

- 旧サイトのサイドバーは著者カード+SNSアイコンのみのミニマル構成だったが、**EmDashテンプレート既定のウィジェット群(検索・カテゴリー一覧・タグ一覧・最近の記事・月次アーカイブ)はそのまま活かす**(このテンプレートの核となる設計のため)。そこに著者カード+SNSリンクを追加する形にする

### 本文変換

- HTML→PortableText変換は**スクリプトで実施**。microCMSからMCP(または直接API)で記事を取得 → HTMLをパース → `seed.json`のcontentブロック形式に変換(画像は`$media`でmicroCMSのCDN URLを指定し、EmDash側のメディアライブラリへ実体コピーさせる)→ `applySeed`で流し込む
- インラインの`color`/`text-align`スタイルは変換時に**すべて削除**する(サイトの単一アクセントカラー方針=CLAUDE.mdの「Don't add a second accent colour」に合わせるため)
- Twitterの生oEmbed HTML(現状2箇所で発見、いずれも表示されていない状態)は、**EmDashネイティブのTwitter埋め込みブロックに変換**する(ツイートURLを抽出して復元。現状より確実に改善する)
- コードブロックの言語は**指定しない**(元データに保存されておらず、9記事分を手動で見直す価値は低いと判断)
- 変換できないパターンが出た場合は、EmDashの「HTMLブロック」(サニタイズ付き)にフォールバックできる

### スコープ外(今回は対応しない)

- Google Analytics / GTMの導入は別タスクとして後回し
- 旧Next.jsリポジトリ・Cloudflare Pagesデプロイは、新サイトの本番稼働確認まで放置。**将来的には削除予定**

## 未決事項(TODO)

- [ ] `settings.tagline` の文言(本人が後日決める)

## 次のステップ

1. `seed/seed.json` にカテゴリ8件・タグ16件・`tag_icons`コレクション・`published_date`フィールド・bylines・redirects等を反映
2. 本文変換スクリプトを実装(microCMS MCP → HTML parse → seed content block生成)
3. `src/pages/articles/[date]/[slug].astro` 等のカスタムルーティングを実装
4. `src/pages/about.astro` の外部リダイレクトを実装
5. ローカルD1(`pnpm emdash dev`)で検証してから本番D1に反映
6. 全記事・カテゴリ・タグ・RSS・検索が一通り動作することを確認して移行完了とする
