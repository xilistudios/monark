/**
 * GeneralSettings component for language selection.
 * Handles language change, error validation, Redux and i18n integration.
 * @module GeneralSettings
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { setLanguage } from "../../redux/actions/preferences";
import { LANGUAGES, VALID_LANGUAGES } from "../../share/settings";

function GeneralSettings() {
	const dispatch = useDispatch();
	const preferences = useSelector(
		(state: any) => state.preferences.preferences,
	);
	const loading = useSelector((state: any) => state.preferences.loading);
	const language = preferences.language;
	const { t } = useTranslation("settings");

	const [error, setError] = useState("");
	useEffect(() => {
		if (!VALID_LANGUAGES.includes(language)) {
			setError(t("errors.invalidLanguage"));
		} else {
			setError("");
		}
	}, [language, t]);

	return (
		<section>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-base-content mb-2">
					{t("general", "General")}
				</h2>
				<p className="text-sm text-base-content/60">
					{t("general.description", "Manage your application preferences")}
				</p>
			</div>

			<div className="bg-base-50 border border-base-200 rounded-xl p-6">
				<form
					className="space-y-6"
					aria-label={t("general.languageAriaLabel", "Language Selection")}
					role="group"
					aria-labelledby="settingsSection"
					tabIndex={0}
				>
					<div>
						<label
							htmlFor="language"
							className="block text-sm font-medium text-base-content mb-2"
						>
							{t("language")}
						</label>
						<div className="relative">
							<select
								id="language"
								className="w-full px-4 py-3 bg-base-100 border border-base-300 rounded-lg text-base-content focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								value={language}
								onChange={(e) => dispatch(setLanguage(e.target.value))}
								disabled={loading}
								aria-label={t(
									"general.languageAriaLabel",
									"Application language",
								)}
								aria-invalid={!!error}
								aria-describedby="languageError"
							>
								{LANGUAGES.map((lang) => (
									<option key={lang.code} value={lang.code}>
										{lang.label}
									</option>
								))}
							</select>
							<div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-base-content/50">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</div>
						</div>
					</div>

					<div id="languageError" role="alert">
						{error && (
							<div className="flex items-start gap-3 p-4 bg-error/10 border border-error/20 rounded-lg">
								<svg
									className="w-5 h-5 text-error shrink-0 mt-0.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<span className="text-sm text-error">{error}</span>
							</div>
						)}
					</div>
				</form>
			</div>
		</section>
	);
}

export default GeneralSettings;
