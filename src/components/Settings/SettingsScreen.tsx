/**
 * SettingsScreen main layout component.
 * Composes GeneralSettings, AppearanceSettings, and ResetSection.
 * Handles i18n, accessibility, and navigation.
 * @module SettingsScreen
 */
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import GeneralSettings from './GeneralSettings'
import AppearanceSettings from './AppearanceSettings'
import ResetSection from './ResetSection'

function SettingsScreen () {
	const { t } = useTranslation('settings')
	return (
		<main className='p-4 w-full'>
			<div className='flex items-center justify-between mb-4'>
				<h1 className='text-3xl font-bold'>{t('title')}</h1>
				<Link to='/' className='btn btn-outline btn-sm'>{t('backButton')}</Link>
			</div>
			<div className='max-w mx-auto'>
				<div className='card bg-base-100 shadow-xl'>
					<div
						className='card-body'
						role='group'
						aria-labelledby='settingsSection'
						tabIndex={0}
					>
						<span id='settingsSection' className='sr-only'>{t('general.sectionLabel', 'Settings Section')}</span>
						<GeneralSettings />
						<AppearanceSettings />
						<ResetSection />
					</div>
				</div>
			</div>
		</main>
	)
}

export default SettingsScreen