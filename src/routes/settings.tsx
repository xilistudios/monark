import { createFileRoute } from "@tanstack/react-router";
import SettingsScreen from "../screens/Settings";
export const Route = createFileRoute("/settings")({
	component: SettingsScreen,
});
