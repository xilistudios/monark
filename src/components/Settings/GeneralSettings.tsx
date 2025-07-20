/**
 * GeneralSettings component for language selection.
 * Handles language change, error validation, Redux and i18n integration.
 * @module GeneralSettings
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../../redux/actions/preferences'
import { LANGUAGES, VALID_LANGUAGES } from '../../share/settings'

function GeneralSettings () {
	const dispatch = useDispatch()
	const preferences = useSelector((state: any) => state.preferences.preferences)
	const loading = useSelector((state: any) => state.preferences.loading)
	const language = preferences.language
	const { t } = useTranslation('settings')

	const [error, setError] = useState('')
	useEffect(() => {
		if (!VALID_LANGUAGES.includes(language)) {
			setError(t('errors.invalidLanguage'))
		} else {
			setError('')
		}
	}, [language, t])

	return (
		<section className='mb-8'>
			<form
				className='form-control w-full max-w-md mt-4'
				aria-label={t('general.languageAriaLabel', 'Language Selection')}
				role='group'
				aria-labelledby='settingsSection'
				tabIndex={0}
			>
				<label htmlFor='language' className='label'>
					<span className='label-text'>{t('language')}</span>
				</label>
				<div className='input-group'>
					<select
						id='language'
						className='select select-bordered'
						value={language}
						onChange={e => dispatch(setLanguage(e.target.value))}
						disabled={loading}
						aria-label={t('general.languageAriaLabel', 'Application language')}
						aria-invalid={!!error}
						aria-describedby='languageError'
					>
						{LANGUAGES.map(lang => (
							<option key={lang.code} value={lang.code}>{lang.label}</option>
						))}
					</select>
				</div>
				<div id='languageError' role='alert'>
					{error && (
						<div className='alert alert-error text-error text-sm mt-1' style={{ backgroundColor: 'var(--b1)', color: 'var(--error)' }}>
							{error}
						</div>
					)}
				</div>
				{/* Add more preference fields here, bound to preferences */}
			</form>
		</section>
	)
}

export default GeneralSettings