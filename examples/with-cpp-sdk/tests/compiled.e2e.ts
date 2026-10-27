import { registerCppTests } from '@e2e-platform/cpp';
const executable = process.env['E2E_CPP_TEST_BINARY'];
if (!executable) throw new Error('Set E2E_CPP_TEST_BINARY to the compiled C++ test executable');
await registerCppTests({ executable });
