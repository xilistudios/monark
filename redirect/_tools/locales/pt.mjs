/** Textos traduzidos (português do Brasil). Traduzidos a partir do conjunto canônico em inglês. */

import { ISSUES, LICENSE, REPO } from "../links.mjs";

export default {
		code: "pt",
		htmlLang: "pt-BR",
		ogLocale: "pt_BR",

		title: "Monark — gerenciador de senhas zero-knowledge",
		desc: "Gerenciador de senhas local-first e de código aberto. Argon2id e XChaCha20-Poly1305 em Rust. Sem contas, sem servidores, sem telemetria.",

		skip: "Ir para o conteúdo",
		nav: {
			features: "Recursos",
			privacy: "Privacidade",
			terms: "Termos",
		},
		download: "Baixar",
		releases: "Última versão",
		langLabel: "Idioma",
		langOther: "Outros idiomas",

		hero: {
			eyebrow: "Local-first · Zero-knowledge",
			title: `Suas chaves.<br><span class="serif">Só suas.</span>`,
			lede: "O Monark é um gerenciador de senhas de código aberto que mantém suas credenciais na sua própria máquina. Sem conta, sem servidor de sincronização, sem telemetria — apenas um cofre criptografado onde ele está.",
			ctaPrimary: "Baixar o Monark",
			ctaSecondary: "Ler o código-fonte",
			meta: [
				["Roda em", "Linux, macOS, Windows, Android, iOS"],
				["Cifra", "XChaCha20-Poly1305"],
				["Derivação de chave", "Argon2id · 64 MB"],
				["Licença", "AGPL-3.0"],
			],
		},

		features: {
			eyebrow: "O que ele faz",
			title: "Tudo o que um gerenciador de senhas deve fazer, e nada do que não deve.",
			lede: "O Monark guarda logins, notas e códigos de uso único em um único arquivo criptografado que pertence a você. Não há fornecedor no meio, porque não há fornecedor no meio.",
			cells: [
				{
					icon: "folder",
					span: 4,
					title: "Seu cofre é um arquivo no seu disco",
					body: "As entradas são criptografadas antes de tocar o armazenamento e descriptografadas apenas enquanto o cofre está aberto. O Monark funciona totalmente offline; a rede nunca entra em cena, a menos que você peça.",
				},
				{
					icon: "lock",
					span: 2,
					dark: true,
					title: "Criptografia feita em Rust",
					body: "O núcleo criptográfico é escrito em Rust e roda nativamente, não na página.",
					terminal: [
						['<span class="k">kdf</span>', '<span class="v">argon2id</span>'],
						['<span class="k">memória</span>', '<span class="v">64 MB · 3 passagens</span>'],
						['<span class="k">cifra</span>', '<span class="v">xchacha20-poly1305</span>'],
						['<span class="k">chave</span>', '<span class="v">256 bits</span>'],
						['<span class="k">nonce</span>', '<span class="v">192 bits, aleatório</span>'],
					],
				},
				{
					icon: "key",
					span: 2,
					title: "Gerador de senhas",
					body: "Senhas e frases-senha geradas a partir do CSPRNG do sistema operacional, com os conjuntos de caracteres e o comprimento que você escolher.",
				},
				{
					icon: "timer",
					span: 2,
					title: "Códigos de dois fatores",
					body: "Guarde os segredos TOTP ao lado do login a que pertencem e leia o código atual na janela do cofre.",
				},
				{
					icon: "cloud",
					span: 2,
					title: "Backup criptografado opcional",
					body: "Copie o cofre para o seu próprio Google Drive ou para um servidor WebDAV. O arquivo já está criptografado antes de sair do seu dispositivo.",
				},
				{
					icon: "devices",
					span: 6,
					wide: true,
					title: "Uma base de código para todos os seus computadores e celulares",
					body: "O Monark é construído sobre o Tauri v2, então o mesmo núcleo em Rust e a mesma interface chegam a Linux, macOS, Windows, Android e iOS sem carregar um runtime Electron junto.",
					terminal: [
						['<span class="k">empacotamento</span>', '<span class="v">webview nativo</span>'],
						['<span class="k">runtime</span>', '<span class="v">tauri v2 · rust</span>'],
						['<span class="k">interface</span>', '<span class="v">react 18 · tipada</span>'],
						['<span class="k">instalador</span>', '<span class="v">.deb .rpm .dmg .msi .apk</span>'],
					],
				},
			],
		},specs: {
			eyebrow: "Por dentro",
			title: "Os parâmetros, em linguagem simples.",
			lede: "Nada aqui é proprietário e nada é secreto. As primitivas exatas estão documentadas no repositório e cobertas por testes.",
			items: [
				["Derivação de chave", "<b>Argon2id</b> com 64 MB de memória, 3 iterações e paralelismo de 4 vias, para tornar caras as tentativas de adivinhação com apoio de GPU."],
				["Criptografia autenticada", "<b>XChaCha20-Poly1305</b> (IETF) com chaves de 256 bits e nonces aleatórios de 192 bits por operação."],
				["Aleatoriedade", "Cada chave, salt e nonce vem do <b>CSPRNG</b> do sistema operacional, nunca de um gerador da própria linguagem."],
				["Higiene de memória", "Chaves derivadas e segredos em texto claro são <b>zerados na liberação</b>, para que não permaneçam em memória livre."],
				["Armazenamento", "Um único <b>arquivo de cofre</b> local que você pode mover, copiar ou apagar. As cópias na nuvem são os mesmos bytes criptografados."],
				["Código-fonte", "Licenciado sob <b>AGPL-3.0</b>. Compile você mesmo, audite ou abra uma issue contra a revisão exata que você executa."],
			],
		},

		cta: {
			title: "Leia o código antes de confiar suas senhas a ele.",
			body: "O Monark é publicado a partir de um repositório aberto, com seus testes, parâmetros criptográficos e artefatos de release no mesmo lugar. Verifique a compilação ou compile você mesmo.",
			primary: "Obter a última versão",
			secondary: "Ver o repositório",
		},

		footer: {
			brand: "Um gerenciador de senhas de código aberto, local-first e com criptografia zero-knowledge, desenvolvido pela Xilistudios.",
			cols: [
				["Documentos", [["Visão geral", "index"], ["Política de Privacidade", "privacy"], ["Termos de Serviço", "terms"]]],
				["Projeto", [["Código-fonte", REPO], ["Reportar um problema", ISSUES], ["Licença AGPL-3.0", LICENSE]]],
			],
			baseLeft: "© 2026 Xilistudios. Monark é software livre sob a AGPL-3.0.",
		},privacy: {
			title: "Política de Privacidade",
			desc: "Como o Monark trata os dados: arquitetura zero-knowledge, o escopo do Google Drive que ele solicita e os compromissos de Uso Limitado que ele cumpre.",
			updated: "Última atualização: 17 de setembro de 2026",
			version: "Versão 1.0",
			sections: [
				{
					id: "introduction",
					title: "1. Introdução e compromisso zero-knowledge",
					html: `<p>No <strong>Monark Password Manager</strong> (desenvolvido pela <strong>Xilistudios</strong>), a privacidade e a soberania dos dados são princípios fundadores. Suas senhas, credenciais, notas e documentos confidenciais pertencem a você e a mais ninguém.</p>
					<p>O Monark opera sob uma <strong>arquitetura zero-knowledge</strong> estrita e um modelo <strong>local-first</strong>. Não coletamos seus dados, não os armazenamos em servidores que controlamos e não temos meios técnicos de ler ou descriptografar suas senhas nem a chave mestra do seu cofre. Todo o trabalho criptográfico acontece no seu dispositivo.</p>`,
				},
				{
					id: "data",
					title: "2. O que tratamos e o que nunca tratamos",
					html: `<h3>2.1 Conteúdo do cofre — sem acesso</h3>
					<p>Suas senhas, nomes de usuário, URLs, notas seguras e dados de autenticação de dois fatores ficam armazenados de forma criptografada no seu próprio hardware. A Xilistudios nunca os recebe em texto claro e nunca os armazena em servidores externos.</p>
					<h3>2.2 Telemetria e rastreamento</h3>
					<p>O Monark não contém rastreadores publicitários, identificadores de publicidade nem análises invasivas que registrem seu comportamento de navegação ou sua identidade pessoal.</p>`,
				},
				{
					id: "google",
					title: "3. Uso da API do Google e do Google Drive",
					html: `<p>O Monark oferece a opção de manter um backup sincronizado na sua própria conta pessoal do Google Drive. Para isso, o aplicativo autentica-se via OAuth e solicita apenas o único escopo mínimo necessário:</p>
					<div class="callout">
						<h4>Escopo solicitado: <code>https://www.googleapis.com/auth/drive.file</code></h4>
						<p>Esta permissão permite <strong>apenas</strong> que o Monark crie, visualize, modifique e apague os arquivos e pastas criados diretamente pelo próprio aplicativo Monark, a fim de armazenar seu backup criptografado.</p>
						<p><strong>O Monark não consegue acessar, ler ou modificar qualquer outro arquivo, documento, foto ou pasta já presente no seu Google Drive.</strong></p>
					</div>
					<div class="compliance">
						<strong>Conformidade com os requisitos de Uso Limitado do Google.</strong><br>
						O uso e a transferência de informações recebidas das APIs do Google pelo Monark obedecem à <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado.
					</div>
					<h3>3.1 Restrições estritas aos dados do Google</h3>
					<ul>
						<li><strong>Sem venda ou comercialização:</strong> nunca vendemos, licenciamos, negociamos nem transferimos a terceiros, corretores de dados ou agências de publicidade os dados de usuário obtidos pelo Google Drive.</li>
						<li><strong>Sem publicidade personalizada:</strong> nenhum dado obtido por meio das APIs do Google é usado para exibir anúncios, montar perfis comerciais ou fazer retargeting de você.</li>
						<li><strong>Sem treinamento de IA:</strong> dados obtidos por meio das APIs do Google nunca são usados para treinar LLM, sistemas de aprendizado de máquina ou algoritmos de inteligência artificial.</li>
						<li><strong>Acesso humano restrito:</strong> nenhum funcionário ou desenvolvedor da Xilistudios tem acesso humano aos arquivos de cofre armazenados no seu Google Drive, exceto quando houver exigência legal ou quando você consentir expressamente para fins de depuração técnica — e, ainda assim, os dados permanecem fortemente criptografados em todo o trajeto.</li>
					</ul>`,
				},
				{
					id: "security",
					title: "4. Segurança dos dados e criptografia",
					html: `<p>Antes de qualquer arquivo de backup ser transmitido ao seu Google Drive, o Monark aplica padrões criptográficos modernos implementados no núcleo seguro em Rust:</p>
					<ul>
						<li><strong>Derivação de chave (KDF):</strong> <code>Argon2id</code> com parâmetros resistentes a força bruta e ao uso de aceleração por GPU (64 MB de memória, 3 iterações, paralelismo de 4 threads).</li>
						<li><strong>Criptografia simétrica autenticada:</strong> <code>XChaCha20-Poly1305</code> (variante IETF) com chaves de 256 bits e nonces aleatórios de 192 bits.</li>
						<li><strong>Proteção de memória:</strong> apagamento seguro das credenciais em memória (<code>ZeroizeOnDrop</code>) para impedir ataques de extração forense.</li>
					</ul>`,
				},
				{
					id: "control",
					title: "5. Controle, direitos e exclusão de dados",
					html: `<p>Como usuário, você mantém controle absoluto em todos os momentos:</p>
					<ul>
						<li><strong>Acesso e portabilidade:</strong> exporte seu cofre a qualquer momento nas configurações do aplicativo.</li>
						<li><strong>Exclusão de backups:</strong> remova os arquivos de backup dentro do próprio Monark ou apagando a pasta Monark no seu armazenamento do Google Drive.</li>
						<li><strong>Revogação de permissões:</strong> revogue o acesso do Monark à sua conta Google a qualquer momento na página oficial de permissões do Google: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
					</ul>`,
				},
				{
					id: "third-parties",
					title: "6. Links para sites de terceiros",
					html: `<p>O Monark pode oferecer integração opcional com serviços de armazenamento externos, como Google Drive, Nextcloud ou servidores WebDAV. Sua interação com esses serviços rege-se pela política de privacidade e pelos termos de serviço do respectivo provedor.</p>`,
				},
				{
					id: "changes",
					title: "7. Alterações nesta política",
					html: `<p>Reservamo-nos o direito de atualizar esta Política de Privacidade para refletir melhorias no aplicativo, novos recursos ou exigências regulatórias. Em caso de alterações substanciais, publicaremos a versão atualizada neste site com uma nova data de vigência.</p>`,
				},
				{
					id: "contact",
					title: "8. Contato",
					html: `<p>Se você tiver dúvidas sobre esta Política de Privacidade ou sobre as práticas de segurança do Monark, pode falar com a equipe de desenvolvimento da Xilistudios pelo nosso repositório oficial no GitHub.</p>
					<p><strong>Xilistudios</strong><br>Repositório e suporte: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a></p>`,
				},
			],
		},terms: {
			title: "Termos de Serviço",
			desc: "Os termos que regem o uso do Monark: licenciamento AGPL-3.0, os limites do modelo zero-knowledge, armazenamento de terceiros e exclusões de garantia.",
			updated: "Última atualização: 17 de setembro de 2026",
			version: "Versão 1.0",
			sections: [
				{
					id: "acceptance",
					title: "1. Aceitação destes termos",
					html: `<p>Ao instalar, executar ou de qualquer outra forma usar o <strong>Monark Password Manager</strong>, você concorda com estes Termos de Serviço. Se não os aceitar, não use o aplicativo.</p>`,
				},
				{
					id: "license",
					title: "2. Natureza do software e licença",
					html: `<p>O Monark é um aplicativo local-first e de código aberto para gerenciamento de credenciais e senhas.</p>
					<p>O código-fonte é distribuído sob os termos da <strong>GNU Affero General Public License versão 3.0 (AGPL-3.0)</strong>. Você é livre para inspecionar, auditar, modificar e redistribuir o código nos termos dessa licença. O texto integral da licença está disponível no repositório oficial do projeto no GitHub.</p>`,
				},
				{
					id: "responsibility",
					title: "3. Responsabilidade do usuário e o modelo zero-knowledge",
					html: `<div class="callout callout--warn">
						<h4>Aviso crítico sobre a sua senha mestra</h4>
						<p>O Monark opera sob um modelo criptográfico <strong>zero-knowledge</strong>. Seus dados são criptografados no seu próprio dispositivo usando a sua senha mestra e as chaves derivadas (Argon2id e XChaCha20-Poly1305).</p>
						<p><strong>A Xilistudios não armazena, não conhece e não pode redefinir a sua senha mestra em nenhuma circunstância. Se você esquecer a senha mestra e não tiver uma chave de recuperação ou um backup, seus dados não poderão ser recuperados.</strong></p>
					</div>
					<p>Você é o único responsável por:</p>
					<ul>
						<li>Escolher uma senha mestra forte e mantê-la em segurança.</li>
						<li>Gerar e guardar backups dos seus dados e das chaves de recuperação.</li>
						<li>Manter a segurança física e lógica dos dispositivos onde o Monark está instalado.</li>
					</ul>`,
				},
				{
					id: "google",
					title: "4. Integração com serviços de terceiros (Google Drive)",
					html: `<p>O Monark oferece suporte à sincronização opcional com armazenamento em nuvem fornecido por terceiros, em especial o <strong>Google Drive</strong>, por meio de autenticação OAuth.</p>
					<ul>
						<li>O uso do Google Drive está sujeito aos <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Termos de Serviço do Google</a>.</li>
						<li>O Monark solicita acesso apenas para gerenciar os arquivos de backup gerados pelo próprio aplicativo (o escopo <code>drive.file</code>), que são criptografados no seu dispositivo antes do envio.</li>
						<li>A Xilistudios não é responsável por falhas de conectividade, interrupções de serviço ou limites de armazenamento impostos por provedores de nuvem de terceiros.</li>
					</ul>`,
				},
				{
					id: "acceptable-use",
					title: "5. Uso aceitável",
					html: `<p>Você concorda em usar o Monark apenas para finalidades lícitas. É estritamente proibido usar o software para:</p>
					<ul>
						<li>Armazenar, gerenciar ou distribuir credenciais obtidas de forma ilegal ou sem autorização.</li>
						<li>Tentar violar, desativar ou contornar as medidas de segurança de serviços ou sistemas de terceiros que não lhe pertencem.</li>
					</ul>`,
				},
				{
					id: "warranty",
					title: "6. Exclusão de garantias",
					html: `<p>Na máxima extensão permitida pela lei aplicável, o software é fornecido <strong>"COMO ESTÁ"</strong> e <strong>"CONFORME DISPONÍVEL"</strong>, sem garantias de qualquer espécie, expressas ou implícitas, incluindo, entre outras, as garantias implícitas de comerciabilidade, adequação a uma finalidade específica ou não violação.</p>
					<p>Embora trabalhemos para manter padrões elevados de qualidade, segurança e testes, a Xilistudios não garante que o aplicativo funcionará de forma ininterrupta, estará totalmente livre de erros ou será compatível com toda configuração de hardware ou software.</p>`,
				},
				{
					id: "liability",
					title: "7. Limitação de responsabilidade",
					html: `<p>Em nenhuma circunstância a Xilistudios, seus desenvolvedores ou colaboradores serão responsáveis por danos diretos, indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo lucros cessantes, perda de dados, interrupção de negócios ou falha de computador decorrentes do uso ou da impossibilidade de usar o aplicativo.</p>`,
				},
				{
					id: "modifications",
					title: "8. Modificações destes termos",
					html: `<p>A Xilistudios reserva-se o direito de modificar ou atualizar estes Termos de Serviço a qualquer momento. A data da última revisão será atualizada no topo desta página. O uso continuado do aplicativo após a publicação de qualquer alteração constitui aceitação dos novos termos.</p>`,
				},
				{
					id: "contact",
					title: "9. Contato",
					html: `<p>Para qualquer dúvida ou solicitação relacionada a estes Termos de Serviço, fale com a equipe da Xilistudios pelos canais oficiais:</p>
					<p><strong>Xilistudios</strong><br>Repositório do projeto: <a href="${REPO}" target="_blank" rel="noopener noreferrer">${REPO}</a><br>Relatos e suporte: <a href="${ISSUES}" target="_blank" rel="noopener noreferrer">${ISSUES}</a></p>`,
				},
			],
		},oauth: {
			title: "Concluindo a autenticação",
			desc: "Concluindo a autenticação com o Monark Password Manager.",
			working: "Autenticando…",
			workingBody: "Aguarde enquanto concluímos sua autenticação com o Monark.",
			statusPending: "Processando a resposta do OAuth",
			statusOk: "Autenticação bem-sucedida",
			successTitle: "Autenticação bem-sucedida",
			successBody: "Conclua o login no aplicativo Monark copiando as credenciais abaixo.",
			copyHeading: "Copiar credenciais",
			copyBody: "Copie estas credenciais e cole-as no Monark para concluir a configuração da sincronização.",
			copyButton: "Copiar credenciais em Base64",
			copied: "Credenciais copiadas. Cole-as no Monark.",
			copyFailed: "Não foi possível copiar as credenciais. Tente novamente.",
			encodeFailed: "Algo deu errado ao preparar as credenciais.",
			instructions: "Instruções",
			steps: [
				"Clique em “Copiar credenciais” acima.",
				"Volte ao aplicativo Monark.",
				'Na janela de autenticação, clique em "Colar credenciais em Base64".',
				'Cole o conteúdo e clique em "Importar e autenticar".',
			],
			closable: "Você pode fechar esta janela depois de copiar as credenciais.",
			errorTitle: "Falha na autenticação",
			errorBody: "Ocorreu um erro durante o processo de autorização.",
			invalidTitle: "Resposta inválida",
			invalidBody: "Faltam parâmetros obrigatórios (code ou state).",
			unknownError: "Erro desconhecido",
			closeWindow: "Fechar janela",
			home: "Início",
		},

		notFound: {
			title: "Página não encontrada",
			desc: "A página solicitada não existe neste site.",
			body: "O endereço pode estar digitado errado, ou a página pode ter sido movida. Comece pela visão geral ou navegue pelos documentos legais.",
			back: "Ir para a visão geral",
		},
	};