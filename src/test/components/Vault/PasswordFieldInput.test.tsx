import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PasswordFieldInput } from "../../../components/Vault/PasswordFieldInput";

// Mock the translation hook: returning the key keeps assertions tied to i18n keys.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

/** Controlled wrapper, mirroring how the modals wire the field up. */
function Harness({
	initialValue = "",
	...props
}: React.ComponentProps<typeof PasswordFieldInput> & {
	initialValue?: string;
}) {
	const [value, setValue] = useState(initialValue);
	return (
		<>
			<PasswordFieldInput {...props} value={value} onChange={setValue} />
			<span data-testid="current-value">{value}</span>
		</>
	);
}

const input = () =>
	screen.getByPlaceholderText("vault.fields.valuePlaceholder");

const openGenerator = () =>
	fireEvent.click(
		screen.getByRole("button", { name: "vault.passwordGenerator.title" }),
	);

/**
 * The generator lives in a daisyUI <dialog>, which jsdom reports as hidden
 * unless showModal() is called, so role queries need `hidden: true`.
 */
const inModal = <T extends HTMLElement>(
	role: Parameters<typeof screen.getByRole>[0],
	name: string,
) => screen.getByRole(role, { name, hidden: true }) as T;

describe("PasswordFieldInput", () => {
	it("renders the input with reveal and generator actions", () => {
		render(<Harness />);

		expect(input()).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "vault.fields.showPassword" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "vault.passwordGenerator.title" }),
		).toBeInTheDocument();
	});

	it("masks the value until reveal is toggled", () => {
		render(<Harness initialValue="hunter2" />);

		expect(input()).toHaveAttribute("type", "password");
		fireEvent.click(
			screen.getByRole("button", { name: "vault.fields.showPassword" }),
		);
		expect(input()).toHaveAttribute("type", "text");
		fireEvent.click(
			screen.getByRole("button", { name: "vault.fields.hidePassword" }),
		);
		expect(input()).toHaveAttribute("type", "password");
	});

	it("opens the generator with a length slider and character-set checkboxes", () => {
		render(<Harness />);
		openGenerator();

		const slider = inModal<HTMLInputElement>(
			"slider",
			"vault.passwordGenerator.length",
		);
		expect(slider).toBeInTheDocument();
		expect(slider).toHaveAttribute("min", "8");
		expect(slider).toHaveAttribute("max", "128");

		for (const set of ["uppercase", "lowercase", "numbers", "symbols"]) {
			expect(
				inModal<HTMLInputElement>("checkbox", `vault.passwordGenerator.${set}`),
			).toBeChecked();
		}
	});

	it("generates a password honouring the length and symbol settings", () => {
		render(<Harness />);
		openGenerator();

		fireEvent.change(inModal("slider", "vault.passwordGenerator.length"), {
			target: { value: "12" },
		});
		fireEvent.click(inModal("checkbox", "vault.passwordGenerator.symbols"));

		const preview = screen.getByTestId("generated-password").textContent ?? "";
		expect(preview).toHaveLength(12);
		expect(preview).toMatch(/^[A-Za-z0-9]+$/);

		fireEvent.click(inModal("button", "vault.passwordGenerator.usePassword"));
		expect(screen.getByTestId("current-value").textContent).toBe(preview);
	});

	it("writes the accepted password back into the field and reveals it", () => {
		render(<Harness />);
		openGenerator();

		fireEvent.click(inModal("button", "vault.passwordGenerator.usePassword"));

		const generated = screen.getByTestId("current-value").textContent ?? "";
		expect(generated.length).toBeGreaterThanOrEqual(8);
		expect(input()).toHaveValue(generated);
		// The field must not be read-only just because the value came from the generator.
		expect(input()).not.toHaveAttribute("readOnly");
	});

	it("hides the generator action for read-only and confirm fields", () => {
		const { rerender } = render(<Harness readOnly />);
		expect(
			screen.queryByRole("button", { name: "vault.passwordGenerator.title" }),
		).not.toBeInTheDocument();

		rerender(<Harness allowGenerate={false} />);
		expect(
			screen.queryByRole("button", { name: "vault.passwordGenerator.title" }),
		).not.toBeInTheDocument();
	});

	it("shows a strength meter when requested", () => {
		render(<Harness initialValue="short" showStrength />);
		expect(
			screen.getByText("vault.passwordGenerator.strengthWeak"),
		).toBeInTheDocument();
	});
});
