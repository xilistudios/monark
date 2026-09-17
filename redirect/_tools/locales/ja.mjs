/** 日本語のサイト文案。正典である英語の文字列セット（en.mjs）から翻訳しています。 */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "ja",
		htmlLang: "ja",
		ogLocale: "ja_JP",

		title: "Monark — ゼロ知識のパスワードマネージャー",
		desc: "オープンソースでローカルファーストのパスワードマネージャーです。認証情報は自分の端末だけに保存し、暗号処理は Rust による Argon2id と XChaCha20-Poly1305 で行います。アカウントも同期サーバーもテレメトリもありません。",

		skip: "本文へスキップ",
		nav: {
			features: "機能",
			privacy: "プライバシー",
			terms: "利用規約",
		},
		download: "ダウンロード",
		releases: "最新リリース",
		langLabel: "言語",
		langOther: "他の言語",

		hero: {
			eyebrow: "ローカルファースト · ゼロ知識",
			title: `あなたの鍵を。<br><span class="serif">あなただけに。</span>`,
			lede: "Monark は、認証情報を自分のマシン上に置いておくためのオープンソースのパスワードマネージャーです。アカウントも同期サーバーもテレメトリもなく、あるのは保存されている場所で暗号化された保管庫だけです。",
			ctaPrimary: "Monark をダウンロード",
			ctaSecondary: "ソースコードを読む",
			meta: [
				["対応環境", "Linux、macOS、Windows、Android、iOS"],
				["暗号化方式", "XChaCha20-Poly1305"],
				["鍵導出", "Argon2id · 64 MB"],
				["ライセンス", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "できること",
			title: "パスワードマネージャーがやるべきことはすべて、やるべきでないことは何も。",
			lede: "Monark は、ログイン情報、メモ、ワンタイムコードを、あなたが所有する 1 つの暗号化ファイルに保存します。間に事業者は入りません。そもそも間に事業者がいないからです。",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "保管庫はディスク上のただのファイル",
					body: "エントリは保存先に書き込まれる前に暗号化され、保管庫を開いている間だけ復号されます。Monark は完全にオフラインで動作し、あなたが求めない限りネットワークには触れません。",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "暗号処理は Rust で実装",
					body: "暗号処理の中核は Rust で書かれており、ページ内ではなくネイティブに動作します。",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						['<span class="k">memory</span>', '<span class="v">64 MB · 3 パス</span>'],
						['<span class="k">cipher</span>', '<span class="v">xchacha20-poly1305</span>'],
						['<span class="k">key</span>', '<span class="v">256 ビット</span>'],
						['<span class="k">nonce</span>', '<span class="v">192 ビット、ランダム</span>'],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "パスワード生成",
					body: "パスワードとパスフレーズはオペレーティングシステムの CSPRNG から生成します。使用する文字種と長さは指定できます。",
				},
				{
					icon: "timer",
					span: 2,
					title: "2 段階認証コード",
					body: "TOTP のシークレットは対応するログイン情報の隣に保存でき、現在のコードは保管庫のウィンドウから確認できます。",
				},
				{
					icon: "cloud",
					span: 2,
					title: "任意の暗号化バックアップ",
					body: "保管庫を自分の Google Drive や WebDAV サーバーにコピーできます。ファイルは端末から出る前にすでに暗号化されています。",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "1 つのコードベースで、手元のすべての PC とスマートフォンへ",
					body: "Monark は Tauri v2 で作られているため、同じ Rust のコアとインターフェースを Linux、macOS、Windows、Android、iOS に配布できます。Electron ランタイムを抱え込む必要はありません。",
					terminal: [
						['<span class="k">bundle</span>', '<span class="v">native webview</span>'],
						['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
						['<span class="k">interface</span>', '<span class="v">react 18 · 型付き</span>'],
						['<span class="k">installer</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
					],
				},
			],
		},

		specs: {
			eyebrow: "内部の仕組み",
			title: "パラメータは、そのままの言葉で。",
			lede: "ここに独自仕様はなく、秘密もありません。実際に使っているプリミティブはすべてリポジトリに記載され、テストで検証されています。",
			items: [
				["鍵導出", "メモリ 64 MB、3 回の反復、4 並列の <b>Argon2id</b>。GPU を使った総当たり推測を高コストにします。"],
				["認証付き暗号化", "256 ビット鍵と操作ごとの 192 ビットランダム nonce を用いる <b>XChaCha20-Poly1305</b>（IETF 版）。"],
				["乱数", "鍵、ソルト、nonce はすべてオペレーティングシステムの <b>CSPRNG</b> から取得し、言語の乱数生成器は使いません。"],
				["メモリの衛生管理", "導出した鍵と平文のシークレットは<b>破棄時にゼロ埋め</b>され、解放済みメモリに残りません。"],
				["保存形式", "移動もコピーも削除もできる、ローカルの<b>保管庫ファイル</b> 1 つだけ。クラウド上のコピーも同じ暗号化バイト列です。"],
				["ソース", "<b>AGPL-3.0</b> で公開しています。自分でビルドしても、監査しても、実際に動かしているリビジョンに対して issue を報告してもかまいません。"],
			],
		},

		cta: {
			title: "パスワードを預ける前に、コードを読んでください。",
			body: "Monark は公開リポジトリから配布されており、テスト、暗号パラメータ、リリース成果物が同じ場所にあります。ビルドを検証するか、自分でコンパイルしてください。",
			primary: "最新リリースを入手",
			secondary: "リポジトリを見る",
		},

		footer: {
			brand: "Xilistudios が開発する、ゼロ知識暗号化を採用したオープンソースかつローカルファーストのパスワードマネージャーです。",
			cols: [
				["ドキュメント", [["概要", "index"], ["プライバシーポリシー", "privacy"], ["利用規約", "terms"]]],
				["プロジェクト", [["ソースコード", REPO], ["問題を報告", ISSUES], ["AGPL-3.0 ライセンス", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios。Monark は AGPL-3.0 の下で公開されている自由ソフトウェアです。",
		},

		privacy: {
			title: "プライバシーポリシー",
			desc: "Monark がデータをどう扱うか。ゼロ知識アーキテクチャ、要求する Google Drive のスコープ、順守している限定使用の確約について説明します。",
			updated: "最終更新日：2026 年 9 月 17 日",
			version: "バージョン 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. はじめにとゼロ知識の確約",
					html: `<p><strong>Monark Password Manager</strong>（開発：<strong>Xilistudios</strong>）にとって、プライバシーとデータ主権は設立当初からの原則です。あなたのパスワード、認証情報、メモ、機密文書はあなたのものであり、他の誰のものでもありません。</p>
					<p>Monark は厳格な<strong>ゼロ知識アーキテクチャ</strong>と<strong>ローカルファースト</strong>のモデルで動作します。当方はあなたのデータを収集せず、当方が管理するサーバーに保存することもなく、あなたのパスワードや保管庫のマスター鍵を読み取ったり復号したりする技術的手段を持ちません。暗号処理はすべてあなたの端末上で行われます。</p>`,
				},
				{
					id: "data",
					title: "2. 当方が処理するもの、そして決して処理しないもの",
					html: `<h3>2.1 保管庫の中身 — アクセスできません</h3>
					<p>あなたのパスワード、ユーザー名、URL、セキュアノート、2 段階認証のデータは、あなた自身のハードウェア上に暗号化して保存されます。Xilistudios がこれらを平文で受け取ることはなく、外部サーバーに保存することもありません。</p>
					<h3>2.2 テレメトリとトラッキング</h3>
					<p>Monark には、広告トラッカー、広告識別子、および閲覧行動や個人の特定につながる侵入的な解析機能は含まれていません。</p>`,
				},
				{
					id: "google",
					title: "3. Google API および Google Drive の利用",
					html: `<p>Monark では、あなた個人の Google Drive アカウントに同期したバックアップを保存するかどうかを選べます。これを実現するため、アプリケーションは OAuth で認証し、必要最小限のスコープを 1 つだけ要求します。</p>
					<div class="callout">
						<h4>要求するスコープ：<code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>この権限は、Monark アプリケーション自身が直接作成したファイルとフォルダを、暗号化されたバックアップを保持する目的で作成・閲覧・変更・削除すること<strong>のみ</strong>を許可します。</p>
						<p><strong>Monark は、あなたの Google Drive にすでにある他のファイル、ドキュメント、写真、フォルダにアクセスしたり、読み取ったり、変更したりすることはできません。</strong></p>
					</div>
					<div class="compliance">
						<strong>Google の限定使用（Limited Use）要件への準拠。</strong><br>
						Monark による Google API から受け取った情報の使用および転送は、限定使用要件を含む <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API サービス ユーザーデータ ポリシー</a>に従います。
					</div>
					<h3>3.1 Google データに対する厳格な制限</h3>
					<ul>
						<li><strong>販売・商用利用の禁止：</strong>Google Drive を通じて取得したユーザーデータを、第三者、データブローカー、広告代理店に対して販売、ライセンス供与、取引、譲渡することは一切ありません。</li>
						<li><strong>パーソナライズ広告の禁止：</strong>Google API を通じて取得したデータを、広告の配信、商用プロファイルの作成、リターゲティングに利用することはありません。</li>
						<li><strong>AI 学習の禁止：</strong>Google API を通じて取得したデータを、大規模言語モデル、機械学習システム、人工知能アルゴリズムの学習に利用することは一切ありません。</li>
						<li><strong>人的アクセスの制限：</strong>Xilistudios の従業員および開発者は、あなたの Google Drive に保存された保管庫ファイルに対して人的アクセスを行いません。ただし法令により求められた場合、または技術的なデバッグについてあなたが明示的に同意した場合を除きます。その場合でも、データはエンドツーエンドで強固に暗号化されています。</li>
					</ul>`,
				},
				{
					id: "security",
					title: "4. データの安全性と暗号化",
					html: `<p>バックアップファイルを Google Drive に送信する前に、Monark は Rust のコアで次のプリミティブを用いて鍵を導出し、暗号化します。</p>
					<ul>
						<li><strong>鍵導出（KDF）：</strong>総当たり攻撃と GPU による高速化に耐えるパラメータの <code>Argon2id</code>（メモリ 64 MB、反復 3 回、4 スレッド並列）。</li>
						<li><strong>認証付き共通鍵暗号化：</strong>256 ビット鍵とランダムな 192 ビット nonce を用いる <code>XChaCha20-Poly1305</code>（IETF 版）。</li>
						<li><strong>メモリ保護：</strong>メモリ上の認証情報を安全に消去し（<code>ZeroizeOnDrop</code>）、フォレンジックによる抽出攻撃を防ぎます。</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. 管理、権利、データの削除",
					html: `<p>ユーザーであるあなたは、常に完全な管理権を保持します。</p>
					<ul>
						<li><strong>アクセスと可搬性：</strong>アプリケーションの設定からいつでも保管庫をエクスポートできます。</li>
						<li><strong>バックアップの削除：</strong>Monark の画面から、またはご自身の Google Drive 内の Monark フォルダを削除することで、バックアップファイルを消去できます。</li>
						<li><strong>権限の取り消し：</strong>Google の公式な権限ページ <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a> で、Monark の Google アカウントへのアクセスをいつでも取り消せます。</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. 第三者サイトへのリンク",
					html: `<p>Monark は、Google Drive、Nextcloud、WebDAV サーバーなどの外部ストレージサービスとの任意の連携を提供する場合があります。これらのサービスとのやり取りには、それぞれの提供者のプライバシーポリシーおよび利用規約が適用されます。</p>`,
				},
				{
					id: "changes",
					title: "7. 本ポリシーの変更",
					html: `<p>当方は、アプリケーションの改善、新機能、法規制上の要請を反映するため、本プライバシーポリシーを更新する権利を留保します。重要な変更を行う場合は、新しい発効日を付した更新版を本サイトで公開します。</p>`,
				},
				{
					id: "contact",
					title: "8. お問い合わせ",
					html: `<p>本プライバシーポリシーまたは Monark のセキュリティ慣行についてご質問がある場合は、公式の GitHub リポジトリを通じて Xilistudios の開発チームにご連絡いただけます。</p>
					<p><strong>Xilistudios</strong><br>リポジトリとサポート：<a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},

		terms: {
			title: "利用規約",
			desc: "Monark の利用条件。AGPL-3.0 によるライセンス、ゼロ知識モデルの限界、第三者ストレージ、および保証の免責について定めます。",
			updated: "最終更新日：2026 年 9 月 17 日",
			version: "バージョン 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. 本規約への同意",
					html: `<p><strong>Monark Password Manager</strong> をインストールし、実行し、またはその他の方法で使用することにより、あなたは本利用規約に同意したものとみなされます。同意しない場合は、本アプリケーションを使用しないでください。</p>`,
				},
				{
					id: "license",
					title: "2. ソフトウェアの性質とライセンス",
					html: `<p>Monark は、ローカルファーストかつオープンソースの認証情報・パスワード管理アプリケーションです。</p>
					<p>ソースコードは <strong>GNU Affero General Public License version 3.0（AGPL-3.0）</strong>の条件で配布されています。あなたは同ライセンスの条件に従い、コードを自由に閲覧、監査、改変、再配布できます。ライセンス全文は、プロジェクトの公式 GitHub リポジトリで入手できます。</p>`,
				},
				{
					id: "responsibility",
					title: "3. ユーザーの責任とゼロ知識モデル",
					html: `<div class="callout callout--warn">
						<h4>マスターパスワードに関する重要なお知らせ</h4>
						<p>Monark は<strong>ゼロ知識</strong>の暗号モデルで動作します。あなたのデータは、マスターパスワードとそこから導出された鍵（Argon2id および XChaCha20-Poly1305）を使って、あなた自身の端末上で暗号化されます。</p>
						<p><strong>Xilistudios はあなたのマスターパスワードを保存しておらず、把握してもおらず、いかなる状況でも再設定できません。マスターパスワードを忘れ、リカバリーキーやバックアップも持っていない場合、あなたのデータを復元することはできません。</strong></p>
					</div>
					<p>次の事項は、あなただけの責任です。</p>
					<ul>
						<li>強力なマスターパスワードを選び、安全に管理すること。</li>
						<li>データとリカバリーキーのバックアップを作成し、保管すること。</li>
						<li>Monark をインストールした端末の物理的および論理的な安全性を維持すること。</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. 第三者サービス（Google Drive）との連携",
					html: `<p>Monark は、第三者が提供するクラウドストレージとの任意の同期に対応しています。特に <strong>Google Drive</strong> とは OAuth 認証を通じて連携します。</p>
					<ul>
						<li>Google Drive の利用には <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Google の利用規約</a>が適用されます。</li>
						<li>Monark は、アプリケーション自身が生成したバックアップファイル（<code>drive.file</code> スコープ）を管理するためのアクセスのみを要求します。これらのファイルは送信前にエンドツーエンドで暗号化されます。</li>
						<li>第三者のクラウド提供者による接続障害、サービス停止、保存容量の制限について、Xilistudios は責任を負いません。</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. 利用の範囲",
					html: `<p>あなたは Monark を適法な目的にのみ使用することに同意します。本ソフトウェアを次の目的で使用することは固く禁じます。</p>
					<ul>
						<li>違法に、または権限なく取得した認証情報を保存、管理、配布すること。</li>
						<li>あなたが所有していない第三者サービスやシステムのセキュリティ対策を突破、無効化、回避しようとすること。</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. 保証の否認",
					html: `<p>適用法が認める最大限の範囲において、本ソフトウェアは<strong>「現状有姿」</strong>かつ<strong>「提供可能な範囲」</strong>で提供され、明示か黙示かを問わずいかなる保証も伴いません。これには、商品性、特定目的への適合性、権利非侵害に関する黙示の保証が含まれますが、これらに限られません。</p>
					<p>当方は品質、安全性、テストの水準を高く保つよう努めていますが、Xilistudios は、本アプリケーションが中断なく動作すること、誤りがまったくないこと、あらゆるハードウェアやソフトウェア構成と互換性があることを保証しません。</p>`,
				},
				{
					id: "liability",
					title: "7. 責任の制限",
					html: `<p>いかなる場合も、Xilistudios、その開発者または貢献者は、本アプリケーションの使用または使用不能から生じる直接的、間接的、偶発的、特別、結果的または懲罰的な損害について責任を負いません。これには、逸失利益、データの損失、事業の中断、コンピュータの故障が含まれます。</p>`,
				},
				{
					id: "modifications",
					title: "8. 本規約の変更",
					html: `<p>Xilistudios は、本利用規約をいつでも変更または更新する権利を留保します。最終改訂日は本ページ上部に反映されます。変更の公開後も本アプリケーションの使用を続けることは、新しい規約への同意を意味します。</p>`,
				},
				{
					id: "contact",
					title: "9. お問い合わせ",
					html: `<p>本利用規約に関するご質問やご要望は、公式の窓口を通じて Xilistudios チームまでご連絡ください。</p>
					<p><strong>Xilistudios</strong><br>プロジェクトリポジトリ：<a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>報告とサポート：<a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},

		oauth: {
			title: "認証を完了します",
			desc: "Monark Password Manager との認証を完了します。",
			working: "認証中…",
			workingBody: "Monark との認証を完了しています。しばらくお待ちください。",
			statusPending: "OAuth の応答を処理しています",
			statusOk: "認証に成功しました",
			successTitle: "認証に成功しました",
			successBody: "下の認証情報をコピーして、Monark アプリケーション内でサインインを完了してください。",
			copyHeading: "認証情報をコピー",
			copyBody: "この認証情報をコピーし、Monark に貼り付けて同期の設定を完了してください。",
			copyButton: "認証情報を Base64 でコピー",
			copied: "認証情報をコピーしました。Monark に貼り付けてください。",
			copyFailed: "認証情報をコピーできませんでした。もう一度お試しください。",
			encodeFailed: "認証情報の準備中に問題が発生しました。",
			instructions: "手順",
			steps: [
				"上の「認証情報をコピー」をクリックします。",
				"Monark アプリケーションに戻ります。",
				'認証ウィンドウで「Paste Base64 credentials」をクリックします。',
				'内容を貼り付け、「Import and authenticate」をクリックします。',
			],
			closable: "認証情報をコピーしたら、このウィンドウを閉じてかまいません。",
			errorTitle: "認証に失敗しました",
			errorBody: "認可の処理中にエラーが発生しました。",
			invalidTitle: "応答が不正です",
			invalidBody: "必要なパラメータ（code または state）が不足しています。",
			unknownError: "不明なエラー",
			closeWindow: "ウィンドウを閉じる",
			home: "ホーム",
		},

		notFound: {
			title: "ページが見つかりません",
			desc: "お探しのページは本サイトに存在しません。",
			body: "アドレスが間違っているか、ページが移動した可能性があります。概要から始めるか、法的文書をご覧ください。",
			back: "概要へ移動",
		},
	};