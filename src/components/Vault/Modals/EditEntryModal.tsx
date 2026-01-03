/**
 * EditEntryModal has been removed from the codebase.
 *
 * The editing functionality has been moved to EntryDetailsSidebar which now supports
 * both 'view' and 'edit' modes. The sidebar provides a better user experience by
 * keeping the editing context within the main interface rather than in a separate modal.
 *
 * To edit an entry:
 * 1. Select the entry to view it in the sidebar
 * 2. Click the edit button to switch to edit mode
 * 3. Make changes and save or cancel
 *
 * This change simplifies the codebase by removing duplicate editing logic and
 * provides a more consistent user interface.
 */

export const EditEntryModal = () => {
	// This component has been removed. Use EntryDetailsSidebar with mode="edit" instead.
	return null;
};
