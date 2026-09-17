/** Source copy (Spanish, Spain). Translated from en.mjs. */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "es",
		htmlLang: "es",
		ogLocale: "es_ES",

		title: "Monark — Gestor de contraseñas de conocimiento cero",
		desc: "Gestor de contraseñas de código abierto y local-first. Argon2id y XChaCha20-Poly1305 en Rust. Sin cuentas, sin servidores, sin telemetría.",

		skip: "Saltar al contenido",
		nav: {
			features: "Funciones",
			privacy: "Privacidad",
			terms: "Términos",
		},
		download: "Descargar",
		releases: "Última versión",
		langLabel: "Idioma",
		langOther: "Otros idiomas",

		hero: {
			eyebrow: "Local-first · Conocimiento cero",
			title: `Tus claves.<br><span class="serif">Solo tuyas.</span>`,
			lede: "Monark es un gestor de contraseñas de código abierto que guarda tus credenciales en tu propia máquina. Sin cuenta, sin servidor de sincronización, sin telemetría: solo una caja fuerte cifrada allí donde vive.",
			ctaPrimary: "Descargar Monark",
			ctaSecondary: "Leer el código",
			meta: [
				["Compatible con", "Linux, macOS, Windows, Android, iOS"],
				["Cifrado", "XChaCha20-Poly1305"],
				["Derivación de clave", "Argon2id · 64 MB"],
				["Licencia", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "Qué hace",
			title: "Todo lo que debería hacer un gestor de contraseñas, y nada de lo que no debería.",
			lede: "Monark guarda inicios de sesión, notas y códigos de un solo uso en un único archivo cifrado que es tuyo. No hay ningún proveedor en medio, porque no hay ningún proveedor en medio.",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "Tu caja fuerte es un archivo en tu disco",
					body: "Las entradas se cifran antes de tocar el almacenamiento y se descifran solo mientras tienes la caja fuerte abierta. Monark funciona totalmente sin conexión; la red nunca interviene a menos que se lo pidas.",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "Criptografía hecha en Rust",
					body: "El núcleo criptográfico está escrito en Rust y se ejecuta de forma nativa, no dentro de la página.",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						['<span class="k">memoria</span>', '<span class="v">64 MB · 3 pasadas</span>'],
						['<span class="k">cifrado</span>', '<span class="v">xchacha20-poly1305</span>'],
						['<span class="k">clave</span>', '<span class="v">256 bits</span>'],
						['<span class="k">nonce</span>', '<span class="v">192 bits, aleatorio</span>'],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "Generador de contraseñas",
					body: "Contraseñas y frases de paso extraídas del CSPRNG del sistema operativo, con los conjuntos de caracteres y la longitud que elijas.",
				},
				{
					icon: "timer",
					span: 2,
					title: "Códigos de doble factor",
					body: "Guarda los secretos TOTP junto al inicio de sesión al que pertenecen y consulta el código actual desde la ventana de la caja fuerte.",
				},
				{
					icon: "cloud",
					span: 2,
					title: "Copia de seguridad cifrada opcional",
					body: "Copia la caja fuerte a tu propio Google Drive o a un servidor WebDAV. El archivo ya está cifrado antes de salir de tu dispositivo.",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "Un solo código para todos tus equipos y teléfonos",
					body: "Monark está construido sobre Tauri v2, así que el mismo núcleo en Rust y la misma interfaz llegan a Linux, macOS, Windows, Android e iOS sin arrastrar un entorno de ejecución Electron.",
					terminal: [
						['<span class="k">paquete</span>', '<span class="v">webview nativo</span>'],
						['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
						['<span class="k">interfaz</span>', '<span class="v">react 18 · tipado</span>'],
						['<span class="k">instalador</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
					],
				},
			],
		},specs: {
			eyebrow: "Bajo el capó",
			title: "Los parámetros, explicados sin rodeos.",
			lede: "Aquí nada es propietario y nada es secreto. Las primitivas exactas están documentadas en el repositorio y cubiertas por pruebas.",
			items: [
				["Derivación de clave", "<b>Argon2id</b> con 64 MB de memoria, 3 iteraciones y paralelismo de 4 vías, para encarecer las conjeturas asistidas por GPU."],
				["Cifrado autenticado", "<b>XChaCha20-Poly1305</b> (IETF) con claves de 256 bits y nonces aleatorios de 192 bits por operación."],
				["Aleatoriedad", "Cada clave, sal y nonce procede del <b>CSPRNG</b> del sistema operativo, nunca de un generador del propio lenguaje."],
				["Higiene de memoria", "Las claves derivadas y los secretos en claro se <b>borran al liberarse</b>, de modo que no quedan en memoria ya liberada."],
				["Almacenamiento", "Un único <b>archivo de caja fuerte</b> local que puedes mover, copiar o borrar. Las copias en la nube son exactamente los mismos bytes cifrados."],
				["Código fuente", "Con licencia <b>AGPL-3.0</b>. Compílalo tú mismo, audítalo o abre una incidencia contra la revisión exacta que ejecutes."],
			],
		},

		cta: {
			title: "Lee el código antes de confiarle tus contraseñas.",
			body: "Monark se publica desde un repositorio abierto, con sus pruebas, sus parámetros criptográficos y sus artefactos de versión en el mismo sitio. Verifica la compilación o compílalo tú mismo.",
			primary: "Obtener la última versión",
			secondary: "Ver el repositorio",
		},

		footer: {
			brand: "Un gestor de contraseñas de código abierto y local-first con cifrado de conocimiento cero, creado por Xilistudios.",
			cols: [
				["Documentos", [["Resumen", "index"], ["Política de Privacidad", "privacy"], ["Términos del Servicio", "terms"]]],
				["Proyecto", [["Código fuente", REPO], ["Informar de un problema", ISSUES], ["Licencia AGPL-3.0", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios. Monark es software libre bajo la AGPL-3.0.",
		},privacy: {
			title: "Política de Privacidad",
			desc: "Cómo trata Monark los datos: arquitectura de conocimiento cero, el ámbito de Google Drive que solicita y las obligaciones de Uso Limitado que cumple.",
			updated: "Última actualización: 17 de septiembre de 2026",
			version: "Versión 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. Introducción y compromiso de conocimiento cero",
					html: `<p>En <strong>Monark Password Manager</strong> (desarrollado por <strong>Xilistudios</strong>), la privacidad y la soberanía de los datos son principios fundacionales. Tus contraseñas, credenciales, notas y documentos confidenciales te pertenecen a ti y a nadie más.</p>
					<p>Monark funciona bajo una estricta <strong>arquitectura de conocimiento cero</strong> y un modelo <strong>local-first</strong>. No recopilamos tus datos, no los almacenamos en servidores que controlemos y no disponemos de ningún medio técnico para leer o descifrar tus contraseñas ni la clave maestra de tu caja fuerte. Todo el trabajo criptográfico ocurre en tu dispositivo.</p>`,
				},
				{
					id: "data",
					title: "2. Qué tratamos y qué no tratamos nunca",
					html: `<h3>2.1 Contenido de la caja fuerte — sin acceso</h3>
					<p>Tus contraseñas, nombres de usuario, URL, notas seguras y datos de autenticación en dos pasos se almacenan cifrados en tu propio hardware. Xilistudios nunca los recibe en claro ni los guarda en servidores externos.</p>
					<h3>2.2 Telemetría y rastreo</h3>
					<p>Monark no incluye rastreadores publicitarios, ni identificadores publicitarios, ni analíticas invasivas que registren tu comportamiento de navegación o tu identidad personal.</p>`,
				},
				{
					id: "google",
					title: "3. Uso de la API de Google y de Google Drive",
					html: `<p>Monark te ofrece la opción de mantener una copia de seguridad sincronizada en tu propia cuenta personal de Google Drive. Para hacerlo posible, la aplicación se autentica mediante OAuth y solicita únicamente el ámbito mínimo necesario:</p>
					<div class="callout">
						<h4>Ámbito solicitado: <code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>Este permiso permite <strong>únicamente</strong> a Monark crear, ver, modificar y eliminar los archivos y carpetas creados directamente por la propia aplicación Monark, con el fin de alojar tu copia de seguridad cifrada.</p>
						<p><strong>Monark no puede acceder, leer ni modificar ningún otro archivo, documento, foto o carpeta que ya esté presente en tu Google Drive.</strong></p>
					</div>
					<div class="compliance">
						<strong>Cumplimiento de los requisitos de Uso Limitado de Google.</strong><br>
						El uso y la transferencia por parte de Monark de la información recibida de las API de Google se ajustan a la <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Política de Datos de Usuario de los Servicios de API de Google</a>, incluidos los requisitos de Uso Limitado.
					</div>
					<h3>3.1 Restricciones estrictas sobre los datos de Google</h3>
					<ul>
						<li><strong>Sin venta ni comercialización:</strong> nunca vendemos, cedemos mediante licencia, comerciamos ni transferimos a terceros, corredores de datos ni agencias publicitarias los datos de usuario obtenidos a través de Google Drive.</li>
						<li><strong>Sin publicidad personalizada:</strong> ningún dato obtenido a través de las API de Google se utiliza para mostrar anuncios, elaborar perfiles comerciales ni hacer remarketing sobre ti.</li>
						<li><strong>Sin entrenamiento de IA:</strong> los datos obtenidos a través de las API de Google nunca se utilizan para entrenar grandes modelos de lenguaje, sistemas de aprendizaje automático ni algoritmos de inteligencia artificial.</li>
						<li><strong>Acceso humano restringido:</strong> ningún empleado o desarrollador de Xilistudios tiene acceso humano a los archivos de la caja fuerte almacenados en tu Google Drive, salvo cuando exista una obligación legal o cuando tú lo consientas explícitamente para una depuración técnica; incluso entonces, los datos están fuertemente cifrados de extremo a extremo.</li>
					</ul>`,
				},{
					id: "security",
					title: "4. Seguridad de los datos y cifrado",
					html: `<p>Antes de transmitir cualquier archivo de copia de seguridad a tu Google Drive, Monark aplica los estándares criptográficos actuales implementados en el núcleo seguro de Rust:</p>
					<ul>
						<li><strong>Derivación de clave (KDF):</strong> <code>Argon2id</code> con parámetros resistentes a la fuerza bruta y a la aceleración por GPU (64 MB de memoria, 3 iteraciones, paralelismo de 4 hilos).</li>
						<li><strong>Cifrado simétrico autenticado:</strong> <code>XChaCha20-Poly1305</code> (variante IETF) con claves de 256 bits y nonces aleatorios de 192 bits.</li>
						<li><strong>Protección de memoria:</strong> borrado seguro de las credenciales en memoria (<code>ZeroizeOnDrop</code>) para impedir ataques de extracción forense.</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. Control, derechos y eliminación de datos",
					html: `<p>Como usuario, conservas el control absoluto en todo momento:</p>
					<ul>
						<li><strong>Acceso y portabilidad:</strong> exporta tu caja fuerte en cualquier momento desde los ajustes de la aplicación.</li>
						<li><strong>Eliminación de copias de seguridad:</strong> borra los archivos de copia desde la propia aplicación Monark o eliminando la carpeta de Monark en tu almacenamiento de Google Drive.</li>
						<li><strong>Revocación de permisos:</strong> revoca en cualquier momento el acceso de Monark a tu cuenta de Google en la página oficial de permisos de Google: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. Enlaces a sitios de terceros",
					html: `<p>Monark puede ofrecer integración opcional con servicios de almacenamiento externos como Google Drive, Nextcloud o servidores WebDAV. Tu interacción con esos servicios se rige por la política de privacidad y los términos del servicio del proveedor correspondiente.</p>`,
				},
				{
					id: "changes",
					title: "7. Cambios en esta política",
					html: `<p>Nos reservamos el derecho de actualizar esta Política de Privacidad para reflejar mejoras de la aplicación, nuevas funciones o requisitos normativos. En caso de cambios sustanciales, publicaremos la versión actualizada en este sitio con una nueva fecha de entrada en vigor.</p>`,
				},
				{
					id: "contact",
					title: "8. Contacto",
					html: `<p>Si tienes preguntas sobre esta Política de Privacidad o sobre las prácticas de seguridad de Monark, puedes contactar con el equipo de desarrollo de Xilistudios a través de nuestro repositorio oficial en GitHub.</p>
					<p><strong>Xilistudios</strong><br>Repositorio y soporte: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},terms: {
			title: "Términos del Servicio",
			desc: "Las condiciones que rigen el uso de Monark: licencia AGPL-3.0, límites del modelo de conocimiento cero, almacenamiento de terceros y exclusiones de garantía.",
			updated: "Última actualización: 17 de septiembre de 2026",
			version: "Versión 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. Aceptación de estos términos",
					html: `<p>Al instalar, ejecutar o utilizar de cualquier otra forma <strong>Monark Password Manager</strong>, aceptas estos Términos del Servicio. Si no los aceptas, no utilices la aplicación.</p>`,
				},
				{
					id: "license",
					title: "2. Naturaleza del software y licencia",
					html: `<p>Monark es una aplicación de código abierto y local-first para la gestión de credenciales y contraseñas.</p>
					<p>El código fuente se distribuye bajo los términos de la <strong>GNU Affero General Public License versión 3.0 (AGPL-3.0)</strong>. Eres libre de inspeccionar, auditar, modificar y redistribuir el código conforme a las condiciones de dicha licencia. El texto completo de la licencia está disponible en el repositorio oficial del proyecto en GitHub.</p>`,
				},
				{
					id: "responsibility",
					title: "3. Responsabilidad del usuario y el modelo de conocimiento cero",
					html: `<div class="callout callout--warn">
						<h4>Aviso crítico sobre tu contraseña maestra</h4>
						<p>Monark opera bajo un modelo criptográfico de <strong>conocimiento cero</strong>. Tus datos se cifran en tu propio dispositivo con tu contraseña maestra y las claves derivadas (Argon2id y XChaCha20-Poly1305).</p>
						<p><strong>Xilistudios no almacena ni conoce tu contraseña maestra y no puede restablecerla bajo ninguna circunstancia. Si olvidas tu contraseña maestra y no dispones de una clave de recuperación ni de una copia de seguridad, tus datos no podrán recuperarse.</strong></p>
					</div>
					<p>Solo tú eres responsable de:</p>
					<ul>
						<li>Elegir una contraseña maestra robusta y custodiarla debidamente.</li>
						<li>Generar y conservar copias de seguridad de tus datos y de tus claves de recuperación.</li>
						<li>Mantener la seguridad física y lógica de los dispositivos en los que está instalado Monark.</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. Integración con servicios de terceros (Google Drive)",
					html: `<p>Monark admite la sincronización opcional con almacenamiento en la nube ofrecido por terceros, en particular <strong>Google Drive</strong> mediante autenticación OAuth.</p>
					<ul>
						<li>El uso de Google Drive está sujeto a los <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Términos del Servicio de Google</a>.</li>
						<li>Monark solicita acceso únicamente para gestionar los archivos de copia de seguridad generados por la propia aplicación (el ámbito <code>drive.file</code>), que se cifran de extremo a extremo antes de enviarse.</li>
						<li>Xilistudios no se responsabiliza de los fallos de conectividad, las interrupciones del servicio ni los límites de almacenamiento impuestos por los proveedores de nube de terceros.</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. Uso aceptable",
					html: `<p>Te comprometes a utilizar Monark únicamente con fines lícitos. Queda estrictamente prohibido usar el software para:</p>
					<ul>
						<li>Almacenar, gestionar o distribuir credenciales obtenidas de forma ilícita o sin autorización.</li>
						<li>Intentar vulnerar, desactivar o eludir las medidas de seguridad de servicios o sistemas de terceros que no te pertenezcan.</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. Exclusión de garantías",
					html: `<p>En la máxima medida permitida por la legislación aplicable, el software se proporciona <strong>"TAL CUAL"</strong> y <strong>"SEGÚN DISPONIBILIDAD"</strong>, sin garantías de ningún tipo, expresas o implícitas, incluidas, entre otras, las garantías implícitas de comerciabilidad, idoneidad para un fin concreto o no infracción.</p>
					<p>Aunque trabajamos por mantener altos estándares de calidad, seguridad y pruebas, Xilistudios no garantiza que la aplicación funcione sin interrupciones, esté totalmente libre de errores o sea compatible con toda configuración de hardware o software.</p>`,
				},
				{
					id: "liability",
					title: "7. Limitación de responsabilidad",
					html: `<p>En ningún caso Xilistudios, sus desarrolladores o colaboradores serán responsables de daños directos, indirectos, incidentales, especiales, consecuenciales o punitivos, incluidos el lucro cesante, la pérdida de datos, la interrupción de la actividad empresarial o los fallos informáticos derivados del uso o de la imposibilidad de uso de la aplicación.</p>`,
				},
				{
					id: "modifications",
					title: "8. Modificaciones de estos términos",
					html: `<p>Xilistudios se reserva el derecho de modificar o actualizar estos Términos del Servicio en cualquier momento. La fecha de la última revisión se actualizará en la parte superior de esta página. El uso continuado de la aplicación tras la publicación de cualquier cambio constituye la aceptación de los nuevos términos.</p>`,
				},
				{
					id: "contact",
					title: "9. Contacto",
					html: `<p>Para cualquier duda o solicitud relacionada con estos Términos del Servicio, contacta con el equipo de Xilistudios a través de los canales oficiales:</p>
					<p><strong>Xilistudios</strong><br>Repositorio del proyecto: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>Incidencias y soporte: <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},oauth: {
			title: "Completar la autenticación",
			desc: "Completando la autenticación con Monark Password Manager.",
			working: "Autenticando…",
			workingBody: "Espera mientras completamos tu autenticación con Monark.",
			statusPending: "Procesando la respuesta de OAuth",
			statusOk: "Autenticación correcta",
			successTitle: "Autenticación correcta",
			successBody: "Termina de iniciar sesión en la aplicación Monark copiando las credenciales de abajo.",
			copyHeading: "Copiar credenciales",
			copyBody: "Copia estas credenciales y pégalas en Monark para completar la configuración de la sincronización.",
			copyButton: "Copiar credenciales en Base64",
			copied: "Credenciales copiadas. Pégalas en Monark.",
			copyFailed: "No se han podido copiar las credenciales. Inténtalo de nuevo.",
			encodeFailed: "Algo ha fallado al preparar las credenciales.",
			instructions: "Instrucciones",
			steps: [
				"Haz clic en “Copiar credenciales” arriba.",
				"Vuelve a la aplicación Monark.",
				'En la ventana de autenticación, haz clic en "Pegar credenciales en Base64".',
				'Pega el contenido y haz clic en "Importar y autenticar".',
			],
			closable: "Puedes cerrar esta ventana una vez copiadas las credenciales.",
			errorTitle: "La autenticación ha fallado",
			errorBody: "Se ha producido un error durante el proceso de autorización.",
			invalidTitle: "Respuesta no válida",
			invalidBody: "Faltan parámetros obligatorios (code o state).",
			unknownError: "Error desconocido",
			closeWindow: "Cerrar ventana",
			home: "Inicio",
		},

		notFound: {
			title: "Página no encontrada",
			desc: "La página que has solicitado no existe en este sitio.",
			body: "Puede que la dirección esté mal escrita o que la página se haya movido. Empieza por el resumen o consulta los documentos legales.",
			back: "Ir al resumen",
		},
	};