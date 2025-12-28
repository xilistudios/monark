import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toast } from "../../../components/UI/Toast";

function getAlertElement() {
	const toast = screen.getByRole("alert");
	const alert = toast.querySelector(".alert");
	if (!alert) {
		throw new Error("Expected .alert element to be present inside the toast");
	}
	return alert;
}

describe("Toast", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("renders correctly when isVisible is true", () => {
		const onHide = vi.fn();
		render(
			<Toast message="Hello" isVisible={true} onHide={onHide} type="success" />,
		);

		const toast = screen.getByRole("alert");
		expect(toast).toHaveClass("toast", "toast-end", "toast-bottom");
		expect(toast).toHaveAttribute("aria-live", "polite");

		const alert = getAlertElement();
		expect(alert).toHaveClass("alert", "alert-success");
	});

	it("does not render when isVisible is false", () => {
		const onHide = vi.fn();
		render(
			<Toast
				message="Hidden"
				isVisible={false}
				onHide={onHide}
				type="success"
			/>,
		);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("displays the message correctly", () => {
		const onHide = vi.fn();
		render(
			<Toast message="Saved successfully" isVisible={true} onHide={onHide} />,
		);

		expect(screen.getByText("Saved successfully")).toBeInTheDocument();
	});

	it("applies transition classes and visible opacity", () => {
		const onHide = vi.fn();
		render(<Toast message="Fades" isVisible={true} onHide={onHide} />);

		const alert = getAlertElement();
		expect(alert).toHaveClass(
			"transition-opacity",
			"duration-300",
			"opacity-100",
		);
	});

	it("includes accessibility attributes (role, aria-live) and icon semantics", () => {
		const onHide = vi.fn();
		render(
			<Toast
				message="Accessible"
				isVisible={true}
				onHide={onHide}
				type="info"
			/>,
		);

		const toast = screen.getByRole("alert");
		expect(toast).toHaveAttribute("role", "alert");
		expect(toast).toHaveAttribute("aria-live", "polite");

		const icon = screen.getByLabelText("Info icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon).toHaveAttribute("role", "img");
	});

	it("auto-hide: calls onHide after the 3s delay plus the 300ms transition", async () => {
		vi.useFakeTimers();
		const onHide = vi.fn();
		render(<Toast message="Auto-hide" isVisible={true} onHide={onHide} />);

		await act(async () => {
			vi.advanceTimersByTime(2999);
		});
		expect(onHide).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		expect(onHide).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(299);
		});
		expect(onHide).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		expect(onHide).toHaveBeenCalledTimes(1);
	});

	it.each([
		["success", "alert-success"],
		["error", "alert-error"],
		["warning", "alert-warning"],
		["info", "alert-info"],
	] as const)(
		"applies the correct alert class for type %s",
		(type, expectedClass) => {
			const onHide = vi.fn();
			render(
				<Toast
					message="Type test"
					isVisible={true}
					onHide={onHide}
					type={type}
				/>,
			);

			const alert = getAlertElement();
			expect(alert).toHaveClass("alert", expectedClass);
		},
	);

	it.each([
		["success", "Success icon"],
		["error", "Error icon"],
		["warning", "Warning icon"],
		["info", "Info icon"],
	] as const)("renders the correct icon for type %s", (type, label) => {
		const onHide = vi.fn();
		render(
			<Toast
				message="Icon test"
				isVisible={true}
				onHide={onHide}
				type={type}
			/>,
		);

		expect(screen.getByLabelText(label)).toBeInTheDocument();
	});

	it("cleans up the auto-hide timer on unmount", async () => {
		vi.useFakeTimers();
		const onHide = vi.fn();
		const { unmount } = render(
			<Toast message="Cleanup" isVisible={true} onHide={onHide} />,
		);

		unmount();

		await act(async () => {
			vi.advanceTimersByTime(10_000);
		});

		expect(onHide).not.toHaveBeenCalled();
	});

	it("defaults type to success when not provided", () => {
		const onHide = vi.fn();
		render(<Toast message="Default" isVisible={true} onHide={onHide} />);

		const alert = getAlertElement();
		expect(alert).toHaveClass("alert-success");
		expect(screen.getByLabelText("Success icon")).toBeInTheDocument();
	});
});
