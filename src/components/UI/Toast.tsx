import { useEffect, useState } from "react";

interface ToastProps {
	message: string;
	isVisible: boolean;
	onHide: () => void;
	type?: "success" | "error" | "warning" | "info";
}

export function Toast({
	message,
	isVisible,
	onHide,
	type = "success",
}: ToastProps) {
	const [showToast, setShowToast] = useState(false);

	useEffect(() => {
		let hideTimer: NodeJS.Timeout;
		let callbackTimer: NodeJS.Timeout;

		if (isVisible) {
			setShowToast(true);
			hideTimer = setTimeout(() => {
				setShowToast(false);
				callbackTimer = setTimeout(onHide, 300); // Wait for animation to complete
			}, 3000);
		} else {
			setShowToast(false);
		}

		return () => {
			clearTimeout(hideTimer);
			clearTimeout(callbackTimer);
		};
	}, [isVisible, onHide]);

	if (!showToast && !isVisible) {
		return null;
	}

	const getAlertClass = (): string => {
		switch (type) {
			case "error":
				return "alert-error";
			case "warning":
				return "alert-warning";
			case "info":
				return "alert-info";
			default:
				return "alert-success";
		}
	};

	const getIcon = (): React.ReactNode => {
		switch (type) {
			case "error":
				return (
					<svg
						className="w-5 h-5 shrink-0 stroke-current"
						fill="none"
						viewBox="0 0 24 24"
						role="img"
						aria-label="Error icon"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				);
			case "warning":
				return (
					<svg
						className="w-5 h-5 shrink-0 stroke-current"
						fill="none"
						viewBox="0 0 24 24"
						role="img"
						aria-label="Warning icon"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				);
			case "info":
				return (
					<svg
						className="w-5 h-5 shrink-0 stroke-current"
						fill="none"
						viewBox="0 0 24 24"
						role="img"
						aria-label="Info icon"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				);
			default:
				return (
					<svg
						className="w-5 h-5 shrink-0 stroke-current"
						fill="none"
						viewBox="0 0 24 24"
						role="img"
						aria-label="Success icon"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				);
		}
	};

	return (
		<div
			className="toast toast-end toast-bottom"
			role="alert"
			aria-live="polite"
		>
			<div
				className={`alert ${getAlertClass()} transition-opacity duration-300 ${
					isVisible ? "opacity-100" : "opacity-0"
				}`}
			>
				{getIcon()}
				<span className="text-sm font-medium">{message}</span>
			</div>
		</div>
	);
}
