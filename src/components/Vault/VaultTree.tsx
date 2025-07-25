import { useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import {
	type Entry,
	isDataEntry,
	isGroupEntry,
} from "../../interfaces/vault.interface";
import { deleteVaultEntry } from "../../redux/actions/vault";
import type { AppDispatch } from "../../redux/store";

interface VaultTreeProps {
	entries: Entry[];
	onAddEntry: (parentId: string | null) => void;
	onAddGroup: (parentId: string | null) => void;
	onEdit: (entry: Entry) => void;
	onView: (entry: Entry) => void; // New prop for viewing data entries
	onNavigate: (groupId: string) => void;
}

const VaultTree = ({
	entries,
	onAddEntry,
	onAddGroup,
	onEdit,
	onView,
	onNavigate,
}: VaultTreeProps) => {
	const { t } = useTranslation();
	const dispatch = useDispatch<AppDispatch>();
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const handleDelete = async (entryId: string) => {
		if (
			confirm(
				t("home.vault.tree.deleteConfirm")
			)
		) {
			setDeletingId(entryId);
			try {
				await dispatch(deleteVaultEntry(entryId)).unwrap();
			} catch (err) {
				console.error("Delete failed:", err);
			} finally {
				setDeletingId(null);
			}
		}
	};

	return (
		<div>
			{entries.length === 0 ? (
				<div className="text-center py-12">{t("home.vault.tree.noEntries")}</div>
			) : (
				entries.map((node) => (
					<div key={node.id} className="my-2">
						<div className="flex items-center justify-between bg-base-200 p-2 rounded">
							<div
								className="flex items-center cursor-pointer"
								onClick={() => {
									if (isGroupEntry(node)) {
										onNavigate(node.id);
									} else {
										onView(node);
									}
								}}
							>
								{isGroupEntry(node) ? (
									<svg
										className="w-5 h-5 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
										/>
									</svg>
								) : (
									<svg
										className="w-5 h-5 mr-2"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
										/>
									</svg>
								)}
								<span>{node.name}</span>
							</div>
							<div className="flex gap-1">
								{isGroupEntry(node) && (
									<>
										<button
											className="btn btn-xs btn-primary"
											onClick={() => onAddEntry(node.id)}
										>
											{t("home.vault.tree.addEntry")}
										</button>
										<button
											className="btn btn-xs btn-secondary"
											onClick={() => onAddGroup(node.id)}
										>
											{t("home.vault.tree.addGroup")}
										</button>
									</>
								)}
								<button
									className="btn btn-xs btn-accent"
									onClick={() => onEdit(node)}
								>
									{t("home.vault.tree.edit")}
								</button>
								<button
									className="btn btn-xs btn-error"
									onClick={() => handleDelete(node.id)}
									disabled={deletingId === node.id}
								>
									{deletingId === node.id ? (
										<>
											<span className="loading loading-spinner loading-xs"></span>
											<span className="ml-1">{t("home.vault.tree.deleting")}</span>
										</>
									) : (
										t("home.vault.tree.delete")
									)}
								</button>
							</div>
						</div>
					</div>
				))
			)}
		</div>
	);
};

export default VaultTree;
