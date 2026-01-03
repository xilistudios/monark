/**
 * ResetSection component for resetting preferences to defaults.
 * Handles confirmation, Redux dispatch, i18n, and accessibility.
 * @module ResetSection
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { setPreferences } from "../../redux/actions/preferences";
import { DEFAULT_SETTINGS } from "../../share/settings";
import { settingsStore } from "../../store/settings";
import { Modal } from "../UI/Modal";

function ResetSection() {
	const dispatch = useDispatch();
	const loading = useSelector((state: any) => state.preferences.loading);
	const { t } = useTranslation("settings");
	const [modalOpen, setModalOpen] = useState(false);
	const [clearLoading, setClearLoading] = useState(false);
	const [clearError, setClearError] = useState("");
	const [clearSuccess, setClearSuccess] = useState(false);
	const clearBtnRef = useRef<HTMLButtonElement>(null);

	const handleClear = async () => {
		setClearLoading(true);
		setClearError("");
		setClearSuccess(false);
		try {
			await settingsStore.clear();
			setClearSuccess(true);
		} catch (err) {
			setClearError(t("clearDataError", "Failed to clear app data"));
		}
		setClearLoading(false);
		setTimeout(() => {
			setModalOpen(false);
			clearBtnRef.current?.focus();
		}, 1200);
	};

	return (
		<section>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-base-content mb-2">
					{t("reset", "Reset")}
				</h2>
				<p className="text-sm text-base-content/60">
					{t(
						"reset.description",
						"Reset preferences or clear all application data",
					)}
				</p>
			</div>

			<div className="space-y-4">
				<div className="bg-base-50 border border-base-200 rounded-xl p-6">
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1">
							<h3 className="font-medium text-base-content mb-1">
								{t("resetButton", "Reset to Defaults")}
							</h3>
							<p className="text-sm text-base-content/60">
								{t(
									"reset.description",
									"Reset all preferences to their default values",
								)}
							</p>
						</div>
						<button
							className="px-4 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg font-medium hover:bg-base-200 hover:border-base-400 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
							aria-label={t("general.resetAriaLabel", "Reset to Defaults")}
							onClick={() => dispatch(setPreferences(DEFAULT_SETTINGS))}
							disabled={loading}
						>
							{t("resetButton")}
						</button>
					</div>
				</div>

				<div className="bg-error/5 border border-error/20 rounded-xl p-6">
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1">
							<div className="flex items-center gap-2 mb-1">
								<svg
									className="w-5 h-5 text-error"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
								<h3 className="font-medium text-error">
									{t("clearDataButton", "Clear All App Data")}
								</h3>
							</div>
							<p className="text-sm text-base-content/60">
								{t(
									"clearDataDescription",
									"This will erase all app data. This action cannot be undone.",
								)}
							</p>
						</div>
						<button
							className="px-4 py-2 bg-error text-error-content rounded-lg font-medium hover:bg-error/90 focus:outline-none focus:ring-2 focus:ring-error/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
							aria-label={t("clearDataButtonAria", "Clear all app data")}
							onClick={() => setModalOpen(true)}
							disabled={clearLoading}
							ref={clearBtnRef}
						>
							{t("clearDataButton", "Clear All App Data")}
						</button>
					</div>
				</div>
			</div>

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
				<div
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="clearDataConfirmTitle"
					className="p-6"
				>
					<div className="flex items-start gap-4 mb-4">
						<div className="p-3 bg-error/10 rounded-lg shrink-0">
							<svg
								className="w-6 h-6 text-error"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
						</div>
						<div>
							<h2
								id="clearDataConfirmTitle"
								className="text-lg font-semibold text-base-content mb-2"
							>
								{t("clearDataConfirmTitle", "Clear All App Data?")}
							</h2>
							<p className="text-sm text-base-content/70">
								{t(
									"clearDataConfirmDesc",
									"This will erase all app data. This action cannot be undone.",
								)}
							</p>
						</div>
					</div>
					{clearError && (
						<div className="flex items-start gap-3 p-4 bg-error/10 border border-error/20 rounded-lg mb-4">
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
							<span className="text-sm text-error">{clearError}</span>
						</div>
					)}
					{clearSuccess && (
						<div className="flex items-start gap-3 p-4 bg-success/10 border border-success/20 rounded-lg mb-4">
							<svg
								className="w-5 h-5 text-success shrink-0 mt-0.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span className="text-sm text-success">
								{t("clearDataSuccess", "App data cleared successfully.")}
							</span>
						</div>
					)}
					<div className="flex justify-end gap-3">
						<button
							className="px-4 py-2 bg-error text-error-content rounded-lg font-medium hover:bg-error/90 focus:outline-none focus:ring-2 focus:ring-error/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
							onClick={handleClear}
							disabled={clearLoading}
							aria-busy={clearLoading}
							autoFocus
						>
							{clearLoading ? (
								<>
									<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
									{t("clearDataLoading", "Clearing...")}
								</>
							) : (
								t("clearDataConfirmYes", "Yes, clear")
							)}
						</button>
						<button
							className="px-4 py-2 bg-base-100 border border-base-300 text-base-content rounded-lg font-medium hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={() => setModalOpen(false)}
							disabled={clearLoading}
						>
							{t("clearDataConfirmNo", "Cancel")}
						</button>
					</div>
				</div>
			</Modal>
		</section>
	);
}

export default ResetSection;
