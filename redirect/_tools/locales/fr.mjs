/** Copy for the French (France) locale. Translated from the canonical English string set in en.mjs. */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
	code: "fr",
	htmlLang: "fr",
	ogLocale: "fr_FR",

	title: "Monark — Gestionnaire de mots de passe",
	desc: "Gestionnaire de mots de passe local-first et open source. Argon2id et XChaCha20-Poly1305 en Rust. Sans compte, sans serveur, sans télémétrie.",

	skip: "Aller au contenu",
	nav: {
		features: "Fonctionnalités",
		privacy: "Confidentialité",
		terms: "Conditions",
	},
	download: "Télécharger",
	releases: "Dernière version",
	langLabel: "Langue",
	langOther: "Autres langues",

	hero: {
		eyebrow: "Local-first · Zero-knowledge",
		title: `Vos clés.<br><span class="serif">À vous seuls.</span>`,
		lede: "Monark est un gestionnaire de mots de passe open source qui garde vos identifiants sur votre propre machine. Pas de compte, pas de serveur de synchronisation, pas de télémétrie — juste un coffre chiffré là où il se trouve.",
		ctaPrimary: "Télécharger Monark",
		ctaSecondary: "Lire le code source",
		meta: [
			["Systèmes", "Linux, macOS, Windows, Android, iOS"],
			["Chiffrement", "XChaCha20-Poly1305"],
			["Dérivation de clé", "Argon2id · 64 Mo"],
			["Licence", "AGPL-3.0"],
		],
	},

	features: {
		eyebrow: "Ce qu'il fait",
		title: "Tout ce qu'un gestionnaire de mots de passe doit faire, et rien de plus.",
		lede: "Monark stocke vos identifiants, vos notes et vos codes à usage unique dans un seul fichier chiffré qui vous appartient. Aucun intermédiaire, puisqu'il n'y a personne entre vous et vos données.",
		cells: [
			{
				icon: "folder",
				span: 4,
				title: "Votre coffre est un fichier sur votre disque",
				body: "Les entrées sont chiffrées avant d'atteindre le stockage et ne sont déchiffrées que lorsque le coffre est ouvert. Monark fonctionne entièrement hors ligne : le réseau n'entre en jeu que si vous le demandez.",
			},
			{
				icon: "lock",
				span: 2,
				dark: true,
				title: "La cryptographie écrite en Rust",
				body: "Le cœur cryptographique est écrit en Rust et s'exécute nativement, pas dans la page.",
				terminal: [
					['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
					['<span class="k">mémoire</span>', '<span class="v">64 Mo · 3 passes</span>'],
					['<span class="k">chiffrement</span>', '<span class="v">xchacha20-poly1305</span>'],
					['<span class="k">clé</span>', '<span class="v">256 bits</span>'],
					['<span class="k">nonce</span>', '<span class="v">192 bits, aléatoire</span>'],
				],
			},
			{
				icon: "key",
				span: 2,
				title: "Générateur de mots de passe",
				body: "Mots de passe et phrases de passe tirés du CSPRNG du système d'exploitation, avec les jeux de caractères et la longueur que vous choisissez.",
			},
			{
				icon: "timer",
				span: 2,
				title: "Codes de double authentification",
				body: "Stockez vos secrets TOTP à côté de l'identifiant auquel ils correspondent et lisez le code courant depuis la fenêtre du coffre.",
			},
			{
				icon: "cloud",
				span: 2,
				title: "Sauvegarde chiffrée facultative",
				body: "Copiez le coffre sur votre propre Google Drive ou sur un serveur WebDAV. Le fichier est déjà chiffré avant de quitter votre appareil.",
			},
			{
				icon: "devices",
				span: 6,
				wide: true,
				title: "Une seule base de code, pour tous vos ordinateurs et téléphones",
				body: "Monark est construit sur Tauri v2 : le même cœur Rust et la même interface sont livrés pour Linux, macOS, Windows, Android et iOS, sans embarquer de runtime Electron.",
				terminal: [
					['<span class="k">paquet</span>', '<span class="v">webview natif</span>'],
					['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
					['<span class="k">interface</span>', '<span class="v">react 18 · typée</span>'],
					['<span class="k">installeur</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
				],
			},
		],
	},specs: {
		eyebrow: "Sous le capot",
		title: "Les paramètres, dits simplement.",
		lede: "Rien ici n'est propriétaire et rien n'est secret. Les primitives exactes sont documentées dans le dépôt et couvertes par des tests.",
		items: [
			["Dérivation de clé", "<b>Argon2id</b> avec 64 Mo de mémoire, 3 itérations et un parallélisme de 4 voies, pour rendre coûteuses les attaques par force brute assistées par GPU."],
			["Chiffrement authentifié", "<b>XChaCha20-Poly1305</b> (IETF) avec des clés de 256 bits et des nonces aléatoires de 192 bits par opération."],
			["Aléa", "Chaque clé, sel et nonce provient du <b>CSPRNG</b> du système d'exploitation, jamais d'un générateur fourni par le langage."],
			["Hygiène mémoire", "Les clés dérivées et les secrets en clair sont <b>effacés à la libération</b> (zeroized on drop), afin de ne pas subsister dans la mémoire libérée."],
			["Stockage", "Un unique <b>fichier de coffre</b> local, que vous pouvez déplacer, copier ou supprimer. Les copies dans le cloud sont les mêmes octets chiffrés."],
			["Source", "Distribué sous <b>AGPL-3.0</b>. Compilez-le vous-même, auditez-le, ou ouvrez un ticket sur la révision exacte que vous exécutez."],
		],
	},

	cta: {
		title: "Lisez le code avant de lui confier vos mots de passe.",
		body: "Monark est publié depuis un dépôt ouvert, avec ses tests, ses paramètres cryptographiques et ses artefacts de version au même endroit. Vérifiez le binaire, ou compilez-le vous-même.",
		primary: "Obtenir la dernière version",
		secondary: "Voir le dépôt",
	},

	footer: {
		brand: "Un gestionnaire de mots de passe open source et local-first, à chiffrement zero-knowledge, développé par Xilistudios.",
		cols: [
			["Documents", [["Présentation", "index"], ["Politique de confidentialité", "privacy"], ["Conditions d'utilisation", "terms"]]],
			["Projet", [["Code source", REPO], ["Signaler un problème", ISSUES], ["Licence AGPL-3.0", LICENSE]]],
		],
		baseLeft: "© 2026 Xilistudios. Monark est un logiciel libre sous licence AGPL-3.0.",
	},privacy: {
		title: "Politique de confidentialité",
		desc: "Comment Monark traite les données : architecture zero-knowledge, permission Google Drive demandée et engagements d'usage limité respectés.",
		updated: "Dernière mise à jour : 17 septembre 2026",
		version: "Version 1.0",
		sections: [
			{
				id: "introduction",
				title: "1. Introduction et engagement zero-knowledge",
				html: `<p>Chez <strong>Monark Password Manager</strong> (développé par <strong>Xilistudios</strong>), la confidentialité et la souveraineté des données sont des principes fondateurs. Vos mots de passe, vos identifiants, vos notes et vos documents confidentiels vous appartiennent, et à personne d'autre.</p>
					<p>Monark repose sur une <strong>architecture zero-knowledge</strong> stricte et sur un modèle <strong>local-first</strong>. Nous ne collectons pas vos données, nous ne les stockons sur aucun serveur que nous contrôlons et nous n'avons aucun moyen technique de lire ou de déchiffrer vos mots de passe ni la clé principale de votre coffre. Tout le travail cryptographique s'effectue sur votre appareil.</p>`,
			},
			{
				id: "data",
				title: "2. Ce que nous traitons, et ce que nous ne traitons jamais",
				html: `<h3>2.1 Contenu du coffre — aucun accès</h3>
					<p>Vos mots de passe, identifiants, URL, notes sécurisées et données d'authentification à deux facteurs sont stockés sous forme chiffrée sur votre propre matériel. Xilistudios ne les reçoit jamais en clair et ne les conserve jamais sur des serveurs externes.</p>
					<h3>2.2 Télémétrie et traçage</h3>
					<p>Monark ne contient aucun traceur publicitaire, aucun identifiant publicitaire et aucune analyse intrusive enregistrant votre navigation ou votre identité personnelle.</p>`,
			},
			{
				id: "google",
				title: "3. Utilisation de l'API Google et de Google Drive",
				html: `<p>Monark vous permet, en option, de conserver une sauvegarde synchronisée dans votre compte Google Drive personnel. Pour ce faire, l'application s'authentifie via OAuth et ne demande que l'unique permission minimale nécessaire :</p>
					<div class="callout">
						<h4>Permission demandée : <code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>Cette autorisation permet <strong>uniquement</strong> à Monark de créer, consulter, modifier et supprimer les fichiers et dossiers créés directement par l'application Monark elle-même, afin d'y héberger votre sauvegarde chiffrée.</p>
						<p><strong>Monark ne peut ni accéder à, ni lire, ni modifier aucun autre fichier, document, photo ou dossier déjà présent dans votre Google Drive.</strong></p>
					</div>
					<div class="compliance">
						<strong>Conformité aux exigences d'usage limité de Google.</strong><br>
						L'utilisation et le transfert par Monark des informations reçues des API Google respectent la <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, y compris les exigences d'usage limité (Limited Use).
					</div>
					<h3>3.1 Restrictions strictes sur les données Google</h3>
					<ul>
						<li><strong>Aucune vente ni exploitation commerciale :</strong> nous ne vendons, ne concédons sous licence, n'échangeons ni ne transférons jamais des données utilisateur obtenues via Google Drive à des tiers, des courtiers en données ou des régies publicitaires.</li>
						<li><strong>Aucune publicité personnalisée :</strong> aucune donnée obtenue via les API Google n'est utilisée pour diffuser des annonces, établir des profils commerciaux ou vous recibler.</li>
						<li><strong>Aucun entraînement d'IA :</strong> les données obtenues via les API Google ne servent jamais à entraîner des grands modèles de langage, des systèmes d'apprentissage automatique ou des algorithmes d'intelligence artificielle.</li>
						<li><strong>Accès humain restreint :</strong> aucun employé ni développeur de Xilistudios n'a d'accès humain aux fichiers de coffre stockés dans votre Google Drive, sauf obligation légale ou consentement explicite de votre part pour un débogage technique — et même dans ce cas, les données sont fortement chiffrées de bout en bout.</li>
					</ul>`,
			},
			{
				id: "security",
				title: "4. Sécurité des données et chiffrement",
				html: `<p>Avant qu'un fichier de sauvegarde ne soit transmis à votre Google Drive, Monark applique des standards cryptographiques de référence, implémentés dans le cœur Rust sécurisé :</p>
					<ul>
						<li><strong>Dérivation de clé (KDF) :</strong> <code>Argon2id</code> avec des paramètres résistants à la force brute et à l'accélération GPU (64 Mo de mémoire, 3 itérations, parallélisme de 4 threads).</li>
						<li><strong>Chiffrement symétrique authentifié :</strong> <code>XChaCha20-Poly1305</code> (variante IETF) avec des clés de 256 bits et des nonces aléatoires de 192 bits.</li>
						<li><strong>Protection de la mémoire :</strong> effacement sécurisé des identifiants en mémoire (<code>ZeroizeOnDrop</code>) pour prévenir les attaques par extraction forensique.</li>
					</ul>`,
			},
			{
				id: "control",
				title: "5. Maîtrise, droits et suppression des données",
				html: `<p>En tant qu'utilisateur, vous gardez à tout moment un contrôle absolu :</p>
					<ul>
						<li><strong>Accès et portabilité :</strong> exportez votre coffre à tout moment depuis les paramètres de l'application.</li>
						<li><strong>Suppression des sauvegardes :</strong> supprimez les fichiers de sauvegarde depuis Monark, ou en effaçant le dossier Monark dans votre propre espace Google Drive.</li>
						<li><strong>Révocation des autorisations :</strong> révoquez à tout moment l'accès de Monark à votre compte Google sur la page officielle des autorisations Google : <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
					</ul>`,
			},
			{
				id: "third-parties",
				title: "6. Liens vers des sites tiers",
				html: `<p>Monark peut proposer une intégration facultative avec des services de stockage externes tels que Google Drive, Nextcloud ou des serveurs WebDAV. Votre utilisation de ces services est régie par la politique de confidentialité et les conditions d'utilisation de leurs fournisseurs respectifs.</p>`,
			},
			{
				id: "changes",
				title: "7. Modifications de la présente politique",
				html: `<p>Nous nous réservons le droit de mettre à jour cette Politique de confidentialité afin de refléter les améliorations de l'application, les nouvelles fonctionnalités ou les exigences réglementaires. En cas de modification substantielle, nous publierons la version actualisée sur ce site avec une nouvelle date d'entrée en vigueur.</p>`,
			},
			{
				id: "contact",
				title: "8. Contact",
				html: `<p>Si vous avez des questions sur cette Politique de confidentialité ou sur les pratiques de sécurité de Monark, vous pouvez joindre l'équipe de développement Xilistudios via notre dépôt GitHub officiel.</p>
					<p><strong>Xilistudios</strong><br>Dépôt et support : <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
			},
		],
	},terms: {
		title: "Conditions d'utilisation",
		desc: "Les conditions régissant l'utilisation de Monark : licence AGPL-3.0, limites du modèle zero-knowledge, stockage tiers et exclusions de garantie.",
		updated: "Dernière mise à jour : 17 septembre 2026",
		version: "Version 1.0",
		sections: [
			{
				id: "acceptance",
				title: "1. Acceptation des présentes conditions",
				html: `<p>En installant, en exécutant ou en utilisant de quelque manière que ce soit <strong>Monark Password Manager</strong>, vous acceptez les présentes Conditions d'utilisation. Si vous ne les acceptez pas, n'utilisez pas l'application.</p>`,
			},
			{
				id: "license",
				title: "2. Nature du logiciel et licence",
				html: `<p>Monark est une application locale de gestion des identifiants et des mots de passe, open source et local-first.</p>
					<p>Le code source est distribué selon les termes de la <strong>GNU Affero General Public License version 3.0 (AGPL-3.0)</strong>. Vous êtes libre d'examiner, d'auditer, de modifier et de redistribuer le code dans le respect de cette licence. Le texte intégral de la licence est disponible dans le dépôt GitHub officiel du projet.</p>`,
			},
			{
				id: "responsibility",
				title: "3. Responsabilité de l'utilisateur et modèle zero-knowledge",
				html: `<div class="callout callout--warn">
						<h4>Avertissement essentiel concernant votre mot de passe principal</h4>
						<p>Monark repose sur un modèle cryptographique <strong>zero-knowledge</strong>. Vos données sont chiffrées sur votre propre appareil à l'aide de votre mot de passe principal et des clés qui en sont dérivées (Argon2id et XChaCha20-Poly1305).</p>
						<p><strong>Xilistudios ne conserve pas, ne connaît pas et ne peut en aucun cas réinitialiser votre mot de passe principal. Si vous oubliez votre mot de passe principal et ne disposez d'aucune clé de récupération ni sauvegarde, vos données sont irrécupérables.</strong></p>
					</div>
					<p>Vous êtes seul responsable des points suivants :</p>
					<ul>
						<li>Choisir un mot de passe principal robuste et le conserver en lieu sûr.</li>
						<li>Générer et conserver des sauvegardes de vos données et de vos clés de récupération.</li>
						<li>Maintenir la sécurité physique et logique des appareils sur lesquels Monark est installé.</li>
					</ul>`,
			},
			{
				id: "google",
				title: "4. Intégration avec des services tiers (Google Drive)",
				html: `<p>Monark prend en charge une synchronisation facultative avec des services de stockage cloud fournis par des tiers, en particulier <strong>Google Drive</strong> via une authentification OAuth.</p>
					<ul>
						<li>L'utilisation de Google Drive est soumise aux <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Conditions d'utilisation de Google</a>.</li>
						<li>Monark ne demande l'accès que pour gérer les fichiers de sauvegarde générés par l'application elle-même (la permission <code>drive.file</code>), lesquels sont chiffrés de bout en bout avant d'être envoyés.</li>
						<li>Xilistudios n'est pas responsable des échecs de connexion, des interruptions de service ou des limites de stockage imposés par les fournisseurs cloud tiers.</li>
					</ul>`,
			},
			{
				id: "acceptable-use",
				title: "5. Utilisation acceptable",
				html: `<p>Vous vous engagez à n'utiliser Monark qu'à des fins licites. Il est strictement interdit d'utiliser le logiciel pour :</p>
					<ul>
						<li>Stocker, gérer ou diffuser des identifiants obtenus illégalement ou sans autorisation.</li>
						<li>Tenter de compromettre, de désactiver ou de contourner les mesures de sécurité de services ou de systèmes tiers qui ne vous appartiennent pas.</li>
					</ul>`,
			},
			{
				id: "warranty",
				title: "6. Exclusion de garanties",
				html: `<p>Dans toute la mesure permise par le droit applicable, le logiciel est fourni <strong>« EN L'ÉTAT »</strong> et <strong>« SELON DISPONIBILITÉ »</strong>, sans garantie d'aucune sorte, expresse ou implicite, y compris, sans s'y limiter, les garanties implicites de qualité marchande, d'adéquation à un usage particulier ou d'absence de contrefaçon.</p>
					<p>Bien que nous nous attachions à maintenir un niveau élevé de qualité, de sécurité et de tests, Xilistudios ne garantit pas que l'application fonctionnera sans interruption, sera totalement exempte d'erreurs ou sera compatible avec toute configuration matérielle ou logicielle.</p>`,
			},
			{
				id: "liability",
				title: "7. Limitation de responsabilité",
				html: `<p>En aucun cas Xilistudios, ses développeurs ou ses contributeurs ne sauraient être tenus responsables des dommages directs, indirects, accessoires, spéciaux, consécutifs ou punitifs, y compris la perte de bénéfices, la perte de données, l'interruption d'activité ou la panne informatique découlant de l'utilisation ou de l'impossibilité d'utiliser l'application.</p>`,
			},
			{
				id: "modifications",
				title: "8. Modifications des présentes conditions",
				html: `<p>Xilistudios se réserve le droit de modifier ou de mettre à jour ces Conditions d'utilisation à tout moment. La date de dernière révision sera actualisée en haut de cette page. La poursuite de l'utilisation de l'application après la publication d'une modification vaut acceptation des nouvelles conditions.</p>`,
			},
			{
				id: "contact",
				title: "9. Contact",
				html: `<p>Pour toute question ou demande relative à ces Conditions d'utilisation, contactez l'équipe Xilistudios par les canaux officiels :</p>
					<p><strong>Xilistudios</strong><br>Dépôt du projet : <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>Signalements et support : <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
			},
		],
	},oauth: {
		title: "Finalisation de l'authentification",
		desc: "Finalisation de l'authentification avec Monark Password Manager.",
		working: "Authentification…",
		workingBody: "Veuillez patienter pendant que nous finalisons votre authentification avec Monark.",
		statusPending: "Traitement de la réponse OAuth",
		statusOk: "Authentification réussie",
		successTitle: "Authentification réussie",
		successBody: "Terminez la connexion dans l'application Monark en copiant les identifiants ci-dessous.",
		copyHeading: "Copier les identifiants",
		copyBody: "Copiez ces identifiants et collez-les dans Monark pour terminer la configuration de la synchronisation.",
		copyButton: "Copier les identifiants en Base64",
		copied: "Identifiants copiés. Collez-les dans Monark.",
		copyFailed: "Impossible de copier les identifiants. Veuillez réessayer.",
		encodeFailed: "Une erreur est survenue lors de la préparation des identifiants.",
		instructions: "Instructions",
		steps: [
			"Cliquez sur « Copier les identifiants » ci-dessus.",
			"Revenez dans l'application Monark.",
			'Dans la fenêtre d\'authentification, cliquez sur "Paste Base64 credentials".',
			'Collez le contenu puis cliquez sur "Import and authenticate".',
		],
		closable: "Vous pouvez fermer cette fenêtre une fois les identifiants copiés.",
		errorTitle: "Échec de l'authentification",
		errorBody: "Une erreur s'est produite pendant le processus d'autorisation.",
		invalidTitle: "Réponse invalide",
		invalidBody: "Des paramètres requis sont absents (code ou state).",
		unknownError: "Erreur inconnue",
		closeWindow: "Fermer la fenêtre",
		home: "Accueil",
	},

	notFound: {
		title: "Page introuvable",
		desc: "La page demandée n'existe pas sur ce site.",
		body: "L'adresse est peut-être mal saisie, ou la page a été déplacée. Repartez de la présentation, ou parcourez les documents juridiques.",
		back: "Aller à la présentation",
	},
};