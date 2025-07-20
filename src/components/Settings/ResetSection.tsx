/**
 * ResetSection component for resetting preferences to defaults.
 * Handles confirmation, Redux dispatch, i18n, and accessibility.
 * @module ResetSection
 */
import { useDispatch, useSelector } from 'react-redux'
import { useTranslation } from 'react-i18next'
import { setPreferences } from '../../redux/actions/preferences'
import { DEFAULT_SETTINGS } from '../../share/settings'

function ResetSection () {
	const dispatch = useDispatch()
	const loading = useSelector((state: any) => state.preferences.loading)
	const { t } = useTranslation('settings')

	const handleReset = () => {
		if (window.confirm(t('general.resetConfirm', 'Reset all preferences?'))) {
			dispatch(setPreferences(DEFAULT_SETTINGS))
		}
	}

	return (
		<section className='flex items-center gap-4 mt-8'>
			<button
				className='btn btn-error'
				aria-label={t('general.resetAriaLabel', 'Reset to Defaults')}
				onClick={handleReset}
				disabled={loading}
			>
				{t('resetButton')}
			</button>
		</section>
	)
}

export default ResetSection