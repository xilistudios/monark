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
		<section className="space-y-10 animate-in fade-in duration-300">
			<div className="border-b border-base-content/10 pb-6">
				<h2 className="text-2xl font-semibold text-base-content tracking-tight mb-2">
					{t('general', 'General')}
				</h2>
				<p className="text-base-content/60 text-sm">
					{t('general.description', 'Manage your application preferences')}
				</p>
			</div>

			<div>
				<form
					className="space-y-6 max-w-md"
					aria-label={t("general.languageAriaLabel", "Language Selection")}
					role="group"
					aria-labelledby="settingsSection"
					tabIndex={0}
				>
					<div className="space-y-2">
						<label htmlFor="language" className="block text-sm font-medium text-base-content">
							{t("language")}
						</label>
						<div className="relative group">
							<select
								id="language"
								className="w-full px-4 py-2.5 bg-transparent border border-base-content/20 rounded-md text-base-content focus:outline-none focus:ring-1 focus:ring-base-content focus:border-base-content transition-colors duration-200 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:border-base-content/40 text-sm"
								value={language}
								onChange={(e) => dispatch(setLanguage(e.target.value))}
								disabled={loading}
								aria-label={t("general.languageAriaLabel", "Application language")}
								aria-invalid={!!error}
								aria-describedby="languageError"
							>
								{LANGUAGES.map((lang) => (
									<option key={lang.code} value={lang.code}>
										{lang.label}
									</option>
								))}
							</select>
							<div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-base-content/40">
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
								</svg>
							</div>
						</div>
					</div>

					<div id="languageError" role="alert">
						{error && (
							<div className="flex items-start gap-2 p-3 bg-error/5 text-error text-sm rounded-md">
								<svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<span>{error}</span>
							</div>
						)}
					</div>
				</form>
			</div>
		</section>
	);
}

export default GeneralSettings;
