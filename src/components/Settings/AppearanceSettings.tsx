/**
 * AppearanceSettings component for theme selection.
 * Displays available themes, handles selection via Redux, and supports i18n.
 * @module AppearanceSettings
 */

import { useTranslation } from "react-i18next";
import { useDispatch } from "react-redux";
import { setTheme } from "../../redux/actions/preferences";
import { DAISYUI_THEMES } from "../../share/themes";

function AppearanceSettings() {
	const dispatch = useDispatch();
	const { t } = useTranslation("settings");

	return (
		<section className="mb-8">
			<div className="form-control w-full mt-4">
				<label className="label">
					<span className="label-text">{t("theme")}</span>
				</label>
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4 w-full">
					{DAISYUI_THEMES.map((thm) => (
						<div
							key={thm}
							data-theme={thm}
							className="card w-40 bg-base-100 shadow-xl transition-all duration-500 cursor-pointer"
							onClick={() => dispatch(setTheme(thm))}
						>
							<div className="card-body">
								<h2 className="card-title">
									{t(
										`themes.${thm}`,
										thm.charAt(0).toUpperCase() + thm.slice(1),
									)}
								</h2>
								<p className="text-sm">
									{t("appearance.samplePreview", "Sample card preview")}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export default AppearanceSettings;
