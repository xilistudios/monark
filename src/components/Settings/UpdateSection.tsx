/**
 * UpdateSection component for checking and installing app updates.
 * Handles update checking, downloading, and app relaunch.
 * @module UpdateSection
 */

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function UpdateSection() {
	const { t } = useTranslation("settings");
	const [isChecking, setIsChecking] = useState(false);
	const [updateMessage, setUpdateMessage] = useState("");
	const [updateError, setUpdateError] = useState("");
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [versionLoading, setVersionLoading] = useState(true);

	const checkForUpdates = async () => {
		setIsChecking(true);
		setUpdateMessage("");
		setUpdateError("");

		try {
			const update = await check();

			if (update) {
				setUpdateMessage(t("updates.available", { version: update.version }));

				// Download and install the update
				let downloaded = 0;
				let contentLength = 0;

				await update.downloadAndInstall((event: DownloadEvent) => {
					switch (event.event) {
						case "Started":
							contentLength = event?.data?.contentLength || 0;
							setUpdateMessage(t("updates.downloading"));
							break;
						case "Progress": {
							downloaded += event.data?.chunkLength ?? 0;
							const progress =
								contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
							setUpdateMessage(
								t("updates.downloadingProgress", {
									progress: Math.round(progress),
								}),
							);
							break;
						}
						case "Finished":
							setUpdateMessage(t("updates.downloaded"));
							break;
					}
				});

				// Relaunch the app to apply the update
				await relaunch();
			} else {
				setUpdateMessage(t("updates.upToDate"));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setUpdateError(t("updates.errorCheck", { message }));
		} finally {
			setIsChecking(false);
		}
	};

	useEffect(() => {
		// Get version from Tauri API
		const fetchVersion = async () => {
			try {
				const version = await getVersion();
				setAppVersion(version);
			} catch (error) {
				console.error("Failed to get app version:", error);
			} finally {
				setVersionLoading(false);
			}
		};

		fetchVersion();
	}, []);

	return (
		<section>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-base-content mb-2">
					{t("updates.title", "App Updates")}
				</h2>
				<p className="text-sm text-base-content/60">
					{t(
						"updates.description",
						"Check for and install the latest version of the application.",
					)}
				</p>
			</div>

			<div className="bg-base-50 border border-base-200 rounded-xl p-6">
				{/* Version Display */}
				<div className="flex items-center justify-between mb-6">
					<div>
						<span className="text-sm text-base-content/60">
							{t("updates.currentVersionLabel", "Current Version")}
						</span>
						<div className="text-lg font-semibold text-base-content mt-1">
							{versionLoading ? (
								<span className="text-base-content/40">
									{t("updates.loading")}
								</span>
							) : appVersion ? (
								appVersion
							) : (
								<span className="text-base-content/40">
									{t("updates.versionUnavailable")}
								</span>
							)}
						</div>
					</div>
					<div className="p-3 bg-primary/10 rounded-lg">
						<svg
							className="w-6 h-6 text-primary"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</div>
				</div>

				<div className="flex items-center gap-4">
					<button
						className="px-4 py-2 bg-primary text-primary-content rounded-lg font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
						onClick={checkForUpdates}
						disabled={isChecking}
						aria-label={t(
							"updates.checkAriaLabel",
							"Check for application updates",
						)}
						aria-busy={isChecking}
					>
						{isChecking ? (
							<>
								<span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
								{t("updates.checking", "Checking...")}
							</>
						) : (
							<>
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
										d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
									/>
								</svg>
								{t("updates.checkButton", "Check for Updates")}
							</>
						)}
					</button>
				</div>

				{updateMessage && (
					<div
						className="flex items-start gap-3 p-4 bg-info/10 border border-info/20 rounded-lg mt-4"
						role="status"
					>
						<svg
							className="w-5 h-5 text-info shrink-0 mt-0.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span className="text-sm text-info">{updateMessage}</span>
					</div>
				)}

				{updateError && (
					<div
						className="flex items-start gap-3 p-4 bg-error/10 border border-error/20 rounded-lg mt-4"
						role="alert"
					>
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
								d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span className="text-sm text-error">{updateError}</span>
					</div>
				)}
			</div>
		</section>
	);
}

export default UpdateSection;
