import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copySensitive } from "../../utils/clipboard";
import {
	DEFAULT_PASSWORD_OPTIONS,
	estimateEntropyBits,
	generatePassword,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	type PasswordGeneratorOptions,
} from "../../utils/passwordGenerator";

interface PasswordGeneratorProps {
	/** Called when the user accepts the generated password. */
	onAccept?: (password: string) => void;
}

/** Entropy thresholds (bits) used to classify password strength. */
const ENTROPY_WEAK = 40;
const ENTROPY_FAIR = 60;
const ENTROPY_GOOD = 80;

/** Lengths of each character set, used to compute the pool size for entropy. */
const SET_LENGTHS = {
	uppercase: 26,
	lowercase: 26,
	numbers: 10,
	symbols: 27,
} as const;

type ToggleKey = keyof Omit<PasswordGeneratorOptions, "length">;

const TOGGLE_KEYS: ToggleKey[] = [
	"includeUppercase",
	"includeLowercase",
	"includeNumbers",
	"includeSymbols",
];

export function PasswordGenerator({ onAccept }: PasswordGeneratorProps) {
	const { t } = useTranslation("home");
	const [options, setOptions] = useState<PasswordGeneratorOptions>(
		DEFAULT_PASSWORD_OPTIONS,
	);
	const [password, setPassword] = useState("");
	const [optionsError, setOptionsError] = useState("");
	const [copied, setCopied] = useState(false);
	const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const regenerate = useCallback((opts: PasswordGeneratorOptions) => {
		try {
			setPassword(generatePassword(opts));
			setOptionsError("");
		} catch (error) {
			setPassword("");
			setOptionsError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	// Generate on mount and whenever the options change.
	useEffect(() => {
		regenerate(options);
	}, [options, regenerate]);

	// Clean up the "copied" feedback timer on unmount.
	useEffect(() => {
		return () => {
			if (copiedTimeoutRef.current !== null) {
				clearTimeout(copiedTimeoutRef.current);
			}
		};
	}, []);

	const handleCopy = async () => {
		if (!password) return;
		try {
			await copySensitive(password);
			setCopied(true);
			if (copiedTimeoutRef.current !== null) {
				clearTimeout(copiedTimeoutRef.current);
			}
			copiedTimeoutRef.current = setTimeout(() => {
				setCopied(false);
				copiedTimeoutRef.current = null;
			}, 2000);
		} catch {
			// Clipboard write failed; the user can still select the text manually.
		}
	};

	const handleToggle = (key: ToggleKey, checked: boolean) => {
		setOptions((prev) => ({ ...prev, [key]: checked }));
	};

	const enabledCount = TOGGLE_KEYS.filter((key) => options[key]).length;

	const poolSize =
		(options.includeUppercase ? SET_LENGTHS.uppercase : 0) +
		(options.includeLowercase ? SET_LENGTHS.lowercase : 0) +
		(options.includeNumbers ? SET_LENGTHS.numbers : 0) +
		(options.includeSymbols ? SET_LENGTHS.symbols : 0);

	const entropy = estimateEntropyBits(options.length, poolSize);

	const strength =
		entropy < ENTROPY_WEAK
			? { label: t("vault.passwordGenerator.strengthWeak"), color: "error" }
			: entropy < ENTROPY_FAIR
				? { label: t("vault.passwordGenerator.strengthFair"), color: "warning" }
				: entropy < ENTROPY_GOOD
					? { label: t("vault.passwordGenerator.strengthGood"), color: "info" }
					: {
							label: t("vault.passwordGenerator.strengthStrong"),
							color: "success",
						};

	const toggleLabels: Record<ToggleKey, string> = {
		includeUppercase: t("vault.passwordGenerator.uppercase"),
		includeLowercase: t("vault.passwordGenerator.lowercase"),
		includeNumbers: t("vault.passwordGenerator.numbers"),
		includeSymbols: t("vault.passwordGenerator.symbols"),
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Generated password display with copy and regenerate actions */}
			<div className="flex items-center gap-2">
				<div className="font-mono text-sm bg-base-200 rounded-md px-3 py-2 break-all select-all flex-1 min-h-[2.5rem] flex items-center">
					{password || (
						<span className="text-base-content/50">{optionsError}</span>
					)}
				</div>
				<button
					className="btn btn-ghost btn-sm"
					type="button"
					title={
						copied
							? t("vault.passwordGenerator.copied")
							: t("vault.passwordGenerator.copy")
					}
					onClick={handleCopy}
					disabled={!password}
				>
					{copied ? (
						<svg
							className="w-4 h-4 text-success"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<title>{t("vault.passwordGenerator.copied")}</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 13l4 4L19 7"
							/>
						</svg>
					) : (
						<svg
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<title>{t("vault.passwordGenerator.copy")}</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
					)}
				</button>
				<button
					className="btn btn-ghost btn-sm"
					type="button"
					title={t("vault.passwordGenerator.regenerate")}
					onClick={() => regenerate(options)}
				>
					<svg
						className="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<title>{t("vault.passwordGenerator.regenerate")}</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				</button>
			</div>

			{optionsError ? (
				<div className="text-error text-sm">{optionsError}</div>
			) : null}

			{/* Length slider */}
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between">
					<label
						className="text-sm font-medium"
						htmlFor="password-generator-length"
					>
						{t("vault.passwordGenerator.length")}
					</label>
					<span className="badge badge-primary">{options.length}</span>
				</div>
				<input
					id="password-generator-length"
					type="range"
					className="range range-primary"
					min={PASSWORD_MIN_LENGTH}
					max={PASSWORD_MAX_LENGTH}
					step={1}
					value={options.length}
					aria-label={t("vault.passwordGenerator.length")}
					onChange={(e) =>
						setOptions((prev) => ({ ...prev, length: Number(e.target.value) }))
					}
				/>
			</div>

			{/* Character set toggles */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{TOGGLE_KEYS.map((key) => (
					<label
						key={key}
						className="flex items-center gap-2 text-sm cursor-pointer"
					>
						<input
							type="checkbox"
							className="checkbox checkbox-sm checkbox-primary"
							checked={options[key]}
							disabled={options[key] && enabledCount === 1}
							onChange={(e) => handleToggle(key, e.target.checked)}
						/>
						{toggleLabels[key]}
					</label>
				))}
			</div>

			{/* Strength indicator */}
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">
						{t("vault.passwordGenerator.strength")}
					</span>
					<span className={`badge badge-${strength.color}`}>
						{strength.label}
					</span>
				</div>
				<progress
					className={`progress progress-${strength.color}`}
					value={Math.min(entropy, 100)}
					max={100}
					aria-label={strength.label}
				/>
			</div>

			{/* Accept button (only when a consumer provided onAccept) */}
			{onAccept ? (
				<button
					className="btn btn-primary"
					type="button"
					disabled={!password}
					onClick={() => onAccept(password)}
				>
					{t("vault.passwordGenerator.usePassword")}
				</button>
			) : null}
		</div>
	);
}
