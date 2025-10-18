/**
 * UpdateSection component for checking and installing app updates.
 * Handles update checking, downloading, and app relaunch.
 * @module UpdateSection
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

function UpdateSection() {
	const { t } = useTranslation('settings');
	const [isChecking, setIsChecking] = useState(false);
	const [updateMessage, setUpdateMessage] = useState('');
	const [updateError, setUpdateError] = useState('');
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [versionLoading, setVersionLoading] = useState(true);

	const checkForUpdates = async () => {
		setIsChecking(true);
		setUpdateMessage('');
		setUpdateError('');

		try {
			const update = await check();

			if (update) {
				setUpdateMessage(`Update available: ${update.version}`);
				
				// Download and install the update
				let downloaded = 0;
				let contentLength = 0;

				await update.downloadAndInstall((event: DownloadEvent) => {
					switch (event.event) {
						case 'Started':
							contentLength = event?.data?.contentLength || 0;
							setUpdateMessage('Downloading update...');
							break;
						case 'Progress':
							downloaded += event.data.chunkLength;
							const progress = contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
							setUpdateMessage(`Downloading update: ${Math.round(progress)}%`);
							break;
						case 'Finished':
							setUpdateMessage('Update downloaded successfully. Relaunching...');
							break;
					}
				});

				// Relaunch the app to apply the update
				await relaunch();
			} else {
				setUpdateMessage('No updates available. You are on the latest version.');
			}
		} catch (error) {
			setUpdateError(`Failed to check for updates: ${error}`);
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
				console.error('Failed to get app version:', error);
			} finally {
				setVersionLoading(false);
			}
		};

		fetchVersion();
	}, []);

	return (
		<section className="flex flex-col gap-4 mt-8">
			<h2 className="text-xl font-semibold">{t('updates.title', 'App Updates')}</h2>
			<p className="text-sm opacity-70">
				{t('updates.description', 'Check for and install the latest version of the application.')}
			</p>
			
			{/* Version Display */}
			<div className="text-sm">
				{versionLoading ? (
					<span className="opacity-70">Loading...</span>
				) : appVersion ? (
					t('updates.currentVersion', { version: appVersion })
				) : (
					<span className="opacity-70">Version unavailable</span>
				)}
			</div>
			
			<div className="flex items-center gap-4">
				<button
					className="btn btn-primary"
					onClick={checkForUpdates}
					disabled={isChecking}
					aria-label={t('updates.checkAriaLabel', 'Check for application updates')}
					aria-busy={isChecking}
				>
					{isChecking ? (
						<>
							<span className="loading loading-spinner loading-sm"></span>
							{t('updates.checking', 'Checking...')}
						</>
					) : (
						t('updates.checkButton', 'Check for Updates')
					)}
				</button>
			</div>

			{updateMessage && (
				<div className="alert alert-info" role="status">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>{updateMessage}</span>
				</div>
			)}

			{updateError && (
				<div className="alert alert-error" role="alert">
					<svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span>{updateError}</span>
				</div>
			)}
		</section>
	);
}

export default UpdateSection;