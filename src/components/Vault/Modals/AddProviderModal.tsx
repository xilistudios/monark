/**
 * AddProviderModal component for adding new cloud storage providers
 * Provides form for Google Drive and WebDAV provider configuration
 * @module AddProviderModal
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { StorageProviderType } from "../../../interfaces/cloud-storage.interface";
import type { RootState } from "../../../redux/store";
import { CloudStorageCommands } from "../../../services/cloudStorage";
import { VaultManager } from "../../../services/vault";
import { Modal } from "../../UI/Modal";

interface AddProviderModalProps {
	isOpen: boolean;
	onClose: () => void;
}

interface ProviderFormData {
	providerName: string;
	providerType: StorageProviderType;
	// Google Drive fields
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	// WebDAV fields
	serverUrl: string;
	username: string;
	password: string;
	basePath: string;
}

export const AddProviderModal = ({
	isOpen,
	onClose,
}: AddProviderModalProps) => {
	const { t } = useTranslation("settings");
	const loading = useSelector((state: RootState) => state.vault.loading);
	const defaultRedirectUri = "https://monark-password-manager.web.app";

	const [formData, setFormData] = useState<ProviderFormData>({
		providerName: "",
		providerType: StorageProviderType.GOOGLE_DRIVE,
		clientId: "",
		clientSecret: "",
		redirectUri: defaultRedirectUri,
		serverUrl: "",
		username: "",
		password: "",
		basePath: "",
	});
	const [errors, setErrors] = useState<Partial<ProviderFormData>>({});
	const [isSubmitting, setIsSubmitting] = useState(false);

	const validateForm = (): boolean => {
		const newErrors: Partial<ProviderFormData> = {};

		if (!formData.providerName.trim()) {
			newErrors.providerName = t(
				"addProvider.errors.providerNameRequired",
				"Provider name is required",
			);
		}

		if (formData.providerType === StorageProviderType.GOOGLE_DRIVE) {
			if (!formData.clientId.trim()) {
				newErrors.clientId = t(
					"addProvider.errors.clientIdRequired",
					"Client ID is required",
				);
			}
			if (!formData.clientSecret.trim()) {
				newErrors.clientSecret = t(
					"addProvider.errors.clientSecretRequired",
					"Client Secret is required",
				);
			}
			if (!formData.redirectUri.trim()) {
				newErrors.redirectUri = t(
					"addProvider.errors.redirectUriRequired",
					"Redirect URI is required",
				);
			}
		} else if (formData.providerType === StorageProviderType.WEB_DAV) {
			if (!formData.serverUrl.trim()) {
				newErrors.serverUrl = t(
					"addProvider.errors.serverUrlRequired",
					"Server URL is required",
				);
			}
			if (!formData.username.trim()) {
				newErrors.username = t(
					"addProvider.errors.usernameRequired",
					"Username is required",
				);
			}
			if (!formData.password.trim()) {
				newErrors.password = t(
					"addProvider.errors.passwordRequired",
					"Password is required",
				);
			}
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateForm()) {
			return;
		}

		setIsSubmitting(true);
		setErrors({});

		try {
			const vaultManager = VaultManager.getInstance();

			let providerRequest;

			if (formData.providerType === StorageProviderType.GOOGLE_DRIVE) {
				providerRequest = {
					name: formData.providerName.trim(),
					config: {
						type: StorageProviderType.GOOGLE_DRIVE,
						config: {
							client_id: formData.clientId.trim(),
							client_secret: formData.clientSecret.trim(),
							redirect_uri: formData.redirectUri.trim(),
						},
					} as any,
				};
			} else if (formData.providerType === StorageProviderType.WEB_DAV) {
				// Test the connection first before saving
				try {
					await CloudStorageCommands.testWebDavConnection(
						formData.serverUrl.trim(),
						formData.username.trim(),
						formData.password.trim(),
						formData.basePath.trim(),
					);
				} catch (testError) {
					const errorMessage =
						testError instanceof Error
							? testError.message
							: String(testError);
					setErrors({ serverUrl: errorMessage });
					setIsSubmitting(false);
					return;
				}

				providerRequest = {
					name: formData.providerName.trim(),
					config: {
						type: StorageProviderType.WEB_DAV,
						config: {
							server_url: formData.serverUrl.trim(),
							username: formData.username.trim(),
							password: formData.password.trim(),
							base_path: formData.basePath.trim(),
						},
					} as any,
				};
			} else {
				throw new Error("Unsupported provider type");
			}

			await vaultManager.addProvider(providerRequest);

			// Reset form and close modal
			setFormData({
				providerName: "",
				providerType: StorageProviderType.GOOGLE_DRIVE,
				clientId: "",
				clientSecret: "",
				redirectUri: defaultRedirectUri,
				serverUrl: "",
				username: "",
				password: "",
				basePath: "",
			});
			onClose();
		} catch (error) {
			console.error("Failed to add provider:", error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setErrors({
				providerName: errorMessage,
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleInputChange =
		(field: keyof ProviderFormData) =>
		(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
			setFormData((prev) => ({
				...prev,
				[field]: e.target.value,
			}));

			// Clear error for this field when user starts typing
			if (errors[field]) {
				setErrors((prev) => ({
					...prev,
					[field]: undefined,
				}));
			}
		};

	const handleClose = () => {
		if (!isSubmitting) {
			setErrors({});
			onClose();
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={handleClose}>
			<div className="card-body p-6">
				<h2 className="card-title text-xl mb-4">
					{t("addProvider.title", "Add Storage Provider")}
				</h2>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Provider Name */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t("addProvider.providerName", "Provider Name")}
							</span>
						</label>
						<input
							type="text"
							className={`input input-bordered w-full ${
								errors.providerName ? "input-error" : ""
							}`}
							value={formData.providerName}
							onChange={handleInputChange("providerName")}
							placeholder={t(
								"addProvider.providerNamePlaceholder",
								"My Google Drive",
							)}
							disabled={isSubmitting}
						/>
						{errors.providerName && (
							<label className="label">
								<span className="label-text-alt text-error">
									{errors.providerName}
								</span>
							</label>
						)}
					</div>

					{/* Provider Type */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">
								{t("addProvider.providerType", "Provider Type")}
							</span>
						</label>
						<select
							className="select select-bordered w-full"
							value={formData.providerType}
							onChange={handleInputChange("providerType")}
							disabled={isSubmitting}
						>
							<option value={StorageProviderType.GOOGLE_DRIVE}>
								{t("cloudStorage.googleDrive", "Google Drive")}
							</option>
							<option value={StorageProviderType.WEB_DAV}>
								{t("cloudStorage.webdav", "WebDAV")}
							</option>
						</select>
					</div>

					{formData.providerType === StorageProviderType.GOOGLE_DRIVE && (
						<>
							{/* Client ID */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.clientId", "Client ID")}
									</span>
								</label>
								<input
									type="text"
									className={`input input-bordered w-full ${
										errors.clientId ? "input-error" : ""
									}`}
									value={formData.clientId}
									onChange={handleInputChange("clientId")}
									placeholder={t(
										"addProvider.clientIdPlaceholder",
										"Your Google OAuth Client ID",
									)}
									disabled={isSubmitting}
								/>
								{errors.clientId && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.clientId}
										</span>
									</label>
								)}
							</div>

							{/* Client Secret */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.clientSecret", "Client Secret")}
									</span>
								</label>
								<input
									type="password"
									className={`input input-bordered w-full ${
										errors.clientSecret ? "input-error" : ""
									}`}
									value={formData.clientSecret}
									onChange={handleInputChange("clientSecret")}
									placeholder={t(
										"addProvider.clientSecretPlaceholder",
										"Your Google OAuth Client Secret",
									)}
									disabled={isSubmitting}
								/>
								{errors.clientSecret && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.clientSecret}
										</span>
									</label>
								)}
							</div>

							{/* Redirect URI */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.redirectUri", "Redirect URI")}
									</span>
								</label>
								<input
									type="text"
									className={`input input-bordered w-full ${
										errors.redirectUri ? "input-error" : ""
									}`}
									value={formData.redirectUri}
									onChange={handleInputChange("redirectUri")}
									disabled={isSubmitting}
								/>
								{errors.redirectUri && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.redirectUri}
										</span>
									</label>
								)}
								<label className="label">
									<span className="label-text-alt">
										{t(
											"addProvider.redirectUriHelp",
											"This URI must be configured in your Google Cloud Console",
										)}
									</span>
								</label>
							</div>
						</>
					)}

					{formData.providerType === StorageProviderType.WEB_DAV && (
						<>
							{/* Server URL */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.serverUrl", "Server URL")}
									</span>
								</label>
								<input
									type="url"
									className={`input input-bordered w-full ${
										errors.serverUrl ? "input-error" : ""
									}`}
									value={formData.serverUrl}
									onChange={handleInputChange("serverUrl")}
									placeholder={t(
										"addProvider.serverUrlPlaceholder",
										"https://cloud.example.com/remote.php/dav/files/user",
									)}
									disabled={isSubmitting}
								/>
								{errors.serverUrl && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.serverUrl}
										</span>
									</label>
								)}
							</div>

							{/* Username */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.username", "Username")}
									</span>
								</label>
								<input
									type="text"
									className={`input input-bordered w-full ${
										errors.username ? "input-error" : ""
									}`}
									value={formData.username}
									onChange={handleInputChange("username")}
									placeholder={t(
										"addProvider.usernamePlaceholder",
										"Your WebDAV username",
									)}
									disabled={isSubmitting}
								/>
								{errors.username && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.username}
										</span>
									</label>
								)}
							</div>

							{/* Password */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.password", "Password")}
									</span>
								</label>
								<input
									type="password"
									className={`input input-bordered w-full ${
										errors.password ? "input-error" : ""
									}`}
									value={formData.password}
									onChange={handleInputChange("password")}
									placeholder={t(
										"addProvider.passwordPlaceholder",
										"Your WebDAV password",
									)}
									disabled={isSubmitting}
								/>
								{errors.password && (
									<label className="label">
										<span className="label-text-alt text-error">
											{errors.password}
										</span>
									</label>
								)}
							</div>

							{/* Base Path (optional) */}
							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("addProvider.basePath", "Base Path (optional)")}
									</span>
								</label>
								<input
									type="text"
									className="input input-bordered w-full"
									value={formData.basePath}
									onChange={handleInputChange("basePath")}
									placeholder={t(
										"addProvider.basePathPlaceholder",
										"Monark",
									)}
									disabled={isSubmitting}
								/>
								<label className="label">
									<span className="label-text-alt">
										{t(
											"addProvider.basePathHelp",
											"Subfolder within your WebDAV root for storing vaults",
										)}
									</span>
								</label>
							</div>
						</>
					)}

					{/* Form Actions */}
					<div className="card-actions justify-end mt-6">
						<button
							type="button"
							className="btn btn-ghost"
							onClick={handleClose}
							disabled={isSubmitting}
						>
							{t("addProvider.cancel", "Cancel")}
						</button>
						<button
							type="submit"
							className="btn btn-primary"
							disabled={isSubmitting || loading}
						>
							{isSubmitting ? (
								<>
									<span className="loading loading-spinner loading-sm"></span>
									{t("addProvider.adding", "Adding...")}
								</>
							) : (
								t("addProvider.add", "Add Provider")
							)}
						</button>
					</div>
				</form>
			</div>
		</Modal>
	);
};
