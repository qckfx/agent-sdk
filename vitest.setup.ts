import { vi } from 'vitest';

// Mock the jest object for compatibility
globalThis.jest = {
  fn: vi.fn,
  mock: vi.mock,
  spyOn: vi.spyOn,
  mockImplementation: vi.fn,
  mockReturnValue: vi.fn,
  mockResolvedValue: vi.fn,
  // Add other Jest functions as needed
};
