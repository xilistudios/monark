# Cloud Storage Testing Guide

This document provides comprehensive guidance for testing cloud storage functionality in Monark, including automated tests, manual testing procedures, and troubleshooting.

## Table of Contents

1. [Overview](#overview)
2. [Automated Testing](#automated-testing)
3. [Manual Testing Procedures](#manual-testing-procedures)
4. [Test Scenarios Covered](#test-scenarios-covered)
5. [Known Limitations](#known-limitations)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Coverage Goals](#coverage-goals)

## Overview

Cloud storage testing in Monark ensures that vault operations work seamlessly across different storage providers, with proper error handling, synchronization, and security. The testing strategy includes:

- **Unit Tests**: Individual component and service testing
- **Integration Tests**: End-to-end workflow testing
- **Manual Testing**: OAuth flows and real provider interactions

## Automated Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run only cloud storage tests
npm run test -- --grep "Cloud Vault"
```

### Test Structure

```
src/test/
├── integration/
│   └── cloudVaultIntegration.test.ts    # End-to-end cloud vault workflows
├── services/
│   ├── cloudStorage.test.ts             # Cloud storage service tests
│   └── vault.test.ts                    # Vault manager tests with cloud scenarios
├── redux/
│   └── vault.test.ts                    # Redux state management tests
├── components/
│   └── Vault/
│       └── CloudVaultIndicator.test.tsx # Component tests with cloud scenarios
└── helpers/
    └── cloudStorageMocks.ts             # Mock utilities and test data
```

### Key Test Files

#### 1. Integration Tests (`cloudVaultIntegration.test.ts`)
Comprehensive end-to-end tests covering:
- Provider management workflows
- Cloud vault creation and import
- Vault operations (add, update, delete entries)
- Synchronization scenarios
- Error handling and edge cases

#### 2. Mock Helpers (`cloudStorageMocks.ts`)
Provides:
- Mock Tauri invoke implementations
- Sample provider and vault data
- Error simulation utilities
- Test scenario setup functions

#### 3. Service Tests (`cloudStorage.test.ts`, `vault.test.ts`)
Unit tests for:
- Cloud storage commands
- Vault manager operations
- Provider authentication
- Error handling

## Manual Testing Procedures

### OAuth Authentication Flow Testing

Since OAuth requires actual browser interaction with cloud providers, manual testing is necessary for complete validation.

#### Prerequisites

1. **Google Cloud Console Setup**
   - Create a new project or use existing one
   - Enable Google Drive API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URI: `http://localhost:1420/auth/callback`

2. **Test Environment**
   - Development server running: `npm run dev`
   - Browser with pop-ups enabled
   - Test Google account with Drive access

#### Test Procedure

1. **Add Google Drive Provider**
   ```
   1. Navigate to Settings → Cloud Storage
   2. Click "Add Provider"
   3. Select "Google Drive"
   4. Enter OAuth credentials:
      - Client ID: [your-test-client-id]
      - Client Secret: [your-test-client-secret]
      - Redirect URI: http://localhost:1420/auth/callback
   5. Click "Add Provider"
   6. Verify provider appears in list
   ```

2. **Authenticate Provider**
   ```
   1. Click "Authenticate" next to Google Drive provider
   2. Verify OAuth popup opens
   3. Complete Google authentication flow
   4. Verify redirect back to app
   5. Check provider status shows "Authenticated"
   ```

3. **Create Cloud Vault**
   ```
   1. Navigate to main vault screen
   2. Click "Add Vault"
   3. Select "Cloud Storage"
   4. Choose Google Drive provider
   5. Enter vault name and password
   6. Click "Create Vault"
   7. Verify vault appears in list with cloud indicator
   ```

4. **Test Vault Operations**
   ```
   1. Unlock the cloud vault
   2. Add new entries
   3. Update existing entries
   4. Delete entries
   5. Lock vault
   6. Unlock again to verify changes persisted
   ```

### Real Provider Testing

#### Test Scenarios

1. **Network Connectivity**
   - Test with stable internet connection
   - Test with intermittent connection
   - Test offline behavior

2. **Large Files**
   - Create vault with many entries (1000+)
   - Test sync performance
   - Verify no data corruption

3. **Concurrent Access**
   - Open same vault on multiple devices
   - Make simultaneous changes
   - Verify conflict resolution

4. **Provider Limits**
   - Test with Google Drive quota limits
   - Verify proper error messages
   - Test recovery scenarios

## Test Scenarios Covered

### Automated Tests

#### Provider Management (100% Coverage)
- [x] Add Google Drive provider
- [x] List all providers
- [x] Set default provider
- [x] Remove provider
- [x] Handle provider authentication
- [x] Handle authentication failures

#### Cloud Vault Creation (100% Coverage)
- [x] Create cloud vault with authenticated provider
- [x] Verify Redux state updates
- [x] Verify VaultManager metadata creation
- [x] Handle missing provider errors
- [x] Handle creation failures

#### Cloud Vault Import (100% Coverage)
- [x] Import existing cloud vaults
- [x] Verify metadata handling
- [x] List vaults from provider
- [x] Handle empty vault lists

#### Cloud Vault Operations (90%+ Coverage)
- [x] Add entries to cloud vault
- [x] Update entries in cloud vault
- [x] Delete entries from cloud vault
- [x] Verify cloud synchronization
- [x] Handle concurrent operations
- [x] Performance testing with large vaults

#### Sync Operations (100% Coverage)
- [x] Manual sync operations
- [x] Sync status updates
- [x] Sync error handling
- [x] Network error recovery

#### Error Scenarios (80%+ Coverage)
- [x] Authentication failures
- [x] Token expiration
- [x] Network errors
- [x] Quota exceeded
- [x] Provider disconnection
- [x] Metadata corruption

### Manual Tests (OAuth Flow)

#### Authentication Flow
- [ ] Complete Google OAuth flow
- [ ] Handle authentication cancellation
- [ ] Handle token refresh
- [ ] Test with different Google accounts

#### Real Provider Integration
- [ ] Test with actual Google Drive
- [ ] Verify file creation in Drive
- [ ] Test file synchronization
- [ ] Verify file permissions

## Known Limitations

### Automated Testing Limitations

1. **OAuth Flow**: Cannot fully test OAuth authentication without real browser interaction
2. **Network Conditions**: Limited simulation of real network scenarios
3. **Provider APIs**: Cannot test against actual provider APIs in automated tests
4. **Browser Storage**: Limited testing of browser-specific storage behaviors

### Workarounds

1. **OAuth Testing**: Use manual testing procedures documented above
2. **Network Simulation**: Use mock error scenarios for common network issues
3. **Provider API Testing**: Set up test accounts with real providers for manual validation

## Troubleshooting Guide

### Common Test Failures

#### 1. Mock Invocation Errors
```
Error: invoke is not a function
```
**Solution**: Ensure Tauri API is properly mocked in test setup
```typescript
// In setup.ts
global.window.__TAURI_INTERNALS__ = {
  invoke: vi.fn(),
};
```

#### 2. Redux State Issues
```
Error: Vault not found in state
```
**Solution**: Verify Redux store is properly initialized with required state
```typescript
const store = configureStore({
  reducer: { vault: vaultReducer },
  preloadedState: {
    vault: {
      vaults: [],
      providers: mockProviders,
      // ... other required state
    }
  }
})
```

#### 3. Async Test Timeouts
```
Error: Test timeout exceeded
```
**Solution**: Use proper async/await patterns and increase timeout if needed
```typescript
it('should handle async operations', async () => {
  const result = await someAsyncOperation()
  expect(result).toBeDefined()
}, 10000) // Increase timeout to 10 seconds
```

#### 4. Mock Data Inconsistencies
```
Error: Expected mock data to match
```
**Solution**: Ensure mock data structure matches interface definitions
```typescript
// Verify mock data matches interfaces
const mockVault: Vault = {
  id: 'test-id',
  name: 'Test Vault',
  storageType: 'cloud', // Required
  providerId: 'test-provider', // Required for cloud vaults
  // ... other required fields
}
```

### Debugging Tips

1. **Use Test UI**: Run `npm run test:ui` for interactive debugging
2. **Console Logging**: Add debug logs to understand test flow
3. **Mock Verification**: Verify mock calls are made correctly
4. **State Inspection**: Check Redux state at different test stages

### Performance Issues

1. **Slow Tests**: Optimize mock data size and reduce unnecessary operations
2. **Memory Leaks**: Ensure proper cleanup in `afterEach` hooks
3. **Async Operations**: Use proper async patterns and avoid race conditions

## Coverage Goals

### Target Coverage

| Category | Target | Current | Notes |
|----------|--------|---------|-------|
| Provider Management | 100% | ✅ | All CRUD operations covered |
| Cloud Vault Creation | 100% | ✅ | Including error scenarios |
| Cloud Vault Import | 100% | ✅ | All import flows tested |
| Cloud Vault Operations | 90%+ | ✅ | OAuth flow requires manual testing |
| Sync Operations | 100% | ✅ | All sync scenarios covered |
| Error Scenarios | 80%+ | ✅ | Common errors covered |

### Coverage Measurement

```bash
# Generate coverage report
npm run test:coverage

# View detailed coverage
open coverage/lcov-report/index.html
```

### Improving Coverage

1. **Add Edge Cases**: Test unusual input combinations
2. **Error Paths**: Ensure all error branches are tested
3. **Integration Points**: Test component interactions
4. **Browser Compatibility**: Test different browser behaviors

## Best Practices

### Test Development

1. **Arrange-Act-Assert Pattern**: Structure tests clearly
2. **Descriptive Names**: Use clear, descriptive test names
3. **Isolation**: Ensure tests don't depend on each other
4. **Mock Management**: Use consistent mock patterns

### Mock Usage

1. **Consistent Mocks**: Use the mock helper utilities
2. **Reset Mocks**: Clear mocks between tests
3. **Realistic Data**: Use realistic test data
4. **Error Simulation**: Test both success and failure cases

### Continuous Integration

1. **Test Automation**: Run tests on every commit
2. **Coverage Gates**: Set minimum coverage thresholds
3. **Test Parallelization**: Run tests in parallel for speed
4. **Test Reporting**: Generate and review coverage reports

## Conclusion

This comprehensive testing strategy ensures that cloud storage functionality in Monark is reliable, secure, and performs well across different scenarios. The combination of automated tests and manual testing procedures provides thorough coverage of both technical functionality and user experience.

Regular review and updates to this testing guide will help maintain high quality as the cloud storage features evolve.