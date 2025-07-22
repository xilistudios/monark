import { useEffect } from "react";
import { useSelector } from "react-redux";

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
	const theme = useSelector(
		(state: any) => state.preferences.preferences.theme,
	);
	// loading can be removed if it is not used

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	return children;
};
