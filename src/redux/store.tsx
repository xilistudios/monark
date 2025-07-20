import { configureStore } from '@reduxjs/toolkit'
import vault, { loadVaultStateFromSettings, restoreVaultState } from './actions/vault'
import preferences, {loadPreferencesFromSettings, restorePreferencesState} from './actions/preferences'
import { settingsStore } from '../store/settings'

export const store = configureStore({
  reducer: {
    vault,
    preferences,
  },
})

// Initialize vault state from settings store
export const initializeVaultState = async () => {
  try {
    await settingsStore.init()
    const savedState = await loadVaultStateFromSettings()
    if (Object.keys(savedState).length > 0) {
      store.dispatch(restoreVaultState(savedState))
    }
    const preferences = await loadPreferencesFromSettings()
    store.dispatch(restorePreferencesState(preferences))
  } catch (error) {
    console.error('Failed to initialize vault state:', error)
  }
}

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = {
  vault: ReturnType<typeof vault>
  preferences: ReturnType<typeof preferences>
}
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch