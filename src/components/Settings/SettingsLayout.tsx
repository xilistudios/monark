/**
 * SettingsLayout component with sidebar tab navigation.
 * Provides a tabbed interface for different settings sections.
 * @module SettingsLayout
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import AppearanceSettings from "./AppearanceSettings";
import { CloudStorageSettings } from "./CloudStorageSettings";
import GeneralSettings from "./GeneralSettings";
import ResetSection from "./ResetSection";
import UpdateSection from "./UpdateSection";

type SettingsTab =
	| "general"
	| "appearance"
	| "cloudStorage"
	| "reset"
	| "updates";

interface TabConfig {
	id: SettingsTab;
	label: string;
	icon: string;
	component: React.ComponentType;
}

function SettingsLayout() {
	const { t } = useTranslation("settings");
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");

	const tabs: TabConfig[] = [
		{
			id: "general",
			label: t("general", "General"),
			icon: "⚙️",
			component: GeneralSettings,
		},
		{
			id: "appearance",
			label: t("appearance", "Appearance"),
			icon: "🎨",
			component: AppearanceSettings,
		},
		{
			id: "cloudStorage",
			label: t("cloudStorage.title", "Cloud Storage"),
			icon: "☁️",
			component: CloudStorageSettings,
		},
		{
			id: "reset",
			label: t("resetButton", "Reset"),
			icon: "🔄",
			component: ResetSection,
		},
		{
			id: "updates",
			label: t("updates.title", "Updates"),
			icon: "🔄",
			component: UpdateSection,
		},
	];

	const ActiveComponent = tabs.find((tab) => tab.id === activeTab)?.component;

	const handleTabChange = (tabId: SettingsTab) => {
		setActiveTab(tabId);
	};

	const handleKeyDown = (
		e: React.KeyboardEvent,
		tabId: SettingsTab,
		index: number,
	) => {
		if (e.key === "ArrowRight") {
			e.preventDefault();
			const nextIndex = (index + 1) % tabs.length;
			setActiveTab(tabs[nextIndex].id);
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			const prevIndex = (index - 1 + tabs.length) % tabs.length;
			setActiveTab(tabs[prevIndex].id);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			setActiveTab(tabId);
		}
	};

	return (
		<div className="flex flex-col lg:flex-row gap-8 w-full min-h-[600px]">
			{/* Sidebar Navigation */}
			<aside className="lg:w-72 w-full shrink-0">
				<nav
					className="bg-base-100 border border-base-200 rounded-xl shadow-sm overflow-hidden"
					role="tablist"
					aria-label={t("navigation", "Settings navigation")}
				>
					<div className="px-6 py-4 border-b border-base-200">
						<h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/60">
							{t("settings", "Settings")}
						</h2>
					</div>
					<ul className="p-2 space-y-1">
						{tabs.map((tab, index) => (
							<li key={tab.id} role="presentation">
								<button
									className={`flex items-center gap-3 px-4 py-3 w-full rounded-lg transition-all duration-200 text-left font-medium ${
										activeTab === tab.id
											? "bg-primary/10 text-primary border-l-4 border-primary"
											: "text-base-content/70 hover:bg-base-200 hover:text-base-content border-l-4 border-transparent"
									}`}
									onClick={() => handleTabChange(tab.id)}
									onKeyDown={(e) => handleKeyDown(e, tab.id, index)}
									role="tab"
									aria-selected={activeTab === tab.id}
									aria-controls={`${tab.id}-panel`}
									id={`${tab.id}-tab`}
									tabIndex={activeTab === tab.id ? 0 : -1}
									type="button"
								>
									<span className="text-lg" aria-hidden="true">
										{tab.icon}
									</span>
									<span className="text-sm">{tab.label}</span>
								</button>
							</li>
						))}
					</ul>
				</nav>
			</aside>

			{/* Content Panel */}
			<main
				className="flex-1 bg-base-100 border border-base-200 rounded-xl shadow-sm p-8"
				role="tabpanel"
				id={`${activeTab}-panel`}
				aria-labelledby={`${activeTab}-tab`}
			>
				{ActiveComponent && <ActiveComponent />}
			</main>
		</div>
	);
}

export default SettingsLayout;
