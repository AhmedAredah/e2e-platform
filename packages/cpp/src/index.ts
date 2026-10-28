import { registerAuthoredTests, type AuthoredTestOptions } from '@e2e-platform/authoring';

export type CppTestOptions = Omit<AuthoredTestOptions, 'language'>;

/** Registers compiled C++ cases through the shared bounded authoring host. */
export async function registerCppTests(options: CppTestOptions): Promise<void> {
  await registerAuthoredTests({ ...options, language: 'C++' });
}
