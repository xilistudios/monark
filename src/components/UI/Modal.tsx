export interface ModalProps {
	isOpen: boolean;
	className?: string;
	onClose: () => void;
	children: React.ReactNode;
}
export const Modal = ({ isOpen, onClose, children, className }: ModalProps) => {
	return (
		<dialog className={`modal ${isOpen ? "modal-open" : ""} ${className}`}>
			<div className="modal-box">
				<form method="dialog">
					<button
						className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
						onClick={onClose}
					>
						✕
					</button>
				</form>
				{children}
			</div>
			<form method="dialog" className="modal-backdrop">
				<button onClick={onClose}>close</button>
			</form>
		</dialog>
	);
};
