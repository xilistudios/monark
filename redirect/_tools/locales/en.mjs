/** Source copy (English). This is the canonical string set other locales are translated from. */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "en",
		htmlLang: "en",
		ogLocale: "en_US",

		title: "Monark — Zero-knowledge password manager",
		desc: "Open-source, local-first password manager. Argon2id and XChaCha20-Poly1305 in Rust. No accounts, no servers, no telemetry.",

		skip: "Skip to content",
		nav: {
			features: "Features",
			privacy: "Privacy",
			terms: "Terms",
		},
		download: "Download",
		releases: "Latest release",
		langLabel: "Language",
		langOther: "Other languages",

		hero: {
			eyebrow: "Local-first · Zero-knowledge",
			title: `Your keys.<br><span class="serif">Only yours.</span>`,
			lede: "Monark is an open-source password manager that keeps your credentials on your own machine. No account, no sync server, no telemetry — just a vault encrypted where it lives.",
			ctaPrimary: "Download Monark",
			ctaSecondary: "Read the source",
			meta: [
				["Runs on", "Linux, macOS, Windows, Android, iOS"],
				["Cipher", "XChaCha20-Poly1305"],
				["Key derivation", "Argon2id · 64 MB"],
				["License", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "What it does",
			title: "Everything a password manager should do, and nothing it shouldn't.",
			lede: "Monark stores logins, notes and one-time codes in a single encrypted file you own. There is no vendor in the middle, because there is no vendor in the middle.",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "Your vault is a file on your disk",
					body: "Entries are encrypted before they touch storage and decrypted only while you have the vault open. Monark works fully offline; the network is never involved unless you ask it to be.",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "Crypto done in Rust",
					body: "The cryptographic core is written in Rust and runs natively, not in the page.",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						['<span class="k">memory</span>', '<span class="v">64 MB · 3 passes</span>'],
						['<span class="k">cipher</span>', '<span class="v">xchacha20-poly1305</span>'],
						['<span class="k">key</span>', '<span class="v">256-bit</span>'],
						['<span class="k">nonce</span>', '<span class="v">192-bit, random</span>'],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "Password generator",
					body: "Passwords and passphrases drawn from the operating system's CSPRNG, with the character sets and length you choose.",
				},
				{
					icon: "timer",
					span: 2,
					title: "Two-factor codes",
					body: "Store TOTP secrets next to the login they belong to and read the current code from the vault window.",
				},
				{
					icon: "cloud",
					span: 2,
					title: "Optional encrypted backup",
					body: "Copy the vault to your own Google Drive or a WebDAV server. The file is already encrypted before it leaves your device.",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "One codebase, every desktop and phone you own",
					body: "Monark is built on Tauri v2, so the same Rust core and interface ship to Linux, macOS, Windows, Android and iOS without an Electron runtime in tow.",
					terminal: [
						['<span class="k">bundle</span>', '<span class="v">native webview</span>'],
						['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
						['<span class="k">interface</span>', '<span class="v">react 18 · typed</span>'],
						['<span class="k">installer</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
					],
				},
			],
		},

		specs: {
			eyebrow: "Under the hood",
			title: "The parameters, in plain writing.",
			lede: "Nothing here is proprietary and nothing is secret. The exact primitives are documented in the repository and covered by tests.",
			items: [
				["Key derivation", "<b>Argon2id</b> with 64 MB of memory, 3 iterations and 4-way parallelism, to make GPU-assisted guessing expensive."],
				["Authenticated encryption", "<b>XChaCha20-Poly1305</b> (IETF) with 256-bit keys and 192-bit random nonces per operation."],
				["Randomness", "Every key, salt and nonce comes from the operating system's <b>CSPRNG</b>, never from a language-level generator."],
				["Memory hygiene", "Derived keys and plaintext secrets are <b>zeroized on drop</b>, so they do not linger in freed memory."],
				["Storage", "A single local <b>vault file</b> you can move, copy or delete. Cloud copies are the same encrypted bytes."],
				["Source", "Licensed <b>AGPL-3.0</b>. Build it yourself, audit it, or file an issue against the exact revision you run."],
			],
		},

		cta: {
			title: "Read the code before you trust it with your passwords.",
			body: "Monark ships from an open repository with its tests, cryptographic parameters and release artifacts in the same place. Verify the build, or compile it yourself.",
			primary: "Get the latest release",
			secondary: "View the repository",
		},

		footer: {
			brand: "An open-source, local-first password manager with zero-knowledge encryption, built by Xilistudios.",
			cols: [
				["Documents", [["Overview", "index"], ["Privacy Policy", "privacy"], ["Terms of Service", "terms"]]],
				["Project", [["Source code", REPO], ["Report an issue", ISSUES], ["AGPL-3.0 license", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios. Monark is free software under the AGPL-3.0.",
		},

		privacy: {
			title: "Privacy Policy",
			desc: "How Monark handles data: zero-knowledge architecture, the Google Drive scope it requests, and the Limited Use commitments it complies with.",
			updated: "Last updated: 17 September 2026",
			version: "Version 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. Introduction and zero-knowledge commitment",
					html: `<p>At <strong>Monark Password Manager</strong> (developed by <strong>Xilistudios</strong>), privacy and data sovereignty are founding principles. Your passwords, credentials, notes and confidential documents belong to you and to nobody else.</p>
					<p>Monark operates under a strict <strong>zero-knowledge architecture</strong> and a <strong>local-first</strong> model. We do not collect your data, we do not store it on servers we control, and we have no technical means of reading or decrypting your passwords or your vault's master key. All cryptographic work happens on your device.</p>`,
				},
				{
					id: "data",
					title: "2. What we process, and what we never process",
					html: `<h3>2.1 Vault contents — no access</h3>
					<p>Your passwords, usernames, URLs, secure notes and two-factor authentication data are stored encrypted on your own hardware. Xilistudios never receives them in plaintext and never stores them on external servers.</p>
					<h3>2.2 Telemetry and tracking</h3>
					<p>Monark contains no advertising trackers, no advertising identifiers and no invasive analytics that record your browsing behaviour or personal identity.</p>`,
				},
				{
					id: "google",
					title: "3. Use of the Google API and Google Drive",
					html: `<p>Monark gives you the option of keeping a synchronised backup in your own personal Google Drive account. To make this possible the application authenticates over OAuth and requests only the single, minimal scope required:</p>
					<div class="callout">
						<h4>Scope requested: <code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>This permission <strong>only</strong> allows Monark to create, view, modify and delete the files and folders created directly by the Monark application itself, in order to hold your encrypted backup.</p>
						<p><strong>Monark cannot access, read or modify any other file, document, photo or folder already present in your Google Drive.</strong></p>
					</div>
					<div class="compliance">
						<strong>Compliance with Google's Limited Use requirements.</strong><br>
						Monark's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.
					</div>
					<h3>3.1 Strict restrictions on Google data</h3>
					<ul>
						<li><strong>No sale or commercialisation:</strong> we never sell, licence, trade or transfer user data obtained through Google Drive to third parties, data brokers or advertising agencies.</li>
						<li><strong>No personalised advertising:</strong> no data obtained through Google APIs is used to serve ads, build commercial profiles or retarget you.</li>
						<li><strong>No AI training:</strong> data obtained through Google APIs is never used to train large language models, machine-learning systems or artificial-intelligence algorithms.</li>
						<li><strong>Restricted human access:</strong> no employee or developer of Xilistudios has human access to the vault files stored in your Google Drive, except where legally compelled or where you explicitly consent for technical debugging — and even then the data is strongly encrypted end to end.</li>
					</ul>`,
				},
				{
					id: "security",
					title: "4. Data security and encryption",
					html: `<p>Before any backup file is transmitted to your Google Drive, Monark derives and encrypts it in the Rust core using the following primitives:</p>
					<ul>
						<li><strong>Key derivation (KDF):</strong> <code>Argon2id</code> with parameters resistant to brute force and GPU acceleration (64 MB memory, 3 iterations, 4-thread parallelism).</li>
						<li><strong>Authenticated symmetric encryption:</strong> <code>XChaCha20-Poly1305</code> (IETF variant) with 256-bit keys and random 192-bit nonces.</li>
						<li><strong>Memory protection:</strong> secure erasure of in-memory credentials (<code>ZeroizeOnDrop</code>) to prevent forensic extraction attacks.</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. Control, rights and data deletion",
					html: `<p>As a user you keep absolute control at all times:</p>
					<ul>
						<li><strong>Access and portability:</strong> export your vault at any time from the application settings.</li>
						<li><strong>Deleting backups:</strong> remove backup files from within Monark, or by deleting the Monark folder in your own Google Drive storage.</li>
						<li><strong>Revoking permissions:</strong> revoke Monark's access to your Google account at any time on Google's official permissions page: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. Links to third-party sites",
					html: `<p>Monark may offer optional integration with external storage services such as Google Drive, Nextcloud or WebDAV servers. Your interaction with those services is governed by the respective provider's privacy policy and terms of service.</p>`,
				},
				{
					id: "changes",
					title: "7. Changes to this policy",
					html: `<p>We reserve the right to update this Privacy Policy to reflect improvements to the application, new features or regulatory requirements. For substantial changes we will publish the updated version on this site with a new effective date.</p>`,
				},
				{
					id: "contact",
					title: "8. Contact",
					html: `<p>If you have questions about this Privacy Policy or about Monark's security practices, you can reach the Xilistudios development team through our official GitHub repository.</p>
					<p><strong>Xilistudios</strong><br>Repository and support: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},

		terms: {
			title: "Terms of Service",
			desc: "The terms governing use of Monark: AGPL-3.0 licensing, the limits of the zero-knowledge model, third-party storage and warranty exclusions.",
			updated: "Last updated: 17 September 2026",
			version: "Version 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. Acceptance of these terms",
					html: `<p>By installing, running or otherwise using <strong>Monark Password Manager</strong>, you agree to these Terms of Service. If you do not accept them, do not use the application.</p>`,
				},
				{
					id: "license",
					title: "2. Nature of the software and licence",
					html: `<p>Monark is a local-first, open-source credential and password management application.</p>
					<p>The source code is distributed under the terms of the <strong>GNU Affero General Public License version 3.0 (AGPL-3.0)</strong>. You are free to inspect, audit, modify and redistribute the code under the terms of that licence. The full licence text is available in the project's official GitHub repository.</p>`,
				},
				{
					id: "responsibility",
					title: "3. User responsibility and the zero-knowledge model",
					html: `<div class="callout callout--warn">
						<h4>Critical notice about your master password</h4>
						<p>Monark operates under a <strong>zero-knowledge</strong> cryptographic model. Your data is encrypted on your own device using your master password and derived keys (Argon2id and XChaCha20-Poly1305).</p>
						<p><strong>Xilistudios does not store, does not know and cannot reset your master password under any circumstance. If you forget your master password and hold no recovery key or backup, your data cannot be recovered.</strong></p>
					</div>
					<p>You alone are responsible for:</p>
					<ul>
						<li>Choosing a strong master password and keeping it safe.</li>
						<li>Generating and retaining backups of your data and recovery keys.</li>
						<li>Maintaining the physical and logical security of the devices on which Monark is installed.</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. Integration with third-party services (Google Drive)",
					html: `<p>Monark supports optional synchronisation with cloud storage provided by third parties, in particular <strong>Google Drive</strong> through OAuth authentication.</p>
					<ul>
						<li>Use of Google Drive is subject to <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Google's Terms of Service</a>.</li>
						<li>Monark requests access only to manage backup files generated by the application itself (the <code>drive.file</code> scope), which are encrypted end to end before being sent.</li>
						<li>Xilistudios is not responsible for connectivity failures, service interruptions or storage limits imposed by third-party cloud providers.</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. Acceptable use",
					html: `<p>You agree to use Monark only for lawful purposes. It is strictly prohibited to use the software to:</p>
					<ul>
						<li>Store, manage or distribute credentials obtained unlawfully or without authorisation.</li>
						<li>Attempt to breach, disable or circumvent the security measures of third-party services or systems you do not own.</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. Exclusion of warranties",
					html: `<p>To the maximum extent permitted by applicable law, the software is provided <strong>"AS IS"</strong> and <strong>"AS AVAILABLE"</strong>, without warranties of any kind, express or implied, including but not limited to the implied warranties of merchantability, fitness for a particular purpose or non-infringement.</p>
					<p>Although we work to maintain high standards of quality, security and testing, Xilistudios does not warrant that the application will operate uninterrupted, be entirely free of errors, or be compatible with every hardware or software configuration.</p>`,
				},
				{
					id: "liability",
					title: "7. Limitation of liability",
					html: `<p>Under no circumstances shall Xilistudios, its developers or contributors be liable for direct, indirect, incidental, special, consequential or punitive damages, including lost profits, data loss, business interruption or computer failure arising from the use of, or inability to use, the application.</p>`,
				},
				{
					id: "modifications",
					title: "8. Modifications to these terms",
					html: `<p>Xilistudios reserves the right to modify or update these Terms of Service at any time. The last-revision date will be updated at the top of this page. Continued use of the application after any change is published constitutes acceptance of the new terms.</p>`,
				},
				{
					id: "contact",
					title: "9. Contact",
					html: `<p>For any question or request relating to these Terms of Service, contact the Xilistudios team through the official channels:</p>
					<p><strong>Xilistudios</strong><br>Project repository: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>Reports and support: <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},

		oauth: {
			title: "Completing authentication",
			desc: "Completing authentication with Monark Password Manager.",
			working: "Authenticating…",
			workingBody: "Please wait while we complete your authentication with Monark.",
			statusPending: "Processing OAuth response",
			statusOk: "Authentication successful",
			successTitle: "Authentication successful",
			successBody: "Finish signing in inside the Monark application by copying the credentials below.",
			copyHeading: "Copy credentials",
			copyBody: "Copy these credentials and paste them into Monark to complete the sync setup.",
			copyButton: "Copy credentials as Base64",
			copied: "Credentials copied. Paste them into Monark.",
			copyFailed: "Could not copy the credentials. Please try again.",
			encodeFailed: "Something went wrong while preparing the credentials.",
			instructions: "Instructions",
			steps: [
				"Click “Copy credentials” above.",
				"Return to the Monark application.",
				'In the authentication window, click "Paste Base64 credentials".',
				'Paste the contents and click "Import and authenticate".',
			],
			closable: "You can close this window once the credentials are copied.",
			errorTitle: "Authentication failed",
			errorBody: "An error occurred during the authorisation process.",
			invalidTitle: "Invalid response",
			invalidBody: "Required parameters are missing (code or state).",
			unknownError: "Unknown error",
			closeWindow: "Close window",
			home: "Home",
		},

		notFound: {
			title: "Page not found",
			desc: "The page you requested does not exist on this site.",
			body: "The address may be mistyped, or the page may have moved. Start from the overview, or browse the legal documents.",
			back: "Go to the overview",
		},
	};
