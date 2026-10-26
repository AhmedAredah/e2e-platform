import type { EngineHandle } from '@e2e-cpp/core/engine';
import { NativeEngine } from './engine/native-engine.ts';
import type { NativeOptions } from './options.ts';

export { NativeEngine } from './engine/native-engine.ts';
export type { NativeProcessLaunch } from './engine/native-process.ts';
export { NativeDriver, type NativeInitialization, type NativeScreenshot } from './driver/native-driver.ts';
export { RpcNativeDriver } from './driver/rpc-native-driver.ts';
export { NativeTransport, type RequestContext } from './transport/native-transport.ts';
export { JsonRpcTcpTransport } from './transport/json-rpc-tcp.ts';
export type { NativeOptions } from './options.ts';

/** Launch an application containing an authenticated protocol-v1 helper. */
export function native(options: NativeOptions = {}): EngineHandle { return new NativeEngine(options).handle(); }

/** Qt profile of the native protocol; the application must include the Qt helper. */
export function qt(options: NativeOptions = {}): EngineHandle { return native({ ...options, platform: options.platform ?? 'qt' }); }
