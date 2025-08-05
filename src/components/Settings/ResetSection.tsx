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
		<section className="flex items-center gap-4 mt-8">
			<button
				className="btn btn-error"
				aria-label={t("general.resetAriaLabel", "Reset to Defaults")}
				onClick={() => dispatch(setPreferences(DEFAULT_SETTINGS))}
				disabled={loading}
			>
				{t("resetButton")}
			</button>
			<button
				className="btn btn-warning"
				aria-label={t("clearDataButtonAria", "Clear all app data")}
				onClick={() => setModalOpen(true)}
				disabled={clearLoading}
				ref={clearBtnRef}
			>
				{t("clearDataButton", "Clear All App Data")}
			</button>
			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
				<div
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="clearDataConfirmTitle"
				>
					<h2 id="clearDataConfirmTitle" className="font-bold text-lg mb-2">
						{t("clearDataConfirmTitle", "Clear All App Data?")}
					</h2>
					<p className="mb-4">
						{t(
							"clearDataConfirmDesc",
							"This will erase all app data. This action cannot be undone.",
						)}
					</p>
					{clearError && (
						<div className="alert alert-error mb-2">{clearError}</div>
					)}
					{clearSuccess && (
						<div className="alert alert-success mb-2">
							{t("clearDataSuccess", "App data cleared successfully.")}
						</div>
					)}
					<div className="flex gap-2">
						<button
							className="btn btn-error"
							onClick={handleClear}
							disabled={clearLoading}
							aria-busy={clearLoading}
							autoFocus
						>
							{clearLoading
								? t("clearDataLoading", "Clearing...")
								: t("clearDataConfirmYes", "Yes, clear")}
						</button>
						<button
							className="btn btn-outline"
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
