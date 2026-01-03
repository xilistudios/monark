import { useTranslation } from "react-i18next";

interface EmptyStateProps {
	className?: string;
}

export function EmptyState({ className = "" }: EmptyStateProps) {
	const { t } = useTranslation("home");

	return (
		<aside className={`w-full h-full bg-base-50 ${className}`}>
			<div className="flex items-center justify-center h-full p-8">
				<div className="text-center">
					<div className="text-base-content/30 mb-6">
						<svg
							className="w-20 h-20 mx-auto"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={1}
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<h3 className="text-base-content/60 text-xl font-semibold mb-2">
						{t("vault.sidebar.empty.title")}
					</h3>
					<p className="text-base-content/40 text-sm">
						{t("vault.sidebar.empty.description")}
					</p>
				</div>
			</div>
		</aside>
	);
}
