import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface TotpResponse {
	code: string;
	seconds_remaining: number;
	period: number;
	digits: number;
}

interface OtpFieldViewProps {
	secret: string;
	onCopy: (value: string, fieldName?: string) => Promise<void>;
}

const CIRCUMFERENCE = 2 * Math.PI * 10;

export function OtpFieldView({ secret, onCopy }: OtpFieldViewProps) {
	const { t } = useTranslation("home");

	const [code, setCode] = useState<string>("");
	const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
	const [period, setPeriod] = useState<number>(30);
	const [error, setError] = useState<boolean>(false);

	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const secondsRef = useRef<number>(0);

	const clearTimer = useCallback(() => {
		if (intervalRef.current !== null) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, []);

	const fetchTotp = useCallback(async () => {
		try {
			const response = await invoke<TotpResponse>("generate_totp", { secret });
			setCode(response.code);
			setSecondsRemaining(response.seconds_remaining);
			secondsRef.current = response.seconds_remaining;
			setPeriod(response.period);
			setError(false);
		} catch {
			setError(true);
			setCode("");
			setSecondsRemaining(0);
			secondsRef.current = 0;
		}
	}, [secret]);

	// Fetch TOTP on mount and when secret changes
	useEffect(() => {
		if (!secret) return;

		fetchTotp();

		return () => {
			clearTimer();
		};
	}, [secret, fetchTotp, clearTimer]);

	// Start countdown interval once we have a valid code
	// biome-ignore lint/correctness/useExhaustiveDependencies: secondsRemaining is intentionally omitted — it changes every second via the interval and we only want to re-setup when a fresh code arrives
	useEffect(() => {
		if (error || !code || secondsRemaining <= 0) return;

		// Clear any existing interval before setting a new one
		clearTimer();

		intervalRef.current = setInterval(() => {
			secondsRef.current -= 1;
			const next = secondsRef.current;
			setSecondsRemaining(next);

			if (next <= 0) {
				clearTimer();
				fetchTotp();
			}
		}, 1000);

		return () => {
			clearTimer();
		};
	}, [code, error, fetchTotp, clearTimer]); // re-setup when code changes (i.e. after fetchTotp sets new code)

	const getColorClass = (): string => {
		if (secondsRemaining > period / 2) return "text-success";
		if (secondsRemaining > period / 4) return "text-warning";
		return "text-error";
	};

	// The text color class is used for the stroke color via currentColor

	const formatCode = (raw: string): string => {
		if (!raw || raw.length < 6) return raw;
		const mid = Math.floor(raw.length / 2);
		return `${raw.slice(0, mid)} ${raw.slice(mid)}`;
	};

	if (!secret) {
		return <p className="text-base-content/40 italic text-xs">No value</p>;
	}

	if (error) {
		return (
			<div className="flex items-center gap-2">
				<svg
					className="w-4 h-4 text-warning flex-shrink-0"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 9v2m0 4h.01M10.29 3.86l-8.58 14.86A1 1 0 002.58 20h18.84a1 1 0 00.86-1.28L13.71 3.86a1 1 0 00-1.72 0z"
					/>
				</svg>
				<span className="text-xs text-base-content/50">
					{t("vault.fields.otpInvalid")}
				</span>
				<button
					type="button"
					className="btn btn-ghost btn-sm btn-circle text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
					onClick={() => onCopy(secret)}
					title={t("vault.fields.copyButton")}
				>
					<svg
						className="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
				</button>
			</div>
		);
	}

	const dashoffset = CIRCUMFERENCE * (1 - secondsRemaining / period);

	return (
		<div className="flex items-center gap-2.5">
			<span
				className={`font-mono text-lg font-bold tracking-widest ${getColorClass()} bg-base-300/30 px-2.5 py-1 rounded-lg border border-base-300/40 inline-block`}
			>
				{formatCode(code)}
			</span>

			<svg
				className="w-6 h-6 flex-shrink-0 -rotate-90"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				{/* Background track */}
				<circle
					cx={12}
					cy={12}
					r={10}
					fill="none"
					stroke="currentColor"
					strokeWidth={2.5}
					className="text-base-300"
				/>
				{/* Progress ring */}
				<circle
					cx={12}
					cy={12}
					r={10}
					fill="none"
					stroke="currentColor"
					strokeWidth={2.5}
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={dashoffset}
					strokeLinecap="round"
					className={getColorClass()}
					style={{ transition: "stroke-dashoffset 1s linear" }}
				/>
			</svg>

			<button
				type="button"
				className="btn btn-ghost btn-sm btn-circle text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
				onClick={() => onCopy(code)}
				title={t("vault.fields.otpCopyCode")}
			>
				<svg
					className="w-4 h-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
					/>
				</svg>
			</button>
		</div>
	);
}
