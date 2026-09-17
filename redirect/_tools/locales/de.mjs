/** Quelltexte (Deutsch). Übersetzt aus dem kanonischen englischen String-Satz (en.mjs). */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "de",
		htmlLang: "de",
		ogLocale: "de_DE",

		title: "Monark — Zero-Knowledge-Passwortmanager",
		desc: "Open-Source-Passwortmanager, lokal zuerst. Argon2id und XChaCha20-Poly1305 in Rust. Keine Konten, keine Server, keine Telemetrie.",

		skip: "Zum Inhalt springen",
		nav: {
			features: "Funktionen",
			privacy: "Datenschutz",
			terms: "Nutzungsbedingungen",
		},
		download: "Herunterladen",
		releases: "Neueste Version",
		langLabel: "Sprache",
		langOther: "Andere Sprachen",

		hero: {
			eyebrow: "Lokal zuerst · Zero-Knowledge",
			title: `Deine Schlüssel.<br><span class="serif">Nur deine.</span>`,
			lede: "Monark ist ein Open-Source-Passwortmanager, der deine Zugangsdaten auf deinem eigenen Rechner hält. Kein Konto, kein Sync-Server, keine Telemetrie — nur ein Tresor, verschlüsselt dort, wo er liegt.",
			ctaPrimary: "Monark herunterladen",
			ctaSecondary: "Quellcode ansehen",
			meta: [
				["Läuft auf", "Linux, macOS, Windows, Android, iOS"],
				["Verschlüsselung", "XChaCha20-Poly1305"],
				["Schlüsselableitung", "Argon2id · 64 MB"],
				["Lizenz", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "Was es tut",
			title: "Alles, was ein Passwortmanager tun sollte, und nichts, was er nicht tun sollte.",
			lede: "Monark speichert Logins, Notizen und Einmalcodes in einer einzigen verschlüsselten Datei, die dir gehört. Es gibt keinen Anbieter dazwischen, weil es keinen Anbieter dazwischen gibt.",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "Dein Tresor ist eine Datei auf deiner Festplatte",
					body: "Einträge werden verschlüsselt, bevor sie den Speicher berühren, und erst entschlüsselt, solange du den Tresor geöffnet hast. Monark arbeitet vollständig offline; das Netzwerk ist nie beteiligt, außer du verlangst es.",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "Kryptografie in Rust",
					body: "Der kryptografische Kern ist in Rust geschrieben und läuft nativ, nicht in der Seite.",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						['<span class="k">memory</span>', '<span class="v">64 MB · 3 Durchläufe</span>'],
						['<span class="k">cipher</span>', '<span class="v">xchacha20-poly1305</span>'],
						['<span class="k">key</span>', '<span class="v">256 Bit</span>'],
						['<span class="k">nonce</span>', '<span class="v">192 Bit, zufällig</span>'],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "Passwortgenerator",
					body: "Passwörter und Passphrasen aus dem CSPRNG des Betriebssystems, mit den Zeichensätzen und der Länge, die du wählst.",
				},
				{
					icon: "timer",
					span: 2,
					title: "Zwei-Faktor-Codes",
					body: "Speichere TOTP-Geheimnisse neben dem Login, zu dem sie gehören, und lies den aktuellen Code im Tresorfenster ab.",
				},
				{
					icon: "cloud",
					span: 2,
					title: "Optionales verschlüsseltes Backup",
					body: "Kopiere den Tresor in dein eigenes Google Drive oder auf einen WebDAV-Server. Die Datei ist bereits verschlüsselt, bevor sie dein Gerät verlässt.",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "Eine Codebasis für jeden Desktop und jedes Telefon, das du besitzt",
					body: "Monark basiert auf Tauri v2, sodass derselbe Rust-Kern und dieselbe Oberfläche für Linux, macOS, Windows, Android und iOS ausgeliefert werden — ohne Electron-Laufzeit im Schlepptau.",
					terminal: [
						['<span class="k">bundle</span>', '<span class="v">native Webview</span>'],
						['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
						['<span class="k">interface</span>', '<span class="v">react 18 · typisiert</span>'],
						['<span class="k">installer</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
					],
				},
			],
		},specs: {
			eyebrow: "Unter der Haube",
			title: "Die Parameter, in klaren Worten.",
			lede: "Nichts davon ist proprietär und nichts ist geheim. Die genauen Primitive sind im Repository dokumentiert und durch Tests abgedeckt.",
			items: [
				["Schlüsselableitung", "<b>Argon2id</b> mit 64 MB Speicher, 3 Iterationen und 4-facher Parallelität, damit GPU-gestütztes Raten teuer wird."],
				["Authentifizierte Verschlüsselung", "<b>XChaCha20-Poly1305</b> (IETF) mit 256-Bit-Schlüsseln und 192-Bit-Zufallsnonces pro Operation."],
				["Zufälligkeit", "Jeder Schlüssel, jedes Salt und jede Nonce stammt aus dem <b>CSPRNG</b> des Betriebssystems, nie aus einem Generator der Programmiersprache."],
				["Speicherhygiene", "Abgeleitete Schlüssel und Klartextgeheimnisse werden <b>beim Verwerfen genullt</b>, damit sie nicht im freigegebenen Speicher zurückbleiben."],
				["Speicherung", "Eine einzige lokale <b>Tresordatei</b>, die du verschieben, kopieren oder löschen kannst. Cloud-Kopien sind dieselben verschlüsselten Bytes."],
				["Quellcode", "Lizenziert unter <b>AGPL-3.0</b>. Baue ihn selbst, prüfe ihn, oder melde ein Problem gegen genau die Revision, die du ausführst."],
			],
		},

		cta: {
			title: "Lies den Code, bevor du ihm deine Passwörter anvertraust.",
			body: "Monark erscheint aus einem offenen Repository, mit Tests, kryptografischen Parametern und Release-Artefakten am selben Ort. Prüfe den Build, oder kompiliere ihn selbst.",
			primary: "Neueste Version holen",
			secondary: "Repository ansehen",
		},

		footer: {
			brand: "Ein quelloffener, lokal arbeitender Passwortmanager mit Zero-Knowledge-Verschlüsselung, entwickelt von Xilistudios.",
			cols: [
				["Dokumente", [["Überblick", "index"], ["Datenschutzerklärung", "privacy"], ["Nutzungsbedingungen", "terms"]]],
				["Projekt", [["Quellcode", REPO], ["Problem melden", ISSUES], ["AGPL-3.0-Lizenz", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios. Monark ist freie Software unter der AGPL-3.0.",
		},privacy: {
			title: "Datenschutzerklärung",
			desc: "Wie Monark mit Daten umgeht: die Zero-Knowledge-Architektur, der angefragte Google-Drive-Scope und die Verpflichtungen zur eingeschränkten Nutzung, die eingehalten werden.",
			updated: "Zuletzt aktualisiert: 17. September 2026",
			version: "Version 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. Einleitung und Zero-Knowledge-Zusage",
					html: `<p>Bei <strong>Monark Password Manager</strong> (entwickelt von <strong>Xilistudios</strong>) sind Datenschutz und Datenhoheit Gründungsprinzipien. Deine Passwörter, Zugangsdaten, Notizen und vertraulichen Dokumente gehören dir und niemandem sonst.</p>
					<p>Monark folgt einer strikten <strong>Zero-Knowledge-Architektur</strong> und einem <strong>Local-First</strong>-Modell. Wir erheben deine Daten nicht, wir speichern sie nicht auf Servern, die wir kontrollieren, und wir haben keine technische Möglichkeit, deine Passwörter oder den Master-Schlüssel deines Tresors zu lesen oder zu entschlüsseln. Sämtliche kryptografische Arbeit findet auf deinem Gerät statt.</p>`,
				},
				{
					id: "data",
					title: "2. Was wir verarbeiten und was wir niemals verarbeiten",
					html: `<h3>2.1 Inhalte des Tresors — kein Zugriff</h3>
					<p>Deine Passwörter, Benutzernamen, URLs, sicheren Notizen und Zwei-Faktor-Authentifizierungsdaten werden verschlüsselt auf deiner eigenen Hardware gespeichert. Xilistudios erhält sie niemals im Klartext und speichert sie niemals auf externen Servern.</p>
					<h3>2.2 Telemetrie und Tracking</h3>
					<p>Monark enthält keine Werbe-Tracker, keine Werbe-IDs und keine invasiven Analysen, die dein Surfverhalten oder deine Identität erfassen.</p>`,
				},
				{
					id: "google",
					title: "3. Nutzung der Google API und von Google Drive",
					html: `<p>Monark bietet dir die Möglichkeit, ein synchronisiertes Backup in deinem eigenen Google-Drive-Konto zu führen. Damit dies möglich ist, authentifiziert sich die Anwendung über OAuth und fragt ausschließlich den einen, minimal notwendigen Scope an:</p>
					<div class="callout">
						<h4>Angefragter Scope: <code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>Diese Berechtigung erlaubt Monark <strong>ausschließlich</strong>, die Dateien und Ordner anzulegen, anzusehen, zu ändern und zu löschen, die von der Anwendung Monark selbst erstellt wurden, um dein verschlüsseltes Backup zu halten.</p>
						<p><strong>Monark kann auf keine andere Datei, kein anderes Dokument, Foto oder keinen anderen Ordner zugreifen, sie lesen oder ändern, die bereits in deinem Google Drive vorhanden sind.</strong></p>
					</div>
					<div class="compliance">
						<strong>Einhaltung der Anforderungen von Google zur eingeschränkten Nutzung.</strong><br>
						Die Verwendung und Weitergabe von Informationen, die Monark über Google APIs erhält, richtet sich nach der <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, einschließlich der Anforderungen zur eingeschränkten Nutzung.
					</div>
					<h3>3.1 Strikte Beschränkungen für Google-Daten</h3>
					<ul>
						<li><strong>Kein Verkauf und keine Kommerzialisierung:</strong> Wir verkaufen, lizenzieren, handeln oder übertragen keine Nutzerdaten, die über Google Drive erlangt wurden, an Dritte, Datenhändler oder Werbeagenturen.</li>
						<li><strong>Keine personalisierte Werbung:</strong> Keine über Google APIs erlangten Daten werden verwendet, um Werbung auszuliefern, kommerzielle Profile zu erstellen oder dich erneut anzusprechen.</li>
						<li><strong>Kein KI-Training:</strong> Über Google APIs erlangte Daten werden niemals verwendet, um große Sprachmodelle, maschinelle Lernsysteme oder KI-Algorithmen zu trainieren.</li>
						<li><strong>Eingeschränkter menschlicher Zugriff:</strong> Keine Mitarbeiterin und kein Entwickler von Xilistudios hat menschlichen Zugriff auf die in deinem Google Drive gespeicherten Tresordateien, außer bei rechtlicher Verpflichtung oder wenn du ausdrücklich für die technische Fehlersuche einwilligst — und selbst dann sind die Daten Ende-zu-Ende stark verschlüsselt.</li>
					</ul>`,
				},
				{
					id: "security",
					title: "4. Datensicherheit und Verschlüsselung",
					html: `<p>Bevor eine Backup-Datei an dein Google Drive übertragen wird, wendet Monark moderne kryptografische Verfahren an, die im sicheren Rust-Kern implementiert sind:</p>
					<ul>
						<li><strong>Schlüsselableitung (KDF):</strong> <code>Argon2id</code> mit Parametern, die gegen Brute-Force und GPU-Beschleunigung widerstandsfähig sind (64 MB Speicher, 3 Iterationen, 4-Thread-Parallelität).</li>
						<li><strong>Authentifizierte symmetrische Verschlüsselung:</strong> <code>XChaCha20-Poly1305</code> (IETF-Variante) mit 256-Bit-Schlüsseln und zufälligen 192-Bit-Nonces.</li>
						<li><strong>Speicherschutz:</strong> sichere Löschung der Zugangsdaten im Arbeitsspeicher (<code>ZeroizeOnDrop</code>), um forensische Extraktionsangriffe zu verhindern.</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. Kontrolle, Rechte und Löschung von Daten",
					html: `<p>Als Nutzer behältst du jederzeit die vollständige Kontrolle:</p>
					<ul>
						<li><strong>Zugriff und Portabilität:</strong> Exportiere deinen Tresor jederzeit über die Einstellungen der Anwendung.</li>
						<li><strong>Backups löschen:</strong> Entferne Backup-Dateien in Monark selbst oder indem du den Monark-Ordner in deinem eigenen Google-Drive-Speicher löschst.</li>
						<li><strong>Berechtigungen widerrufen:</strong> Widerrufe den Zugriff von Monark auf dein Google-Konto jederzeit auf der offiziellen Berechtigungsseite von Google: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. Links zu Websites Dritter",
					html: `<p>Monark kann optionale Integrationen mit externen Speicherdiensten wie Google Drive, Nextcloud oder WebDAV-Servern anbieten. Deine Interaktion mit diesen Diensten unterliegt der Datenschutzerklärung und den Nutzungsbedingungen des jeweiligen Anbieters.</p>`,
				},
				{
					id: "changes",
					title: "7. Änderungen dieser Erklärung",
					html: `<p>Wir behalten uns das Recht vor, diese Datenschutzerklärung zu aktualisieren, um Verbesserungen der Anwendung, neue Funktionen oder regulatorische Anforderungen abzubilden. Bei wesentlichen Änderungen veröffentlichen wir die aktualisierte Fassung auf dieser Website mit einem neuen Datum des Inkrafttretens.</p>`,
				},
				{
					id: "contact",
					title: "8. Kontakt",
					html: `<p>Wenn du Fragen zu dieser Datenschutzerklärung oder zu den Sicherheitspraktiken von Monark hast, kannst du das Entwicklungsteam von Xilistudios über unser offizielles GitHub-Repository erreichen.</p>
					<p><strong>Xilistudios</strong><br>Repository und Support: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},terms: {
			title: "Nutzungsbedingungen",
			desc: "Die Bedingungen für die Nutzung von Monark: Lizenzierung unter AGPL-3.0, die Grenzen des Zero-Knowledge-Modells, Speicherung bei Dritten und Gewährleistungsausschlüsse.",
			updated: "Zuletzt aktualisiert: 17. September 2026",
			version: "Version 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. Annahme dieser Bedingungen",
					html: `<p>Mit der Installation, der Ausführung oder der sonstigen Nutzung von <strong>Monark Password Manager</strong> stimmst du diesen Nutzungsbedingungen zu. Wenn du sie nicht akzeptierst, verwende die Anwendung nicht.</p>`,
				},
				{
					id: "license",
					title: "2. Art der Software und Lizenz",
					html: `<p>Monark ist eine quelloffene Anwendung zur lokalen Verwaltung von Zugangsdaten und Passwörtern.</p>
					<p>Der Quellcode wird unter den Bedingungen der <strong>GNU Affero General Public License Version 3.0 (AGPL-3.0)</strong> verbreitet. Du darfst den Code im Rahmen dieser Lizenz einsehen, prüfen, ändern und weiterverbreiten. Der vollständige Lizenztext ist im offiziellen GitHub-Repository des Projekts verfügbar.</p>`,
				},
				{
					id: "responsibility",
					title: "3. Verantwortung der Nutzer und das Zero-Knowledge-Modell",
					html: `<div class="callout callout--warn">
						<h4>Wichtiger Hinweis zu deinem Master-Passwort</h4>
						<p>Monark arbeitet nach einem kryptografischen <strong>Zero-Knowledge</strong>-Modell. Deine Daten werden auf deinem eigenen Gerät mit deinem Master-Passwort und daraus abgeleiteten Schlüsseln verschlüsselt (Argon2id und XChaCha20-Poly1305).</p>
						<p><strong>Xilistudios speichert dein Master-Passwort nicht, kennt es nicht und kann es unter keinen Umständen zurücksetzen. Wenn du dein Master-Passwort vergisst und keinen Wiederherstellungsschlüssel und kein Backup besitzt, können deine Daten nicht wiederhergestellt werden.</strong></p>
					</div>
					<p>Allein du bist verantwortlich für:</p>
					<ul>
						<li>die Wahl eines starken Master-Passworts und dessen sichere Aufbewahrung.</li>
						<li>die Erstellung und Aufbewahrung von Backups deiner Daten und Wiederherstellungsschlüssel.</li>
						<li>die physische und logische Sicherheit der Geräte, auf denen Monark installiert ist.</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. Integration von Diensten Dritter (Google Drive)",
					html: `<p>Monark unterstützt die optionale Synchronisierung mit Cloud-Speicher Dritter, insbesondere mit <strong>Google Drive</strong> über die OAuth-Authentifizierung.</p>
					<ul>
						<li>Die Nutzung von Google Drive unterliegt den <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Nutzungsbedingungen von Google</a>.</li>
						<li>Monark fragt nur Zugriff an, um Backup-Dateien zu verwalten, die die Anwendung selbst erzeugt hat (der Scope <code>drive.file</code>); diese werden vor dem Versand Ende-zu-Ende verschlüsselt.</li>
						<li>Xilistudios ist nicht verantwortlich für Verbindungsfehler, Dienstunterbrechungen oder Speicherlimits, die von Cloud-Anbietern Dritter auferlegt werden.</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. Zulässige Nutzung",
					html: `<p>Du stimmst zu, Monark ausschließlich für rechtmäßige Zwecke zu nutzen. Es ist streng untersagt, die Software zu verwenden, um:</p>
					<ul>
						<li>Zugangsdaten zu speichern, zu verwalten oder zu verbreiten, die unrechtmäßig oder ohne Berechtigung erlangt wurden.</li>
						<li>zu versuchen, die Sicherheitsmaßnahmen von Diensten oder Systemen Dritter, die dir nicht gehören, zu durchbrechen, außer Kraft zu setzen oder zu umgehen.</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. Ausschluss der Gewährleistung",
					html: `<p>In dem nach geltendem Recht maximal zulässigen Umfang wird die Software <strong>„WIE BESEHEN“</strong> und <strong>„WIE VERFÜGBAR“</strong> bereitgestellt, ohne Gewährleistung jeglicher Art, ausdrücklich oder stillschweigend, einschließlich, aber nicht beschränkt auf die stillschweigenden Gewährleistungen der Marktgängigkeit, der Eignung für einen bestimmten Zweck oder der Nichtverletzung von Rechten Dritter.</p>
					<p>Obwohl wir an hohen Standards bei Qualität, Sicherheit und Tests arbeiten, gewährleistet Xilistudios nicht, dass die Anwendung unterbrechungsfrei läuft, vollständig fehlerfrei ist oder mit jeder Hardware- und Softwarekonfiguration kompatibel ist.</p>`,
				},
				{
					id: "liability",
					title: "7. Haftungsbeschränkung",
					html: `<p>Xilistudios, seine Entwickler und Mitwirkenden haften unter keinen Umständen für direkte, indirekte, zufällige, besondere, Folge- oder Strafschäden, einschließlich entgangener Gewinne, Datenverlust, Betriebsunterbrechungen oder Rechnerausfällen, die aus der Nutzung oder der Unmöglichkeit der Nutzung der Anwendung entstehen.</p>`,
				},
				{
					id: "modifications",
					title: "8. Änderungen dieser Bedingungen",
					html: `<p>Xilistudios behält sich das Recht vor, diese Nutzungsbedingungen jederzeit zu ändern oder zu aktualisieren. Das Datum der letzten Revision wird oben auf dieser Seite aktualisiert. Die fortgesetzte Nutzung der Anwendung nach Veröffentlichung einer Änderung gilt als Annahme der neuen Bedingungen.</p>`,
				},
				{
					id: "contact",
					title: "9. Kontakt",
					html: `<p>Bei Fragen oder Anliegen zu diesen Nutzungsbedingungen wende dich über die offiziellen Kanäle an das Team von Xilistudios:</p>
					<p><strong>Xilistudios</strong><br>Projekt-Repository: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>Meldungen und Support: <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},

		oauth: {
			title: "Anmeldung abschließen",
			desc: "Anmeldung bei Monark Password Manager abschließen.",
			working: "Anmeldung läuft…",
			workingBody: "Bitte warte, während wir deine Anmeldung bei Monark abschließen.",
			statusPending: "OAuth-Antwort wird verarbeitet",
			statusOk: "Anmeldung erfolgreich",
			successTitle: "Anmeldung erfolgreich",
			successBody: "Schließe die Anmeldung in der Anwendung Monark ab, indem du die untenstehenden Zugangsdaten kopierst.",
			copyHeading: "Zugangsdaten kopieren",
			copyBody: "Kopiere diese Zugangsdaten und füge sie in Monark ein, um die Synchronisierung einzurichten.",
			copyButton: "Zugangsdaten als Base64 kopieren",
			copied: "Zugangsdaten kopiert. Füge sie in Monark ein.",
			copyFailed: "Die Zugangsdaten konnten nicht kopiert werden. Bitte versuche es erneut.",
			encodeFailed: "Beim Vorbereiten der Zugangsdaten ist etwas schiefgegangen.",
			instructions: "Anleitung",
			steps: [
				"Klicke oben auf „Zugangsdaten kopieren“.",
				"Kehre zur Anwendung Monark zurück.",
				'Klicke im Anmeldefenster auf "Paste Base64 credentials".',
				'Füge den Inhalt ein und klicke auf "Import and authenticate".',
			],
			closable: "Du kannst dieses Fenster schließen, sobald die Zugangsdaten kopiert sind.",
			errorTitle: "Anmeldung fehlgeschlagen",
			errorBody: "Während des Autorisierungsvorgangs ist ein Fehler aufgetreten.",
			invalidTitle: "Ungültige Antwort",
			invalidBody: "Erforderliche Parameter fehlen (code oder state).",
			unknownError: "Unbekannter Fehler",
			closeWindow: "Fenster schließen",
			home: "Startseite",
		},

		notFound: {
			title: "Seite nicht gefunden",
			desc: "Die angeforderte Seite existiert auf dieser Website nicht.",
			body: "Möglicherweise ist die Adresse falsch geschrieben oder die Seite wurde verschoben. Beginne beim Überblick oder sieh dir die rechtlichen Dokumente an.",
			back: "Zum Überblick",
		},
	};