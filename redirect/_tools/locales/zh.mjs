/** 目标语言文案（简体中文）。由 en.mjs 这一权威英文文案集翻译而来。 */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "zh",
		htmlLang: "zh-Hans",
		ogLocale: "zh_CN",

		title: "Monark — 零知识密码管理器",
		desc: "开源、本地优先的密码管理器：密码、笔记和一次性验证码都存在你自己的设备上，由 Rust 实现的 Argon2id 与 XChaCha20-Poly1305 加密保护，无需联网即可使用。没有账号，没有同步服务器，没有遥测，密钥始终只属于你，任何厂商都无法读取。",

		skip: "跳到主要内容",
		nav: {
			features: "功能",
			privacy: "隐私政策",
			terms: "服务条款",
		},
		download: "下载",
		releases: "最新版本",
		langLabel: "语言",
		langOther: "其他语言",

		hero: {
			eyebrow: "本地优先 · 零知识",
			title: `你的密钥。<br><span class="serif">只属于你。</span>`,
			lede: "Monark 是一款开源密码管理器，把所有凭据保存在你自己的设备上。没有账号，没有同步服务器，没有遥测——只有一个在本地完成加密的保险库。",
			ctaPrimary: "下载 Monark",
			ctaSecondary: "阅读源码",
			meta: [
				["运行平台", "Linux、macOS、Windows、Android、iOS"],
				["加密算法", "XChaCha20-Poly1305"],
				["密钥派生", "Argon2id · 64 MB"],
				["许可证", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "它能做什么",
			title: "密码管理器该做的事，它全都做；不该做的事，它一件都不做。",
			lede: "Monark 把登录信息、笔记和一次性验证码存进一个属于你的加密文件。中间没有厂商，因为中间本来就不该有厂商。",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "你的保险库只是磁盘上的一个文件",
					body: "条目在写入存储之前就已加密，只有在你打开保险库时才会解密。Monark 可以完全离线工作；除非你主动要求，否则它不会碰网络。",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "加密逻辑用 Rust 写成",
					body: "加密核心以 Rust 实现并原生运行，不在页面里跑。",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						[
							'<span class="k">memory</span>',
							'<span class="v">64 MB · 3 轮</span>',
						],
						[
							'<span class="k">cipher</span>',
							'<span class="v">xchacha20-poly1305</span>',
						],
						['<span class="k">key</span>', '<span class="v">256 位</span>'],
						[
							'<span class="k">nonce</span>',
							'<span class="v">192 位，随机</span>',
						],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "密码生成器",
					body: "密码和口令由操作系统的 CSPRNG 生成，字符集与长度都由你决定。",
				},
				{
					icon: "timer",
					span: 2,
					title: "两步验证码",
					body: "把 TOTP 密钥和它对应的登录信息存在一起，在保险库窗口中直接读取当前验证码。",
				},
				{
					icon: "cloud",
					span: 2,
					title: "可选的加密备份",
					body: "把保险库复制到你自己的 Google Drive 或 WebDAV 服务器。文件在离开设备之前就已经是加密状态。",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "一套代码，覆盖你所有的电脑和手机",
					body: "Monark 基于 Tauri v2 构建，同一个 Rust 核心和界面可以发布到 Linux、macOS、Windows、Android 和 iOS，且不必附带 Electron 运行时。",
					terminal: [
						[
							'<span class="k">bundle</span>',
							'<span class="v">native webview</span>',
						],
						[
							'<span class="k">runtime</span>',
							'<span class="v">tauri v2 · rust</span>',
						],
						[
							'<span class="k">interface</span>',
							'<span class="v">react 18 · 类型化</span>',
						],
						[
							'<span class="k">installer</span>',
							'<span class="v">.deb .rpm .dmg .msi .apk</span>',
						],
					],
				},
			],
		},

		specs: {
			eyebrow: "技术细节",
			title: "把参数明明白白写出来。",
			lede: "这里没有任何专有内容，也没有任何秘密。所有算法原语都记录在代码仓库里，并有测试覆盖。",
			items: [
				["密钥派生", "<b>Argon2id</b>，64 MB 内存、3 轮迭代、4 路并行，让借助 GPU 的猜测变得昂贵。"],
				["认证加密", "<b>XChaCha20-Poly1305</b>（IETF 版本），256 位密钥，每次操作使用 192 位随机 nonce。"],
				["随机性", "所有密钥、盐值和 nonce 都来自操作系统的 <b>CSPRNG</b>，绝不使用语言自带的随机数生成器。"],
				["内存卫生", "派生密钥和明文机密在<b>离开作用域时归零</b>，不会残留在已释放的内存中。"],
				["存储", "只有一个本地<b>保险库文件</b>，你可以随意移动、复制或删除。云端副本是同一份加密字节。"],
				["源码", "以 <b>AGPL-3.0</b> 授权。你可以自行编译、审计，或针对你实际运行的版本提交 issue。"],
			],
		},

		cta: {
			title: "在把密码交给它之前，先读一读代码。",
			body: "Monark 发布自一个公开仓库，测试、加密参数和发布产物都放在同一个地方。你可以校验构建结果，也可以自己编译。",
			primary: "获取最新版本",
			secondary: "查看仓库",
		},

		footer: {
			brand: "由 Xilistudios 打造的开源、本地优先密码管理器，采用零知识加密。",
			cols: [
				["文档", [["概览", "index"], ["隐私政策", "privacy"], ["服务条款", "terms"]]],
				["项目", [["源代码", REPO], ["报告问题", ISSUES], ["AGPL-3.0 许可证", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios。Monark 是 AGPL-3.0 下的自由软件。",
		},

		privacy: {
			title: "隐私政策",
			desc: "Monark 如何处理数据：零知识架构、申请的 Google Drive 权限范围，以及所遵守的有限使用承诺。",
			updated: "最后更新：2026 年 9 月 17 日",
			version: "版本 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. 引言与零知识承诺",
					html: `<p><strong>Monark Password Manager</strong>（由 <strong>Xilistudios</strong> 开发）以隐私和数据主权为立身之本。你的密码、凭据、笔记和机密文件只属于你本人，不属于任何其他一方。</p>
					<p>Monark 严格遵循<strong>零知识架构</strong>与<strong>本地优先</strong>模式。我们不收集你的数据，不将其存储在我们控制的服务器上，也不具备任何读取或解密你的密码及保险库主密钥的技术手段。所有加密运算都在你的设备上完成。</p>`,
				},
				{
					id: "data",
					title: "2. 我们处理什么，以及我们绝不处理什么",
					html: `<h3>2.1 保险库内容——无从访问</h3>
					<p>你的密码、用户名、网址、安全笔记和两步验证数据均以加密形式存储在你自己的硬件上。Xilistudios 从不会以明文形式接收这些数据，也从不将其存储在外部服务器上。</p>
					<h3>2.2 遥测与追踪</h3>
					<p>Monark 不包含任何广告追踪器、广告标识符，也不包含记录你浏览行为或个人身份的侵入式分析组件。</p>`,
				},
				{
					id: "google",
					title: "3. Google API 与 Google Drive 的使用",
					html: `<p>Monark 允许你选择将备份同步保存到你个人的 Google Drive 帐户中。为实现这一功能，应用程序通过 OAuth 完成身份验证，并且只申请一个必要的最小权限范围：</p>
					<div class="callout">
						<h4>申请的权限范围：<code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>该权限<strong>仅</strong>允许 Monark 创建、查看、修改和删除由 Monark 应用程序本身直接创建的文件与文件夹，用于存放你的加密备份。</p>
						<p><strong>Monark 无法访问、读取或修改你 Google Drive 中已有的任何其他文件、文档、照片或文件夹。</strong></p>
					</div>
					<div class="compliance">
						<strong>符合 Google 有限使用（Limited Use）要求。</strong><br>
						Monark 对从 Google API 获取的信息的使用与传输，遵守 <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API 服务用户数据政策</a>，包括其中的有限使用要求。
					</div>
					<h3>3.1 对 Google 数据的严格限制</h3>
					<ul>
						<li><strong>不得出售或商业化：</strong>我们绝不会将通过 Google Drive 获得的用户数据出售、许可、交易或转让给第三方、数据经纪商或广告机构。</li>
						<li><strong>不得用于个性化广告：</strong>通过 Google API 获得的任何数据都不会用于投放广告、构建商业画像或对你进行再营销。</li>
						<li><strong>不得用于 AI 训练：</strong>通过 Google API 获得的数据绝不会用于训练大语言模型、机器学习系统或人工智能算法。</li>
						<li><strong>严格限制人工访问：</strong>Xilistudios 的任何员工或开发者均无权人工访问存储在你 Google Drive 中的保险库文件，法律强制要求或你为技术排障而明确同意的情形除外；即便如此，相关数据也经过端到端强加密。</li>
					</ul>`,
				},
				{
					id: "security",
					title: "4. 数据安全与加密",
					html: `<p>在把任何备份文件传输到你的 Google Drive 之前，Monark 会在安全的 Rust 核心中采用业界通行的加密标准：</p>
					<ul>
						<li><strong>密钥派生（KDF）：</strong><code>Argon2id</code>，参数足以抵御暴力破解和 GPU 加速攻击（64 MB 内存、3 轮迭代、4 线程并行）。</li>
						<li><strong>认证对称加密：</strong><code>XChaCha20-Poly1305</code>（IETF 变体），256 位密钥与随机 192 位 nonce。</li>
						<li><strong>内存保护：</strong>对内存中的凭据进行安全擦除（<code>ZeroizeOnDrop</code>），以防取证式提取攻击。</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. 控制权、权利与数据删除",
					html: `<p>作为用户，你始终拥有完全的控制权：</p>
					<ul>
						<li><strong>访问与可移植性：</strong>你可以随时在应用设置中导出保险库。</li>
						<li><strong>删除备份：</strong>在 Monark 内删除备份文件，或直接删除你自己 Google Drive 存储空间中的 Monark 文件夹。</li>
						<li><strong>撤销授权：</strong>你可以随时在 Google 的官方权限页面撤销 Monark 对你 Google 帐户的访问权限：<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>。</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. 第三方网站链接",
					html: `<p>Monark 可能提供与 Google Drive、Nextcloud 或 WebDAV 服务器等外部存储服务的可选集成。你与这些服务的交互，受相应服务提供商的隐私政策和服务条款约束。</p>`,
				},
				{
					id: "changes",
					title: "7. 本政策的变更",
					html: `<p>我们保留更新本隐私政策的权利，以反映应用程序的改进、新增功能或监管要求。如发生重大变更，我们会在本网站发布更新后的版本，并注明新的生效日期。</p>`,
				},
				{
					id: "contact",
					title: "8. 联系方式",
					html: `<p>如果你对本隐私政策或 Monark 的安全实践有疑问，可以通过我们的官方 GitHub 仓库联系 Xilistudios 开发团队。</p>
					<p><strong>Xilistudios</strong><br>仓库与支持：<a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},

		terms: {
			title: "服务条款",
			desc: "规范 Monark 使用行为的条款：AGPL-3.0 授权、零知识模式的局限、第三方存储，以及保证责任的免除。",
			updated: "最后更新：2026 年 9 月 17 日",
			version: "版本 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. 条款的接受",
					html: `<p>安装、运行或以其他方式使用 <strong>Monark Password Manager</strong>，即表示你同意本服务条款。如不接受，请勿使用本应用程序。</p>`,
				},
				{
					id: "license",
					title: "2. 软件性质与许可",
					html: `<p>Monark 是一款本地优先的开源凭据与密码管理应用程序。</p>
					<p>源代码依据 <strong>GNU Affero 通用公共许可证第 3 版（AGPL-3.0）</strong>发布。你可以在该许可证条款允许的范围内自由查看、审计、修改和再分发代码。完整许可证文本可在项目官方 GitHub 仓库中查阅。</p>`,
				},
				{
					id: "responsibility",
					title: "3. 用户责任与零知识模式",
					html: `<div class="callout callout--warn">
						<h4>关于主密码的重要提示</h4>
						<p>Monark 采用<strong>零知识</strong>加密模式。你的数据在你的设备上使用主密码及派生密钥（Argon2id 与 XChaCha20-Poly1305）加密。</p>
						<p><strong>Xilistudios 不存储、不知晓，也无在任何情况下重置你的主密码的能力。如果你忘记主密码，且没有恢复密钥或备份，你的数据将无法找回。</strong></p>
					</div>
					<p>以下事项由你独自负责：</p>
					<ul>
						<li>选择高强度主密码并妥善保管。</li>
						<li>生成并留存数据备份与恢复密钥。</li>
						<li>维护安装 Monark 的设备的物理安全与逻辑安全。</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. 与第三方服务的集成（Google Drive）",
					html: `<p>Monark 支持与第三方提供的云存储进行可选同步，尤其是通过 OAuth 身份验证接入的 <strong>Google Drive</strong>。</p>
					<ul>
						<li>使用 Google Drive 须遵守 <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Google 服务条款</a>。</li>
						<li>Monark 仅申请管理由本应用程序自身生成的备份文件（<code>drive.file</code> 权限范围），这些文件在发送前已进行端到端加密。</li>
						<li>对于第三方云服务提供商造成的连接故障、服务中断或存储空间限制，Xilistudios 不承担责任。</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. 可接受的使用方式",
					html: `<p>你同意仅为合法目的使用 Monark。严禁将本软件用于：</p>
					<ul>
						<li>存储、管理或分发以非法手段或未经授权获得的凭据。</li>
						<li>试图突破、停用或规避你不拥有所有权的第三方服务或系统的安全措施。</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. 保证责任的免除",
					html: `<p>在适用法律允许的最大范围内，本软件按<strong>“现状”</strong>和<strong>“现有可用状态”</strong>提供，不附带任何明示或默示的保证，包括但不限于对适销性、特定用途适用性或非侵权的默示保证。</p>
					<p>尽管我们力求维持高质量、高安全性和充分测试的标准，Xilistudios 并不保证本应用程序的运行不中断、完全无错误，或与所有硬件和软件配置兼容。</p>`,
				},
				{
					id: "liability",
					title: "7. 责任限制",
					html: `<p>在任何情况下，Xilistudios 及其开发者或贡献者均不对因使用或无法使用本应用程序而产生的直接、间接、附带、特殊、后果性或惩罚性损害承担责任，包括利润损失、数据丢失、业务中断或计算机故障。</p>`,
				},
				{
					id: "modifications",
					title: "8. 本条款的修改",
					html: `<p>Xilistudios 保留随时修改或更新本服务条款的权利。最后修订日期将在本页顶部更新。任何变更发布后你继续使用本应用程序，即构成对新条款的接受。</p>`,
				},
				{
					id: "contact",
					title: "9. 联系方式",
					html: `<p>如对本服务条款有任何疑问或请求，请通过官方渠道联系 Xilistudios 团队：</p>
					<p><strong>Xilistudios</strong><br>项目仓库：<a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>问题反馈与支持：<a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},

		oauth: {
			title: "正在完成验证",
			desc: "正在完成与 Monark Password Manager 的身份验证。",
			working: "正在验证…",
			workingBody: "请稍候，我们正在完成你与 Monark 的身份验证。",
			statusPending: "正在处理 OAuth 响应",
			statusOk: "验证成功",
			successTitle: "验证成功",
			successBody: "请在 Monark 应用程序内复制下方凭据，以完成登录。",
			copyHeading: "复制凭据",
			copyBody: "复制这些凭据并粘贴到 Monark 中，即可完成同步设置。",
			copyButton: "以 Base64 复制凭据",
			copied: "凭据已复制。请粘贴到 Monark 中。",
			copyFailed: "无法复制凭据，请重试。",
			encodeFailed: "准备凭据时出错。",
			instructions: "操作说明",
			steps: [
				"点击上方的“复制凭据”。",
				"返回 Monark 应用程序。",
				'在验证窗口中点击 "Paste Base64 credentials"。',
				'粘贴内容后点击 "Import and authenticate"。',
			],
			closable: "凭据复制完成后，你可以关闭此窗口。",
			errorTitle: "验证失败",
			errorBody: "授权过程中发生错误。",
			invalidTitle: "响应无效",
			invalidBody: "缺少必需参数（code 或 state）。",
			unknownError: "未知错误",
			closeWindow: "关闭窗口",
			home: "首页",
		},

		notFound: {
			title: "页面未找到",
			desc: "你请求的页面在本站不存在。",
			body: "可能是地址输入有误，或该页面已被移动。你可以从概览页开始，或浏览法律文档。",
			back: "前往概览页",
		},
};
