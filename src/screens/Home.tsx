import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { AddEntryModal } from "../components/Vault/AddEntryModal";
import { AddGroupModal } from "../components/Vault/AddGroupModal";
import { EditEntryModal } from "../components/Vault/EditEntryModal";
import { EditGroupModal } from "../components/Vault/EditGroupModal";
import { EntryDetailsModal } from "../components/Vault/EntryDetailsModal";
import VaultSelector from "../components/Vault/VaultSelector";
import VaultTree from "../components/Vault/VaultTree";
import {
	type DataEntry,
	type Entry,
	type GroupEntry,
	isDataEntry,
	isGroupEntry,
} from "../interfaces/vault.interface";
import {
	lockVault,
	setNavigationPath,
	setVaultLocked,
} from "../redux/actions/vault";
import { VaultManager } from "../services/vault";
import type { AppDispatch, RootState } from "../redux/store";

const HomeScreen = () => {
	const { t } = useTranslation("home");
	const dispatch = useDispatch<AppDispatch>();
	const vaults = useSelector((state: RootState) => state.vault.vaults);
	const currentVaultId = useSelector((state: RootState) => state.vault.currentVaultId);
	const loading = useSelector((state: RootState) => state.vault.loading);
	const error = useSelector((state: RootState) => state.vault.error);

	const currentVault = vaults.find(v => v.id === currentVaultId) ?? null;
	const navigationPath = currentVault?.volatile?.navigationPath || "/";

	const [password, setPassword] = useState("");
	const [unlockError, setUnlockError] = useState("");
	const [isAddEntryModalOpen, setIsAddEntryModalOpen] = useState(false);
	const [addEntryPath, setAddEntryPath] = useState<string[]>([]);
	const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
	const [addGroupPath, setAddGroupPath] = useState<string[]>([]);
	const [selectedEntry, setSelectedEntry] = useState<
		DataEntry | GroupEntry | null
	>(null);
	const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
	const [isEditEntryModalOpen, setIsEditEntryModalOpen] = useState(false);
	const [isEditGroupModalOpen, setIsEditGroupModalOpen] = useState(false);

	const getCurrentPath = (): string[] => {
		const pathParts = navigationPath.split("/").filter(Boolean);
		return pathParts;
	};

	const findPathById = (entries: Entry[], targetId: string, currentPath: string[] = []): string[] => {
		for (const entry of entries) {
			const newPath = [...currentPath, entry.id];
			
			if (entry.id === targetId) {
				return newPath;
			}
			
			if (isGroupEntry(entry) && entry.children) {
				const childPath = findPathById(entry.children, targetId, newPath);
				if (childPath.length > 0) {
					return childPath;
				}
			}
		}
		return [];
	};

	const getCurrentEntries = (entries: Entry[], path: string[]): Entry[] => {
		if (path.length === 0) {
			return entries;
		}

		let currentLevel = entries;
		for (const id of path) {
			const parentEntry = currentLevel.find((e) => e.id === id);
			if (parentEntry && isGroupEntry(parentEntry) && parentEntry.children) {
				currentLevel = parentEntry.children;
			} else {
				return [];
			}
		}
		return currentLevel;
	};

	const handleNavigate = (path: string[]) => {
		const newPath = path.length > 0 ? `/${path.join("/")}` : "/";
		if (currentVault) {
			dispatch(setNavigationPath({ vaultId: currentVault.id, navigationPath: newPath }));
		}
	};

	const renderBreadcrumbs = () => {
		const parts = navigationPath.split("/").filter(Boolean);
		
		const findEntryByPath = (entries: Entry[], pathParts: string[]): Entry | null => {
			if (pathParts.length === 0) return null;
			
			let currentEntries = entries;
			let foundEntry: Entry | null = null;
			
			for (const id of pathParts) {
				const entry = currentEntries.find((e: Entry) => e.id === id);
				if (!entry) return null;
				
				foundEntry = entry;
				
				if (isGroupEntry(entry) && entry.children) {
					currentEntries = entry.children;
				} else {
					break;
				}
			}
			
			return foundEntry;
		};

		return (
			<div className="breadcrumbs text-sm p-4 border-b border-base-300">
				<ul>
					<li>
						<a onClick={() => {
							if (currentVault) {
								dispatch(setNavigationPath({ vaultId: currentVault.id, navigationPath: "/" }));
							}
						}}>/</a>
					</li>
					{parts.map((id, index) => {
						const pathUpToParts = parts.slice(0, index + 1);
						const entry = findEntryByPath(currentVault?.volatile?.entries ?? [], pathUpToParts);
						if (!entry) return null;
						const pathUpTo = "/" + pathUpToParts.join("/");
						return (
							<li key={id}>
								<a onClick={() => {
									if (currentVault) {
										dispatch(setNavigationPath({ vaultId: currentVault.id, navigationPath: pathUpTo }));
									}
								}}>
									{entry.name}
								</a>
							</li>
						);
					})}
				</ul>
			</div>
		);
	};

	const handleUnlockVault = async () => {
		if (!currentVault || !password.trim()) {
			setUnlockError(t("errors.missingFields"));
			return;
		}

		setUnlockError("");
		try {
			if (currentVault) {
				const vaultInstance = VaultManager.getInstance().getInstance(currentVault.id);
				if (vaultInstance) {
					await vaultInstance.unlock(password.trim());
					dispatch(setVaultLocked({ vaultId: currentVault.id, isLocked: false }));
					dispatch(setNavigationPath({ vaultId: currentVault.id, navigationPath: "/" }));
				}
			}
			setPassword("");
		} catch (err) {
			setUnlockError(t("errors.unlockFailed"));
		}
	};

	const handleLockVault = () => {
		if (currentVault) {
			dispatch(lockVault(currentVault.id));
		}
		setPassword("");
		setUnlockError("");
	};

	const renderVaultContent = () => {
		if (!currentVault) {
			return (
				<div className="flex items-center justify-center h-full">
					<div className="text-center">
						<h2 className="text-2xl font-bold mb-4">
							{t("vault.manager.noVaultSelected")}
						</h2>
						<p className="text-base-content/60">
							{t("vault.manager.selectVaultToStart")}
						</p>
					</div>
				</div>
			);
		}

		if (currentVault?.isLocked) {
			return (
				<div className="flex items-center justify-center h-full">
					<div className="card w-96 bg-base-100 shadow-xl">
						<div className="card-body">
							<h2 className="card-title justify-center mb-4">
								{t("vault.unlock.title")}
							</h2>

							<div className="form-control">
								<label className="label">
									<span className="label-text">
										{t("vault.unlock.password")}
									</span>
								</label>
								<input
									type="password"
									placeholder={t("vault.unlock.passwordPlaceholder")}
									className="input input-bordered"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									onKeyPress={(e) => e.key === "Enter" && handleUnlockVault()}
								/>
							</div>

							{(unlockError || error) && (
								<div className="alert alert-error mt-4">
									<span>
										{unlockError || (typeof error === "string" ? error : JSON.stringify(error))}
									</span>
								</div>
							)}

							<div className="card-actions justify-end mt-4">
								<button
									className="btn btn-primary"
									onClick={handleUnlockVault}
									disabled={loading || !password.trim()}
								>
									{loading ? (
										<>
											<span className="loading loading-spinner loading-sm"></span>
											{t("vault.unlock.unlocking")}
										</>
									) : (
										t("vault.unlock.unlockButton")
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			);
		}

		return (
			<div className="h-full flex flex-col">
				<div className="p-4 border-b border-base-300">
					<div className="flex justify-between items-center">
						<h2 className="text-2xl font-bold">{currentVault.name}</h2>
						<div className="flex gap-2">
							<button
								className="btn btn-primary btn-sm"
								onClick={() => {
									setAddEntryPath(getCurrentPath());
									setIsAddEntryModalOpen(true);
								}}
							>
								{t("vault.manager.addEntry")}
							</button>
							<button
								className="btn btn-outline btn-sm"
								onClick={() => {
									setAddGroupPath(getCurrentPath());
									setIsAddGroupModalOpen(true);
								}}
							>
								{t("vault.manager.addGroup")}
							</button>
							<button
								className="btn btn-ghost btn-sm"
								onClick={handleLockVault}
							>
								{t("vault.manager.lock")}
							</button>
						</div>
					</div>
				</div>

				<div className="flex-1 overflow-auto">
					{renderBreadcrumbs()}
					<div className="p-4">
						{getCurrentEntries(currentVault?.volatile?.entries ?? [], getCurrentPath())
							.length === 0 ? (
							<div className="text-center py-12">
								<div className="text-base-content/60 mb-4">
									<p className="text-lg">{t("vault.manager.emptyVault")}</p>
								</div>
							</div>
						) : (
							<VaultTree
								vaultId={currentVault.id}
								entries={getCurrentEntries(
									currentVault?.volatile?.entries ?? [],
									getCurrentPath(),
								)}
								basePath={getCurrentPath()}
								onView={(_vaultId, _path, entry) => {
									if (isDataEntry(entry)) {
										setSelectedEntry(entry);
										setIsDetailsModalOpen(true);
									}
								}}
								onEdit={(_vaultId, _path, entry) => {
									setSelectedEntry(entry);
									if (isGroupEntry(entry)) {
										setIsEditGroupModalOpen(true);
									} else if (isDataEntry(entry)) {
										setIsEditEntryModalOpen(true);
									}
								}}
								onNavigate={(_vaultId, path) => handleNavigate(path)}
							/>
						)}
					</div>
				</div>
			</div>
		);
	};

	return (
		<div className="flex h-screen w-screen">
			<div className="vault-selector w-1/5 h-full border-r border-base-300">
				<VaultSelector />
			</div>
			<div className="vault-content w-4/5 h-full">{renderVaultContent()}</div>

			<AddEntryModal
				isOpen={isAddEntryModalOpen}
				onClose={() => setIsAddEntryModalOpen(false)}
				onSuccess={() => setIsAddEntryModalOpen(false)}
				path={addEntryPath}
			/>
			<AddGroupModal
				isOpen={isAddGroupModalOpen}
				onClose={() => setIsAddGroupModalOpen(false)}
				onSuccess={() => setIsAddGroupModalOpen(false)}
				path={addGroupPath}
			/>
			{selectedEntry && isDataEntry(selectedEntry) && (
				<EntryDetailsModal
					isOpen={isDetailsModalOpen}
					onClose={() => {
						setIsDetailsModalOpen(false);
						setSelectedEntry(null);
					}}
					entry={selectedEntry}
					onEdit={() => {
						setIsDetailsModalOpen(false);
						setIsEditEntryModalOpen(true);
					}}
				/>
			)}
			{selectedEntry && isDataEntry(selectedEntry) && (
				<EditEntryModal
					isOpen={isEditEntryModalOpen}
					onClose={() => {
						setIsEditEntryModalOpen(false);
						setSelectedEntry(null);
					}}
					onSuccess={() => {
						setIsEditEntryModalOpen(false);
						setSelectedEntry(null);
					}}
					entry={selectedEntry}
					path={getCurrentPath()}
				/>
			)}
			{selectedEntry && isGroupEntry(selectedEntry) && (
				<EditGroupModal
					isOpen={isEditGroupModalOpen}
					onClose={() => {
						setIsEditGroupModalOpen(false);
						setSelectedEntry(null);
					}}
					onSuccess={() => {
						setIsEditGroupModalOpen(false);
						setSelectedEntry(null);
					}}
					entry={selectedEntry}
					path={getCurrentPath()}
				/>
			)}
		</div>
	);
};

export default HomeScreen;
