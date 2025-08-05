import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { store } from "../redux/store";
import en from "./locales/en.json";
import es from "./locales/es.json";

const resources = {
	en,
	es,
};

i18n.use(initReactI18next).init({
	resources,
	lng: localStorage.getItem("i18nextLng") || "en",
	interpolation: {
		escapeValue: false,
	},
});

// Sync with Redux store
let currentLang = i18n.language;
const persistLanguage = (lng: string) => {
	localStorage.setItem("i18nextLng", lng);
	i18n.changeLanguage(lng);
};

store.subscribe(() => {
	const state = store.getState();
	if (
		state.preferences?.preferences?.language &&
		state.preferences.preferences.language !== currentLang
	) {
		currentLang = state.preferences.preferences.language;
		persistLanguage(currentLang);
	}
});

export default i18n;
