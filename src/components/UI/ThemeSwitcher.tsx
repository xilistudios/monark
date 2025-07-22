import { useEffect, useState } from "react";

const DAISYUI_THEMES = [
	"light",
	"dark",
	"cupcake",
	"bumblebee",
	"emerald",
	"corporate",
	"synthwave",
	"retro",
	"cyberpunk",
	"valentine",
	"halloween",
	"garden",
	"forest",
	"aqua",
	"lofi",
	"pastel",
	"fantasy",
	"wireframe",
	"black",
	"luxury",
	"dracula",
	"cmyk",
	"autumn",
	"business",
	"acid",
	"lemonade",
	"night",
	"coffee",
	"winter",
] as const;

type DaisyUITheme = (typeof DAISYUI_THEMES)[number];

const THEME_STORAGE_KEY = "daisyui-theme";
const THEME_EXPIRATION_DAYS = 365;

export default function ThemeSwitcher() {
	const [currentTheme, setCurrentTheme] = useState<DaisyUITheme>("light");
	const [isSystemPreferredDark, setIsSystemPreferredDark] = useState(false);

	// Initialize theme from storage or system preference
	useEffect(() => {
		const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
		const storedExpiration = localStorage.getItem(
			`${THEME_STORAGE_KEY}-expiry`,
		);

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		setIsSystemPreferredDark(mediaQuery.matches);

		if (
			storedTheme &&
			storedExpiration &&
			new Date() < new Date(storedExpiration)
		) {
			applyTheme(storedTheme as DaisyUITheme);
		} else {
			const systemTheme = mediaQuery.matches ? "dark" : "light";
			applyTheme(systemTheme);
		}

		mediaQuery.addEventListener("change", (e) => {
			setIsSystemPreferredDark(e.matches);
			if (!storedTheme) applyTheme(e.matches ? "dark" : "light");
		});
	}, []);

	const applyTheme = (theme: DaisyUITheme) => {
		document.documentElement.setAttribute("data-theme", theme);
		setCurrentTheme(theme);
	};

	const handleThemeChange = (theme: DaisyUITheme) => {
		applyTheme(theme);
		const expirationDate = new Date();
		expirationDate.setDate(expirationDate.getDate() + THEME_EXPIRATION_DAYS);

		localStorage.setItem(THEME_STORAGE_KEY, theme);
		localStorage.setItem(
			`${THEME_STORAGE_KEY}-expiry`,
			expirationDate.toISOString(),
		);
	};

	return (
		<div
			className="dropdown dropdown-end"
			role="navigation"
			aria-label="Theme Selection"
		>
			<div
				tabIndex={0}
				role="button"
				className="btn btn-ghost gap-1 normal-case"
				aria-haspopup="listbox"
				aria-expanded="false"
			>
				<svg
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2m-2 2a2 2 0 01-2-2m2-2a2 2 0 00-2-2h-2m-4-6h4m-8 6V7m0 0H5m4 0h4"
					/>
				</svg>
				<span className="hidden md:inline">Theme</span>
				<svg
					className="ml-1 h-3 w-3"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</div>

			<ul
				tabIndex={0}
				className="dropdown-content menu rounded-box z-[1] mt-3 h-96 w-52 overflow-y-auto p-2 shadow-2xl"
				role="listbox"
				aria-label="Available Themes"
			>
				{DAISYUI_THEMES.map((theme) => (
					<li key={theme} role="option" aria-selected={theme === currentTheme}>
						<button
							className={`btn btn-sm btn-block justify-start ${theme === currentTheme ? "btn-active" : ""}`}
							onClick={() => handleThemeChange(theme)}
							onKeyDown={(e) => e.key === "Enter" && handleThemeChange(theme)}
							aria-label={`Select ${theme} theme`}
							data-theme={theme}
						>
							{theme.charAt(0).toUpperCase() + theme.slice(1)}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
