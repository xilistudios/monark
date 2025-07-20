import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import ThemeSwitcher from "../components/UI/ThemeSwitcher";
import { settingsStore } from "../store/settings";
import { useDispatch, useSelector } from "react-redux";
import { DAISYUI_THEMES } from "../share/themes";
import { useTranslation } from "react-i18next";
const LANGUAGES = [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "zh", label: "中文" },
    { code: "ja", label: "日本語" },
];

const DEFAULT_SETTINGS = {
    language: "en",
    theme: "light",
};

import {
    setPreferences,
    setTheme,
    setLanguage,
} from "../redux/actions/preferences";

const VALID_LANGUAGES = LANGUAGES.map(l => l.code);

const GeneralSettings = () => {
    const dispatch = useDispatch();
    const preferences = useSelector((state: any) => state.preferences.preferences);
    const loading = useSelector((state: any) => state.preferences.loading);
    const language = preferences.language;
    const { t } = useTranslation("settings");

    const [error, setError] = useState('');
    useEffect(() => {
        if (!VALID_LANGUAGES.includes(language)) {
            setError(t("errors.invalidLanguage"));
        } else {
            setError('');
        }
    }, [language, t]);

    return (
        <section className="mb-8">
            <form
                className="form-control w-full max-w-md mt-4"
                aria-label={t("general.languageAriaLabel", "Language Selection")}
                role="group"
                aria-labelledby="settingsSection"
                tabIndex={0}
            >
                <label htmlFor="language" className="label">
                    <span className="label-text">{t("language")}</span>
                </label>
                <div className="input-group">
                    <select
                        id="language"
                        className="select select-bordered"
                        value={language}
                        onChange={e => dispatch(setLanguage(e.target.value))}
                        disabled={loading}
                        aria-label={t("general.languageAriaLabel", "Application language")}
                        aria-invalid={!!error}
                        aria-describedby="languageError"
                    >
                        {LANGUAGES.map(lang => (
                            <option key={lang.code} value={lang.code}>{lang.label}</option>
                        ))}
                    </select>
                </div>
                <div id="languageError" role="alert">
                    {error && (
                        <div className="alert alert-error text-error text-sm mt-1" style={{ backgroundColor: 'var(--b1)', color: 'var(--error)' }}>
                            {error}
                        </div>
                    )}
                </div>
                {/* Add more preference fields here, bound to preferences */}
            </form>
        </section>
    );
};

const AppearanceSettings = () => {
    const dispatch = useDispatch();
    const { t } = useTranslation("settings");

    return (
        <section className="mb-8">
            <div className="form-control w-full mt-4">
                <label className="label">
                    <span className="label-text">{t("theme")}</span>
                </label>
                <div className="grid grid-cols-4 gap-4 mt-4 w-full">
                    {DAISYUI_THEMES.map((thm) => (
                        <div key={thm} data-theme={thm} className="card w-40 bg-base-100 shadow-xl transition-all duration-500 cursor-pointer"
                            onClick={() => dispatch(setTheme(thm))}
                        >
                            <div className="card-body">
                                <h2 className="card-title">{t(`themes.${thm}`, thm.charAt(0).toUpperCase() + thm.slice(1))}</h2>
                                <p className="text-sm">{t("appearance.samplePreview", "Sample card preview")}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

const ResetSection = () => {
    const dispatch = useDispatch();
    const loading = useSelector((state: any) => state.preferences.loading);
    const { t } = useTranslation("settings");

    const handleReset = () => {
        if (window.confirm(t("general.resetConfirm", "Reset all preferences?"))) {
            dispatch(setPreferences({ theme: 'light', language: 'en' }));
        }
    };

    return (
        <section className="flex items-center gap-4 mt-8">
            <button
                className="btn btn-error"
                aria-label={t("general.resetAriaLabel", "Reset to Defaults")}
                onClick={handleReset}
                disabled={loading}
            >
                {t("resetButton")}
            </button>
        </section>
    );
};

const SettingsScreen = () => {
    const { t } = useTranslation("settings");
    return (
        <main className="p-4">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-3xl font-bold">{t("title")}</h1>
                <Link to="/" className="btn btn-outline btn-sm">{t("backButton")}</Link>
            </div>
            <div className="max-w-3xl mx-auto">
                <div className="card bg-base-100 shadow-xl">
                    <div
                        className="card-body"
                        role="group"
                        aria-labelledby="settingsSection"
                        tabIndex={0}
                    >
                        <span id="settingsSection" className="sr-only">{t("general.sectionLabel", "Settings Section")}</span>
                        <GeneralSettings />
                        <AppearanceSettings />
                        <ResetSection />
                    </div>
                </div>
            </div>
        </main>
    );
};

export default SettingsScreen;