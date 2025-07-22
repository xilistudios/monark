import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { settingsStore } from "../../store/settings";

export interface Preferences {
	theme: string;
	language: string;
}

interface PreferencesState {
	preferences: Preferences;
	loading: boolean;
	error: string | null;
}

const savePreferencesToSettings = async (preferences: Preferences) => {
	try {
		await settingsStore.set("preferences", preferences);
	} catch (error) {
		console.error("Error saving preferences to settings:", error);
	}
};

// Helper para cargar preferencias desde settingsStore
export const loadPreferencesFromSettings = async (): Promise<
	Partial<PreferencesState>
> => {
	try {
		const prefs = await settingsStore.get("preferences");
		if (prefs) {
			return { preferences: prefs };
		}
	} catch (error) {
		console.error("Error loading preferences from settings:", error);
	}
	return {};
};

const initialState: PreferencesState = {
	preferences: {
		theme: "light",
		language: "en",
	},
	loading: false,
	error: null,
};

export const preferencesSlice = createSlice({
	name: "preferences",
	initialState,
	reducers: {
		setPreferences: (state, action: PayloadAction<Preferences>) => {
			state.preferences = action.payload;
			savePreferencesToSettings(action.payload);
		},
		setTheme: (state, action: PayloadAction<string>) => {
			state.preferences.theme = action.payload;
			savePreferencesToSettings(state.preferences);
		},
		setLanguage: (state, action: PayloadAction<string>) => {
			state.preferences.language = action.payload;
			savePreferencesToSettings(state.preferences);
		},
		setLoading: (state, action: PayloadAction<boolean>) => {
			state.loading = action.payload;
		},
		setError: (state, action: PayloadAction<string | null>) => {
			state.error = action.payload;
		},
		clearError: (state) => {
			state.error = null;
		},
		restorePreferencesState: (
			state,
			action: PayloadAction<Partial<PreferencesState>>,
		) => {
			if (action.payload.preferences) {
				state.preferences = action.payload.preferences;
			}
		},
	},
});

export const {
	setPreferences,
	setTheme,
	setLanguage,
	setLoading,
	setError,
	clearError,
	restorePreferencesState,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
