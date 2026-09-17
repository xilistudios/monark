import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copySensitive } from "../../utils/clipboard";
import { Modal } from "../UI/Modal";
import { PasswordGenerator } from "./PasswordGenerator";

interface PasswordFieldInputProps {
	value: string;
	onChange: (value: string) => void;
	readOnly?: boolean;
	/** Forwarded to the input for label association. Generated when omitted. */
	id?: string;
	/** Extra classes for the input, so callers can match their own field styles. */
	inputClassName?: string;
	placeholder?: string;
	disabled?: boolean;
	/** Pass `null` for fields that must not cap length (master passwords). */
	maxLength?: number | null;
	/** Hide the generator button (e.g. on a "confirm password" field). */
	allowGenerate?: boolean;
	/** Show a strength meter under the input. */
	showStrength?: boolean;
	/** Match the size of the other fields in the surrounding form. */
	size?: "sm" | "md";
}

/**
 * A masked text input for a password, with three inline actions: reveal,
 * copy, and a generator dialog (length slider + character-set checkboxes).
 * Use it for every password field so the affordances stay consistent across
 * entry editing, vault creation and vault settings.
 */
export function PasswordFieldInput({
	value,
	onChange,
	readOnly = false,
	id,
	inputClassName = "",
	placeholder,
	disabled = false,
	maxLength = 128,
	allowGenerate = true,
	showStrength = false,
	size = "md",
}: PasswordFieldInputProps) {
	const { t } = useTranslation("home");
	const autoId = useId();
	const inputId = id ?? autoId;
	const [showPassword, setShowPassword] = useState(false);
	const [showGenerator, setShowGenerator] = useState(false);
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const editable = !readOnly && !disabled;
	const inputSize = size === "sm" ? "input-sm" : "";
	// .btn-circle takes its size from --size-field, so the buttons must carry the
	// same size modifier as the input or the row reads as misaligned.
	const buttonSize = size === "sm" ? "btn-sm" : "btn-md";

	// How many action buttons overlay the input's right edge.
	const trailingCount =
		1 + (value ? 1 : 0) + (editable && allowGenerate ? 1 : 0);

	const revealLabel = showPassword
		? t("vault.fields.hidePassword")
		: t("vault.fields.showPassword");
	const generatorLabel = t("vault.passwordGenerator.title");
	const copyLabel = copied
		? t("vault.passwordGenerator.copied")
		: t("vault.passwordGenerator.copy");

	const handleCopy = async () => {
		if (!value) return;
		try {
			await copySensitive(value);
			setCopied(true);
			if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => {
				setCopied(false);
				copiedTimer.current = null;
			}, 2000);
		} catch {
			// Clipboard write failed; the text can still be selected manually.
		}
	};

	useEffect(() => {
		return () => {
			if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
		};
	}, []);

	return (
		/*
		 * One root that claims the full width of whatever hosts it. Callers put
		 * this field inside a `flex` value row, so without `w-full` the whole row
		 * shrinks to its intrinsic size and the input collapses onto daisyUI's
		 * `clamp(3rem, 20rem, 100%)` floor. The strength meter is a sibling of
		 * the row, so it must not become a second column in that row either.
		 */
		<div className="w-full min-w-0">
			{/*
			 * The action buttons float inside the input's right padding rather
			 * than sitting next to it, so the field's box is exactly as wide as
			 * every other field in the form. The padding must be a literal class
			 * per button count — Tailwind cannot see interpolated `pr-${n}`.
			 */}
			<div className="relative flex w-full items-center">
				<input
					id={inputId}
					ref={inputRef}
					type={showPassword ? "text" : "password"}
					className={`input ${inputSize} w-full min-w-0 font-mono ${
						TRAILING_PADDING[`${size}-${trailingCount}`]
					} ${readOnly ? "bg-base-100" : ""} ${inputClassName}`}
					placeholder={placeholder ?? t("vault.fields.valuePlaceholder")}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					maxLength={maxLength ?? undefined}
					readOnly={readOnly}
					disabled={disabled}
					/* Deliberate: a password manager must not let the embedded WebView
					   offer to save or autofill the credentials it is storing. */
					autoComplete="off"
					spellCheck={false}
				/>
				<div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
					<IconButton
						size={buttonSize}
						label={revealLabel}
						onClick={() => setShowPassword((prev) => !prev)}
					>
						<EyeIcon open={showPassword} />
					</IconButton>
					{value && (
						<IconButton
							size={buttonSize}
							label={copyLabel}
							onClick={handleCopy}
						>
							{copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
						</IconButton>
					)}
					{editable && allowGenerate && (
						<IconButton
							size={buttonSize}
							label={generatorLabel}
							onClick={() => setShowGenerator(true)}
							active={showGenerator}
						>
							<WandIcon />
						</IconButton>
					)}
				</div>
			</div>
			{showStrength && value ? <StrengthMeter value={value} /> : null}
			<Modal isOpen={showGenerator} onClose={() => setShowGenerator(false)}>
				<h3 className="font-bold text-lg mb-4">{generatorLabel}</h3>
				<PasswordGenerator
					onAccept={(password) => {
						onChange(password);
						setShowPassword(true);
						setShowGenerator(false);
						// Bring the user back to the field they just filled.
						inputRef.current?.focus();
					}}
				/>
			</Modal>
		</div>
	);
}

