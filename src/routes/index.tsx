import { createFileRoute } from "@tanstack/react-router";
import HomeScreen from "../screens/Home";
export const Route = createFileRoute("/")({
	component: HomeScreen,
});
