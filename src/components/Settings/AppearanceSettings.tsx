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
		<section>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-base-content mb-2">
					{t("appearance", "Appearance")}
				</h2>
				<p className="text-sm text-base-content/60">
					{t(
						"appearance.description",
						"Customize the look and feel of the application",
					)}
				</p>
			</div>

			<div className="bg-base-50 border border-base-200 rounded-xl p-6">
				<div className="mb-4">
					<label className="block text-sm font-medium text-base-content mb-2">
						{t("theme")}
					</label>
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
					{DAISYUI_THEMES.map((thm) => (
						<div
							key={thm}
							data-theme={thm}
							className="group relative bg-base-100 border border-base-200 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-lg hover:border-primary/50 hover:-translate-y-1"
							onClick={() => dispatch(setTheme(thm))}
						>
							<div className="p-4">
								<div className="aspect-square rounded-lg bg-base-200 mb-3 flex items-center justify-center overflow-hidden">
									<div className="w-full h-full space-y-2 p-2">
										<div className="h-2 w-3/4 bg-primary/30 rounded"></div>
										<div className="h-2 w-1/2 bg-base-content/20 rounded"></div>
										<div className="h-2 w-5/6 bg-base-content/20 rounded"></div>
									</div>
								</div>
								<h3 className="text-sm font-medium text-base-content text-center truncate">
									{t(
										`themes.${thm}`,
										thm.charAt(0).toUpperCase() + thm.slice(1),
									)}
								</h3>
							</div>
							<div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export default AppearanceSettings;