function IconButton({
	label,
	onClick,
	active = false,
	size = "btn-md",
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	size?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			className={`btn btn-ghost ${size} btn-circle shrink-0 ${
				active ? "text-primary" : "text-base-content/60"
			}`}
			title={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

/**
 * Icons inside a labelled button are decorative: the button carries the
 * accessible name, so every glyph is aria-hidden.
 */
function Icon({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<svg
			className={`w-4 h-4 ${className}`}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

function EyeIcon({ open }: { open: boolean }) {
	return open ? (
		<Icon>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L7.05 6.05M9.878 9.878a3 3 0 105.303-.572m0 0a3 3 0 01-4.243-4.243m4.242 4.243L15.95 17.95"
			/>
		</Icon>
	) : (
		<Icon>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
			/>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
			/>
		</Icon>
	);
}

function CopyIcon() {
	return (
		<Icon>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
			/>
		</Icon>
	);
}

function CheckIcon({ className = "" }: { className?: string }) {
	return (
		<Icon className={className}>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M5 13l4 4L19 7"
			/>
		</Icon>
	);
}

/** Key icon: the generator's "produce a credential" affordance. */
function WandIcon() {
	return (
		<Icon>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
			/>
		</Icon>
	);
}

/**
 * Right padding that keeps the text clear of the overlaid buttons.
 * Total = 4px (right-1) + n * button + (n - 1) * 2px (gap-0.5), where a
 * btn-sm is 32px and a btn-md is 40px. Literal keys only: Tailwind cannot
 * generate classes from interpolated values.
 */
const TRAILING_PADDING: Record<string, string> = {
	"sm-1": "pr-9",
	"sm-2": "pr-[4.5rem]",
	"sm-3": "pr-[6.5rem]",
	"md-1": "pr-11",
	"md-2": "pr-[5.5rem]",
	"md-3": "pr-32",
};

/** Strength classes must be literal so Tailwind can pick them up at build time. */
const STRENGTH_STYLES = {
	weak: { bar: "progress-error", badge: "badge-error" },
	fair: { bar: "progress-warning", badge: "badge-warning" },
	good: { bar: "progress-info", badge: "badge-info" },
	strong: { bar: "progress-success", badge: "badge-success" },
} as const;

type StrengthLevel = keyof typeof STRENGTH_STYLES;

/**
 * Rough entropy estimate for a typed password, used only for the inline meter.
 * The generator panel does the precise calculation from its own options.
 */
function classifyStrength(value: string): {
	level: StrengthLevel;
	bits: number;
} {
	let pool = 0;
	if (/[a-z]/.test(value)) pool += 26;
	if (/[A-Z]/.test(value)) pool += 26;
	if (/[0-9]/.test(value)) pool += 10;
	if (/[^a-zA-Z0-9]/.test(value)) pool += 27;
	const bits = pool > 1 ? Math.round(value.length * Math.log2(pool)) : 0;
	const level: StrengthLevel =
		bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "good" : "strong";
	return { level, bits };
}

function StrengthMeter({ value }: { value: string }) {
	const { t } = useTranslation("home");
	const { level, bits } = classifyStrength(value);
	const labelKey =
		level === "weak"
			? "vault.passwordGenerator.strengthWeak"
			: level === "fair"
				? "vault.passwordGenerator.strengthFair"
				: level === "good"
					? "vault.passwordGenerator.strengthGood"
					: "vault.passwordGenerator.strengthStrong";
	const label = t(labelKey);

	return (
		<div className="flex w-full items-center gap-2 mt-1">
			<progress
				className={`progress ${STRENGTH_STYLES[level].bar} h-1.5 flex-1`}
				value={Math.min(bits, 100)}
				max={100}
				aria-label={label}
			/>
			<span
				className={`badge badge-xs ${STRENGTH_STYLES[level].badge} badge-outline`}
			>
				{label}
			</span>
		</div>
	);
}
